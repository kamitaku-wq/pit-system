import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/lib/db/schema/audit_logs";
import { companies } from "@/lib/db/schema/companies";
import { reservationVerificationCodes } from "@/lib/db/schema/reservation_verification_codes";
import {
  ISSUE_RATE_MAX,
  ISSUE_RATE_WINDOW_MINUTES,
} from "@/lib/services/reservation-verification-code-crypto";
import {
  issueVerificationCode,
  verifyVerificationCode,
} from "@/lib/services/reservation-verification-codes";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";
const PEPPER = "integration-test-pepper-0123456789ABCDEF";

// Drizzle does not expose a shared transaction type for postgres-js transactions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

type Fixture = { companyId: string; otherCompanyId: string; email: string };

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
      { name: `__rvc_company_${suffix}__`, code: `rvc_${suffix}` },
      { name: `__rvc_other_${suffix}__`, code: `rvc_o_${suffix}` },
    ])
    .returning({ id: companies.id });
  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
    email: `cust_${suffix}@example.com`,
  };
}

async function activeRows(tx: Tx, companyId: string, email: string) {
  return tx
    .select()
    .from(reservationVerificationCodes)
    .where(
      and(
        eq(reservationVerificationCodes.companyId, companyId),
        eq(reservationVerificationCodes.email, email),
        isNull(reservationVerificationCodes.consumedAt),
      ),
    );
}

