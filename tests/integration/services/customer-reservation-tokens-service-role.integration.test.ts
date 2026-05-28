import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/lib/db/schema/audit_logs";
import { companies } from "@/lib/db/schema/companies";
import { customerReservationTokens } from "@/lib/db/schema/customer_reservation_tokens";
import { lanes } from "@/lib/db/schema/lanes";
import { reservations } from "@/lib/db/schema/reservations";
import { stores } from "@/lib/db/schema/stores";
import {
  issueToken,
  loadTokenStatusViaServiceRole,
  verifyAndConsumeTokenViaServiceRole,
} from "@/lib/services/customer-reservation-tokens";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

type Fixture = {
  companyId: string;
  reservationId: string;
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

  const [company] = await outerTx
    .insert(companies)
    .values({ name: `__crt_sr_${suffix}__`, code: `crt_sr_${suffix}` })
    .returning({ id: companies.id });

  const [store] = await outerTx
    .insert(stores)
    .values({ companyId: company.id, code: `s_${suffix}`, name: `Store ${suffix}` })
    .returning({ id: stores.id });

  const [lane] = await outerTx
    .insert(lanes)
    .values({ companyId: company.id, storeId: store.id, name: `Lane ${suffix}` })
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

  return {
    companyId: company.id,
    reservationId: reservation.id,
  };
}

