import { config } from "dotenv";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { laneTypes } from "@/lib/db/schema/lane_types";
import {
  createLaneType,
  deleteLaneType,
  getLaneTypeById,
  LaneTypeCodeConflictError,
  listLaneTypes,
  updateLaneType,
} from "@/lib/services/lane-types";

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
      { name: `__lt_company_${suffix}__`, code: `lt_${suffix}` },
      { name: `__lt_other_${suffix}__`, code: `lt_o_${suffix}` },
    ])
    .returning({ id: companies.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
  };
}

describeIntegration("lane_type services", () => {
  it("creates a lane_type scoped to the admin company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const created = await createLaneType(
        { name: `一般整備-${suffix}`, code: `GEN_${suffix}`, sortOrder: 5 },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.companyId).toBe(fixture.companyId);
      expect(created.name).toBe(`一般整備-${suffix}`);
      expect(created.code).toBe(`GEN_${suffix}`);
      expect(created.sortOrder).toBe(5);
    });
  });

  it("lists only lane_types for the requested company ordered by sortOrder", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const other = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      await createLaneType({ name: `LT-B-${suffix}`, code: `B_${suffix}`, sortOrder: 20 }, { db: outerTx, companyId: fixture.companyId });
      await createLaneType({ name: `LT-A-${suffix}`, code: `A_${suffix}`, sortOrder: 10 }, { db: outerTx, companyId: fixture.companyId });
      await createLaneType({ name: `LT-OTHER-${suffix}`, code: `O_${suffix}` }, { db: outerTx, companyId: other.companyId });

      const result = await listLaneTypes({}, { db: outerTx, companyId: fixture.companyId });
      const names = result.rows.map((r) => r.name);
      expect(names).toContain(`LT-A-${suffix}`);
      expect(names).toContain(`LT-B-${suffix}`);
      expect(names).not.toContain(`LT-OTHER-${suffix}`);
      const idxA = names.indexOf(`LT-A-${suffix}`);
      const idxB = names.indexOf(`LT-B-${suffix}`);
      expect(idxA).toBeLessThan(idxB);
    });
  });

  it("updates a lane_type in company scope", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createLaneType(
        { name: "板金", code: "BAN", sortOrder: 0 },
        { db: outerTx, companyId: fixture.companyId },
      );

      const updated = await updateLaneType(
        created.id,
        { name: "板金 (改)", sortOrder: 99 },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(updated?.name).toBe("板金 (改)");
      expect(updated?.sortOrder).toBe(99);
      expect(updated?.code).toBe("BAN");
    });
  });

  it("hard-deletes a lane_type and rejects cross-tenant delete", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createLaneType(
        { name: "削除対象", code: "DELME" },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(deleteLaneType(created.id, { db: outerTx, companyId: fixture.otherCompanyId })).resolves.toBe(false);
      await expect(deleteLaneType(created.id, { db: outerTx, companyId: fixture.companyId })).resolves.toBe(true);

      const rows = await outerTx
        .select({ value: count() })
        .from(laneTypes)
        .where(eq(laneTypes.id, created.id));
      expect(Number(rows[0]?.value ?? 0)).toBe(0);

      const detail = await getLaneTypeById(created.id, { db: outerTx, companyId: fixture.companyId });
      expect(detail).toBeNull();
    });
  });

  it("filters lane_types by q (name / code partial match)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      await createLaneType({ name: `一般整備-${suffix}`, code: `GEN_${suffix}` }, { db: outerTx, companyId: fixture.companyId });
      await createLaneType({ name: `車検-${suffix}`, code: `INSP_${suffix}` }, { db: outerTx, companyId: fixture.companyId });

      const byName = await listLaneTypes({ q: `一般整備-${suffix}` }, { db: outerTx, companyId: fixture.companyId });
      expect(byName.rows.map((r) => r.name)).toEqual([`一般整備-${suffix}`]);

      const byCode = await listLaneTypes({ q: `INSP_${suffix}` }, { db: outerTx, companyId: fixture.companyId });
      expect(byCode.rows.find((r) => r.name === `車検-${suffix}`)).toBeDefined();
    });
  });

  it("rejects duplicate code within the same company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const code = `DUP_${suffix}`;

      await createLaneType(
        { name: `初回-${suffix}`, code },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(
        outerTx.transaction(async (savepoint: Tx) =>
          createLaneType(
            { name: `重複-${suffix}`, code },
            { db: savepoint, companyId: fixture.companyId },
          ),
        ),
      ).rejects.toBeInstanceOf(LaneTypeCodeConflictError);

      await expect(
        createLaneType(
          { name: `別社-${suffix}`, code },
          { db: outerTx, companyId: fixture.otherCompanyId },
        ),
      ).resolves.toMatchObject({ code });
    });
  });
});
