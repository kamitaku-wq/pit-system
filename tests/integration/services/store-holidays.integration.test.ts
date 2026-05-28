import { config } from "dotenv";
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { storeHolidays } from "@/lib/db/schema/store_holidays";
import { stores } from "@/lib/db/schema/stores";
import {
  StoreHolidayConflictError,
  StoreHolidayNotFoundError,
  StoreNotFoundError,
  createStoreHoliday,
  deleteStoreHoliday,
  listStoreHolidaysByStoreId,
  updateStoreHoliday,
} from "@/lib/services/store-holidays";
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
      { name: `__sh_company_${suffix}__`, code: `sh_${suffix}` },
      { name: `__sh_other_${suffix}__`, code: `sh_o_${suffix}` },
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

describeIntegration("store_holidays services", () => {
  it("createStoreHoliday: inserts with default isClosed=true when omitted", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      const created = await createStoreHoliday(
        { storeId: fixture.storeId, holidayDate: "2026-01-01", name: "元日" },
        ctx,
      );
      expect(created.holidayDate).toBe("2026-01-01");
      expect(created.name).toBe("元日");
      expect(created.isClosed).toBe(true);
      expect(created.storeId).toBe(fixture.storeId);
    });
  });

  it("createStoreHoliday: persists isClosed=false (special opening day)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      const created = await createStoreHoliday(
        {
          storeId: fixture.storeId,
          holidayDate: "2026-05-05",
          name: "こどもの日 特別営業",
          isClosed: false,
        },
        ctx,
      );
      expect(created.isClosed).toBe(false);
    });
  });

  it("createStoreHoliday: UNIQUE conflict on (store_id, holiday_date) throws StoreHolidayConflictError", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      await createStoreHoliday(
        { storeId: fixture.storeId, holidayDate: "2026-01-01" },
        ctx,
      );

      await expect(
        createStoreHoliday(
          { storeId: fixture.storeId, holidayDate: "2026-01-01", name: "重複" },
          ctx,
        ),
      ).rejects.toBeInstanceOf(StoreHolidayConflictError);
    });
  });

  it("createStoreHoliday: rejects cross-company store (tenant isolation)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const otherCtx = { db: outerTx, companyId: fixture.otherCompanyId };

      await expect(
        createStoreHoliday(
          { storeId: fixture.storeId, holidayDate: "2026-01-01" },
          otherCtx,
        ),
      ).rejects.toBeInstanceOf(StoreNotFoundError);
    });
  });

  it("updateStoreHoliday: updates name and isClosed; rejects unknown id with NotFound", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      const created = await createStoreHoliday(
        { storeId: fixture.storeId, holidayDate: "2026-01-02", name: "旧名" },
        ctx,
      );

      const updated = await updateStoreHoliday(
        created.id,
        { name: "新名", isClosed: false },
        ctx,
      );
      expect(updated.name).toBe("新名");
      expect(updated.isClosed).toBe(false);
      expect(updated.holidayDate).toBe("2026-01-02");

      const fakeId = crypto.randomUUID();
      await expect(
        updateStoreHoliday(fakeId, { name: "x" }, ctx),
      ).rejects.toBeInstanceOf(StoreHolidayNotFoundError);
    });
  });

  it("updateStoreHoliday: UNIQUE conflict on date change throws StoreHolidayConflictError", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      await createStoreHoliday(
        { storeId: fixture.storeId, holidayDate: "2026-01-01" },
        ctx,
      );
      const second = await createStoreHoliday(
        { storeId: fixture.storeId, holidayDate: "2026-01-02" },
        ctx,
      );

      await expect(
        updateStoreHoliday(second.id, { holidayDate: "2026-01-01" }, ctx),
      ).rejects.toBeInstanceOf(StoreHolidayConflictError);
    });
  });

  it("deleteStoreHoliday: hard delete removes the row, list reflects", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      const created = await createStoreHoliday(
        { storeId: fixture.storeId, holidayDate: "2026-01-03" },
        ctx,
      );

      const removed = await deleteStoreHoliday(created.id, ctx);
      expect(removed).toBe(true);

      const list = await listStoreHolidaysByStoreId(fixture.storeId, {}, ctx);
      expect(list).toHaveLength(0);

      // tenant: 他テナントから削除しても false
      const otherCtx = { db: outerTx, companyId: fixture.otherCompanyId };
      const fakeRemove = await deleteStoreHoliday(created.id, otherCtx);
      expect(fakeRemove).toBe(false);
    });
  });

  it("listStoreHolidaysByStoreId: ordered by date asc, filtered by date range", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      await createStoreHoliday({ storeId: fixture.storeId, holidayDate: "2026-03-03" }, ctx);
      await createStoreHoliday({ storeId: fixture.storeId, holidayDate: "2026-01-01" }, ctx);
      await createStoreHoliday({ storeId: fixture.storeId, holidayDate: "2026-02-11" }, ctx);

      const all = await listStoreHolidaysByStoreId(fixture.storeId, {}, ctx);
      expect(all.map((r) => r.holidayDate)).toEqual([
        "2026-01-01",
        "2026-02-11",
        "2026-03-03",
      ]);

      const ranged = await listStoreHolidaysByStoreId(
        fixture.storeId,
        { fromDate: "2026-02-01", toDate: "2026-02-28" },
        ctx,
      );
      expect(ranged).toHaveLength(1);
      expect(ranged[0]?.holidayDate).toBe("2026-02-11");

      // cross-company shouldn't leak
      const otherCtx = { db: outerTx, companyId: fixture.otherCompanyId };
      const crossList = await listStoreHolidaysByStoreId(fixture.storeId, {}, otherCtx);
      expect(crossList).toHaveLength(0);
    });
  });

  it("store CASCADE: raw DELETE FROM stores removes store_holidays rows", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      await createStoreHoliday({ storeId: fixture.storeId, holidayDate: "2026-01-01" }, ctx);
      await createStoreHoliday({ storeId: fixture.storeId, holidayDate: "2026-01-02" }, ctx);

      await outerTx.execute(sql`DELETE FROM stores WHERE id = ${fixture.storeId}`);

      const [{ value }] = await outerTx
        .select({ value: count() })
        .from(storeHolidays)
        .where(eq(storeHolidays.storeId, fixture.storeId));
      expect(value).toBe(0);
    });
  });

  it("store soft delete: deleteStore (deletedAt set) does NOT remove store_holidays rows", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };

      await createStoreHoliday({ storeId: fixture.storeId, holidayDate: "2026-01-01" }, ctx);

      await deleteStore(fixture.storeId, ctx);

      const [{ value }] = await outerTx
        .select({ value: count() })
        .from(storeHolidays)
        .where(eq(storeHolidays.storeId, fixture.storeId));
      expect(value).toBe(1);
    });
  });
});
