import { config } from "dotenv";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { statuses } from "@/lib/db/schema/statuses";
import { statusTransitions } from "@/lib/db/schema/status_transitions";
import {
  createStatus,
  deleteStatus,
  getStatusById,
  listStatuses,
  StatusConflictError,
  StatusInUseError,
  updateStatus,
} from "@/lib/services/statuses";

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
      { name: `__st_company_${suffix}__`, code: `st_${suffix}` },
      { name: `__st_other_${suffix}__`, code: `st_o_${suffix}` },
    ])
    .returning({ id: companies.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
  };
}

describeIntegration("status services", () => {
  it("creates a status scoped to the admin company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const created = await createStatus(
        {
          statusType: "reservation",
          key: `pending_${suffix}`,
          name: "保留",
          displayOrder: 10,
          isInitial: true,
          isActive: true,
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.companyId).toBe(fixture.companyId);
      expect(created.statusType).toBe("reservation");
      expect(created.key).toBe(`pending_${suffix}`);
      expect(created.name).toBe("保留");
      expect(created.displayOrder).toBe(10);
      expect(created.isInitial).toBe(true);
      expect(created.isTerminal).toBe(false);
      expect(created.isActive).toBe(true);
    });
  });

  it("lists only statuses for the requested company ordered by (statusType, displayOrder)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const other = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      await createStatus(
        { statusType: "service", key: `b_${suffix}`, name: `S-B-${suffix}`, displayOrder: 20 },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createStatus(
        { statusType: "service", key: `a_${suffix}`, name: `S-A-${suffix}`, displayOrder: 10 },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createStatus(
        { statusType: "reservation", key: `x_${suffix}`, name: `R-X-${suffix}`, displayOrder: 5 },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createStatus(
        { statusType: "service", key: `other_${suffix}`, name: `S-OTHER-${suffix}` },
        { db: outerTx, companyId: other.companyId },
      );

      const result = await listStatuses({ limit: 100 }, { db: outerTx, companyId: fixture.companyId });
      const names = result.rows.map((r) => r.name);
      expect(names).toContain(`R-X-${suffix}`);
      expect(names).toContain(`S-A-${suffix}`);
      expect(names).toContain(`S-B-${suffix}`);
      expect(names).not.toContain(`S-OTHER-${suffix}`);
      // statusType asc → reservation < service
      const idxR = names.indexOf(`R-X-${suffix}`);
      const idxSA = names.indexOf(`S-A-${suffix}`);
      const idxSB = names.indexOf(`S-B-${suffix}`);
      expect(idxR).toBeLessThan(idxSA);
      expect(idxSA).toBeLessThan(idxSB);
    });
  });

  it("filters statuses by statusType", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      await createStatus(
        { statusType: "transport", key: `t_${suffix}`, name: `T-${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createStatus(
        { statusType: "vendor", key: `v_${suffix}`, name: `V-${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );

      const transportOnly = await listStatuses(
        { statusType: "transport", limit: 100 },
        { db: outerTx, companyId: fixture.companyId },
      );
      const names = transportOnly.rows.map((r) => r.name);
      expect(names).toContain(`T-${suffix}`);
      expect(names).not.toContain(`V-${suffix}`);
    });
  });

  it("filters statuses by q (name / key partial match)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      await createStatus(
        { statusType: "reservation", key: `confirmed_${suffix}`, name: `確定-${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createStatus(
        { statusType: "reservation", key: `cancelled_${suffix}`, name: `キャンセル-${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );

      const byName = await listStatuses(
        { q: `確定-${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(byName.rows.map((r) => r.name)).toEqual([`確定-${suffix}`]);

      const byKey = await listStatuses(
        { q: `cancelled_${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(byKey.rows.find((r) => r.name === `キャンセル-${suffix}`)).toBeDefined();
    });
  });

  it("updates a status in company scope", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const created = await createStatus(
        { statusType: "service", key: `wip_${suffix}`, name: "作業中" },
        { db: outerTx, companyId: fixture.companyId },
      );

      const updated = await updateStatus(
        created.id,
        { name: "作業中 (改)", displayOrder: 99, isTerminal: true },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(updated?.name).toBe("作業中 (改)");
      expect(updated?.displayOrder).toBe(99);
      expect(updated?.isTerminal).toBe(true);
      expect(updated?.key).toBe(`wip_${suffix}`);
    });
  });

  it("hard-deletes a status and rejects cross-tenant delete", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const created = await createStatus(
        { statusType: "vendor", key: `delme_${suffix}`, name: "削除対象" },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(
        deleteStatus(created.id, { db: outerTx, companyId: fixture.otherCompanyId }),
      ).resolves.toBe(false);
      await expect(
        deleteStatus(created.id, { db: outerTx, companyId: fixture.companyId }),
      ).resolves.toBe(true);

      const rows = await outerTx
        .select({ value: count() })
        .from(statuses)
        .where(eq(statuses.id, created.id));
      expect(Number(rows[0]?.value ?? 0)).toBe(0);

      const detail = await getStatusById(created.id, { db: outerTx, companyId: fixture.companyId });
      expect(detail).toBeNull();
    });
  });

  it("rejects duplicate (statusType, key) within the same company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const key = `dup_${suffix}`;

      await createStatus(
        { statusType: "reservation", key, name: "初回" },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(
        outerTx.transaction(async (savepoint: Tx) =>
          createStatus(
            { statusType: "reservation", key, name: "重複" },
            { db: savepoint, companyId: fixture.companyId },
          ),
        ),
      ).rejects.toBeInstanceOf(StatusConflictError);

      // different statusType with same key is allowed
      await expect(
        createStatus(
          { statusType: "service", key, name: "別 type" },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).resolves.toMatchObject({ key, statusType: "service" });

      // different company is allowed
      await expect(
        createStatus(
          { statusType: "reservation", key, name: "別社" },
          { db: outerTx, companyId: fixture.otherCompanyId },
        ),
      ).resolves.toMatchObject({ key });
    });
  });

  it("wraps FK violation as StatusInUseError when referenced by status_transitions", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const fromStatus = await createStatus(
        { statusType: "reservation", key: `from_${suffix}`, name: "From" },
        { db: outerTx, companyId: fixture.companyId },
      );
      const toStatus = await createStatus(
        { statusType: "reservation", key: `to_${suffix}`, name: "To" },
        { db: outerTx, companyId: fixture.companyId },
      );

      await outerTx.insert(statusTransitions).values({
        companyId: fixture.companyId,
        statusType: "reservation",
        fromStatusId: fromStatus.id,
        toStatusId: toStatus.id,
      });

      await expect(
        outerTx.transaction(async (savepoint: Tx) =>
          deleteStatus(toStatus.id, { db: savepoint, companyId: fixture.companyId }),
        ),
      ).rejects.toBeInstanceOf(StatusInUseError);
    });
  });

  it("rejects invalid statusType via Zod", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await expect(
        createStatus(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          { statusType: "invalid" as any, key: "bad", name: "bad" },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toThrow();
    });
  });

  it("normalizes displayOrder null and toggles isActive across update boundary", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const created = await createStatus(
        {
          statusType: "service",
          key: `flag_${suffix}`,
          name: "flag",
          displayOrder: 7,
          isActive: true,
        },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(created.displayOrder).toBe(7);
      expect(created.isActive).toBe(true);

      const cleared = await updateStatus(
        created.id,
        { displayOrder: null, isActive: null },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(cleared?.displayOrder).toBeNull();
      expect(cleared?.isActive).toBeNull();
    });
  });
});
