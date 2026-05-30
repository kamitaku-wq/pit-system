import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { customers } from "@/lib/db/schema/customers";
import { vehicleOwnerships } from "@/lib/db/schema/vehicle_ownerships";
import { vehicles } from "@/lib/db/schema/vehicles";
import {
  deleteVehicleOwnership,
  updateVehicleOwnership,
  VehicleOwnershipConstraintError,
  VehicleOwnershipNotFoundError,
} from "@/lib/services/vehicle-ownerships";
import { createVehicle, transferOwnership } from "@/lib/services/vehicles";

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
      { name: `__vown_company_${suffix}__`, code: `vown_${suffix}` },
      { name: `__vown_other_${suffix}__`, code: `vown_o_${suffix}` },
    ])
    .returning({ id: companies.id });
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
    customerAId: customerA.id,
    customerBId: customerB.id,
  };
}

describeIntegration("vehicle-ownerships per-row CRUD", () => {
  it("updates startsOn / endsOn / isPrimary on an existing ownership", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const vehicle = await createVehicle({ registrationNumber: "VOWN-UPD-1" }, { db: outerTx, companyId: fixture.companyId });
      const ownership = await transferOwnership(
        vehicle.id,
        { customerId: fixture.customerAId, startsOn: "2024-01-01", isPrimary: true },
        { db: outerTx, companyId: fixture.companyId },
      );

      const updated = await updateVehicleOwnership(
        ownership.id,
        { startsOn: "2024-02-01", endsOn: "2024-12-31", isPrimary: false },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(updated.startsOn).toBe("2024-02-01");
      expect(updated.endsOn).toBe("2024-12-31");
      expect(updated.isPrimary).toBe(false);
    });
  });

  it("rejects update when starts_on > ends_on (service-side CHECK defense)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const vehicle = await createVehicle({ registrationNumber: "VOWN-CHK" }, { db: outerTx, companyId: fixture.companyId });
      const ownership = await transferOwnership(
        vehicle.id,
        { customerId: fixture.customerAId, startsOn: "2024-06-01" },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(
        updateVehicleOwnership(
          ownership.id,
          { endsOn: "2024-01-01" },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toBeInstanceOf(VehicleOwnershipConstraintError);
    });
  });

  it("allows re-activating (endsOn → null) when no other active ownership exists", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const vehicle = await createVehicle({ registrationNumber: "VOWN-REACT" }, { db: outerTx, companyId: fixture.companyId });
      // 旧 ownership を作って閉じる (transferOwnership 2 回で旧の endsOn を埋める)
      const old = await transferOwnership(
        vehicle.id,
        { customerId: fixture.customerAId, startsOn: "2023-01-01" },
        { db: outerTx, companyId: fixture.companyId },
      );
      await transferOwnership(
        vehicle.id,
        { customerId: fixture.customerBId, startsOn: "2024-01-01" },
        { db: outerTx, companyId: fixture.companyId },
      );
      // この時点で旧 ownership は endsOn が今日付け、新 ownership が ends_on=NULL
      // 新を soft delete してから旧の endsOn を null に戻して再 activate
      const ownerships = await outerTx
        .select()
        .from(vehicleOwnerships)
        .where(and(eq(vehicleOwnerships.vehicleId, vehicle.id), eq(vehicleOwnerships.companyId, fixture.companyId)));
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const current = ownerships.find((row: any) => row.endsOn === null);
      expect(current).toBeDefined();
      await deleteVehicleOwnership(current!.id, { db: outerTx, companyId: fixture.companyId });

      // 今度は旧 (old) の endsOn を null に戻せる
      const revived = await updateVehicleOwnership(
        old.id,
        { endsOn: null },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(revived.endsOn).toBeNull();
    });
  });

  it("rejects re-activation when another active ownership exists (ends_on=NULL exclusivity)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const vehicle = await createVehicle({ registrationNumber: "VOWN-EXCL" }, { db: outerTx, companyId: fixture.companyId });
      const old = await transferOwnership(
        vehicle.id,
        { customerId: fixture.customerAId, startsOn: "2023-01-01" },
        { db: outerTx, companyId: fixture.companyId },
      );
      // 新 ownership 作成 → 旧は閉じられて新が ends_on=NULL に
      await transferOwnership(
        vehicle.id,
        { customerId: fixture.customerBId, startsOn: "2024-01-01" },
        { db: outerTx, companyId: fixture.companyId },
      );
      // 旧 ownership の endsOn を NULL に戻そうとすると、新が active なのでエラー
      await expect(
        updateVehicleOwnership(
          old.id,
          { endsOn: null },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toBeInstanceOf(VehicleOwnershipConstraintError);
    });
  });

  it("soft-deletes an ownership (list excludes deleted rows)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const vehicle = await createVehicle({ registrationNumber: "VOWN-DEL" }, { db: outerTx, companyId: fixture.companyId });
      const ownership = await transferOwnership(
        vehicle.id,
        { customerId: fixture.customerAId },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(
        deleteVehicleOwnership(ownership.id, { db: outerTx, companyId: fixture.companyId }),
      ).resolves.toBe(true);

      // soft delete: row 残るが deletedAt が立つ
      const active = await outerTx
        .select({ id: vehicleOwnerships.id })
        .from(vehicleOwnerships)
        .where(
          and(
            eq(vehicleOwnerships.id, ownership.id),
            isNull(vehicleOwnerships.deletedAt),
          ),
        );
      expect(active.length).toBe(0);
    });
  });

  it("rejects cross-tenant update / delete", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const vehicle = await createVehicle({ registrationNumber: "VOWN-TENANT" }, { db: outerTx, companyId: fixture.companyId });
      const ownership = await transferOwnership(
        vehicle.id,
        { customerId: fixture.customerAId },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(
        updateVehicleOwnership(
          ownership.id,
          { isPrimary: false },
          { db: outerTx, companyId: fixture.otherCompanyId },
        ),
      ).rejects.toBeInstanceOf(VehicleOwnershipNotFoundError);

      await expect(
        deleteVehicleOwnership(ownership.id, { db: outerTx, companyId: fixture.otherCompanyId }),
      ).resolves.toBe(false);
    });
  });

  it("throws NotFound when updating an already-deleted ownership", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const vehicle = await createVehicle({ registrationNumber: "VOWN-NF" }, { db: outerTx, companyId: fixture.companyId });
      const ownership = await transferOwnership(
        vehicle.id,
        { customerId: fixture.customerAId },
        { db: outerTx, companyId: fixture.companyId },
      );
      await deleteVehicleOwnership(ownership.id, { db: outerTx, companyId: fixture.companyId });

      await expect(
        updateVehicleOwnership(
          ownership.id,
          { isPrimary: false },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toBeInstanceOf(VehicleOwnershipNotFoundError);
    });
  });

  it("CHECK (starts_on <= ends_on) enforced at DB level", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const vehicle = await createVehicle({ registrationNumber: "VOWN-DB-CHECK" }, { db: outerTx, companyId: fixture.companyId });

      // raw insert で starts_on > ends_on を試行 → DB CHECK 違反で reject
      await expect(
        outerTx.insert(vehicleOwnerships).values({
          companyId: fixture.companyId,
          customerId: fixture.customerAId,
          vehicleId: vehicle.id,
          startsOn: "2024-12-31",
          endsOn: "2024-01-01",
        }),
      ).rejects.toThrow();
    });
  });

  it("CASCADE: vehicle hard delete cascades to ownerships", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const vehicle = await createVehicle({ registrationNumber: "VOWN-CASCADE" }, { db: outerTx, companyId: fixture.companyId });
      await transferOwnership(
        vehicle.id,
        { customerId: fixture.customerAId },
        { db: outerTx, companyId: fixture.companyId },
      );

      // hard delete (soft 用ではなく FK CASCADE 検証用に raw DELETE)
      await outerTx.delete(vehicles).where(eq(vehicles.id, vehicle.id));

      const remaining = await outerTx
        .select({ id: vehicleOwnerships.id })
        .from(vehicleOwnerships)
        .where(eq(vehicleOwnerships.vehicleId, vehicle.id));
      expect(remaining.length).toBe(0);
    });
  });

  it("updates only isPrimary without touching dates", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const vehicle = await createVehicle({ registrationNumber: "VOWN-PRIM" }, { db: outerTx, companyId: fixture.companyId });
      const ownership = await transferOwnership(
        vehicle.id,
        { customerId: fixture.customerAId, startsOn: "2024-03-15", isPrimary: true },
        { db: outerTx, companyId: fixture.companyId },
      );

      const updated = await updateVehicleOwnership(
        ownership.id,
        { isPrimary: false },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(updated.isPrimary).toBe(false);
      expect(updated.startsOn).toBe("2024-03-15");
      expect(updated.endsOn).toBeNull();
    });
  });

  it("rejects unknown fields via strict schema", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const vehicle = await createVehicle({ registrationNumber: "VOWN-STRICT" }, { db: outerTx, companyId: fixture.companyId });
      const ownership = await transferOwnership(
        vehicle.id,
        { customerId: fixture.customerAId },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(
        updateVehicleOwnership(
          ownership.id,
          // @ts-expect-error testing strict schema rejects unknown fields
          { startsOn: "2024-01-01", bogusField: "x" },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toThrow();
    });
  });
});
