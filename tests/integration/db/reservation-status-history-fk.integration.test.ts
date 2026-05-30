import { config } from "dotenv";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { lanes } from "@/lib/db/schema/lanes";
import { reservationStatusHistory } from "@/lib/db/schema/reservation_status_history";
import { reservations } from "@/lib/db/schema/reservations";
import { statuses } from "@/lib/db/schema/statuses";
import { stores } from "@/lib/db/schema/stores";
import { users } from "@/lib/db/schema/users";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";
const FOREIGN_KEY_VIOLATION = "23503";

type Db = NonNullable<typeof db>;
type TransactionCallback = Parameters<Db["transaction"]>[0];
type Tx = Parameters<TransactionCallback>[0];

interface Fixture {
  companyId: string;
  storeId: string;
  laneId: string;
  reservationId: string;
  toStatusId: string;
  userId: string;
}

function requireRow<T>(row: T | undefined, label: string): T {
  if (!row) throw new Error(`Expected ${label} row to be returned`);
  return row;
}

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

async function expectPostgresErrorCode(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action();
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
    return;
  }

  throw new Error(`Expected postgres error code ${code}`);
}

async function seedFixture(outerTx: Tx, options: { companyLabel?: string } = {}): Promise<Fixture> {
  const { companyLabel = "Company" } = options;
  const suffix = crypto.randomUUID().slice(0, 8);

  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__res_sh_${companyLabel}_${suffix}__`, code: `rsh_${suffix}` })
    .returning({ id: companies.id });
  const company = requireRow(companyRow, "company");

  const [storeRow] = await outerTx
    .insert(stores)
    .values({ companyId: company.id, code: `s_${suffix}`, name: `Store ${suffix}` })
    .returning({ id: stores.id });
  const store = requireRow(storeRow, "store");

  const [laneRow] = await outerTx
    .insert(lanes)
    .values({ companyId: company.id, storeId: store.id, name: `Lane ${suffix}` })
    .returning({ id: lanes.id });
  const lane = requireRow(laneRow, "lane");

  const [statusRow] = await outerTx
    .insert(statuses)
    .values({
      companyId: company.id,
      statusType: "reservation",
      key: `confirmed_${suffix}`,
      name: `Confirmed ${suffix}`,
    })
    .returning({ id: statuses.id });
  const status = requireRow(statusRow, "status");

  const [reservationRow] = await outerTx
    .insert(reservations)
    .values({
      companyId: company.id,
      storeId: store.id,
      laneId: lane.id,
      startAt: new Date("2026-06-01T09:00:00Z"),
      endAt: new Date("2026-06-01T10:00:00Z"),
    })
    .returning({ id: reservations.id });
  const reservation = requireRow(reservationRow, "reservation");

  const userResult = await outerTx.execute(sql<{ id: string }>`
    WITH auth_user AS (
      INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        ${`user-res-${suffix}@example.test`},
        now(),
        now(),
        now()
      )
      RETURNING id
    )
    INSERT INTO users (id, company_id, email, name, is_active)
    SELECT id, ${company.id}, ${`user-res-${suffix}@example.test`}, ${`User ${suffix}`}, true
    FROM auth_user
    RETURNING id
  `);

  const [userRow] = (userResult as any).rows ?? userResult;
  const user = requireRow(userRow, "user");

  return {
    companyId: company.id,
    storeId: store.id,
    laneId: lane.id,
    reservationId: reservation.id,
    toStatusId: status.id,
    userId: user.id,
  };
}

describeIntegration("reservation_status_history changed_by_user_id composite FK", () => {
  it("rejects INSERT with cross-company changed_by_user_id via composite FK", async () => {
    await withRollback(async (outerTx) => {
      const fixtureA = await seedFixture(outerTx, { companyLabel: "A" });
      const fixtureB = await seedFixture(outerTx, { companyLabel: "B" });

      await expectPostgresErrorCode(
        () =>
          outerTx.insert(reservationStatusHistory).values({
            companyId: fixtureA.companyId,
            reservationId: fixtureA.reservationId,
            toStatusId: fixtureA.toStatusId,
            changedByUserId: fixtureB.userId,
          }),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  it("accepts INSERT with same-company changed_by_user_id", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);

      const [inserted] = await outerTx
        .insert(reservationStatusHistory)
        .values({
          companyId: fixture.companyId,
          reservationId: fixture.reservationId,
          toStatusId: fixture.toStatusId,
          changedByUserId: fixture.userId,
        })
        .returning({ id: reservationStatusHistory.id });

      const rows = await outerTx
        .select()
        .from(reservationStatusHistory)
        .where(eq(reservationStatusHistory.id, requireRow(inserted, "status history").id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.changedByUserId).toBe(fixture.userId);
    });
  });

  it("accepts INSERT with NULL changed_by_user_id (MATCH SIMPLE)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);

      await outerTx.insert(reservationStatusHistory).values({
        companyId: fixture.companyId,
        reservationId: fixture.reservationId,
        toStatusId: fixture.toStatusId,
        changedByUserId: null,
      });

      const rows = await outerTx
        .select()
        .from(reservationStatusHistory)
        .where(
          and(
            eq(reservationStatusHistory.reservationId, fixture.reservationId),
            isNull(reservationStatusHistory.changedByUserId),
          ),
        );
      expect(rows).toHaveLength(1);
    });
  });

  it("rejects user hard delete referenced by status_history (ON DELETE NO ACTION = RESTRICT)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);

      await outerTx.insert(reservationStatusHistory).values({
        companyId: fixture.companyId,
        reservationId: fixture.reservationId,
        toStatusId: fixture.toStatusId,
        changedByUserId: fixture.userId,
      });

      await expectPostgresErrorCode(
        () => outerTx.delete(users).where(eq(users.id, fixture.userId)),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  it("raises FK violation at statement time for cross-company user (NO ACTION non-deferrable check)", async () => {
    await withRollback(async (outerTx) => {
      const fixtureA = await seedFixture(outerTx, { companyLabel: "DefA" });
      const fixtureB = await seedFixture(outerTx, { companyLabel: "DefB" });

      // PostgreSQL non-DEFERRABLE FK with NO ACTION raises at statement time.
      // Using company A row but company B user triggers composite FK immediately.
      await expectPostgresErrorCode(
        () =>
          outerTx.insert(reservationStatusHistory).values({
            companyId: fixtureA.companyId,
            reservationId: fixtureA.reservationId,
            toStatusId: fixtureA.toStatusId,
            changedByUserId: fixtureB.userId,
          }),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });
});