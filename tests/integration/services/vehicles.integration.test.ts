import { config } from "dotenv";
import { and, count, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { customers } from "@/lib/db/schema/customers";
import { stores } from "@/lib/db/schema/stores";
import { vehicleOwnerships } from "@/lib/db/schema/vehicle_ownerships";
import { vehicles } from "@/lib/db/schema/vehicles";
import {
  createVehicle,
  deleteVehicle,
  getVehicleById,
  listOwnershipsByVehicle,
  listVehicles,
  transferOwnership,
  updateVehicle,
} from "@/lib/services/vehicles";

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
  customerAId: string;
  customerBId: string;
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
      { name: `__veh_company_${suffix}__`, code: `veh_${suffix}` },
      { name: `__veh_other_${suffix}__`, code: `veh_o_${suffix}` },
    ])
    .returning({ id: companies.id });
  const [store] = await outerTx
    .insert(stores)
    .values({ companyId: company.id, code: `store_${suffix}`, name: "車両管理店舗A" })
    .returning({ id: stores.id });
  const [customerA, customerB] = await outerTx
    .insert(customers)
    .values([
      { companyId: company.id, fullName: `顧客A ${suffix}` },
      { companyId: company.id, fullName: `顧客B ${suffix}` },
    ])
    .returning({ id: customers.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
    storeId: store.id,
    customerAId: customerA.id,
    customerBId: customerB.id,
  };
}

describeIntegration("vehicle services", () => {
  it("creates a vehicle scoped to the admin company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createVehicle(
        {
          storeId: fixture.storeId,
          registrationNumber: `品川300-${crypto.randomUUID().slice(0, 4)}`,
          vin: `VIN-${crypto.randomUUID()}`,
          maker: "トヨタ",
          model: "プリウス",
          modelYear: 2020,
          color: "白",
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.companyId).toBe(fixture.companyId);
      expect(created.maker).toBe("トヨタ");
      expect(created.modelYear).toBe(2020);
    });
  });

  it("lists only vehicles for the requested company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const other = await seedFixture(outerTx);
      await createVehicle({ registrationNumber: "VEH-LIST-A" }, { db: outerTx, companyId: fixture.companyId });
      await createVehicle({ registrationNumber: "VEH-LIST-B" }, { db: outerTx, companyId: other.companyId });

      const result = await listVehicles({}, { db: outerTx, companyId: fixture.companyId });

      expect(result.rows.map((row) => row.registrationNumber)).toContain("VEH-LIST-A");
      expect(result.rows.map((row) => row.registrationNumber)).not.toContain("VEH-LIST-B");
      expect(result.total).toBeGreaterThanOrEqual(1);
    });
  });

  it("updates a vehicle in company scope", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createVehicle(
        { registrationNumber: "VEH-UPD", maker: "ホンダ" },
        { db: outerTx, companyId: fixture.companyId },
      );

      const updated = await updateVehicle(
        created.id,
        { maker: "日産", color: "赤", modelYear: 2023 },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(updated?.maker).toBe("日産");
      expect(updated?.color).toBe("赤");
      const detail = await getVehicleById(created.id, { db: outerTx, companyId: fixture.companyId });
      expect(detail?.modelYear).toBe(2023);
    });
  });

  it("soft-deletes a vehicle and rejects cross-tenant delete", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createVehicle({ registrationNumber: "VEH-DEL" }, { db: outerTx, companyId: fixture.companyId });

      await expect(deleteVehicle(created.id, { db: outerTx, companyId: fixture.otherCompanyId })).resolves.toBe(false);
      await expect(deleteVehicle(created.id, { db: outerTx, companyId: fixture.companyId })).resolves.toBe(true);

      // soft delete: row 残るが deletedAt が立つ
      const rows = await outerTx
        .select({ value: count() })
        .from(vehicles)
        .where(and(eq(vehicles.id, created.id), isNull(vehicles.deletedAt)));
      expect(Number(rows[0]?.value ?? 0)).toBe(0);

      // 詳細取得は null
      const detail = await getVehicleById(created.id, { db: outerTx, companyId: fixture.companyId });
      expect(detail).toBeNull();
    });
  });

  it("transferOwnership inserts a new active ownership row", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const vehicle = await createVehicle({ registrationNumber: "VEH-TX1" }, { db: outerTx, companyId: fixture.companyId });

      const ownership = await transferOwnership(
        vehicle.id,
        { customerId: fixture.customerAId, isPrimary: true },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(ownership.vehicleId).toBe(vehicle.id);
      expect(ownership.customerId).toBe(fixture.customerAId);
      expect(ownership.endsOn).toBeNull();
      expect(ownership.isPrimary).toBe(true);

      const all = await listOwnershipsByVehicle(vehicle.id, { db: outerTx, companyId: fixture.companyId });
      expect(all).toHaveLength(1);
      expect(all[0]?.endsOn).toBeNull();
    });
  });

  it("transferOwnership closes existing active ownerships with ends_on", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const vehicle = await createVehicle({ registrationNumber: "VEH-TX2" }, { db: outerTx, companyId: fixture.companyId });

      const first = await transferOwnership(
        vehicle.id,
        { customerId: fixture.customerAId, isPrimary: true },
        { db: outerTx, companyId: fixture.companyId },
      );
      const second = await transferOwnership(
        vehicle.id,
        { customerId: fixture.customerBId, isPrimary: true },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(second.customerId).toBe(fixture.customerBId);
      expect(second.endsOn).toBeNull();

      // first 行は ends_on がセットされているはず
      const firstRow = await outerTx
        .select({ id: vehicleOwnerships.id, endsOn: vehicleOwnerships.endsOn })
        .from(vehicleOwnerships)
        .where(eq(vehicleOwnerships.id, first.id));
      expect(firstRow[0]?.endsOn).not.toBeNull();

      // active (ends_on IS NULL) は 1 件だけ
      const active = await outerTx
        .select({ value: count() })
        .from(vehicleOwnerships)
        .where(and(eq(vehicleOwnerships.vehicleId, vehicle.id), isNull(vehicleOwnerships.endsOn)));
      expect(Number(active[0]?.value ?? 0)).toBe(1);
    });
  });

  it("transferOwnership rejects cross-tenant vehicle reference", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const other = await seedFixture(outerTx);
      const vehicle = await createVehicle({ registrationNumber: "VEH-TX3" }, { db: outerTx, companyId: fixture.companyId });

      await expect(
        transferOwnership(
          vehicle.id,
          { customerId: other.customerAId, isPrimary: true },
          { db: outerTx, companyId: other.companyId },
        ),
      ).rejects.toThrow(/vehicle not found for company/);
    });
  });
});
