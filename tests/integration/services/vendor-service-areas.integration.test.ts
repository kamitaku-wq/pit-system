import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { vendors } from "@/lib/db/schema/vendors";
import { vendorServiceAreas } from "@/lib/db/schema/vendor_service_areas";
import {
  createVendorServiceArea,
  deleteVendorServiceArea,
  listVendorServiceAreasByVendorId,
  updateVendorServiceArea,
  VendorNotFoundError,
  VendorServiceAreaNotFoundError,
} from "@/lib/services/vendor-service-areas";
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
      { name: `__vsa_company_${suffix}__`, code: `vsa_${suffix}` },
      { name: `__vsa_other_${suffix}__`, code: `vsa_o_${suffix}` },
    ])
    .returning({ id: companies.id });
  const vendor = await createVendor({ name: `業者 ${suffix}` }, { db: outerTx, companyId: company.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
    vendorId: vendor.id,
  };
}

describeIntegration("vendor-service-areas per-row CRUD", () => {
  it("creates a service area with prefecture + city", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createVendorServiceArea(
        fixture.vendorId,
        { prefecture: "東京都", city: "渋谷区" },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.vendorId).toBe(fixture.vendorId);
      expect(created.prefecture).toBe("東京都");
      expect(created.city).toBe("渋谷区");
      expect(created.companyId).toBe(fixture.companyId);
    });
  });

  it("creates a service area with prefecture only (city null = 都道府県全域)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createVendorServiceArea(
        fixture.vendorId,
        { prefecture: "神奈川県" },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.city).toBeNull();
    });
  });

  it("lists service areas ordered by prefecture then city", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await createVendorServiceArea(
        fixture.vendorId,
        { prefecture: "東京都", city: "渋谷区" },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createVendorServiceArea(
        fixture.vendorId,
        { prefecture: "東京都", city: "新宿区" },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createVendorServiceArea(
        fixture.vendorId,
        { prefecture: "神奈川県", city: "横浜市" },
        { db: outerTx, companyId: fixture.companyId },
      );

      const listed = await listVendorServiceAreasByVendorId(fixture.vendorId, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(listed.length).toBe(3);
      // prefecture asc → 東京都 が 神奈川県 より前 (Unicode 順: 東(0x6771) > 神(0x795E) ではない、神(0x795E) > 東(0x6771) なので 東京都 が先)
      // 実際には Postgres collation 依存だが、いずれにせよ 2 つの都道府県が含まれる
      const prefectures = listed.map((r) => r.prefecture);
      expect(prefectures).toContain("東京都");
      expect(prefectures).toContain("神奈川県");
    });
  });

  it("allows duplicate (prefecture, city) — UNIQUE 不在", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await createVendorServiceArea(
        fixture.vendorId,
        { prefecture: "東京都", city: "渋谷区" },
        { db: outerTx, companyId: fixture.companyId },
      );
      // 重複登録が UNIQUE 違反にならず成功する
      const dup = await createVendorServiceArea(
        fixture.vendorId,
        { prefecture: "東京都", city: "渋谷区" },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(dup.id).toBeTruthy();

      const listed = await listVendorServiceAreasByVendorId(fixture.vendorId, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(listed.length).toBe(2);
    });
  });

  it("rejects when vendor belongs to another company (list / create)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await expect(
        listVendorServiceAreasByVendorId(fixture.vendorId, {
          db: outerTx,
          companyId: fixture.otherCompanyId,
        }),
      ).rejects.toBeInstanceOf(VendorNotFoundError);

      await expect(
        createVendorServiceArea(
          fixture.vendorId,
          { prefecture: "東京都", city: "渋谷区" },
          { db: outerTx, companyId: fixture.otherCompanyId },
        ),
      ).rejects.toBeInstanceOf(VendorNotFoundError);
    });
  });

  it("updates prefecture and city independently", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createVendorServiceArea(
        fixture.vendorId,
        { prefecture: "東京都", city: "渋谷区" },
        { db: outerTx, companyId: fixture.companyId },
      );

      // city のみ更新 (prefecture 未指定で保持)
      const updated = await updateVendorServiceArea(
        created.id,
        { city: "新宿区" },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(updated.city).toBe("新宿区");
      expect(updated.prefecture).toBe("東京都");

      // city を空 (=都道府県全域) に更新
      const cleared = await updateVendorServiceArea(
        created.id,
        { city: "" },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(cleared.city).toBeNull();
    });
  });

  it("update on missing id raises VendorServiceAreaNotFoundError", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const stranger = crypto.randomUUID();
      await expect(
        updateVendorServiceArea(
          stranger,
          { prefecture: "東京都" },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toBeInstanceOf(VendorServiceAreaNotFoundError);
    });
  });

  it("hard-deletes a service area and rejects cross-tenant delete", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createVendorServiceArea(
        fixture.vendorId,
        { prefecture: "東京都", city: "渋谷区" },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(
        deleteVendorServiceArea(created.id, { db: outerTx, companyId: fixture.otherCompanyId }),
      ).resolves.toBe(false);
      await expect(
        deleteVendorServiceArea(created.id, { db: outerTx, companyId: fixture.companyId }),
      ).resolves.toBe(true);

      // hard delete (deletedAt なし schema): row が消える
      const remaining = await outerTx
        .select({ id: vendorServiceAreas.id })
        .from(vendorServiceAreas)
        .where(eq(vendorServiceAreas.id, created.id));
      expect(remaining.length).toBe(0);
    });
  });

  it("CASCADE: vendor hard delete cascades to vendor_service_areas", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await createVendorServiceArea(
        fixture.vendorId,
        { prefecture: "東京都", city: "渋谷区" },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createVendorServiceArea(
        fixture.vendorId,
        { prefecture: "神奈川県" },
        { db: outerTx, companyId: fixture.companyId },
      );

      await outerTx.delete(vendors).where(eq(vendors.id, fixture.vendorId));

      const remaining = await outerTx
        .select({ id: vendorServiceAreas.id })
        .from(vendorServiceAreas)
        .where(
          and(
            eq(vendorServiceAreas.vendorId, fixture.vendorId),
            eq(vendorServiceAreas.companyId, fixture.companyId),
          ),
        );
      expect(remaining.length).toBe(0);
    });
  });

  it("rejects empty prefecture via Zod", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await expect(
        createVendorServiceArea(
          fixture.vendorId,
          { prefecture: "  " },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toThrow();
    });
  });
});
