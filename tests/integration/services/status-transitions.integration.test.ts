import { config } from "dotenv";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { statusTransitions } from "@/lib/db/schema/status_transitions";
import { createStatus } from "@/lib/services/statuses";
import {
  createStatusTransition,
  deleteStatusTransition,
  getStatusTransitionById,
  listStatusTransitions,
  StatusTransitionConflictError,
  updateStatusTransition,
} from "@/lib/services/status-transitions";

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
};

afterAll(async () => {
  await queryClient?.end();
});

async function withRollback(fn: (outerTx: Tx) => Promise<void>): Promise<void> {
  await db!
    .transaction(async (outerTx) => {
      try {
        await fn(outerTx);
      } finally {
        throw new Error(ROLLBACK);
      }
    })
    .catch((err) => {
      if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
    });
}

async function seedFixture(outerTx: Tx): Promise<Fixture> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [company, otherCompany] = await outerTx
    .insert(companies)
    .values([
      { name: `__sxn_company_${suffix}__`, code: `sxn_${suffix}` },
      { name: `__sxn_other_${suffix}__`, code: `sxn_o_${suffix}` },
    ])
    .returning({ id: companies.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
  };
}

async function seedStatusPair(outerTx: Tx, companyId: string) {
  const suffix = crypto.randomUUID().slice(0, 6);
  const from = await createStatus(
    { statusType: "reservation", key: `from_${suffix}`, name: `From-${suffix}` },
    { db: outerTx, companyId },
  );
  const to = await createStatus(
    { statusType: "reservation", key: `to_${suffix}`, name: `To-${suffix}` },
    { db: outerTx, companyId },
  );
  return { from, to, suffix };
}

