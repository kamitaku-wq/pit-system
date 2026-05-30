import { config } from "dotenv";
import { and, count, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { lanes } from "@/lib/db/schema/lanes";
import { stores } from "@/lib/db/schema/stores";
import { createLaneType, deleteLaneType } from "@/lib/services/lane-types";
import {
  createLane,
  deleteLane,
  getLaneById,
  LaneCodeConflictError,
  listLanes,
  updateLane,
} from "@/lib/services/lanes";

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
  storeAId: string;
  storeBId: string;
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
      { name: `__ln_company_${suffix}__`, code: `ln_${suffix}` },
      { name: `__ln_other_${suffix}__`, code: `ln_o_${suffix}` },
    ])
    .returning({ id: companies.id });

  const [storeA, storeB] = await outerTx
    .insert(stores)
    .values([
      { companyId: company.id, name: `店舗A-${suffix}`, code: `SA_${suffix}` },
      { companyId: company.id, name: `店舗B-${suffix}`, code: `SB_${suffix}` },
    ])
    .returning({ id: stores.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
    storeAId: storeA.id,
    storeBId: storeB.id,
  };
}

describeIntegration("lane services", () => {
  it("creates a lane with defaults and nullable code", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);

      const created = await createLane(
        { storeId: fixture.storeAId, name: `Lane-${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.companyId).toBe(fixture.companyId);
      expect(created.storeId).toBe(fixture.storeAId);
      expect(created.laneTypeId).toBeNull();
      expect(created.code).toBeNull();
      expect(created.capacity).toBe(1);
      expect(created.isActive).toBe(true);
    });
  });

  it("lists lanes with store + lane_type join and filters by storeId/laneTypeId/isActive/q", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const other = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const typeA = await createLaneType({ name: `TYPE-A-${suffix}`, code: `TA_${suffix}` }, { db: outerTx, companyId: fixture.companyId });
      const typeB = await createLaneType({ name: `TYPE-B-${suffix}`, code: `TB_${suffix}` }, { db: outerTx, companyId: fixture.companyId });

      await createLane({ storeId: fixture.storeAId, laneTypeId: typeA.id, name: `LANE-AA-${suffix}`, code: `AA_${suffix}`, isActive: true }, { db: outerTx, companyId: fixture.companyId });
      await createLane({ storeId: fixture.storeAId, laneTypeId: typeB.id, name: `LANE-AB-${suffix}`, code: `AB_${suffix}`, isActive: false }, { db: outerTx, companyId: fixture.companyId });
      await createLane({ storeId: fixture.storeBId, laneTypeId: typeA.id, name: `LANE-BA-${suffix}`, code: `BA_${suffix}`, isActive: true }, { db: outerTx, companyId: fixture.companyId });
      await createLane({ storeId: fixture.storeAId, name: `LANE-NONE-${suffix}`, code: `N_${suffix}`, isActive: true }, { db: outerTx, companyId: fixture.companyId });
      await createLane({ storeId: other.storeAId, name: `LANE-OTHER-${suffix}` }, { db: outerTx, companyId: other.companyId });

      const all = await listLanes({}, { db: outerTx, companyId: fixture.companyId });
      const allNames = all.rows.map((r) => r.name);
      expect(allNames).toContain(`LANE-AA-${suffix}`);
      expect(allNames).not.toContain(`LANE-OTHER-${suffix}`);
      const aa = all.rows.find((r) => r.name === `LANE-AA-${suffix}`);
      expect(aa?.laneTypeName).toBe(`TYPE-A-${suffix}`);
      expect(aa?.storeName).toContain("店舗A");

      const onlyStoreA = await listLanes({ storeId: fixture.storeAId }, { db: outerTx, companyId: fixture.companyId });
      const storeANames = onlyStoreA.rows.map((r) => r.name);
      expect(storeANames).toContain(`LANE-AA-${suffix}`);
      expect(storeANames).toContain(`LANE-AB-${suffix}`);
      expect(storeANames).not.toContain(`LANE-BA-${suffix}`);

      const onlyTypeA = await listLanes({ laneTypeId: typeA.id }, { db: outerTx, companyId: fixture.companyId });
      const typeANames = onlyTypeA.rows.map((r) => r.name);
      expect(typeANames).toContain(`LANE-AA-${suffix}`);
      expect(typeANames).toContain(`LANE-BA-${suffix}`);
      expect(typeANames).not.toContain(`LANE-AB-${suffix}`);

      const activeOnly = await listLanes({ isActive: true }, { db: outerTx, companyId: fixture.companyId });
      const activeNames = activeOnly.rows.map((r) => r.name);
      expect(activeNames).not.toContain(`LANE-AB-${suffix}`);

      const noneOnly = await listLanes({ laneTypeId: null }, { db: outerTx, companyId: fixture.companyId });
      expect(noneOnly.rows.find((r) => r.name === `LANE-NONE-${suffix}`)).toBeDefined();
      expect(noneOnly.rows.find((r) => r.name === `LANE-AA-${suffix}`)).toBeUndefined();
    });
  });

  it("updates a lane in company scope and supports lane_type reassignment", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const typeA = await createLaneType({ name: "整備", code: "GEN" }, { db: outerTx, companyId: fixture.companyId });
      const created = await createLane(
        { storeId: fixture.storeAId, name: "Lane#1", capacity: 1 },
        { db: outerTx, companyId: fixture.companyId },
      );

      const updated = await updateLane(
        created.id,
        { name: "Lane#1改", laneTypeId: typeA.id, capacity: 3, isActive: false },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(updated?.name).toBe("Lane#1改");
      expect(updated?.laneTypeId).toBe(typeA.id);
      expect(updated?.capacity).toBe(3);
      expect(updated?.isActive).toBe(false);
    });
  });

  it("soft-deletes a lane and rejects cross-tenant delete", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createLane(
        { storeId: fixture.storeAId, name: "削除対象", code: "DELME" },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(deleteLane(created.id, { db: outerTx, companyId: fixture.otherCompanyId })).resolves.toBe(false);
      await expect(deleteLane(created.id, { db: outerTx, companyId: fixture.companyId })).resolves.toBe(true);

      const rows = await outerTx
        .select({ value: count() })
        .from(lanes)
        .where(and(eq(lanes.id, created.id), isNull(lanes.deletedAt)));
      expect(Number(rows[0]?.value ?? 0)).toBe(0);

      const detail = await getLaneById(created.id, { db: outerTx, companyId: fixture.companyId });
      expect(detail).toBeNull();
    });
  });

  it("rejects duplicate lane code within the same store, but allows across stores", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const code = `DUP_${suffix}`;

      await createLane(
        { storeId: fixture.storeAId, name: `初回-${suffix}`, code },
        { db: outerTx, companyId: fixture.companyId },
      );

      // 同 store + 同 code は弾く (UNIQUE store_id, code)
      await expect(
        outerTx.transaction(async (savepoint: Tx) =>
          createLane(
            { storeId: fixture.storeAId, name: `重複-${suffix}`, code },
            { db: savepoint, companyId: fixture.companyId },
          ),
        ),
      ).rejects.toBeInstanceOf(LaneCodeConflictError);

      // 別 store なら同 code でも OK
      await expect(
        createLane(
          { storeId: fixture.storeBId, name: `別店舗-${suffix}`, code },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).resolves.toMatchObject({ code });
    });
  });

  it("sets laneTypeId to NULL when parent lane_type is hard-deleted (ON DELETE SET NULL)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const laneType = await createLaneType(
        { name: `親-${suffix}`, code: `P_${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );
      const lane = await createLane(
        { storeId: fixture.storeAId, name: `子-${suffix}`, laneTypeId: laneType.id },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(lane.laneTypeId).toBe(laneType.id);

      await expect(deleteLaneType(laneType.id, { db: outerTx, companyId: fixture.companyId })).resolves.toBe(true);

      const detail = await getLaneById(lane.id, { db: outerTx, companyId: fixture.companyId });
      expect(detail).not.toBeNull();
      expect(detail?.laneTypeId).toBeNull();
      expect(detail?.laneTypeName).toBeNull();
    });
  });

  it("validates capacity is a positive integer via DB CHECK", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);

      // capacity=0 は zod min(1) で reject されること
      await expect(
        createLane(
          { storeId: fixture.storeAId, name: "Bad", capacity: 0 },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toThrow();

      // capacity=5 は許容
      const ok = await createLane(
        { storeId: fixture.storeAId, name: "OK", capacity: 5 },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(ok.capacity).toBe(5);
    });
  });
});
