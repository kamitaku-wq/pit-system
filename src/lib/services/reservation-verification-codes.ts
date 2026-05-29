/**
 * reservation_verification_codes use-case service (Phase 64-A.32a)
 *
 * 顧客公開予約フロー (spec §12.1 step6-7) の email 6 桁コード本人確認の security core。
 * email 送信・route・UI は A.32b。本 service は「コードの発行」と「検証+消費」だけを担う。
 *
 * テナント境界: 顧客は Supabase Auth user ではない。公開 URL の companyId が唯一の scope
 *   (customer-reservation-public.ts と同じ service-role + companyId 引数方式、RLS 不使用 = ADR-0010)。
 *
 * 設計判断 (敵対的レビュー workflow 反映、詳細 phase-handoff/phase-64-a32a-design-plan.md):
 * 1. active コードは (company_id, email) 毎に最大 1 件 (partial unique index)。concurrent issue は
 *    23505 を返すため issue は tx 全体を retry する (HIGH#1)。
 * 2. code_hash = HMAC-SHA256(pepper, companyId:email:code)。pepper 必須 (HIGH#2)。
 * 3. verify は verifiedEmail を返す。A.32b は予約 customer.email をこの verifiedEmail から取得し、
 *    クライアント送信 email を使わない (email binding を型で強制、HIGH#3)。
 * 4. 再発行ブルートフォース緩和のため issue に発行レート guard (HIGH#4-A)。本格的な IP/global
 *    送信レート制限 + Turnstile は A.33。公開 route の本番露出は A.33 完了が hard 依存。
 * 5. 契約 (MEDIUM#6): 各関数の全 DB 操作は内部の単一 db.transaction(tx) 内で実行する。
 *    options.db は .transaction() をサポートするクライアント (serviceRoleDb / test outerTx)。
 */

import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import { z } from "zod";
import { db as serviceRoleDb } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema/audit_logs";
import {
  reservationVerificationCodes,
  type ReservationVerificationCode,
} from "@/lib/db/schema/reservation_verification_codes";
import {
  DEFAULT_MAX_ATTEMPTS,
  DEFAULT_TTL_MINUTES,
  generateNumericCode,
  hashCode,
  ISSUE_RATE_MAX,
  ISSUE_RATE_WINDOW_MINUTES,
  normalizeEmail,
  resolvePepper,
  timingSafeEqualHex,
} from "@/lib/services/reservation-verification-code-crypto";

// Drizzle does not expose a common DB/transaction interface that fits this project.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

const TTL_MIN_MINUTES = 1;
const TTL_MAX_MINUTES = 60;
const MAX_ATTEMPTS_CEILING = 10;
const ISSUE_RETRY_LIMIT = 3;

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  return (err as { code?: unknown }).code === "23505";
}

// ---------------------------------------------------------------------------
// issueVerificationCode
// ---------------------------------------------------------------------------

export const IssueVerificationCodeInput = z
  .object({
    companyId: z.string().uuid(),
    email: z.string().trim().email().max(320),
    ttlMinutes: z.number().int().min(TTL_MIN_MINUTES).max(TTL_MAX_MINUTES).optional(),
    maxAttempts: z.number().int().min(1).max(MAX_ATTEMPTS_CEILING).optional(),
  })
  .strict();

export type IssueVerificationCodeInput = z.input<typeof IssueVerificationCodeInput>;

export type IssueVerificationCodeOptions = {
  db?: Db;
  pepper?: string;
  now?: Date;
};

export type IssueVerificationCodeResult =
  | { ok: true; id: string; code: string; email: string; expiresAt: Date }
  | { ok: false; reason: "rate_limited" };

