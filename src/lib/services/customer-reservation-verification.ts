// Phase 64-A.32b: 顧客公開予約フロー (spec §12.1 step6-7) の email 6 桁コード本人確認 orchestration。
// ---------------------------------------------------------------------------
//
// A.32a (security core) が「コードの発行 (issue)」と「検証+消費 (verify)」を純 service として実装済み。
// 本モジュールはその上に「email 送信 (outbox)」と「予約作成 (createPublicReservation) との合流」を積む。
//
// 設計の核心 = 2 つの原子性 (両方とも単一 tx で囲い、片側だけ永続して詰む状態を作らない):
//
//   1. issue + outbox (requestReservationVerificationCode):
//      issue がコミットされたのに outbox 行が入らないと「コードは発行済みだが email が飛ばない」状態
//      (顧客が前に進めない) になる。よって issueVerificationCode と notification_outbox INSERT を
//      同一 tx に入れ、どちらも成功するか両方ロールバックするかに限定する (transport-orders と同型)。
//
//   2. verify + create (createVerifiedPublicReservation):
//      verify はコードを single-use 消費する。素朴に「verify→create」と直列にすると、create の
//      availability gate が落とす slot_unavailable (step3 選択〜step7 入力の数分で枠が埋まる “普通の”
//      race) のたびにコードが焼かれ、顧客は再発行を強いられる。これを避けるため verify(消費) と
//      create を同一 outer tx で実行し、create が失敗したら tx ごとロールバックしてコードを温存する
//      (= 検証成功と予約作成は不可分。slot_unavailable race でコードを焼かない)。
//      → createCustomerReservation は 23P01 (exclusion 違反) を内側 savepoint の外で捕捉して
//        slot_unavailable を返す設計のため、outer tx を渡しても savepoint が保護され outer tx は生存する
//        (customer-reservation-create.integration.test の二重予約テストが outerTx 経由で実証済み)。
//        その slot_unavailable 結果を見て本モジュールが意図的に throw → outer tx rollback で消費を取り消す。
//
// email binding (最重要・A.32a 不変条件の継承): verify は (company_id, normalize(email)) で active 行を
//   引き、HMAC にも email を畳み込む。よって本モジュールは createPublicReservation に渡す customer.email を
//   verify が返す verifiedEmail で必ず上書きし、**クライアント送信 email を予約に転用しない** (lookup key
//   としてのみ使う)。別 email / 別 company は verify が not_found 扱い (→ verification_failed)。
//
// oracle 緩和 (spec §12.3 / A.32b 引き継ぎ契約): not_found / invalid_code / expired / locked を
//   verification_failed 1 種へ畳む。remainingAttempts もクライアントへ漏らさない (試行カウンタの開示は
//   ブルートフォース支援になるため)。
//
// 本番露出は A.33 (Turnstile + IP/global 送信レート制限) 完了が hard 依存 (A.32a 不変条件の継承)。
// spec/CLAUDE.md ADR-0010 補項 (顧客 facing は service_role) / ADR-0011 use-case canonical 準拠。

import { z } from "zod";
import { db as serviceRoleDb } from "@/lib/db/client";
import { notificationOutbox } from "@/lib/db/schema/notification_outbox";
import {
  createPublicReservation,
  isPublicCompanyActive,
  type CreatePublicReservationInput,
  type CreatePublicReservationOptions,
  type CreatePublicReservationResult,
} from "@/lib/services/customer-reservation-public";
import { DEFAULT_TTL_MINUTES } from "@/lib/services/reservation-verification-code-crypto";
import {
  issueVerificationCode,
  verifyVerificationCode,
} from "@/lib/services/reservation-verification-codes";

// Drizzle does not expose a common DB/transaction interface that fits this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

// ---------------------------------------------------------------------------
// email テンプレート (純関数)
// ---------------------------------------------------------------------------