describeIntegration("reservation-verification-codes (integration)", () => {
  it("1. issue -> verify happy path (ok, normalized verifiedEmail, consumed)", async () => {
    await withRollback(async (tx) => {
      const f = await seedFixture(tx);
      const issued = await issueVerificationCode(
        { companyId: f.companyId, email: f.email.toUpperCase() },
        { db: tx, pepper: PEPPER },
      );
      expect(issued.ok).toBe(true);
      if (!issued.ok) return;
      expect(issued.code).toMatch(/^\d{6}$/);
      expect(issued.email).toBe(f.email); // normalized (lowercased)

      const res = await verifyVerificationCode(
        { companyId: f.companyId, email: f.email, code: issued.code },
        { db: tx, pepper: PEPPER },
      );
      expect(res).toEqual({
        ok: true,
        reason: "ok",
        codeId: issued.id,
        verifiedEmail: f.email,
      });

      const active = await activeRows(tx, f.companyId, f.email);
      expect(active.length).toBe(0); // consumed
    });
  });

  it("2. wrong code -> invalid_code, remainingAttempts decrements, attempt_count persists", async () => {
    await withRollback(async (tx) => {
      const f = await seedFixture(tx);
      const issued = await issueVerificationCode(
        { companyId: f.companyId, email: f.email },
        { db: tx, pepper: PEPPER },
      );
      if (!issued.ok) throw new Error("issue failed");
      const wrong = issued.code === "000000" ? "111111" : "000000";

      const res = await verifyVerificationCode(
        { companyId: f.companyId, email: f.email, code: wrong },
        { db: tx, pepper: PEPPER },
      );
      expect(res).toEqual({ ok: false, reason: "invalid_code", remainingAttempts: 4 });

      const [row] = await activeRows(tx, f.companyId, f.email);
      expect(row.attemptCount).toBe(1); // persisted, still active
    });
  });

  it("3. reaching max_attempts -> locked (even with the correct code)", async () => {
    await withRollback(async (tx) => {
      const f = await seedFixture(tx);
      const issued = await issueVerificationCode(
        { companyId: f.companyId, email: f.email, maxAttempts: 2 },
        { db: tx, pepper: PEPPER },
      );
      if (!issued.ok) throw new Error("issue failed");
      const wrong = issued.code === "000000" ? "111111" : "000000";

      const r1 = await verifyVerificationCode(
        { companyId: f.companyId, email: f.email, code: wrong },
        { db: tx, pepper: PEPPER },
      );
      expect(r1).toEqual({ ok: false, reason: "invalid_code", remainingAttempts: 1 });

      const r2 = await verifyVerificationCode(
        { companyId: f.companyId, email: f.email, code: wrong },
        { db: tx, pepper: PEPPER },
      );
      expect(r2).toEqual({ ok: false, reason: "locked" });

      // correct code is now rejected because attempts are exhausted
      const r3 = await verifyVerificationCode(
        { companyId: f.companyId, email: f.email, code: issued.code },
        { db: tx, pepper: PEPPER },
      );
      expect(r3).toEqual({ ok: false, reason: "locked" });
    });
  });

  it("4. expired code -> expired", async () => {
    await withRollback(async (tx) => {
      const f = await seedFixture(tx);
      const t0 = new Date("2026-01-01T00:00:00.000Z");
      const issued = await issueVerificationCode(
        { companyId: f.companyId, email: f.email },
        { db: tx, pepper: PEPPER, now: t0 },
      );
      if (!issued.ok) throw new Error("issue failed");

      const later = new Date(t0.getTime() + 11 * 60 * 1000); // ttl default 10min
      const res = await verifyVerificationCode(
        { companyId: f.companyId, email: f.email, code: issued.code },
        { db: tx, pepper: PEPPER, now: later },
      );
      expect(res).toEqual({ ok: false, reason: "expired" });
    });
  });

  it("5. consumed code -> not_found on replay", async () => {
    await withRollback(async (tx) => {
      const f = await seedFixture(tx);
      const issued = await issueVerificationCode(
        { companyId: f.companyId, email: f.email },
        { db: tx, pepper: PEPPER },
      );
      if (!issued.ok) throw new Error("issue failed");

      const first = await verifyVerificationCode(
        { companyId: f.companyId, email: f.email, code: issued.code },
        { db: tx, pepper: PEPPER },
      );
      expect(first.ok).toBe(true);

      const replay = await verifyVerificationCode(
        { companyId: f.companyId, email: f.email, code: issued.code },
        { db: tx, pepper: PEPPER },
      );
      expect(replay).toEqual({ ok: false, reason: "not_found" });
    });
  });

  it("6. re-issue supersedes the prior active code (exactly 1 active; old code no longer ok)", async () => {
    await withRollback(async (tx) => {
      const f = await seedFixture(tx);
      const first = await issueVerificationCode(
        { companyId: f.companyId, email: f.email },
        { db: tx, pepper: PEPPER },
      );
      const second = await issueVerificationCode(
        { companyId: f.companyId, email: f.email },
        { db: tx, pepper: PEPPER },
      );
      if (!first.ok || !second.ok) throw new Error("issue failed");

      const active = await activeRows(tx, f.companyId, f.email);
      expect(active.length).toBe(1);
      expect(active[0].id).toBe(second.id);

      // old code can never confirm (active row is the new one)
      const oldRes = await verifyVerificationCode(
        { companyId: f.companyId, email: f.email, code: first.code },
        { db: tx, pepper: PEPPER },
      );
      expect(oldRes.ok).toBe(false);

      // new code still works (collateral attempt from old guess kept it under max)
      const newRes = await verifyVerificationCode(
        { companyId: f.companyId, email: f.email, code: second.code },
        { db: tx, pepper: PEPPER },
      );
      expect(newRes.ok).toBe(true);
    });
  });

  it("7. email binding: a code for email A cannot be verified for email B", async () => {
    await withRollback(async (tx) => {
      const f = await seedFixture(tx);
      const emailB = `other_${crypto.randomUUID().slice(0, 6)}@example.com`;
      const issued = await issueVerificationCode(
        { companyId: f.companyId, email: f.email },
        { db: tx, pepper: PEPPER },
      );
      if (!issued.ok) throw new Error("issue failed");

      const res = await verifyVerificationCode(
        { companyId: f.companyId, email: emailB, code: issued.code },
        { db: tx, pepper: PEPPER },
      );
      expect(res).toEqual({ ok: false, reason: "not_found" });
    });
  });

  it("8. cross-company isolation: a code for company1 cannot be verified for company2", async () => {
    await withRollback(async (tx) => {
      const f = await seedFixture(tx);
      const issued = await issueVerificationCode(
        { companyId: f.companyId, email: f.email },
        { db: tx, pepper: PEPPER },
      );
      if (!issued.ok) throw new Error("issue failed");

      const res = await verifyVerificationCode(
        { companyId: f.otherCompanyId, email: f.email, code: issued.code },
        { db: tx, pepper: PEPPER },
      );
      expect(res).toEqual({ ok: false, reason: "not_found" });
    });
  });

  it("9. success writes one audit_logs row (kind=customer_email_verify)", async () => {
    await withRollback(async (tx) => {
      const f = await seedFixture(tx);
      const issued = await issueVerificationCode(
        { companyId: f.companyId, email: f.email },
        { db: tx, pepper: PEPPER },
      );
      if (!issued.ok) throw new Error("issue failed");

      await verifyVerificationCode(
        { companyId: f.companyId, email: f.email, code: issued.code },
        { db: tx, pepper: PEPPER, ipAddress: "203.0.113.7", userAgent: "vitest" },
      );

      const audits = await tx
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "reservation_verification_code"),
            eq(auditLogs.entityId, issued.id),
          ),
        );
      expect(audits.length).toBe(1);
      expect(audits[0].action).toBe("update");
      expect(audits[0].actorKind).toBe("system");
      expect(audits[0].afterJson).toMatchObject({ kind: "customer_email_verify" });
    });
  });

  it("10. issue rate guard: blocks after ISSUE_RATE_MAX issues in the window", async () => {
    await withRollback(async (tx) => {
      const f = await seedFixture(tx);
      for (let i = 0; i < ISSUE_RATE_MAX; i++) {
        const r = await issueVerificationCode(
          { companyId: f.companyId, email: f.email },
          { db: tx, pepper: PEPPER },
        );
        expect(r.ok).toBe(true);
      }
      const blocked = await issueVerificationCode(
        { companyId: f.companyId, email: f.email },
        { db: tx, pepper: PEPPER },
      );
      expect(blocked).toEqual({ ok: false, reason: "rate_limited" });
    });
  });

  it("12. issue rate guard resets once the window has passed", async () => {
    await withRollback(async (tx) => {
      const f = await seedFixture(tx);
      for (let i = 0; i < ISSUE_RATE_MAX; i++) {
        await issueVerificationCode(
          { companyId: f.companyId, email: f.email },
          { db: tx, pepper: PEPPER },
        );
      }
      const blocked = await issueVerificationCode(
        { companyId: f.companyId, email: f.email },
        { db: tx, pepper: PEPPER },
      );
      expect(blocked.ok).toBe(false);

      // advance the evaluation clock past the window: prior rows fall out of the count
      const later = new Date(Date.now() + (ISSUE_RATE_WINDOW_MINUTES + 1) * 60 * 1000);
      const reissued = await issueVerificationCode(
        { companyId: f.companyId, email: f.email },
        { db: tx, pepper: PEPPER, now: later },
      );
      expect(reissued.ok).toBe(true);
    });
  });

  it("11. partial unique index rejects a second active row for the same (company, email)", async () => {
    await withRollback(async (tx) => {
      const f = await seedFixture(tx);
      const base = {
        companyId: f.companyId,
        email: f.email,
        codeHash: "deadbeef".repeat(8),
        attemptCount: 0,
        maxAttempts: 5,
        expiresAt: new Date(Date.now() + 600000),
      };
      await tx.insert(reservationVerificationCodes).values(base);

      let unique = false;
      try {
        // savepoint isolates the constraint failure so the outer tx survives
        await tx.transaction(async (sp: Tx) => {
          await sp
            .insert(reservationVerificationCodes)
            .values({ ...base, codeHash: "cafebabe".repeat(8) });
        });
      } catch (err) {
        unique = (err as { code?: string }).code === "23505";
      }
      expect(unique).toBe(true);
    });
  });

  // RLS 拒否は整合性テスト (owner 接続) では bypass されるため、SET LOCAL ROLE anon で実発火させる
  // (tests/integration/tenant-isolation.test.ts と同型)。RLS 未有効だと anon が attempt_count 改ざん
  // (ロック回避) / 既知 code_hash 注入 (検証偽装) で auth bypass できるため、本テストが防御を実証する。
  it("13. RLS denies anon read and tamper (the anon footgun is closed)", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    let anonReadCount = -1;
    let attemptAfterAnonUpdate = -1;
    await queryClient!
      .begin(async (tx: Tx) => {
        const [company] = await tx`
          INSERT INTO companies (name, code)
          VALUES (${"__rvc_rls_" + suffix + "__"}, ${"rvc_rls_" + suffix})
          RETURNING id`;
        const [row] = await tx`
          INSERT INTO reservation_verification_codes
            (company_id, email, code_hash, attempt_count, max_attempts, expires_at)
          VALUES (${company.id}::uuid, ${"rls_" + suffix + "@example.com"}, ${"a".repeat(64)},
                  0, 5, now() + interval '10 minutes')
          RETURNING id`;

        await tx`SET LOCAL ROLE anon`;
        const seen = await tx`
          SELECT id FROM reservation_verification_codes WHERE id = ${row.id}::uuid`;
        anonReadCount = seen.length;
        // anon は当該行が不可視のため UPDATE は 0 行 (エラーにはならず、改ざんできない)
        await tx`
          UPDATE reservation_verification_codes SET attempt_count = 99 WHERE id = ${row.id}::uuid`;
        await tx`RESET ROLE`;

        const [after] = await tx`
          SELECT attempt_count FROM reservation_verification_codes WHERE id = ${row.id}::uuid`;
        attemptAfterAnonUpdate = Number(after.attempt_count);
        throw new Error(ROLLBACK);
      })
      .catch((err: unknown) => {
        if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
      });

    expect(anonReadCount).toBe(0); // anon は読めない
    expect(attemptAfterAnonUpdate).toBe(0); // anon は attempt_count を改ざんできない
  });

  it("14. RLS denies anon insert (no anon policy => WITH CHECK rejects)", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    let insertDenied = false;
    await queryClient!
      .begin(async (tx: Tx) => {
        const [company] = await tx`
          INSERT INTO companies (name, code)
          VALUES (${"__rvc_rls2_" + suffix + "__"}, ${"rvc_rls2_" + suffix})
          RETURNING id`;
        await tx`SET LOCAL ROLE anon`;
        try {
          await tx`
            INSERT INTO reservation_verification_codes (company_id, email, code_hash, expires_at)
            VALUES (${company.id}::uuid, ${"x_" + suffix + "@example.com"}, ${"b".repeat(64)},
                    now() + interval '10 minutes')`;
        } catch {
          insertDenied = true;
        }
        throw new Error(ROLLBACK);
      })
      .catch((err: unknown) => {
        if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
      });

    expect(insertDenied).toBe(true);
  });
});
