// Phase 64-A.32b: 顧客公開予約 email 6 桁コード本人確認 orchestration の integration tests。
// ---------------------------------------------------------------------------
// requestReservationVerificationCode (issue + outbox を 1 tx) と
// createVerifiedPublicReservation (verify+消費 → create を 1 tx) を検証する。
//
// 最重要 (Design A の原子性): verify がコードを single-use 消費した後に create が失敗 (特に
//   slot_unavailable race) した場合、tx ごとロールバックしてコードを温存すること。23P01 が
//   createCustomerReservation の内側 savepoint で発生しても outer tx が生存することに依存する
//   (customer-reservation-create.integration.test の二重予約テストと同じ savepoint 不変条件)。
//
// email binding: 別 email で verify すると not_found 扱い (verification_failed)。oracle 緩和により
//   not_found/invalid_code/expired/locked はすべて verification_failed 1 種に畳まれ remainingAttempts も
//   返さないこと。
//
// アンカー (public 予約テストと同一): 09:00-18:00 JST = 00:00-09:00 UTC。menu duration 60。

import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { seedReservationStatuses } from "../../_helpers/seed-reservation-statuses";
import { companies } from "@/lib/db/schema/companies";
import { customers } from "@/lib/db/schema/customers";
import { laneWorkingHours } from "@/lib/db/schema/lane_working_hours";
import { laneWorkMenus } from "@/lib/db/schema/lane_work_menus";
import { lanes } from "@/lib/db/schema/lanes";
import { notificationOutbox } from "@/lib/db/schema/notification_outbox";
import { reservations } from "@/lib/db/schema/reservations";
import { reservationVerificationCodes } from "@/lib/db/schema/reservation_verification_codes";
import { storeBusinessHours } from "@/lib/db/schema/store_business_hours";
import { stores } from "@/lib/db/schema/stores";
import { workMenus } from "@/lib/db/schema/work_menus";
import {
  createVerifiedPublicReservation,
  renderReservationVerificationEmail,
  requestReservationVerificationCode,
} from "@/lib/services/customer-reservation-verification";
import {
  DEFAULT_MAX_ATTEMPTS,
  ISSUE_RATE_MAX,
} from "@/lib/services/reservation-verification-code-crypto";
import { issueVerificationCode } from "@/lib/services/reservation-verification-codes";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });
// pepper は env のみで解決される (orchestrator は options.pepper を通さない)。未設定環境でも
// issue/verify が同一 pepper を使うよう、テスト用フォールバックを 1 つ設定する (>=16 文字)。
process.env.RESERVATION_VERIFICATION_CODE_PEPPER ??= "integration-test-pepper-0123456789";

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

const TEST_DATE = "2026-07-15";
const NOW = new Date("2026-07-01T00:00:00Z");
const VALID_START = new Date("2026-07-15T00:00:00Z"); // 09:00 JST
const VALID_END = new Date("2026-07-15T01:00:00Z"); // 10:00 JST
void TEST_DATE;

afterAll(async () => {
  await queryClient?.end();
});

async function withRollback(fn: (outerTx: Tx) => Promise<void>): Promise<void> {
  let originalError: unknown;
  await db!
    .transaction(async (outerTx) => {
      try {
        await fn(outerTx);
      } catch (err) {
        originalError = err;
      }
      throw new Error(ROLLBACK);
    })
    .catch((err) => {
      if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
    });
  if (originalError) throw originalError;
}

async function seedCompany(outerTx: Tx, label: string): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [company] = await outerTx
    .insert(companies)
    .values({ name: `__rvc_${label}_${suffix}__`, code: `rvc_${label}_${suffix}` })
    .returning({ id: companies.id });
  return company.id;
}

async function seedStore(outerTx: Tx, companyId: string): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [store] = await outerTx
    .insert(stores)
    .values({ companyId, code: `s_${suffix}`, name: "Store" })
    .returning({ id: stores.id });
  return store.id;
}