describeIntegration("status_transition services", () => {
  it("creates a transition from NULL (initial) to a target status", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const { to } = await seedStatusPair(outerTx, fixture.companyId);

      const created = await createStatusTransition(
        {
          statusType: "reservation",
          fromStatusId: null,
          toStatusId: to.id,
          triggersNotification: true,
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.companyId).toBe(fixture.companyId);
      expect(created.statusType).toBe("reservation");
      expect(created.fromStatusId).toBeNull();
      expect(created.toStatusId).toBe(to.id);
      expect(created.triggersNotification).toBe(true);
    });
  });

  it("lists transitions for the requested company with from/to status name joined", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const other = await seedFixture(outerTx);
      const pair = await seedStatusPair(outerTx, fixture.companyId);
      const otherPair = await seedStatusPair(outerTx, other.companyId);

      await createStatusTransition(
        { statusType: "reservation", fromStatusId: pair.from.id, toStatusId: pair.to.id },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createStatusTransition(
        {
          statusType: "reservation",
          fromStatusId: otherPair.from.id,
          toStatusId: otherPair.to.id,
        },
        { db: outerTx, companyId: other.companyId },
      );

      const result = await listStatusTransitions(
        { limit: 100 },
        { db: outerTx, companyId: fixture.companyId },
      );
      const visibleToIds = result.rows.map((r) => r.toStatusId);
      expect(visibleToIds).toContain(pair.to.id);
      expect(visibleToIds).not.toContain(otherPair.to.id);
      const row = result.rows.find((r) => r.toStatusId === pair.to.id);
      expect(row?.fromStatusName).toBe(pair.from.name);
      expect(row?.toStatusName).toBe(pair.to.name);
    });
  });

  it("filters transitions by statusType", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const transportTo = await createStatus(
        { statusType: "transport", key: `tt_${suffix}`, name: `TT-${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );
      const vendorTo = await createStatus(
        { statusType: "vendor", key: `vt_${suffix}`, name: `VT-${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );

      await createStatusTransition(
        { statusType: "transport", fromStatusId: null, toStatusId: transportTo.id },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createStatusTransition(
        { statusType: "vendor", fromStatusId: null, toStatusId: vendorTo.id },
        { db: outerTx, companyId: fixture.companyId },
      );

      const transportOnly = await listStatusTransitions(
        { statusType: "transport", limit: 100 },
        { db: outerTx, companyId: fixture.companyId },
      );
      const toIds = transportOnly.rows.map((r) => r.toStatusId);
      expect(toIds).toContain(transportTo.id);
      expect(toIds).not.toContain(vendorTo.id);
    });
  });

  it("filters transitions by fromStatusId=null (initial transitions)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const pair = await seedStatusPair(outerTx, fixture.companyId);

      await createStatusTransition(
        { statusType: "reservation", fromStatusId: null, toStatusId: pair.to.id },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createStatusTransition(
        { statusType: "reservation", fromStatusId: pair.from.id, toStatusId: pair.to.id },
        { db: outerTx, companyId: fixture.companyId },
      );

      const initialOnly = await listStatusTransitions(
        { fromStatusId: null, limit: 100 },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(initialOnly.rows.every((r) => r.fromStatusId === null)).toBe(true);
      expect(initialOnly.rows.length).toBe(1);
    });
  });

  it("updates a transition's toStatusId and triggersNotification flag", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const pair = await seedStatusPair(outerTx, fixture.companyId);
      const suffix = crypto.randomUUID().slice(0, 6);
      const newTo = await createStatus(
        { statusType: "reservation", key: `new_to_${suffix}`, name: `NewTo-${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );

      const created = await createStatusTransition(
        {
          statusType: "reservation",
          fromStatusId: pair.from.id,
          toStatusId: pair.to.id,
          triggersNotification: false,
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      const updated = await updateStatusTransition(
        created.id,
        { toStatusId: newTo.id, triggersNotification: true },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(updated?.toStatusId).toBe(newTo.id);
      expect(updated?.triggersNotification).toBe(true);
      expect(updated?.fromStatusId).toBe(pair.from.id);
    });
  });

  it("hard-deletes a transition and rejects cross-tenant delete", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const pair = await seedStatusPair(outerTx, fixture.companyId);

      const created = await createStatusTransition(
        { statusType: "reservation", fromStatusId: pair.from.id, toStatusId: pair.to.id },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(
        deleteStatusTransition(created.id, { db: outerTx, companyId: fixture.otherCompanyId }),
      ).resolves.toBe(false);
      await expect(
        deleteStatusTransition(created.id, { db: outerTx, companyId: fixture.companyId }),
      ).resolves.toBe(true);

      const rows = await outerTx
        .select({ value: count() })
        .from(statusTransitions)
        .where(eq(statusTransitions.id, created.id));
      expect(Number(rows[0]?.value ?? 0)).toBe(0);

      const detail = await getStatusTransitionById(created.id, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(detail).toBeNull();
    });
  });

  it("rejects duplicate (statusType, fromStatusId, toStatusId) and allows self-loop (from=to)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const pair = await seedStatusPair(outerTx, fixture.companyId);

      await createStatusTransition(
        { statusType: "reservation", fromStatusId: pair.from.id, toStatusId: pair.to.id },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(
        outerTx.transaction(async (savepoint: Tx) =>
          createStatusTransition(
            { statusType: "reservation", fromStatusId: pair.from.id, toStatusId: pair.to.id },
            { db: savepoint, companyId: fixture.companyId },
          ),
        ),
      ).rejects.toBeInstanceOf(StatusTransitionConflictError);

      // self-loop (from=to) is allowed at DB level
      await expect(
        createStatusTransition(
          { statusType: "reservation", fromStatusId: pair.to.id, toStatusId: pair.to.id },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).resolves.toMatchObject({ fromStatusId: pair.to.id, toStatusId: pair.to.id });
    });
  });

  it("rejects invalid statusType and non-uuid toStatusId via Zod", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const { to } = await seedStatusPair(outerTx, fixture.companyId);

      await expect(
        createStatusTransition(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { statusType: "invalid" as any, fromStatusId: null, toStatusId: to.id },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toThrow();

      await expect(
        createStatusTransition(
          { statusType: "reservation", fromStatusId: null, toStatusId: "not-a-uuid" },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toThrow();
    });
  });
});