// outbox-dispatcher は payload.{to,subject,html,text} を直接読んで Resend に渡す (eventType からの
// テンプレート解決はしない)。よって送信内容は enqueue 時に確定させる。code は数字のみのため HTML
// インジェクションの余地はない (動的部分は code のみ)。件名にはコードを載せない (プレビュー漏洩防止)。
export function renderReservationVerificationEmail(input: { code: string; ttlMinutes: number }): {
  subject: string;
  html: string;
  text: string;
} {
  const { code, ttlMinutes } = input;
  const subject = "【ご予約】確認コードのお知らせ";
  const text =
    `ご予約手続きの確認コードは ${code} です。\n` +
    `${ttlMinutes}分以内に予約画面でご入力ください。\n\n` +
    `このメールに心当たりがない場合は破棄してください。`;
  const html =
    `<!doctype html><html lang="ja"><body style="font-family:sans-serif;line-height:1.6;color:#111827">` +
    `<p>ご予約手続きの確認コードは次のとおりです。</p>` +
    `<p style="font-size:28px;font-weight:700;letter-spacing:6px;margin:16px 0">${code}</p>` +
    `<p>${ttlMinutes}分以内に予約画面でご入力ください。</p>` +
    `<p style="color:#6b7280;font-size:13px">このメールに心当たりがない場合は破棄してください。</p>` +
    `</body></html>`;
  return { subject, html, text };
}

// ---------------------------------------------------------------------------
// requestReservationVerificationCode (issue + outbox enqueue, atomic)
// ---------------------------------------------------------------------------

export const RequestReservationVerificationCodeInput = z
  .object({
    companyId: z.string().uuid(),
    email: z.string().trim().email().max(320),
  })
  .strict();

export type RequestReservationVerificationCodeInput = z.input<
  typeof RequestReservationVerificationCodeInput
>;

export type RequestReservationVerificationCodeOptions = {
  db?: Db;
  now?: Date;
};

export type RequestReservationVerificationCodeResult =
  | { ok: true; outboxId: string }
  // rate_limited: 同一 (company,email) の直近発行が上限超過 (A.32a issue rate guard)。
  // route は本結果を ok と区別せず汎用 200 に畳む (issue-state を漏らさない) — 呼び出し側責務。
  | { ok: false; reason: "rate_limited" }
  // company_not_found: 公開対象でない company (不在/inactive/soft-deleted)。issue の INSERT が
  //   FK 23503 で 500 になるのを防ぎ、sibling route (slots/reservations) と同じ 404 に正規化する。
  | { ok: false; reason: "company_not_found" };

// コードを発行し、その生コードを載せた email を outbox に積む。両者を 1 tx に閉じ込め、
// outbox INSERT 失敗時は issue ごとロールバックする (コードだけ残って email が飛ばない状態を防ぐ)。
export async function requestReservationVerificationCode(
  input: RequestReservationVerificationCodeInput,
  options: RequestReservationVerificationCodeOptions = {},
): Promise<RequestReservationVerificationCodeResult> {
  const parsed = RequestReservationVerificationCodeInput.parse(input);
  const db: Db = options.db ?? serviceRoleDb;
  const now = options.now;

  return db.transaction(async (tx: Db): Promise<RequestReservationVerificationCodeResult> => {
    // company gate: 公開対象でない company は issue の INSERT (company_id FK) が 23503 → 500 になり、
    // 「存在する company は 200 / 不在は 500」という存在 oracle を生む。sibling route と同じく
    // company_not_found に正規化して INSERT 前に弾く (tx 内で評価し TOCTOU を最小化)。
    if (!(await isPublicCompanyActive(tx, parsed.companyId))) {
      return { ok: false, reason: "company_not_found" };
    }

    const issued = await issueVerificationCode(
      { companyId: parsed.companyId, email: parsed.email },
      { db: tx, now },
    );
    if (!issued.ok) {
      // rate_limited。outbox には積まない。tx は (副作用なしで) コミットしてよい。
      return { ok: false, reason: issued.reason };
    }

    const email = renderReservationVerificationEmail({
      code: issued.code,
      ttlMinutes: DEFAULT_TTL_MINUTES,
    });

    // 予約は未作成 (create-on-confirm) のため entity FK は全 null。target_type は CHECK で
    // ('vendor','customer','store_user') 限定 → 'customer'。target_id は FK なし uuid のため
    // 検証コード id を使う (dispatcher は target_id を送信に使わず、admin 失敗一覧の識別用)。
    // idempotencyKey は発行コードごとに一意 (rvc:<id>)。再発行は新 id → 新 email が飛ぶ
    // (company+email でキーすると再送が dedupe されて届かないため不可)。
    const inserted = await tx
      .insert(notificationOutbox)
      .values({
        companyId: parsed.companyId,
        idempotencyKey: `rvc:${issued.id}`,
        eventType: "customer_reservation.verification_code",
        targetType: "customer",
        targetId: issued.id,
        payload: {
          channel: "email",
          to: issued.email,
          subject: email.subject,
          html: email.html,
          text: email.text,
        },
      })
      .returning({ id: notificationOutbox.id });

    const row = inserted[0];
    if (!row) throw new Error("notification_outbox insert returned no rows");
    return { ok: true, outboxId: row.id };
  });
}