// 発行: 発行レート guard → 旧 active を supersede → 新コードを INSERT (active unique 競合は retry)。
// 生 code は戻り値で 1 回だけ返す (A.32b が email へ載せる)。DB には code_hash のみ保存。
export async function issueVerificationCode(
  input: IssueVerificationCodeInput,
  options: IssueVerificationCodeOptions = {},
): Promise<IssueVerificationCodeResult> {
  const parsed = IssueVerificationCodeInput.parse(input);
  const db: Db = options.db ?? serviceRoleDb;
  const pepper = resolvePepper(options.pepper);
  const now = options.now ?? new Date();
  const email = normalizeEmail(parsed.email);
  const ttlMinutes = parsed.ttlMinutes ?? DEFAULT_TTL_MINUTES;
  const maxAttempts = parsed.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;

  const runOnce = async (tx: Db): Promise<IssueVerificationCodeResult> => {
    // 1) 発行レート guard (同一 company+email の直近 window 発行回数)。supersede より前に評価する。
    const windowStart = new Date(now.getTime() - ISSUE_RATE_WINDOW_MINUTES * 60 * 1000);
    const recent = await tx
      .select({ value: count() })
      .from(reservationVerificationCodes)
      .where(
        and(
          eq(reservationVerificationCodes.companyId, parsed.companyId),
          eq(reservationVerificationCodes.email, email),
          gt(reservationVerificationCodes.createdAt, windowStart),
        ),
      );
    if (Number(recent[0]?.value ?? 0) >= ISSUE_RATE_MAX) {
      return { ok: false, reason: "rate_limited" };
    }

    // 2) supersede: 既存 active を consume (partial unique index を満たすため必須)。
    await tx
      .update(reservationVerificationCodes)
      .set({ consumedAt: now, updatedAt: now })
      .where(
        and(
          eq(reservationVerificationCodes.companyId, parsed.companyId),
          eq(reservationVerificationCodes.email, email),
          isNull(reservationVerificationCodes.consumedAt),
        ),
      );

    // 3) 新コード生成 + HMAC hash + INSERT。
    const code = generateNumericCode();
    const codeHash = hashCode({ companyId: parsed.companyId, email, code, pepper });
    const expiresAt = new Date(now.getTime() + ttlMinutes * 60 * 1000);

    const inserted = await tx
      .insert(reservationVerificationCodes)
      .values({
        companyId: parsed.companyId,
        email,
        codeHash,
        attemptCount: 0,
        maxAttempts,
        expiresAt,
      })
      .returning({ id: reservationVerificationCodes.id });

    const row = inserted[0];
    if (!row) throw new Error("reservation_verification_codes insert returned no rows");

    return { ok: true, id: row.id, code, email, expiresAt };
  };

  // active unique (23505) 競合は concurrent issue。tx 全体を retry する。
  for (let attempt = 0; attempt < ISSUE_RETRY_LIMIT; attempt++) {
    try {
      return await db.transaction(runOnce);
    } catch (err) {
      if (isUniqueViolation(err) && attempt < ISSUE_RETRY_LIMIT - 1) continue;
      throw err;
    }
  }
  // ループは return か throw で必ず抜ける。到達不能。
  throw new Error("issueVerificationCode: exhausted retries");
}

// ---------------------------------------------------------------------------
// verifyVerificationCode
// ---------------------------------------------------------------------------

export const VerifyVerificationCodeInput = z
  .object({
    companyId: z.string().uuid(),
    email: z.string().trim().min(1).max(320),
    code: z.string().trim().min(1).max(12),
  })
  .strict();

export type VerifyVerificationCodeInput = z.input<typeof VerifyVerificationCodeInput>;

export type VerifyVerificationCodeOptions = {
  db?: Db;
  pepper?: string;
  now?: Date;
  ipAddress?: string | null;
  userAgent?: string | null;
};

export type VerifyVerificationCodeResult =
  | { ok: true; reason: "ok"; codeId: string; verifiedEmail: string }
  | { ok: false; reason: "not_found" | "expired" | "locked" }
  | { ok: false; reason: "invalid_code"; remainingAttempts: number };