describeIntegration("verifyAndConsumeTokenViaServiceRole (Phase 64-A.23)", () => {
  it("verifies a valid token, returns the consumed row, and writes an audit_logs row", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const issued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );

      const result = await verifyAndConsumeTokenViaServiceRole(issued.rawToken, {
        db: outerTx,
        ipAddress: "203.0.113.10",
        userAgent: "vitest-suite/1",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.reason).toBe("ok");
      expect(result.token.id).toBe(issued.id);
      expect(result.token.companyId).toBe(fixture.companyId);
      expect(result.token.reservationId).toBe(fixture.reservationId);
      expect(result.token.usedAt).not.toBeNull();

      const auditRows = await outerTx
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "customer_reservation_token"),
            eq(auditLogs.entityId, issued.id),
          ),
        );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].companyId).toBe(fixture.companyId);
      expect(auditRows[0].action).toBe("update");
      expect(auditRows[0].actorKind).toBe("system");
      expect(auditRows[0].actorUserId).toBeNull();
      expect(auditRows[0].afterJson).toEqual({
        kind: "customer_verify_consume",
        reservationId: fixture.reservationId,
      });
      expect(auditRows[0].ipAddress).toBe("203.0.113.10");
      expect(auditRows[0].userAgent).toBe("vitest-suite/1");
    });
  });

  it("returns reason='not_found' for an unknown token hash and writes no audit log", async () => {
    await withRollback(async (outerTx) => {
      await seedFixture(outerTx);
      const fakeToken = crypto.randomBytes(32).toString("hex");

      const result = await verifyAndConsumeTokenViaServiceRole(fakeToken, {
        db: outerTx,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("not_found");

      const auditRows = await outerTx
        .select({ value: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(eq(auditLogs.entityType, "customer_reservation_token"));
      expect(Number(auditRows[0].value)).toBe(0);
    });
  });

  it("returns reason='used' on the second call (atomic single-use) and writes exactly one audit log", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const issued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );

      const first = await verifyAndConsumeTokenViaServiceRole(issued.rawToken, {
        db: outerTx,
      });
      expect(first.ok).toBe(true);

      const second = await verifyAndConsumeTokenViaServiceRole(issued.rawToken, {
        db: outerTx,
      });
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.reason).toBe("used");

      const auditRows = await outerTx
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "customer_reservation_token"),
            eq(auditLogs.entityId, issued.id),
          ),
        );
      expect(auditRows).toHaveLength(1);
    });
  });

  it("returns reason='expired' for a token whose expires_at is in the past", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const issued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );

      // 期限を過去に更新
      await outerTx
        .update(customerReservationTokens)
        .set({ expiresAt: new Date(Date.now() - 60 * 1000) })
        .where(eq(customerReservationTokens.id, issued.id));

      const result = await verifyAndConsumeTokenViaServiceRole(issued.rawToken, {
        db: outerTx,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("expired");

      const auditRows = await outerTx
        .select({ value: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(eq(auditLogs.entityType, "customer_reservation_token"));
      expect(Number(auditRows[0].value)).toBe(0);
    });
  });

  it("returns reason='revoked' for a soft-deleted token", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const issued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );

      await outerTx
        .update(customerReservationTokens)
        .set({ deletedAt: new Date() })
        .where(eq(customerReservationTokens.id, issued.id));

      const result = await verifyAndConsumeTokenViaServiceRole(issued.rawToken, {
        db: outerTx,
      });

      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("revoked");

      const auditRows = await outerTx
        .select({ value: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(eq(auditLogs.entityType, "customer_reservation_token"));
      expect(Number(auditRows[0].value)).toBe(0);
    });
  });

  it("derives the company from the token hash (no companyId argument required) and is cross-tenant safe", async () => {
    await withRollback(async (outerTx) => {
      // 2 つの company を seed、それぞれ token を発行
      const a = await seedFixture(outerTx);
      const b = await seedFixture(outerTx);
      const issuedA = await issueToken(
        { reservationId: a.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: a.companyId },
      );
      const issuedB = await issueToken(
        { reservationId: b.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: b.companyId },
      );

      // A の token で wrapper を呼ぶ → A の company / reservation を返す
      const resultA = await verifyAndConsumeTokenViaServiceRole(issuedA.rawToken, {
        db: outerTx,
      });
      expect(resultA.ok).toBe(true);
      if (!resultA.ok) return;
      expect(resultA.token.companyId).toBe(a.companyId);
      expect(resultA.token.reservationId).toBe(a.reservationId);

      // B の token で wrapper を呼ぶ → B の company / reservation を返す
      const resultB = await verifyAndConsumeTokenViaServiceRole(issuedB.rawToken, {
        db: outerTx,
      });
      expect(resultB.ok).toBe(true);
      if (!resultB.ok) return;
      expect(resultB.token.companyId).toBe(b.companyId);
      expect(resultB.token.reservationId).toBe(b.reservationId);

      // audit_logs はそれぞれの company に 1 行ずつ書かれる
      const auditRows = await outerTx
        .select({ companyId: auditLogs.companyId, entityId: auditLogs.entityId })
        .from(auditLogs)
        .where(eq(auditLogs.entityType, "customer_reservation_token"));
      const auditByCompany = new Map(
        auditRows.map((r: { companyId: string; entityId: string }) => [r.companyId, r.entityId]),
      );
      expect(auditByCompany.get(a.companyId)).toBe(issuedA.id);
      expect(auditByCompany.get(b.companyId)).toBe(issuedB.id);
    });
  });

  it("rejects empty/oversized rawToken via Zod schema", async () => {
    await withRollback(async (outerTx) => {
      await expect(
        verifyAndConsumeTokenViaServiceRole("", { db: outerTx }),
      ).rejects.toThrow();
      await expect(
        verifyAndConsumeTokenViaServiceRole("x".repeat(257), { db: outerTx }),
      ).rejects.toThrow();
    });
  });

  // ---------- loadTokenStatusViaServiceRole (GET-safe / no consume) ----------

  it("loadTokenStatusViaServiceRole returns reason='ok' without consuming the token (GET-safe)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const issued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );

      const status = await loadTokenStatusViaServiceRole(issued.rawToken, {
        db: outerTx,
      });
      expect(status.ok).toBe(true);
      if (!status.ok) return;
      expect(status.reason).toBe("ok");
      expect(status.tokenId).toBe(issued.id);
      expect(status.reservationId).toBe(fixture.reservationId);

      // DB の usedAt はまだ NULL (consume されていない)
      const rows = await outerTx
        .select({ usedAt: customerReservationTokens.usedAt })
        .from(customerReservationTokens)
        .where(eq(customerReservationTokens.id, issued.id));
      expect(rows[0].usedAt).toBeNull();

      // audit_logs にも何も書かれない
      const auditRows = await outerTx
        .select({ value: sql<number>`count(*)::int` })
        .from(auditLogs)
        .where(eq(auditLogs.entityType, "customer_reservation_token"));
      expect(Number(auditRows[0].value)).toBe(0);

      // status 確認の後でも verify+consume は正常に成功する
      const consumed = await verifyAndConsumeTokenViaServiceRole(issued.rawToken, {
        db: outerTx,
      });
      expect(consumed.ok).toBe(true);
    });
  });

  it("loadTokenStatusViaServiceRole distinguishes not_found / expired / used / revoked without consuming", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);

      // not_found
      const fakeToken = crypto.randomBytes(32).toString("hex");
      const r1 = await loadTokenStatusViaServiceRole(fakeToken, { db: outerTx });
      expect(r1.ok).toBe(false);
      if (r1.ok) return;
      expect(r1.reason).toBe("not_found");

      // expired
      const expiredIssued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );
      await outerTx
        .update(customerReservationTokens)
        .set({ expiresAt: new Date(Date.now() - 60 * 1000) })
        .where(eq(customerReservationTokens.id, expiredIssued.id));
      const r2 = await loadTokenStatusViaServiceRole(expiredIssued.rawToken, {
        db: outerTx,
      });
      expect(r2.ok).toBe(false);
      if (r2.ok) return;
      expect(r2.reason).toBe("expired");

      // used (consume 後に再度 load)
      const usedIssued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );
      await verifyAndConsumeTokenViaServiceRole(usedIssued.rawToken, { db: outerTx });
      const r3 = await loadTokenStatusViaServiceRole(usedIssued.rawToken, {
        db: outerTx,
      });
      expect(r3.ok).toBe(false);
      if (r3.ok) return;
      expect(r3.reason).toBe("used");

      // revoked
      const revokedIssued = await issueToken(
        { reservationId: fixture.reservationId, ttlMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );
      await outerTx
        .update(customerReservationTokens)
        .set({ deletedAt: new Date() })
        .where(eq(customerReservationTokens.id, revokedIssued.id));
      const r4 = await loadTokenStatusViaServiceRole(revokedIssued.rawToken, {
        db: outerTx,
      });
      expect(r4.ok).toBe(false);
      if (r4.ok) return;
      expect(r4.reason).toBe("revoked");
    });
  });
});
