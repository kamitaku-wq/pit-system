import { config } from "dotenv";
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { storeBusinessHours } from "@/lib/db/schema/store_business_hours";
import { stores } from "@/lib/db/schema/stores";
import {
  DuplicateDayOfWeekError,
  StoreNotFoundError,
  listStoreBusinessHoursByStoreId,
  replaceStoreBusinessHours,
} from "@/lib/services/store-business-hours";
import { deleteStore } from "@/lib/services/stores";

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
      { name: `__sbh_company_${suffix}__`, code: `sbh_${suffix}` },
      { name: `__sbh_other_${suffix}__`, code: `sbh_o_${suffix}` },
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

describeIntegration("store_business_hours services", () => {
  it("replaceStoreBusinessHours: initial registration inserts all rows ordered by day", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      const result = await replaceStoreBusinessHours(
        fixture.storeId,
        {
          hours: [
            { dayOfWeek: 1, opensAt: "09:00", closesAt: "18:00" },
            { dayOfWeek: 5, opensAt: "10:00", closesAt: "17:30" },
          ],
        },
        ctx,
      );
      expect(result).toEqual({ removed: 0, inserted: 2 });

      const list = await listStoreBusinessHoursByStoreId(fixture.storeId, ctx);
      expect(list).toHaveLength(2);
      const [first, second] = list;
      expect(first?.dayOfWeek).toBe(1);
      expect(first?.opensAt).toBe("09:00:00");
      expect(first?.closesAt).toBe("18:00:00");
      expect(first?.acceptsReservations).toBe(true);
      expect(second?.dayOfWeek).toBe(5);
    });
  });

  it("replaceStoreBusinessHours: full replace removes existing rows then inserts new", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      await replaceStoreBusinessHours(
        fixture.storeId,
        {
          hours: [
            { dayOfWeek: 1, opensAt: "09:00", closesAt: "18:00" },
            { dayOfWeek: 2, opensAt: "09:00", closesAt: "18:00" },
          ],
        },
        ctx,
      );

      const result = await replaceStoreBusinessHours(
        fixture.storeId,
        {
          hours: [
            { dayOfWeek: 1, opensAt: "10:00", closesAt: "19:00" },
            { dayOfWeek: 6, opensAt: "10:00", closesAt: "15:00" },
          ],
        },
        ctx,
      );
      expect(result).toEqual({ removed: 2, inserted: 2 });

      const list = await listStoreBusinessHoursByStoreId(fixture.storeId, ctx);
      expect(list.map((r) => r.dayOfWeek)).toEqual([1, 6]);
      const [firstAfter] = list;
      expect(firstAfter?.opensAt).toBe("10:00:00");
      expect(firstAfter?.closesAt).toBe("19:00:00");
    });
  });

  it("replaceStoreBusinessHours: empty array clears all rows for the store", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      await replaceStoreBusinessHours(
        fixture.storeId,
        { hours: [{ dayOfWeek: 0, opensAt: "09:00", closesAt: "12:00" }] },
        ctx,
      );

      const result = await replaceStoreBusinessHours(fixture.storeId, { hours: [] }, ctx);
      expect(result).toEqual({ removed: 1, inserted: 0 });

      const list = await listStoreBusinessHoursByStoreId(fixture.storeId, ctx);
      expect(list).toHaveLength(0);
    });
  });

  it("replaceStoreBusinessHours: rejects duplicate day_of_week input", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      await expect(
        replaceStoreBusinessHours(
          fixture.storeId,
          {
            hours: [
              { dayOfWeek: 1, opensAt: "09:00", closesAt: "12:00" },
              { dayOfWeek: 1, opensAt: "13:00", closesAt: "18:00" },
            ],
          },
          ctx,
        ),
      ).rejects.toBeInstanceOf(DuplicateDayOfWeekError);
    });
  });

  it("replaceStoreBusinessHours: rejects opens_at >= closes_at via zod refine", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      await expect(
        replaceStoreBusinessHours(
          fixture.storeId,
          { hours: [{ dayOfWeek: 1, opensAt: "18:00", closesAt: "09:00" }] },
          ctx,
        ),
      ).rejects.toThrow();
    });
  });

  it("replaceStoreBusinessHours: rejects cross-company store (tenant isolation)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const otherCtx = { db: outerTx, companyId: fixture.otherCompanyId };

      await expect(
        replaceStoreBusinessHours(
          fixture.storeId,
          { hours: [{ dayOfWeek: 1, opensAt: "09:00", closesAt: "18:00" }] },
          otherCtx,
        ),
      ).rejects.toBeInstanceOf(StoreNotFoundError);
    });
  });

  it("store CASCADE: raw DELETE FROM stores removes store_business_hours rows", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      await replaceStoreBusinessHours(
        fixture.storeId,
        {
          hours: [
            { dayOfWeek: 1, opensAt: "09:00", closesAt: "18:00" },
            { dayOfWeek: 2, opensAt: "09:00", closesAt: "18:00" },
          ],
        },
        ctx,
      );

      await outerTx.execute(sql`DELETE FROM stores WHERE id = ${fixture.storeId}`);

      const [{ value }] = await outerTx
        .select({ value: count() })
        .from(storeBusinessHours)
        .where(eq(storeBusinessHours.storeId, fixture.storeId));
      expect(value).toBe(0);
    });
  });

  it("store soft delete: deleteStore (deletedAt set) does NOT remove store_business_hours rows", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      await replaceStoreBusinessHours(
        fixture.storeId,
        { hours: [{ dayOfWeek: 1, opensAt: "09:00", closesAt: "18:00" }] },
        ctx,
      );

      await deleteStore(fixture.storeId, ctx);

      const [{ value }] = await outerTx
        .select({ value: count() })
        .from(storeBusinessHours)
        .where(eq(storeBusinessHours.storeId, fixture.storeId));
      expect(value).toBe(1);
    });
  });

  it("listStoreBusinessHoursByStoreId: scoped to companyId, returns ordered rows", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ownCtx = { db: outerTx, companyId: fixture.companyId };
      const otherCtx = { db: outerTx, companyId: fixture.otherCompanyId };

      await replaceStoreBusinessHours(
        fixture.storeId,
        {
          hours: [
            { dayOfWeek: 6, opensAt: "09:00", closesAt: "12:00" },
            { dayOfWeek: 0, opensAt: "10:00", closesAt: "16:00" },
            { dayOfWeek: 3, opensAt: "09:00", closesAt: "18:00" },
          ],
        },
        ownCtx,
      );

      const ownList = await listStoreBusinessHoursByStoreId(fixture.storeId, ownCtx);
      expect(ownList.map((r) => r.dayOfWeek)).toEqual([0, 3, 6]);

      const crossList = await listStoreBusinessHoursByStoreId(fixture.storeId, otherCtx);
      expect(crossList).toHaveLength(0);
    });
  });

  it("acceptsReservations: defaults to true when omitted, persists false when explicit", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      await replaceStoreBusinessHours(
        fixture.storeId,
        {
          hours: [
            { dayOfWeek: 1, opensAt: "09:00", closesAt: "18:00" },
            { dayOfWeek: 2, opensAt: "09:00", closesAt: "18:00", acceptsReservations: false },
            { dayOfWeek: 3, opensAt: "09:00", closesAt: "18:00", acceptsReservations: true },
          ],
        },
        ctx,
      );

      const list = await listStoreBusinessHoursByStoreId(fixture.storeId, ctx);
      const byDay = new Map(list.map((r) => [r.dayOfWeek, r] as const));
      expect(byDay.get(1)?.acceptsReservations).toBe(true);
      expect(byDay.get(2)?.acceptsReservations).toBe(false);
      expect(byDay.get(3)?.acceptsReservations).toBe(true);
    });
  });
});
