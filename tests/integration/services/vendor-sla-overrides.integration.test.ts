import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { stores } from "@/lib/db/schema/stores";
import { vendors } from "@/lib/db/schema/vendors";
import { vendorSlaOverrides } from "@/lib/db/schema/vendor_sla_overrides";
import {
  createVendorSlaOverride,
  deleteVendorSlaOverride,
  listVendorSlaOverridesByVendorId,
  StoreNotInCompanyError,
  updateVendorSlaOverride,
  VendorNotFoundError,
  VendorSlaOverrideConflictError,
  VendorSlaOverrideNotFoundError,
} from "@/lib/services/vendor-sla-overrides";
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
      { name: `__sla_company_${suffix}__`, code: `sla_${suffix}` },
      { name: `__sla_other_${suffix}__`, code: `sla_o_${suffix}` },
    ])
    .returning({ id: companies.id });
  const [storeA, storeB] = await outerTx
    .insert(stores)
    .values([
      { companyId: company.id, code: `sla_sA_${suffix}`, name: "店舗A" },
      { companyId: company.id, code: `sla_sB_${suffix}`, name: "店舗B" },
    ])
    .returning({ id: stores.id });
  const [otherStore] = await outerTx
    .insert(stores)
    .values({ companyId: otherCompany.id, code: `sla_so_${suffix}`, name: "他社店舗" })
    .returning({ id: stores.id });
  const vendor = await createVendor({ name: `業者 ${suffix}` }, { db: outerTx, companyId: company.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
    vendorId: vendor.id,
    storeAId: storeA.id,
    storeBId: storeB.id,
    otherStoreId: otherStore.id,
  };
}

describeIntegration("vendor-sla-overrides per-row CRUD", () => {
  it("creates an SLA override for a (vendor, store) pair", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createVendorSlaOverride(
        fixture.vendorId,
        { storeId: fixture.storeAId, responseDeadlineMinutes: 30, pickupDeadlineMinutes: 120 },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.vendorId).toBe(fixture.vendorId);
      expect(created.storeId).toBe(fixture.storeAId);
      expect(created.responseDeadlineMinutes).toBe(30);
      expect(created.pickupDeadlineMinutes).toBe(120);
    });
  });

  it("lists overrides ordered by store name with join", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await createVendorSlaOverride(
        fixture.vendorId,
        { storeId: fixture.storeAId, responseDeadlineMinutes: 30 },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createVendorSlaOverride(
        fixture.vendorId,
        { storeId: fixture.storeBId, pickupDeadlineMinutes: 60 },
        { db: outerTx, companyId: fixture.companyId },
      );

      const listed = await listVendorSlaOverridesByVendorId(fixture.vendorId, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(listed.length).toBe(2);
      const storeNames = listed.map((r) => r.storeName).filter((n): n is string => n !== null);
      expect(storeNames).toContain("店舗A");
      expect(storeNames).toContain("店舗B");
    });
  });

  it("rejects duplicate (vendor, store) with VendorSlaOverrideConflictError", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await createVendorSlaOverride(
        fixture.vendorId,
        { storeId: fixture.storeAId, responseDeadlineMinutes: 30 },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(
        createVendorSlaOverride(
          fixture.vendorId,
          { storeId: fixture.storeAId, responseDeadlineMinutes: 45 },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toBeInstanceOf(VendorSlaOverrideConflictError);
    });
  });

  it("rejects cross-tenant store with StoreNotInCompanyError", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await expect(
        createVendorSlaOverride(
          fixture.vendorId,
          { storeId: fixture.otherStoreId, responseDeadlineMinutes: 30 },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toBeInstanceOf(StoreNotInCompanyError);
    });
  });

  it("rejects when vendor belongs to another company (list / create)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await expect(
        listVendorSlaOverridesByVendorId(fixture.vendorId, {
          db: outerTx,
          companyId: fixture.otherCompanyId,
        }),
      ).rejects.toBeInstanceOf(VendorNotFoundError);

      await expect(
        createVendorSlaOverride(
          fixture.vendorId,
          { storeId: fixture.storeAId, responseDeadlineMinutes: 30 },
          { db: outerTx, companyId: fixture.otherCompanyId },
        ),
      ).rejects.toBeInstanceOf(VendorNotFoundError);
    });
  });

  it("updates deadlines independently", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createVendorSlaOverride(
        fixture.vendorId,
        { storeId: fixture.storeAId, responseDeadlineMinutes: 30, pickupDeadlineMinutes: 120 },
        { db: outerTx, companyId: fixture.companyId },
      );

      const updated = await updateVendorSlaOverride(
        created.id,
        { pickupDeadlineMinutes: 90 },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(updated.pickupDeadlineMinutes).toBe(90);
      // responseDeadline は未指定なので未変更
      expect(updated.responseDeadlineMinutes).toBe(30);
    });
  });

  it("update on missing id raises VendorSlaOverrideNotFoundError", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const stranger = crypto.randomUUID();
      await expect(
        updateVendorSlaOverride(
          stranger,
          { responseDeadlineMinutes: 30 },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toBeInstanceOf(VendorSlaOverrideNotFoundError);
    });
  });

  it("hard-deletes an override and rejects cross-tenant delete", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createVendorSlaOverride(
        fixture.vendorId,
        { storeId: fixture.storeAId, responseDeadlineMinutes: 30 },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(
        deleteVendorSlaOverride(created.id, { db: outerTx, companyId: fixture.otherCompanyId }),
      ).resolves.toBe(false);
      await expect(
        deleteVendorSlaOverride(created.id, { db: outerTx, companyId: fixture.companyId }),
      ).resolves.toBe(true);

      // hard delete (deletedAt なし schema): row が消える
      const remaining = await outerTx
        .select({ id: vendorSlaOverrides.id })
        .from(vendorSlaOverrides)
        .where(eq(vendorSlaOverrides.id, created.id));
      expect(remaining.length).toBe(0);
    });
  });

  it("CASCADE: vendor hard delete cascades to vendor_sla_overrides", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await createVendorSlaOverride(
        fixture.vendorId,
        { storeId: fixture.storeAId, responseDeadlineMinutes: 30 },
        { db: outerTx, companyId: fixture.companyId },
      );

      await outerTx.delete(vendors).where(eq(vendors.id, fixture.vendorId));

      const remaining = await outerTx
        .select({ id: vendorSlaOverrides.id })
        .from(vendorSlaOverrides)
        .where(eq(vendorSlaOverrides.vendorId, fixture.vendorId));
      expect(remaining.length).toBe(0);
    });
  });

  it("CASCADE: store hard delete cascades to vendor_sla_overrides", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await createVendorSlaOverride(
        fixture.vendorId,
        { storeId: fixture.storeAId, responseDeadlineMinutes: 30 },
        { db: outerTx, companyId: fixture.companyId },
      );

      await outerTx.delete(stores).where(eq(stores.id, fixture.storeAId));

      const listed = await listVendorSlaOverridesByVendorId(fixture.vendorId, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(listed.length).toBe(0);
    });
  });

  it("rejects negative deadline via Zod", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await expect(
        createVendorSlaOverride(
          fixture.vendorId,
          { storeId: fixture.storeAId, responseDeadlineMinutes: -1 },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toThrow();
    });
  });
});