// 検証+消費: active 行を FOR UPDATE で 1 件ロック → expired/locked を弾く → timing-safe hash 比較。
//   一致: consume + audit_logs。不一致: attempt_count++ (上限到達で locked)。
// すべて単一 tx 内 (FOR UPDATE ロックを保持するため、MEDIUM#6 契約)。
export async function verifyVerificationCode(
  input: VerifyVerificationCodeInput,
  options: VerifyVerificationCodeOptions = {},
): Promise<VerifyVerificationCodeResult> {
  const parsed = VerifyVerificationCodeInput.parse(input);
  const db: Db = options.db ?? serviceRoleDb;
  const pepper = resolvePepper(options.pepper);
  const now = options.now ?? new Date();
  const email = normalizeEmail(parsed.email);

  return db.transaction(async (tx: Db): Promise<VerifyVerificationCodeResult> => {
    // active 行 (consumed_at IS NULL) を 1 件ロック取得。partial unique index で最大 1 件だが
    // 防御的に ORDER BY + LIMIT。FOR UPDATE で並走 verify を直列化する。
    const rows = await tx
      .select()
      .from(reservationVerificationCodes)
      .where(
        and(
          eq(reservationVerificationCodes.companyId, parsed.companyId),
          eq(reservationVerificationCodes.email, email),
          isNull(reservationVerificationCodes.consumedAt),
        ),
      )
      .orderBy(desc(reservationVerificationCodes.createdAt))
      .limit(1)
      .for("update");

    const row = rows[0] as ReservationVerificationCode | undefined;
    if (!row) return { ok: false, reason: "not_found" };

    if (row.expiresAt.getTime() <= now.getTime()) {
      return { ok: false, reason: "expired" };
    }
    if (row.attemptCount >= row.maxAttempts) {
      return { ok: false, reason: "locked" };
    }

    const expectedHash = hashCode({
      companyId: parsed.companyId,
      email,
      code: parsed.code,
      pepper,
    });
    const matched = timingSafeEqualHex(expectedHash, row.codeHash);

    if (!matched) {
      const updated = await tx
        .update(reservationVerificationCodes)
        .set({ attemptCount: row.attemptCount + 1, updatedAt: now })
        .where(eq(reservationVerificationCodes.id, row.id))
        .returning({ attemptCount: reservationVerificationCodes.attemptCount });
      // FOR UPDATE で row をロック済みのため UPDATE は必ず 1 行返す。0 行は並行不変条件違反 →
      // メモリ値で代用すると DB 未永続のまま locked/invalid を返し試行制限が崩れるため fail-fast。
      const updatedRow = updated[0];
      if (!updatedRow) {
        throw new Error(
          "reservation_verification_codes attempt_count update returned no rows (concurrency invariant violated)",
        );
      }
      const newAttemptCount = Number(updatedRow.attemptCount);
      if (newAttemptCount >= row.maxAttempts) {
        return { ok: false, reason: "locked" };
      }
      return {
        ok: false,
        reason: "invalid_code",
        remainingAttempts: row.maxAttempts - newAttemptCount,
      };
    }

    // 一致: 消費 (single-use) + 監査ログ。
    await tx
      .update(reservationVerificationCodes)
      .set({ consumedAt: now, updatedAt: now })
      .where(eq(reservationVerificationCodes.id, row.id));

    // audit_logs.action は CHECK ('create','update','delete','restore') 限定 → 'update'、kind を afterJson で区別。
    await tx.insert(auditLogs).values({
      companyId: row.companyId,
      entityType: "reservation_verification_code",
      entityId: row.id,
      action: "update",
      actorKind: "system",
      afterJson: { kind: "customer_email_verify" },
      ipAddress: options.ipAddress ?? null,
      userAgent: options.userAgent ?? null,
    });

    return { ok: true, reason: "ok", codeId: row.id, verifiedEmail: email };
  });
}
