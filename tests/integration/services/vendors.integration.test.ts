import { config } from "dotenv";
import { and, count, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { vendors } from "@/lib/db/schema/vendors";
import {
  createVendor,
  deleteVendor,
  getVendorById,
  listVendors,
  updateVendor,
} from "@/lib/services/vendors";

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
      { name: `__vendor_company_${suffix}__`, code: `vendor_${suffix}` },
      { name: `__vendor_other_${suffix}__`, code: `vendor_o_${suffix}` },
    ])
    .returning({ id: companies.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
  };
}

describeIntegration("vendor services", () => {
  it("creates a vendor scoped to the admin company with defaults", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createVendor(
        {
          name: `業者A ${crypto.randomUUID().slice(0, 4)}`,
          email: "  vendor@example.com  ",
          phone: "03-1234-5678",
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.companyId).toBe(fixture.companyId);
      expect(created.notificationMethod).toBe("both");
      expect(created.isShared).toBe(false);
      expect(created.email).toBe("vendor@example.com");
    });
  });

  it("lists only vendors for the requested company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await createVendor({ name: "VENDOR-LIST-A" }, { db: outerTx, companyId: fixture.companyId });
      await createVendor({ name: "VENDOR-LIST-B" }, { db: outerTx, companyId: fixture.otherCompanyId });

      const result = await listVendors({}, { db: outerTx, companyId: fixture.companyId });

      expect(result.rows.map((row) => row.name)).toContain("VENDOR-LIST-A");
      expect(result.rows.map((row) => row.name)).not.toContain("VENDOR-LIST-B");
      expect(result.total).toBeGreaterThanOrEqual(1);
    });
  });

  it("updates a vendor in company scope including notificationMethod transitions", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createVendor(
        { name: "VENDOR-UPD", notificationMethod: "both" },
        { db: outerTx, companyId: fixture.companyId },
      );

      const updated = await updateVendor(
        created.id,
        { notificationMethod: "portal", isShared: true, priority: 5 },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(updated?.notificationMethod).toBe("portal");
      expect(updated?.isShared).toBe(true);
      expect(updated?.priority).toBe(5);

      const detail = await getVendorById(created.id, { db: outerTx, companyId: fixture.companyId });
      expect(detail?.notificationMethod).toBe("portal");
    });
  });

  it("rejects invalid notificationMethod via Zod enum", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await expect(
        createVendor(
          // @ts-expect-error invalid enum literal for negative test
          { name: "VENDOR-ENUM", notificationMethod: "fax" },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toThrow();
    });
  });

  it("soft-deletes a vendor and rejects cross-tenant delete", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createVendor({ name: "VENDOR-DEL" }, { db: outerTx, companyId: fixture.companyId });

      await expect(deleteVendor(created.id, { db: outerTx, companyId: fixture.otherCompanyId })).resolves.toBe(false);
      await expect(deleteVendor(created.id, { db: outerTx, companyId: fixture.companyId })).resolves.toBe(true);

      const rows = await outerTx
        .select({ value: count() })
        .from(vendors)
        .where(and(eq(vendors.id, created.id), isNull(vendors.deletedAt)));
      expect(Number(rows[0]?.value ?? 0)).toBe(0);

      const detail = await getVendorById(created.id, { db: outerTx, companyId: fixture.companyId });
      expect(detail).toBeNull();
    });
  });

  it("filters list by q across name / email / phone", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await createVendor({ name: "QSEARCH-ALPHA", email: "alpha@example.com" }, { db: outerTx, companyId: fixture.companyId });
      await createVendor({ name: "QSEARCH-BETA", phone: "090-1111-2222" }, { db: outerTx, companyId: fixture.companyId });

      const byName = await listVendors({ q: "ALPHA" }, { db: outerTx, companyId: fixture.companyId });
      expect(byName.rows.map((r) => r.name)).toContain("QSEARCH-ALPHA");
      expect(byName.rows.map((r) => r.name)).not.toContain("QSEARCH-BETA");

      const byPhone = await listVendors({ q: "090-1111" }, { db: outerTx, companyId: fixture.companyId });
      expect(byPhone.rows.map((r) => r.name)).toContain("QSEARCH-BETA");
    });
  });
});
