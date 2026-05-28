import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { customerReservationTokens } from "@/lib/db/schema/customer_reservation_tokens";
import { customers } from "@/lib/db/schema/customers";
import { lanes } from "@/lib/db/schema/lanes";
import { reservations } from "@/lib/db/schema/reservations";
import { stores } from "@/lib/db/schema/stores";
import {
  getTokenById,
  issueToken,
  listTokens,
  revokeToken,
  TokenReservationNotFoundError,
  verifyAndConsumeToken,
} from "@/lib/services/customer-reservation-tokens";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

// Drizzle does not expose a shared transaction type for postgres-js transactions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

type Fixture = {
  companyId: string;
  otherCompanyId: string;
  reservationId: string;
  reservationOtherCompanyId: string;
  customerId: string;
};

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

async function seedFixture(outerTx: Tx): Promise<Fixture> {
  const suffix = crypto.randomUUID().slice(0, 8);

  const [company, otherCompany] = await outerTx
    .insert(companies)
    .values([
      { name: `__crt_company_${suffix}__`, code: `crt_${suffix}` },
      { name: `__crt_other_${suffix}__`, code: `crt_o_${suffix}` },
    ])
    .returning({ id: companies.id });

  const [store] = await outerTx
    .insert(stores)
    .values({ companyId: company.id, code: `s_${suffix}`, name: `Store ${suffix}` })
    .returning({ id: stores.id });

  const [storeOther] = await outerTx
    .insert(stores)
    .values({
      companyId: otherCompany.id,
      code: `s_o_${suffix}`,
      name: `Store Other ${suffix}`,
    })
    .returning({ id: stores.id });

  const [lane] = await outerTx
    .insert(lanes)
    .values({ companyId: company.id, storeId: store.id, name: `Lane ${suffix}` })
    .returning({ id: lanes.id });

  const [laneOther] = await outerTx
    .insert(lanes)
    .values({
      companyId: otherCompany.id,
      storeId: storeOther.id,
      name: `Lane Other ${suffix}`,
    })
    .returning({ id: lanes.id });

  const [reservation] = await outerTx
    .insert(reservations)
    .values({
      companyId: company.id,
      storeId: store.id,
      laneId: lane.id,
      startAt: new Date("2026-06-01T09:00:00Z"),
      endAt: new Date("2026-06-01T10:00:00Z"),
    })
    .returning({ id: reservations.id });

  const [reservationOther] = await outerTx
    .insert(reservations)
    .values({
      companyId: otherCompany.id,
      storeId: storeOther.id,
      laneId: laneOther.id,
      startAt: new Date("2026-06-01T09:00:00Z"),
      endAt: new Date("2026-06-01T10:00:00Z"),
    })
    .returning({ id: reservations.id });

  const [customer] = await outerTx
    .insert(customers)
    .values({
      companyId: company.id,
      fullName: `Customer ${suffix}`,
      email: `c-${suffix}@example.test`,
    })
    .returning({ id: customers.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
    reservationId: reservation.id,
    reservationOtherCompanyId: reservationOther.id,
    customerId: customer.id,
  };
}

describeIntegration("customer_reservation_tokens services", () => {
  it("issues a token with raw value returned exactly once and stores the sha256 hash only", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const result = await issueToken(
        {
          reservationId: fixture.reservationId,
          customerId: fixture.customerId,
          ttlMinutes: 60,
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(result.rawToken).toMatch(/^[0-9a-f]{64}$/); // 32 bytes hex = 64 chars
      expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now());

      // DB には hash のみ格納 (生 token は保存されていない)
      const rows = await outerTx
        .select()
        .from(customerReservationTokens)
        .where(eq(customerReservationTokens.id, result.id));
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).not.toBe(result.rawToken);
      expect(rows[0].tokenHash).toMatch(/^[0-9a-f]{64}$/); // sha256 hex
      expect(rows[0].companyId).toBe(fixture.companyId);
      expect(rows[0].reservationId).toBe(fixture.reservationId);
      expect(rows[0].customerId).toBe(fixture.customerId);
      expect(rows[0].usedAt).toBeNull();
      expect(rows[0].deletedAt).toBeNull();
    });
  });

  it("rejects issuing a token for a reservation that does not belong to the company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await expect(
        issueToken(
          {
            reservationId: fixture.reservationOtherCompanyId, // 別 company の reservation
            ttlMinutes: 60,
          },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toBeInstanceOf(TokenReservationNotFoundError);
    });
  });

  it("verifies and consumes a token atomically (single-use): second verify returns reason=used", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const issued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );

      const first = await verifyAndConsumeToken(issued.rawToken, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(first.ok).toBe(true);
      if (first.ok) {
        expect(first.reason).toBe("ok");
        expect(first.token.usedAt).toBeInstanceOf(Date);
        expect(first.token.reservationId).toBe(fixture.reservationId);
      }

      const second = await verifyAndConsumeToken(issued.rawToken, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(second.ok).toBe(false);
      if (!second.ok) expect(second.reason).toBe("used");
    });
  });

  it("returns reason=expired for tokens whose expires_at has elapsed", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const issued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );
      // expires_at を過去に書き換え
      await outerTx
        .update(customerReservationTokens)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(customerReservationTokens.id, issued.id));

      const result = await verifyAndConsumeToken(issued.rawToken, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("expired");
    });
  });

  it("returns reason=not_found for unknown raw tokens", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const result = await verifyAndConsumeToken(
        crypto.randomBytes(32).toString("hex"),
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("not_found");
    });
  });

  it("returns reason=revoked after revokeToken (soft delete) and prevents further verify", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const issued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );

      const revoked = await revokeToken(issued.id, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(revoked).toBe(true);

      // 二度目の revoke は false (既に削除済み)
      const second = await revokeToken(issued.id, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(second).toBe(false);

      const verify = await verifyAndConsumeToken(issued.rawToken, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(verify.ok).toBe(false);
      if (!verify.ok) expect(verify.reason).toBe("revoked");
    });
  });

  it("isolates tokens across companies (verify with wrong companyId returns not_found)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const issued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );

      // 別 company で verify → not_found (cross-tenant 漏えい防止)
      const result = await verifyAndConsumeToken(issued.rawToken, {
        db: outerTx,
        companyId: fixture.otherCompanyId,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("not_found");

      // 元の company では消費できる (verify に失敗していない)
      const ok = await verifyAndConsumeToken(issued.rawToken, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(ok.ok).toBe(true);
    });
  });

  it("lists tokens with status filters (active / used / expired / revoked) and cross-tenant exclusion", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);

      const activeIssued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );
      const usedIssued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );
      const expiredIssued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );
      const revokedIssued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );
      // 別 company で issue (他社レコードが混入しないこと)
      await issueToken(
        { reservationId: fixture.reservationOtherCompanyId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.otherCompanyId },
      );

      // state 操作
      await verifyAndConsumeToken(usedIssued.rawToken, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      await outerTx
        .update(customerReservationTokens)
        .set({ expiresAt: new Date(Date.now() - 60_000) })
        .where(eq(customerReservationTokens.id, expiredIssued.id));
      await revokeToken(revokedIssued.id, {
        db: outerTx,
        companyId: fixture.companyId,
      });

      const ctx = { db: outerTx, companyId: fixture.companyId };

      const active = await listTokens({ status: "active" }, ctx);
      expect(active.rows.map((r) => r.id)).toEqual([activeIssued.id]);

      const used = await listTokens({ status: "used" }, ctx);
      expect(used.rows.map((r) => r.id)).toEqual([usedIssued.id]);

      const expired = await listTokens({ status: "expired" }, ctx);
      expect(expired.rows.map((r) => r.id)).toEqual([expiredIssued.id]);

      const revoked = await listTokens(
        { status: "revoked", includeRevoked: true },
        ctx,
      );
      expect(revoked.rows.map((r) => r.id)).toEqual([revokedIssued.id]);

      // includeRevoked=false (default) では revoked は出ない
      const defaultList = await listTokens({}, ctx);
      const defaultIds = defaultList.rows.map((r) => r.id);
      expect(defaultIds).toContain(activeIssued.id);
      expect(defaultIds).toContain(usedIssued.id);
      expect(defaultIds).toContain(expiredIssued.id);
      expect(defaultIds).not.toContain(revokedIssued.id);
    });
  });

  it("getTokenById returns null for cross-tenant access and for unknown ids", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const issued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );

      const same = await getTokenById(issued.id, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(same?.id).toBe(issued.id);
      // CustomerReservationTokenListItem は token_hash を含まない
      expect(same as object).not.toHaveProperty("tokenHash");

      const other = await getTokenById(issued.id, {
        db: outerTx,
        companyId: fixture.otherCompanyId,
      });
      expect(other).toBeNull();

      const missing = await getTokenById(crypto.randomUUID(), {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(missing).toBeNull();
    });
  });

  it("rejects invalid input via Zod (ttl too low, ttl too high, non-uuid reservationId)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      await expect(
        issueToken({ reservationId: fixture.reservationId, ttlMinutes: 0 }, ctx),
      ).rejects.toThrow();

      await expect(
        issueToken(
          { reservationId: fixture.reservationId, ttlMinutes: 60 * 24 * 31 },
          ctx,
        ),
      ).rejects.toThrow();

      await expect(
        issueToken({ reservationId: "not-a-uuid", ttlMinutes: 60 }, ctx),
      ).rejects.toThrow();

      await expect(verifyAndConsumeToken("", ctx)).rejects.toThrow();
    });
  });

  it("hash uniqueness: independently issued tokens differ and verify each independently", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const a = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        ctx,
      );
      const b = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        ctx,
      );
      expect(a.rawToken).not.toBe(b.rawToken);
      expect(a.id).not.toBe(b.id);

      // 同じ予約に対して複数 token 発行可能、それぞれ独立に消費できる
      const verifyA = await verifyAndConsumeToken(a.rawToken, ctx);
      expect(verifyA.ok).toBe(true);
      const verifyB = await verifyAndConsumeToken(b.rawToken, ctx);
      expect(verifyB.ok).toBe(true);

      // DB 上の hash 件数確認
      const dbRows = await outerTx
        .select({ tokenHash: customerReservationTokens.tokenHash })
        .from(customerReservationTokens)
        .where(
          and(
            eq(customerReservationTokens.companyId, fixture.companyId),
            eq(customerReservationTokens.reservationId, fixture.reservationId),
          ),
        );
      const hashes = new Set(dbRows.map((r: { tokenHash: string }) => r.tokenHash));
      expect(hashes.size).toBe(dbRows.length); // 全 hash 一意
      expect(dbRows.length).toBeGreaterThanOrEqual(2);
    });
  });
});

// sql import keep for potential future raw expression assertions
void sql;