async function seedStoreHours(outerTx: Tx, companyId: string, storeId: string): Promise<void> {
  for (let dow = 0; dow <= 6; dow += 1) {
    await outerTx.insert(storeBusinessHours).values({
      companyId,
      storeId,
      dayOfWeek: dow,
      opensAt: "09:00:00",
      closesAt: "18:00:00",
      acceptsReservations: true,
    });
  }
}

async function seedLane(outerTx: Tx, companyId: string, storeId: string): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [lane] = await outerTx
    .insert(lanes)
    .values({ companyId, storeId, name: `Lane ${suffix}` })
    .returning({ id: lanes.id });
  for (let dow = 0; dow <= 6; dow += 1) {
    await outerTx.insert(laneWorkingHours).values({
      companyId,
      laneId: lane.id,
      dayOfWeek: dow,
      startsAt: "09:00:00",
      endsAt: "18:00:00",
    });
  }
  return lane.id;
}

async function seedMenu(outerTx: Tx, companyId: string): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [menu] = await outerTx
    .insert(workMenus)
    .values({
      companyId,
      code: `m_${suffix}`,
      name: "Menu",
      durationMinutes: 60,
      visibleToCustomers: true,
    })
    .returning({ id: workMenus.id });
  return menu.id;
}

async function linkLaneMenu(
  outerTx: Tx,
  companyId: string,
  laneId: string,
  menuId: string,
): Promise<void> {
  await outerTx.insert(laneWorkMenus).values({ companyId, laneId, workMenuId: menuId });
}

// 予約作成に必要な最小 tenant (store hours / lane working hours / visible menu / link / statuses)。
async function seedReservableTenant(
  outerTx: Tx,
  label: string,
): Promise<{ companyId: string; storeId: string; laneId: string; menuId: string }> {
  const companyId = await seedCompany(outerTx, label);
  const storeId = await seedStore(outerTx, companyId);
  await seedStoreHours(outerTx, companyId, storeId);
  const laneId = await seedLane(outerTx, companyId, storeId);
  const menuId = await seedMenu(outerTx, companyId);
  await linkLaneMenu(outerTx, companyId, laneId, menuId);
  await seedReservationStatuses(outerTx, companyId);
  return { companyId, storeId, laneId, menuId };
}

function reservationInput(
  t: { companyId: string; storeId: string; laneId: string; menuId: string },
  email: string,
  code: string,
) {
  return {
    companyId: t.companyId,
    storeId: t.storeId,
    workMenuId: t.menuId,
    laneId: t.laneId,
    startAt: VALID_START,
    endAt: VALID_END,
    customer: { fullName: "山田 太郎", email, phone: "09000000000" },
    vehicle: { registrationNumber: "品川 300 あ 12-34", maker: "Toyota" },
    code,
  };
}

// 直接 issue して生コードを取得する (orchestrator は生コードを返さないため、verify 検証用に使う)。
async function issueRawCode(outerTx: Tx, companyId: string, email: string): Promise<string> {
  const issued = await issueVerificationCode({ companyId, email }, { db: outerTx, now: NOW });
  if (!issued.ok) throw new Error(`issue failed in test setup: ${issued.reason}`);
  return issued.code;
}

describe("renderReservationVerificationEmail (Phase 64-A.32b)", () => {
  it("renders the code into subject-free body (html + text)", () => {
    const email = renderReservationVerificationEmail({ code: "123456", ttlMinutes: 10 });
    expect(email.subject).toContain("確認コード");
    expect(email.subject).not.toContain("123456"); // 件名にコードを載せない (プレビュー漏洩防止)
    expect(email.html).toContain("123456");
    expect(email.text).toContain("123456");
    expect(email.text).toContain("10分");
  });
});

