import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { stores } from "@/lib/db/schema/stores";
import { vendorAvailableStores } from "@/lib/db/schema/vendor_available_stores";
import { vendors } from "@/lib/db/schema/vendors";
import {
  listStoreIdsByVendorId,
  replaceVendorAvailableStores,
  StoreNotInCompanyError,
  VendorNotFoundError,
} from "@/lib/services/vendor-available-stores";
import { createVendor } from "@/lib/services/vendors";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

type Fixture = {
  companyId: string;
  otherCompanyId: string;
  vendorId: string;
  storeAId: string;
  storeBId: string;
  storeCId: string;
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
      { name: `__vas_company_${suffix}__`, code: `vas_${suffix}` },
      { name: `__vas_other_${suffix}__`, code: `vas_o_${suffix}` },
    ])
    .returning({ id: companies.id });
  const [storeA, storeB, storeC] = await outerTx
    .insert(stores)
    .values([
      { companyId: company.id, code: `vas_sA_${suffix}`, name: "店舗A" },
      { companyId: company.id, code: `vas_sB_${suffix}`, name: "店舗B" },
      { companyId: company.id, code: `vas_sC_${suffix}`, name: "店舗C" },
    ])
    .returning({ id: stores.id });
  const [otherStore] = await outerTx
    .insert(stores)
    .values({ companyId: otherCompany.id, code: `vas_so_${suffix}`, name: "他社店舗" })
    .returning({ id: stores.id });
  const vendor = await createVendor({ name: `業者 ${suffix}` }, { db: outerTx, companyId: company.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
    vendorId: vendor.id,
    storeAId: storeA.id,
    storeBId: storeB.id,
    storeCId: storeC.id,
    otherStoreId: otherStore.id,
  };
}

describeIntegration("vendor-available-stores M:N replace", () => {
  it("replaces from empty to a full set of stores", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);

      const result = await replaceVendorAvailableStores(
        fixture.vendorId,
        { storeIds: [fixture.storeAId, fixture.storeBId, fixture.storeCId] },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(result).toEqual({ added: 3, removed: 0, kept: 0 });

      const listed = await listStoreIdsByVendorId(fixture.vendorId, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(listed.sort()).toEqual([fixture.storeAId, fixture.storeBId, fixture.storeCId].sort());
    });
  });

  it("computes diff (added / removed / kept) on subsequent replace", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await replaceVendorAvailableStores(
        fixture.vendorId,
        { storeIds: [fixture.storeAId, fixture.storeBId] },
        { db: outerTx, companyId: fixture.companyId },
      );

      const result = await replaceVendorAvailableStores(
        fixture.vendorId,
        { storeIds: [fixture.storeBId, fixture.storeCId] },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(result).toEqual({ added: 1, removed: 1, kept: 1 });

      const listed = await listStoreIdsByVendorId(fixture.vendorId, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(listed.sort()).toEqual([fixture.storeBId, fixture.storeCId].sort());
    });
  });

  it("replace with empty array removes all (clear schedule)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await replaceVendorAvailableStores(
        fixture.vendorId,
        { storeIds: [fixture.storeAId, fixture.storeBId] },
        { db: outerTx, companyId: fixture.companyId },
      );

      const result = await replaceVendorAvailableStores(
        fixture.vendorId,
        { storeIds: [] },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(result).toEqual({ added: 0, removed: 2, kept: 0 });
      const listed = await listStoreIdsByVendorId(fixture.vendorId, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(listed.length).toBe(0);
    });
  });

  it("deduplicates request storeIds (Set semantics)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const result = await replaceVendorAvailableStores(
        fixture.vendorId,
        { storeIds: [fixture.storeAId, fixture.storeAId, fixture.storeAId] },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(result).toEqual({ added: 1, removed: 0, kept: 0 });
    });
  });

  it("rejects store ids that belong to another company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await expect(
        replaceVendorAvailableStores(
          fixture.vendorId,
          { storeIds: [fixture.storeAId, fixture.otherStoreId] },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toBeInstanceOf(StoreNotInCompanyError);
    });
  });

  it("rejects when vendor belongs to another company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await expect(
        replaceVendorAvailableStores(
          fixture.vendorId,
          { storeIds: [fixture.storeAId] },
          { db: outerTx, companyId: fixture.otherCompanyId },
        ),
      ).rejects.toBeInstanceOf(VendorNotFoundError);
    });
  });

  it("CASCADE: vendor hard delete cascades to vendor_available_stores", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await replaceVendorAvailableStores(
        fixture.vendorId,
        { storeIds: [fixture.storeAId, fixture.storeBId] },
        { db: outerTx, companyId: fixture.companyId },
      );

      await outerTx.delete(vendors).where(eq(vendors.id, fixture.vendorId));

      const remaining = await outerTx
        .select({ id: vendorAvailableStores.id })
        .from(vendorAvailableStores)
        .where(eq(vendorAvailableStores.vendorId, fixture.vendorId));
      expect(remaining.length).toBe(0);
    });
  });

  it("CASCADE: store hard delete cascades to vendor_available_stores", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await replaceVendorAvailableStores(
        fixture.vendorId,
        { storeIds: [fixture.storeAId, fixture.storeBId] },
        { db: outerTx, companyId: fixture.companyId },
      );

      await outerTx.delete(stores).where(eq(stores.id, fixture.storeAId));

      const remaining = await listStoreIdsByVendorId(fixture.vendorId, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(remaining).not.toContain(fixture.storeAId);
      expect(remaining).toContain(fixture.storeBId);
    });
  });
});
