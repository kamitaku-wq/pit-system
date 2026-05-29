// Phase 64-A.34: TTL purge 関数 public.purge_expired_reservation_rows() の integration tests。
// ---------------------------------------------------------------------------
// post/0027 が定義する purge 関数が rate_limit_counters / reservation_verification_codes の
// expires_at < now() 行だけを削除し、未来 expiry 行を残すことをテーブル検査で実証する。
// pg_cron スケジューリング (manual/0007) は本番専用 = CI 非実行ゆえ、ここで削除ロジック本体を固定する。
//
// 隔離: customer-reservation-create.integration.test.ts と同じく withRollback で全 INSERT と
// 関数呼出を 1 トランザクションに閉じ、必ず rollback する。グローバル purge を呼んでも commit されない
// ため並走テストへの永続影響はゼロ。検証は「件数の絶対値」ではなく自分の一意キー行の存在/不在で行う
// (並走テストが作る他の expired 行を巻き込む可能性があり、絶対件数は flaky になるため)。

import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { rateLimitCounters } from "@/lib/db/schema/rate_limit_counters";
import { reservationVerificationCodes } from "@/lib/db/schema/reservation_verification_codes";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || db === undefined);

const ROLLBACK = "__rollback__";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

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

// 過去/未来は now() を確実に跨ぐ十分なマージンを取る (transaction_timestamp() = now() 基準)。
const PAST = new Date("2020-01-01T00:00:00Z");
const FUTURE = new Date("2035-01-01T00:00:00Z");

describeIntegration("purge_expired_reservation_rows()", () => {
  it("deletes only expired rows from both tables and keeps fresh rows", async () => {
    await withRollback(async (outerTx) => {
      const suffix = crypto.randomUUID();

      // --- rate_limit_counters: 過去 expiry (削除対象) + 未来 expiry (残存) を一意キーで挿入 ---
      const expiredKey = `test:purge:rl:expired:${suffix}`;
      const freshKey = `test:purge:rl:fresh:${suffix}`;
      await outerTx.insert(rateLimitCounters).values([
        { bucketKey: expiredKey, windowStart: PAST, count: 1, expiresAt: PAST },
        { bucketKey: freshKey, windowStart: FUTURE, count: 1, expiresAt: FUTURE },
      ]);

      // --- reservation_verification_codes: company FK が要るため company を seed ---
      // active-per-email partial unique index (consumed_at IS NULL) を避けるため過去/未来で別 email。
      const [companyRow] = await outerTx
        .insert(companies)
        .values({ name: `__purge_${suffix}__`, code: `purge_${suffix.slice(0, 8)}` })
        .returning({ id: companies.id });
      const companyId = companyRow.id;

      const expiredEmail = `purge-expired-${suffix}@example.test`;
      const freshEmail = `purge-fresh-${suffix}@example.test`;
      const codeHash = "0".repeat(64); // HMAC-SHA256 hex 相当のダミー (検証はしない)
      await outerTx.insert(reservationVerificationCodes).values([
        { companyId, email: expiredEmail, codeHash, expiresAt: PAST },
        { companyId, email: freshEmail, codeHash, expiresAt: FUTURE },
      ]);

      // --- purge 実行 (同一トランザクション内で呼ぶ = rollback で全消去) ---
      const purged = await outerTx.execute(
        sql`SELECT rate_limit_deleted, verification_codes_deleted FROM public.purge_expired_reservation_rows()`,
      );
      const row = purged[0] as
        | { rate_limit_deleted: number | string; verification_codes_deleted: number | string }
        | undefined;
      // 自分の expired 行 (各 1) を必ず含むため >= 1。絶対件数は並走テスト次第なので等値検査しない。
      expect(Number(row?.rate_limit_deleted)).toBeGreaterThanOrEqual(1);
      expect(Number(row?.verification_codes_deleted)).toBeGreaterThanOrEqual(1);

      // --- 検証: 過去行は消え、未来行は残る (一意キーで存在/不在を確認) ---
      const rlExpired = await outerTx
        .select({ k: rateLimitCounters.bucketKey })
        .from(rateLimitCounters)
        .where(eq(rateLimitCounters.bucketKey, expiredKey));
      expect(rlExpired).toHaveLength(0);

      const rlFresh = await outerTx
        .select({ k: rateLimitCounters.bucketKey })
        .from(rateLimitCounters)
        .where(eq(rateLimitCounters.bucketKey, freshKey));
      expect(rlFresh).toHaveLength(1);

      const vcExpired = await outerTx
        .select({ id: reservationVerificationCodes.id })
        .from(reservationVerificationCodes)
        .where(
          and(
            eq(reservationVerificationCodes.companyId, companyId),
            eq(reservationVerificationCodes.email, expiredEmail),
          ),
        );
      expect(vcExpired).toHaveLength(0);

      const vcFresh = await outerTx
        .select({ id: reservationVerificationCodes.id })
        .from(reservationVerificationCodes)
        .where(
          and(
            eq(reservationVerificationCodes.companyId, companyId),
            eq(reservationVerificationCodes.email, freshEmail),
          ),
        );
      expect(vcFresh).toHaveLength(1);
    });
  });
});
