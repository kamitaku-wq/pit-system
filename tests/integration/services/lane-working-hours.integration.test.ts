import { config } from "dotenv";
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { laneWorkingHours } from "@/lib/db/schema/lane_working_hours";
import { stores } from "@/lib/db/schema/stores";
import {
  DuplicateDayOfWeekError,
  LaneNotFoundError,
  listLaneWorkingHoursByLaneId,
  replaceLaneWorkingHours,
} from "@/lib/services/lane-working-hours";
import { createLane, deleteLane } from "@/lib/services/lanes";

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
  storeId: string;
  otherStoreId: string;
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
      { name: `__lwh_company_${suffix}__`, code: `lwh_${suffix}` },
      { name: `__lwh_other_${suffix}__`, code: `lwh_o_${suffix}` },
    ])
    .returning({ id: companies.id });

  const [store, otherStore] = await outerTx
    .insert(stores)
    .values([
      { companyId: company.id, name: `店舗-${suffix}`, code: `S_${suffix}` },
      { companyId: otherCompany.id, name: `他社店舗-${suffix}`, code: `OS_${suffix}` },
    ])
    .returning({ id: stores.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
    storeId: store.id,
    otherStoreId: otherStore.id,
  };
}

describeIntegration("lane_working_hours services", () => {
  it("replaceLaneWorkingHours: initial registration inserts all rows ordered by day", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ctx,
      );

      const result = await replaceLaneWorkingHours(
        lane.id,
        {
          hours: [
            { dayOfWeek: 1, startsAt: "09:00", endsAt: "18:00" },
            { dayOfWeek: 5, startsAt: "10:00", endsAt: "17:30" },
          ],
        },
        ctx,
      );
      expect(result).toEqual({ removed: 0, inserted: 2 });

      const list = await listLaneWorkingHoursByLaneId(lane.id, ctx);
      expect(list).toHaveLength(2);
      const [first, second] = list;
      expect(first?.dayOfWeek).toBe(1);
      expect(first?.startsAt).toBe("09:00:00");
      expect(first?.endsAt).toBe("18:00:00");
      expect(second?.dayOfWeek).toBe(5);
    });
  });

  it("replaceLaneWorkingHours: full replace removes existing rows then inserts new", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ctx,
      );

      await replaceLaneWorkingHours(
        lane.id,
        {
          hours: [
            { dayOfWeek: 1, startsAt: "09:00", endsAt: "18:00" },
            { dayOfWeek: 2, startsAt: "09:00", endsAt: "18:00" },
          ],
        },
        ctx,
      );

      const result = await replaceLaneWorkingHours(
        lane.id,
        {
          hours: [
            { dayOfWeek: 1, startsAt: "10:00", endsAt: "19:00" },
            { dayOfWeek: 6, startsAt: "10:00", endsAt: "15:00" },
          ],
        },
        ctx,
      );
      expect(result).toEqual({ removed: 2, inserted: 2 });

      const list = await listLaneWorkingHoursByLaneId(lane.id, ctx);
      expect(list.map((r) => r.dayOfWeek)).toEqual([1, 6]);
      const [firstAfter] = list;
      expect(firstAfter?.startsAt).toBe("10:00:00");
      expect(firstAfter?.endsAt).toBe("19:00:00");
    });
  });

  it("replaceLaneWorkingHours: empty array clears all rows for the lane", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ctx,
      );

      await replaceLaneWorkingHours(
        lane.id,
        { hours: [{ dayOfWeek: 0, startsAt: "09:00", endsAt: "12:00" }] },
        ctx,
      );

      const result = await replaceLaneWorkingHours(lane.id, { hours: [] }, ctx);
      expect(result).toEqual({ removed: 1, inserted: 0 });

      const list = await listLaneWorkingHoursByLaneId(lane.id, ctx);
      expect(list).toHaveLength(0);
    });
  });

  it("replaceLaneWorkingHours: rejects duplicate day_of_week input", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ctx,
      );

      await expect(
        replaceLaneWorkingHours(
          lane.id,
          {
            hours: [
              { dayOfWeek: 1, startsAt: "09:00", endsAt: "12:00" },
              { dayOfWeek: 1, startsAt: "13:00", endsAt: "18:00" },
            ],
          },
          ctx,
        ),
      ).rejects.toBeInstanceOf(DuplicateDayOfWeekError);
    });
  });

  it("replaceLaneWorkingHours: rejects starts_at >= ends_at via zod refine", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ctx,
      );

      await expect(
        replaceLaneWorkingHours(
          lane.id,
          { hours: [{ dayOfWeek: 1, startsAt: "18:00", endsAt: "09:00" }] },
          ctx,
        ),
      ).rejects.toThrow();
    });
  });

  it("replaceLaneWorkingHours: rejects cross-company lane (tenant isolation)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ownCtx = { db: outerTx, companyId: fixture.companyId };
      const otherCtx = { db: outerTx, companyId: fixture.otherCompanyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ownCtx,
      );

      await expect(
        replaceLaneWorkingHours(
          lane.id,
          { hours: [{ dayOfWeek: 1, startsAt: "09:00", endsAt: "18:00" }] },
          otherCtx,
        ),
      ).rejects.toBeInstanceOf(LaneNotFoundError);
    });
  });

  it("lane CASCADE: raw DELETE FROM lanes removes lane_working_hours rows", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ctx,
      );
      await replaceLaneWorkingHours(
        lane.id,
        {
          hours: [
            { dayOfWeek: 1, startsAt: "09:00", endsAt: "18:00" },
            { dayOfWeek: 2, startsAt: "09:00", endsAt: "18:00" },
          ],
        },
        ctx,
      );

      await outerTx.execute(sql`DELETE FROM lanes WHERE id = ${lane.id}`);

      const [{ value }] = await outerTx
        .select({ value: count() })
        .from(laneWorkingHours)
        .where(eq(laneWorkingHours.laneId, lane.id));
      expect(value).toBe(0);
    });
  });

  it("lane soft delete: deleteLane (deletedAt set) does NOT remove lane_working_hours rows", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ctx,
      );
      await replaceLaneWorkingHours(
        lane.id,
        { hours: [{ dayOfWeek: 1, startsAt: "09:00", endsAt: "18:00" }] },
        ctx,
      );

      await deleteLane(lane.id, ctx);

      const [{ value }] = await outerTx
        .select({ value: count() })
        .from(laneWorkingHours)
        .where(eq(laneWorkingHours.laneId, lane.id));
      expect(value).toBe(1);
    });
  });

  it("listLaneWorkingHoursByLaneId: scoped to companyId, returns ordered rows", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ownCtx = { db: outerTx, companyId: fixture.companyId };
      const otherCtx = { db: outerTx, companyId: fixture.otherCompanyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ownCtx,
      );
      await replaceLaneWorkingHours(
        lane.id,
        {
          hours: [
            { dayOfWeek: 6, startsAt: "09:00", endsAt: "12:00" },
            { dayOfWeek: 0, startsAt: "10:00", endsAt: "16:00" },
            { dayOfWeek: 3, startsAt: "09:00", endsAt: "18:00" },
          ],
        },
        ownCtx,
      );

      const ownList = await listLaneWorkingHoursByLaneId(lane.id, ownCtx);
      expect(ownList.map((r) => r.dayOfWeek)).toEqual([0, 3, 6]);

      const crossList = await listLaneWorkingHoursByLaneId(lane.id, otherCtx);
      expect(crossList).toHaveLength(0);
    });
  });
});
