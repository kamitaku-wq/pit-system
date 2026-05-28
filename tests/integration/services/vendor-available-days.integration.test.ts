import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { vendorAvailableDays } from "@/lib/db/schema/vendor_available_days";
import { vendors } from "@/lib/db/schema/vendors";
import {
  listVendorAvailableDaysByVendorId,
  replaceVendorAvailableDays,
  VendorAvailableDayConstraintError,
  VendorNotFoundError,
} from "@/lib/services/vendor-available-days";
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
      { name: `__vad_company_${suffix}__`, code: `vad_${suffix}` },
      { name: `__vad_other_${suffix}__`, code: `vad_o_${suffix}` },
    ])
    .returning({ id: companies.id });
  const vendor = await createVendor({ name: `業者 ${suffix}` }, { db: outerTx, companyId: company.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
    vendorId: vendor.id,
  };
}

describeIntegration("vendor-available-days full-replace", () => {
  it("replaces from empty to a full 7-day schedule", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const rows = Array.from({ length: 7 }, (_, day) => ({
        dayOfWeek: day,
        startsAt: "09:00",
        endsAt: "18:00",
      }));

      const result = await replaceVendorAvailableDays(
        fixture.vendorId,
        { rows },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(result.removed).toBe(0);
      expect(result.inserted).toBe(7);

      const listed = await listVendorAvailableDaysByVendorId(fixture.vendorId, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(listed.length).toBe(7);
      const first = listed[0]!;
      expect(first.dayOfWeek).toBe(0);
      expect(first.startsAt).toBe("09:00:00");
      expect(first.endsAt).toBe("18:00:00");
    });
  });

  it("removes old rows and inserts new on subsequent replace", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await replaceVendorAvailableDays(
        fixture.vendorId,
        { rows: [{ dayOfWeek: 1, startsAt: "09:00", endsAt: "18:00" }] },
        { db: outerTx, companyId: fixture.companyId },
      );

      const result = await replaceVendorAvailableDays(
        fixture.vendorId,
        {
          rows: [
            { dayOfWeek: 2, startsAt: "10:00", endsAt: "19:00" },
            { dayOfWeek: 3, startsAt: "10:00", endsAt: "19:00" },
          ],
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(result.removed).toBe(1);
      expect(result.inserted).toBe(2);
      const listed = await listVendorAvailableDaysByVendorId(fixture.vendorId, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(listed.map((r) => r.dayOfWeek)).toEqual([2, 3]);
    });
  });

  it("accepts multiple time ranges in the same day (split shifts)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await replaceVendorAvailableDays(
        fixture.vendorId,
        {
          rows: [
            { dayOfWeek: 1, startsAt: "09:00", endsAt: "12:00" },
            { dayOfWeek: 1, startsAt: "13:00", endsAt: "18:00" },
          ],
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      const listed = await listVendorAvailableDaysByVendorId(fixture.vendorId, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(listed.length).toBe(2);
      expect(listed.every((r) => r.dayOfWeek === 1)).toBe(true);
      expect(listed[0]!.startsAt).toBe("09:00:00");
      expect(listed[1]!.startsAt).toBe("13:00:00");
    });
  });

  it("rejects starts_at >= ends_at via service-side CHECK defense", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await expect(
        replaceVendorAvailableDays(
          fixture.vendorId,
          { rows: [{ dayOfWeek: 1, startsAt: "18:00", endsAt: "09:00" }] },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toBeInstanceOf(VendorAvailableDayConstraintError);
    });
  });

  it("rejects dayOfWeek out of 0-6 via Zod schema", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await expect(
        replaceVendorAvailableDays(
          fixture.vendorId,
          { rows: [{ dayOfWeek: 7, startsAt: "09:00", endsAt: "18:00" }] },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toThrow();
    });
  });

  it("rejects cross-tenant replace with VendorNotFoundError", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await expect(
        replaceVendorAvailableDays(
          fixture.vendorId,
          { rows: [{ dayOfWeek: 1, startsAt: "09:00", endsAt: "18:00" }] },
          { db: outerTx, companyId: fixture.otherCompanyId },
        ),
      ).rejects.toBeInstanceOf(VendorNotFoundError);
    });
  });

  it("CASCADE: vendor hard delete cascades to vendor_available_days", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await replaceVendorAvailableDays(
        fixture.vendorId,
        { rows: [{ dayOfWeek: 1, startsAt: "09:00", endsAt: "18:00" }] },
        { db: outerTx, companyId: fixture.companyId },
      );

      await outerTx.delete(vendors).where(eq(vendors.id, fixture.vendorId));

      const remaining = await outerTx
        .select({ id: vendorAvailableDays.id })
        .from(vendorAvailableDays)
        .where(eq(vendorAvailableDays.vendorId, fixture.vendorId));
      expect(remaining.length).toBe(0);
    });
  });

  it("replace with empty rows deletes all (clear schedule)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await replaceVendorAvailableDays(
        fixture.vendorId,
        {
          rows: [
            { dayOfWeek: 1, startsAt: "09:00", endsAt: "18:00" },
            { dayOfWeek: 2, startsAt: "09:00", endsAt: "18:00" },
          ],
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      const result = await replaceVendorAvailableDays(
        fixture.vendorId,
        { rows: [] },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(result.removed).toBe(2);
      expect(result.inserted).toBe(0);

      const listed = await listVendorAvailableDaysByVendorId(fixture.vendorId, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(listed.length).toBe(0);
    });
  });

  it("accepts null starts_at / ends_at (= 終日対応)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const result = await replaceVendorAvailableDays(
        fixture.vendorId,
        { rows: [{ dayOfWeek: 1, startsAt: null, endsAt: null }] },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(result.inserted).toBe(1);
      const listed = await listVendorAvailableDaysByVendorId(fixture.vendorId, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(listed[0]!.startsAt).toBeNull();
      expect(listed[0]!.endsAt).toBeNull();
    });
  });

  it("rejects vendor not found (deleted vendor)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const stranger = crypto.randomUUID();
      await expect(
        replaceVendorAvailableDays(
          stranger,
          { rows: [{ dayOfWeek: 1, startsAt: "09:00", endsAt: "18:00" }] },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toBeInstanceOf(VendorNotFoundError);
    });
  });

  it("DB CHECK enforces starts_at < ends_at when bypassing service", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await expect(
        outerTx.insert(vendorAvailableDays).values({
          companyId: fixture.companyId,
          vendorId: fixture.vendorId,
          dayOfWeek: 1,
          startsAt: "18:00:00",
          endsAt: "09:00:00",
        }),
      ).rejects.toThrow();
      // suppress unused import lint warning
      void and;
    });
  });
});