describeIntegration("requestReservationVerificationCode", () => {
  it("issues a code and enqueues a pre-rendered email outbox row (no entity FK)", async () => {
    await withRollback(async (outerTx) => {
      const companyId = await seedCompany(outerTx, "req1");

      const result = await requestReservationVerificationCode(
        { companyId, email: "Taro@Example.test" },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [ob] = await outerTx
        .select()
        .from(notificationOutbox)
        .where(eq(notificationOutbox.id, result.outboxId))
        .limit(1);
      expect(ob.companyId).toBe(companyId);
      expect(ob.eventType).toBe("customer_reservation.verification_code");
      expect(ob.targetType).toBe("customer");
      expect(ob.status).toBe("pending");
      // 予約は未作成 → entity FK は全 null。
      expect(ob.reservationId).toBeNull();
      expect(ob.transportOrderId).toBeNull();
      expect(ob.transportOrderInvitationId).toBeNull();
      // idempotencyKey は発行コード id (= target_id) に紐づく。
      expect(ob.targetId).toBeTruthy();
      expect(ob.idempotencyKey).toBe(`rvc:${ob.targetId}`);
      // payload は dispatcher が読む pre-rendered な形 (channel/to/subject/html/text)。
      const payload = ob.payload as Record<string, unknown>;
      expect(payload.channel).toBe("email");
      expect(payload.to).toBe("taro@example.test"); // normalize 済み
      expect(String(payload.subject)).toContain("確認コード");
      expect(String(payload.html).length).toBeGreaterThan(0);
      expect(String(payload.text).length).toBeGreaterThan(0);

      // active な検証コードが 1 件作られている (id は outbox.target_id と一致)。
      const codeRows = await outerTx
        .select()
        .from(reservationVerificationCodes)
        .where(eq(reservationVerificationCodes.companyId, companyId));
      expect(codeRows).toHaveLength(1);
      expect(codeRows[0].id).toBe(ob.targetId);
      expect(codeRows[0].email).toBe("taro@example.test");
      expect(codeRows[0].consumedAt).toBeNull();
    });
  });

  it("returns rate_limited and enqueues nothing once the issue rate guard trips", async () => {
    await withRollback(async (outerTx) => {
      const companyId = await seedCompany(outerTx, "req2");
      const email = "burst@example.test";

      // 発行レート guard は行の created_at (tx 開始の実時刻 now()) と now-window を比較するため、
      // ここでは now を注入せず実時刻に揃える (未来の NOW を渡すと既存行が窓外になり count=0 になる)。
      for (let i = 0; i < ISSUE_RATE_MAX; i += 1) {
        const ok = await requestReservationVerificationCode({ companyId, email }, { db: outerTx });
        expect(ok.ok).toBe(true);
      }
      const limited = await requestReservationVerificationCode(
        { companyId, email },
        { db: outerTx },
      );
      expect(limited.ok).toBe(false);
      if (limited.ok) return;
      expect(limited.reason).toBe("rate_limited");

      // 成功した分だけ outbox 行があり、rate_limited 分は積まれていない。
      const obRows = await outerTx
        .select({ id: notificationOutbox.id })
        .from(notificationOutbox)
        .where(eq(notificationOutbox.companyId, companyId));
      expect(obRows).toHaveLength(ISSUE_RATE_MAX);
    });
  }, 30000);

  it("returns company_not_found (not a 23503 throw) for a non-existent company", async () => {
    await withRollback(async (outerTx) => {
      // 実在しない company UUID。company gate が INSERT 前に弾き、FK 23503 → 500 を防ぐ。
      const result = await requestReservationVerificationCode(
        { companyId: crypto.randomUUID(), email: "ghost@example.test" },
        { db: outerTx },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("company_not_found");
    });
  });
});

describeIntegration("createVerifiedPublicReservation", () => {
  it("verifies the code, creates the reservation with the verified (normalized) email, and consumes the code", async () => {
    await withRollback(async (outerTx) => {
      const t = await seedReservableTenant(outerTx, "ok");
      // 大文字混じりで発行 → 予約には normalize 済み verifiedEmail が使われること。
      const code = await issueRawCode(outerTx, t.companyId, "Taro@Example.test");

      const result = await createVerifiedPublicReservation(
        reservationInput(t, "Taro@Example.test", code),
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;

      const [row] = await outerTx
        .select()
        .from(reservations)
        .where(eq(reservations.id, result.reservationId))
        .limit(1);
      expect(row.laneId).toBe(t.laneId);
      expect(row.companyId).toBe(t.companyId);

      // 予約 customer.email は verifiedEmail (normalize 済み) で、クライアント送信の大文字混じりではない。
      const [customerRow] = await outerTx
        .select()
        .from(customers)
        .where(eq(customers.id, result.customerId))
        .limit(1);
      expect(customerRow.email).toBe("taro@example.test");

      // コードは消費済み (single-use)。
      const [codeRow] = await outerTx
        .select()
        .from(reservationVerificationCodes)
        .where(eq(reservationVerificationCodes.companyId, t.companyId))
        .limit(1);
      expect(codeRow.email).toBe("taro@example.test");
      expect(codeRow.consumedAt).not.toBeNull();
    });
  }, 30000);

  it("does NOT consume the code when create fails with slot_unavailable (Design A atomicity)", async () => {
    await withRollback(async (outerTx) => {
      const t = await seedReservableTenant(outerTx, "race");
      // lane の 09:00-10:00 を既存予約で塞ぐ → create は exclusion (23P01) → slot_unavailable。
      await outerTx.insert(reservations).values({
        companyId: t.companyId,
        storeId: t.storeId,
        laneId: t.laneId,
        startAt: VALID_START,
        endAt: VALID_END,
      });
      const email = "race@example.test";
      const code = await issueRawCode(outerTx, t.companyId, email);

      const result = await createVerifiedPublicReservation(reservationInput(t, email, code), {
        db: outerTx,
        now: NOW,
      });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("slot_unavailable");

      // 最重要: コードは消費されず active のまま (slot race でコードを焼かない)。
      const [codeRow] = await outerTx
        .select()
        .from(reservationVerificationCodes)
        .where(
          and(
            eq(reservationVerificationCodes.companyId, t.companyId),
            isNull(reservationVerificationCodes.consumedAt),
          ),
        )
        .limit(1);
      expect(codeRow).toBeTruthy();
      expect(codeRow.consumedAt).toBeNull();
      expect(codeRow.attemptCount).toBe(0); // 正コードのため attempt も増えていない

      // 予約は (事前 insert の 1 件のみで) 新規作成されていない。
      const resvRows = await outerTx
        .select({ id: reservations.id })
        .from(reservations)
        .where(eq(reservations.companyId, t.companyId));
      expect(resvRows).toHaveLength(1);
    });
  }, 30000);

  it("rejects a code verified under a different email with verification_failed (email binding)", async () => {
    await withRollback(async (outerTx) => {
      const t = await seedReservableTenant(outerTx, "bind");
      const code = await issueRawCode(outerTx, t.companyId, "alice@example.test");

      // 別 email で同じコードを使う → (company, bob) に active 行なし → not_found → verification_failed。
      const result = await createVerifiedPublicReservation(
        reservationInput(t, "bob@example.test", code),
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("verification_failed");

      // alice のコードは温存 (別 email の試行では触らない)。
      const [aliceCode] = await outerTx
        .select()
        .from(reservationVerificationCodes)
        .where(eq(reservationVerificationCodes.email, "alice@example.test"))
        .limit(1);
      expect(aliceCode.consumedAt).toBeNull();
      expect(aliceCode.attemptCount).toBe(0);

      const resvRows = await outerTx
        .select({ id: reservations.id })
        .from(reservations)
        .where(eq(reservations.companyId, t.companyId));
      expect(resvRows).toHaveLength(0);
    });
  }, 30000);

  it("folds a wrong code into verification_failed, increments attempt, and creates nothing", async () => {
    await withRollback(async (outerTx) => {
      const companyId = await seedCompany(outerTx, "wrong");
      const email = "wrong@example.test";
      await issueRawCode(outerTx, companyId, email); // 正コードを発行 (戻り値は使わない)

      // verify は create より前に走るため、store/lane/menu はダミー uuid でよい (到達しない)。
      const result = await createVerifiedPublicReservation(
        {
          companyId,
          storeId: crypto.randomUUID(),
          workMenuId: crypto.randomUUID(),
          laneId: crypto.randomUUID(),
          startAt: VALID_START,
          endAt: VALID_END,
          customer: { fullName: "山田 太郎", email },
          vehicle: {},
          code: "000000",
        },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      // oracle 緩和: invalid_code も verification_failed に畳まれ、remainingAttempts は結果に現れない。
      expect(result.reason).toBe("verification_failed");
      expect(result).not.toHaveProperty("remainingAttempts");

      // attempt は永続 (invalid の attempt++ は commit される)、コードは未消費。
      const [codeRow] = await outerTx
        .select()
        .from(reservationVerificationCodes)
        .where(eq(reservationVerificationCodes.companyId, companyId))
        .limit(1);
      expect(codeRow.attemptCount).toBe(1);
      expect(codeRow.consumedAt).toBeNull();

      const resvRows = await outerTx
        .select({ id: reservations.id })
        .from(reservations)
        .where(eq(reservations.companyId, companyId));
      expect(resvRows).toHaveLength(0);
    });
  }, 30000);

  it("folds an expired code into verification_failed (oracle, no attempt++)", async () => {
    await withRollback(async (outerTx) => {
      const companyId = await seedCompany(outerTx, "expired");
      const email = "expired@example.test";
      const code = await issueRawCode(outerTx, companyId, email); // expiresAt = NOW + 10min

      // TTL (10 分) を過ぎた時刻で検証 → expired → verification_failed (not_found 等と区別不能)。
      const after = new Date(NOW.getTime() + 11 * 60 * 1000);
      const result = await createVerifiedPublicReservation(
        {
          companyId,
          storeId: crypto.randomUUID(),
          workMenuId: crypto.randomUUID(),
          laneId: crypto.randomUUID(),
          startAt: VALID_START,
          endAt: VALID_END,
          customer: { fullName: "山田 太郎", email },
          vehicle: {},
          code,
        },
        { db: outerTx, now: after },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("verification_failed");
      expect(result).not.toHaveProperty("remainingAttempts");

      // expired は hash 比較前に弾くため attempt は増えない。
      const [codeRow] = await outerTx
        .select()
        .from(reservationVerificationCodes)
        .where(eq(reservationVerificationCodes.companyId, companyId))
        .limit(1);
      expect(codeRow.attemptCount).toBe(0);
      expect(codeRow.consumedAt).toBeNull();
    });
  }, 30000);

  it("folds a locked code (attempts exhausted) into verification_failed", async () => {
    await withRollback(async (outerTx) => {
      const companyId = await seedCompany(outerTx, "locked");
      const email = "locked@example.test";
      const code = await issueRawCode(outerTx, companyId, email);

      // 試行上限到達状態を直接作る (attempt_count = max_attempts)。正コードでも locked。
      await outerTx
        .update(reservationVerificationCodes)
        .set({ attemptCount: DEFAULT_MAX_ATTEMPTS })
        .where(eq(reservationVerificationCodes.companyId, companyId));

      const result = await createVerifiedPublicReservation(
        {
          companyId,
          storeId: crypto.randomUUID(),
          workMenuId: crypto.randomUUID(),
          laneId: crypto.randomUUID(),
          startAt: VALID_START,
          endAt: VALID_END,
          customer: { fullName: "山田 太郎", email },
          vehicle: {},
          code,
        },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("verification_failed");
      expect(result).not.toHaveProperty("remainingAttempts");

      // locked は正コードでも消費しない。
      const [codeRow] = await outerTx
        .select()
        .from(reservationVerificationCodes)
        .where(eq(reservationVerificationCodes.companyId, companyId))
        .limit(1);
      expect(codeRow.consumedAt).toBeNull();
    });
  }, 30000);
});
