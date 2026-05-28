import { config } from "dotenv";
import { and, count, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { stores } from "@/lib/db/schema/stores";
import {
  createStore,
  deleteStore,
  getStoreById,
  listStores,
  StoreCodeConflictError,
  updateStore,
} from "@/lib/services/stores";

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
      { name: `__store_company_${suffix}__`, code: `store_${suffix}` },
      { name: `__store_other_${suffix}__`, code: `store_o_${suffix}` },
    ])
    .returning({ id: companies.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
  };
}

describeIntegration("store services", () => {
  it("creates a store scoped to the admin company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const created = await createStore(
        {
          name: `渋谷店 ${suffix}`,
          code: `SHIBUYA_${suffix}`,
          postalCode: "150-0001",
          address: "東京都渋谷区神南1-1",
          phone: "03-1234-5678",
          isActive: true,
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.companyId).toBe(fixture.companyId);
      expect(created.name).toBe(`渋谷店 ${suffix}`);
      expect(created.code).toBe(`SHIBUYA_${suffix}`);
      expect(created.isActive).toBe(true);
    });
  });

  it("lists only stores for the requested company with q + isActive filter", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const other = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      await createStore({ name: `STORE-A-${suffix}`, isActive: true }, { db: outerTx, companyId: fixture.companyId });
      await createStore({ name: `STORE-B-${suffix}`, isActive: false }, { db: outerTx, companyId: fixture.companyId });
      await createStore({ name: `STORE-OTHER-${suffix}` }, { db: outerTx, companyId: other.companyId });

      const all = await listStores({}, { db: outerTx, companyId: fixture.companyId });
      expect(all.rows.map((r) => r.name)).toContain(`STORE-A-${suffix}`);
      expect(all.rows.map((r) => r.name)).toContain(`STORE-B-${suffix}`);
      expect(all.rows.map((r) => r.name)).not.toContain(`STORE-OTHER-${suffix}`);

      const activeOnly = await listStores({ isActive: true }, { db: outerTx, companyId: fixture.companyId });
      expect(activeOnly.rows.find((r) => r.name === `STORE-A-${suffix}`)).toBeDefined();
      expect(activeOnly.rows.find((r) => r.name === `STORE-B-${suffix}`)).toBeUndefined();

      const inactiveOnly = await listStores({ isActive: false }, { db: outerTx, companyId: fixture.companyId });
      expect(inactiveOnly.rows.find((r) => r.name === `STORE-B-${suffix}`)).toBeDefined();
    });
  });

  it("updates a store in company scope", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createStore(
        { name: "原宿店", code: "ORIG_CODE", isActive: true },
        { db: outerTx, companyId: fixture.companyId },
      );

      const updated = await updateStore(
        created.id,
        { name: "原宿店改", phone: "03-9999-0000", isActive: false },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(updated?.name).toBe("原宿店改");
      expect(updated?.phone).toBe("03-9999-0000");
      expect(updated?.isActive).toBe(false);
      expect(updated?.code).toBe("ORIG_CODE");
    });
  });

  it("soft-deletes a store and rejects cross-tenant delete", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createStore(
        { name: "削除対象店" },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(deleteStore(created.id, { db: outerTx, companyId: fixture.otherCompanyId })).resolves.toBe(false);
      await expect(deleteStore(created.id, { db: outerTx, companyId: fixture.companyId })).resolves.toBe(true);

      const rows = await outerTx
        .select({ value: count() })
        .from(stores)
        .where(and(eq(stores.id, created.id), isNull(stores.deletedAt)));
      expect(Number(rows[0]?.value ?? 0)).toBe(0);

      const detail = await getStoreById(created.id, { db: outerTx, companyId: fixture.companyId });
      expect(detail).toBeNull();
    });
  });

  it("filters stores by q (name / code / address / phone partial match)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      await createStore(
        { name: `名前検索-${suffix}`, code: `CODE_${suffix}`, address: `東京都新宿区${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createStore(
        { name: `別店舗`, phone: `03-7777-${suffix.slice(0, 4)}` },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createStore({ name: `関係なし-${suffix}` }, { db: outerTx, companyId: fixture.companyId });

      const byName = await listStores({ q: `名前検索-${suffix}` }, { db: outerTx, companyId: fixture.companyId });
      expect(byName.rows.map((r) => r.name)).toEqual([`名前検索-${suffix}`]);

      const byCode = await listStores({ q: `CODE_${suffix}` }, { db: outerTx, companyId: fixture.companyId });
      expect(byCode.rows.find((r) => r.name === `名前検索-${suffix}`)).toBeDefined();

      const byAddress = await listStores({ q: `新宿区${suffix}` }, { db: outerTx, companyId: fixture.companyId });
      expect(byAddress.rows.find((r) => r.name === `名前検索-${suffix}`)).toBeDefined();

      const byPhone = await listStores({ q: `03-7777-${suffix.slice(0, 4)}` }, { db: outerTx, companyId: fixture.companyId });
      expect(byPhone.rows.find((r) => r.name === `別店舗`)).toBeDefined();
    });
  });

  it("rejects duplicate store code within the same company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const code = `DUP_${suffix}`;

      await createStore(
        { name: `初回店舗-${suffix}`, code },
        { db: outerTx, companyId: fixture.companyId },
      );

      // UNIQUE 違反は transaction を abort するため savepoint で隔離
      await expect(
        outerTx.transaction(async (savepoint: Tx) =>
          createStore(
            { name: `重複店舗-${suffix}`, code },
            { db: savepoint, companyId: fixture.companyId },
          ),
        ),
      ).rejects.toBeInstanceOf(StoreCodeConflictError);

      // 別 company であれば同じ code でも許容される
      await expect(
        createStore(
          { name: `別社店舗-${suffix}`, code },
          { db: outerTx, companyId: fixture.otherCompanyId },
        ),
      ).resolves.toMatchObject({ code });
    });
  });
});