// ---------------------------------------------------------------------------
// createVerifiedPublicReservation (verify + create, atomic)
// ---------------------------------------------------------------------------

// 公開予約確定の入力 = createPublicReservation の入力 + 6 桁コード。
// email は公開フローで必須 (verify の lookup key かつ本人確認の宛先) — 共有 customerInputSchema は
// 変えず、本入力型でのみ email を string へ絞る (route の publicCustomerSchema と対称)。
export type CreateVerifiedPublicReservationInput = Omit<
  CreatePublicReservationInput,
  "customer"
> & {
  code: string;
  customer: CreatePublicReservationInput["customer"] & { email: string };
};

export type CreateVerifiedPublicReservationResult =
  | Extract<CreatePublicReservationResult, { ok: true }>
  | {
      ok: false;
      reason: // 本人確認失敗 (not_found/invalid_code/expired/locked を畳んだ oracle 緩和済み 1 種)。
        | "verification_failed"
        // 予約作成側の失敗 (createPublicReservation の reason を素通し)。
        | Extract<CreatePublicReservationResult, { ok: false }>["reason"];
    };

// create 失敗を outer tx の外へ伝播させ、消費済みコードを温存するための内部 sentinel。
class VerifiedReservationRollback extends Error {
  constructor(readonly reason: Extract<CreatePublicReservationResult, { ok: false }>["reason"]) {
    super("rollback verified public reservation to preserve verification code");
    this.name = "VerifiedReservationRollback";
  }
}

const codeSchema = z.string().trim().min(1).max(12);

// verify(消費) → create を単一 tx で実行する。verify 失敗は通常リターン (commit → attempt++ 永続)、
// create 失敗は throw して tx ごとロールバック (消費を取り消しコードを再利用可能にする)。
export async function createVerifiedPublicReservation(
  rawInput: CreateVerifiedPublicReservationInput,
  options: CreatePublicReservationOptions = {},
): Promise<CreateVerifiedPublicReservationResult> {
  const { code: rawCode, ...reservationInput } = rawInput;
  const code = codeSchema.parse(rawCode);
  const db: Db = options.db ?? serviceRoleDb;
  const now = options.now;
  const ipAddress = options.ipAddress ?? null;
  const userAgent = options.userAgent ?? null;

  try {
    return await db.transaction(async (tx: Db): Promise<CreateVerifiedPublicReservationResult> => {
      // 1) コード検証 + 消費 (create と原子)。lookup key はクライアント送信 email。
      const verify = await verifyVerificationCode(
        { companyId: reservationInput.companyId, email: reservationInput.customer.email, code },
        { db: tx, now, ipAddress, userAgent },
      );
      if (!verify.ok) {
        // not_found/invalid_code/expired/locked を verification_failed へ畳む (remainingAttempts も非開示)。
        // invalid_code の attempt++ は verify 内 savepoint で確定済み → 通常リターンで commit し永続させる。
        return { ok: false, reason: "verification_failed" };
      }

      // 2) 予約作成。customer.email は **必ず** verifiedEmail で上書き (クライアント email 不信用)。
      const create = await createPublicReservation(
        {
          ...reservationInput,
          customer: { ...reservationInput.customer, email: verify.verifiedEmail },
        },
        { db: tx, now, ipAddress, userAgent },
      );
      if (!create.ok) {
        // 消費は本 tx 内で確定済み。create 失敗 (特に slot_unavailable race) ではコードを温存するため
        // tx ごとロールバックする。sentinel を throw → 下の catch で結果へ変換。
        throw new VerifiedReservationRollback(create.reason);
      }
      return create;
    });
  } catch (err) {
    if (err instanceof VerifiedReservationRollback) {
      return { ok: false, reason: err.reason };
    }
    throw err;
  }
}
