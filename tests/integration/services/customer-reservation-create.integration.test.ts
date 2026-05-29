import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { seedReservationStatuses } from "../../_helpers/seed-reservation-statuses";
import { auditLogs } from "@/lib/db/schema/audit_logs";
import { companies } from "@/lib/db/schema/companies";
import { customers } from "@/lib/db/schema/customers";
import { lanes } from "@/lib/db/schema/lanes";
import { reservations } from "@/lib/db/schema/reservations";
import { reservationStatusHistory } from "@/lib/db/schema/reservation_status_history";
import { statuses } from "@/lib/db/schema/statuses";
import { stores } from "@/lib/db/schema/stores";
import { vehicles } from "@/lib/db/schema/vehicles";
import { workMenus } from "@/lib/db/schema/work_menus";
import {
  createCustomerReservation,
  type CreateCustomerReservationInput,
} from "@/lib/services/customer-reservation-create";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

afterAll(async () => {
  await queryClient?.end();
});

async function withRollback(fn: (outerTx: Tx) => Promise<void>): Promise<void> {
  let originalError: unknown;

  await db!
    .transaction(async (outerTx) => {
      try {
        await fn(outerTx);
      } catch (err) {
        originalError = err;
      }
      throw new Error(ROLLBACK);
    })
    .catch((err) => {
      if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
    });

  if (originalError) throw originalError;
}

type Tenant = {
  companyId: string;
  storeId: string;
  laneId: string;
};

async function seedTenant(outerTx: Tx, label: string): Promise<Tenant> {
  const suffix = crypto.randomUUID().slice(0, 8);
  // company INSERT で trigger が reservation status 'confirmed' を自動 seed する。
  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__resc_${label}_${suffix}__`, code: `resc_${label}_${suffix}` })
    .returning({ id: companies.id });

  const [storeRow] = await outerTx
    .insert(stores)
    .values({ companyId: companyRow.id, code: `s_${suffix}`, name: "Store" })
    .returning({ id: stores.id });

  const [laneRow] = await outerTx
    .insert(lanes)
    .values({ companyId: companyRow.id, storeId: storeRow.id, name: `Lane ${suffix}` })
    .returning({ id: lanes.id });

  return { companyId: companyRow.id, storeId: storeRow.id, laneId: laneRow.id };
}

function baseInput(tenant: Tenant): CreateCustomerReservationInput {
  return {
    storeId: tenant.storeId,
    laneId: tenant.laneId,
    customer: { fullName: "山田 太郎", email: "taro@example.test", phone: "09000000000" },
    vehicle: { registrationNumber: "品川 300 あ 12-34", maker: "Toyota" },
    startAt: new Date("2026-07-01T09:00:00Z"),
    endAt: new Date("2026-07-01T10:00:00Z"),
  };
}

describeIntegration("createCustomerReservation", () => {
  it("creates a confirmed reservation with customer, vehicle, history and audit log", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "cur");
      const { confirmed } = await seedReservationStatuses(outerTx, tenant.companyId);

      const result = await createCustomerReservation(baseInput(tenant), {
        db: outerTx,
        ipAddress: "203.0.113.1",
        userAgent: "test-agent",
      });

      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.statusId).toBe(confirmed);

      const [reservationRow] = await outerTx
        .select()
        .from(reservations)
        .where(eq(reservations.id, result.reservationId))
        .limit(1);
      expect(reservationRow.statusId).toBe(confirmed);
      expect(reservationRow.companyId).toBe(tenant.companyId);
      expect(reservationRow.customerId).toBe(result.customerId);
      expect(reservationRow.vehicleId).toBe(result.vehicleId);

      const [customerRow] = await outerTx
        .select()
        .from(customers)
        .where(eq(customers.id, result.customerId))
        .limit(1);
      expect(customerRow.fullName).toBe("山田 太郎");
      expect(customerRow.companyId).toBe(tenant.companyId);

      const [vehicleRow] = await outerTx
        .select()
        .from(vehicles)
        .where(eq(vehicles.id, result.vehicleId))
        .limit(1);
      expect(vehicleRow.registrationNumber).toBe("品川 300 あ 12-34");
      expect(vehicleRow.storeId).toBe(tenant.storeId);

      const historyRows = await outerTx
        .select()
        .from(reservationStatusHistory)
        .where(eq(reservationStatusHistory.reservationId, result.reservationId));
      expect(historyRows).toHaveLength(1);
      expect(historyRows[0].fromStatusId).toBeNull();
      expect(historyRows[0].toStatusId).toBe(confirmed);
      expect(historyRows[0].changedByUserId).toBeNull();

      const auditRows = await outerTx
        .select()
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.entityType, "reservation"),
            eq(auditLogs.entityId, result.reservationId),
          ),
        );
      expect(auditRows).toHaveLength(1);
      expect(auditRows[0].action).toBe("create");
      expect(auditRows[0].actorKind).toBe("customer");
    });
  });

  it("accepts a workMenu belonging to the same company", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "menu");
      await seedReservationStatuses(outerTx, tenant.companyId);

      const [menuRow] = await outerTx
        .insert(workMenus)
        .values({ companyId: tenant.companyId, code: "oil", name: "Oil change" })
        .returning({ id: workMenus.id });

      const result = await createCustomerReservation(
        { ...baseInput(tenant), workMenuId: menuRow.id },
        { db: outerTx },
      );
      expect(result.ok).toBe(true);
    });
  });

  it("rejects an overlapping slot on the same store+lane with slot_unavailable", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "slot");
      await seedReservationStatuses(outerTx, tenant.companyId);

      const first = await createCustomerReservation(baseInput(tenant), { db: outerTx });
      expect(first.ok).toBe(true);

      // 同 store+lane で時間帯が重なる 2 件目 → exclusion 制約 (23P01) → slot_unavailable。
      const second = await createCustomerReservation(
        {
          ...baseInput(tenant),
          startAt: new Date("2026-07-01T09:30:00Z"),
          endAt: new Date("2026-07-01T10:30:00Z"),
        },
        { db: outerTx },
      );
      expect(second.ok).toBe(false);
      if (second.ok) return;
      expect(second.reason).toBe("slot_unavailable");

      // outerTx は savepoint で保護され生存している (後続クエリが成功すること)。
      const rows = await outerTx
        .select()
        .from(reservations)
        .where(eq(reservations.companyId, tenant.companyId));
      expect(rows).toHaveLength(1);
    });
  });

  it("allows a non-overlapping slot on the same store+lane", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "adj");
      await seedReservationStatuses(outerTx, tenant.companyId);

      const first = await createCustomerReservation(baseInput(tenant), { db: outerTx });
      expect(first.ok).toBe(true);

      const second = await createCustomerReservation(
        {
          ...baseInput(tenant),
          startAt: new Date("2026-07-01T10:00:00Z"),
          endAt: new Date("2026-07-01T11:00:00Z"),
        },
        { db: outerTx },
      );
      expect(second.ok).toBe(true);
    });
  });

  it("rejects a lane belonging to another company with lane_not_found", async () => {
    await withRollback(async (outerTx) => {
      const cur = await seedTenant(outerTx, "cur");
      const other = await seedTenant(outerTx, "oth");
      await seedReservationStatuses(outerTx, cur.companyId);

      const result = await createCustomerReservation(
        { ...baseInput(cur), laneId: other.laneId },
        { db: outerTx },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("lane_not_found");
    });
  });

  it("rejects a workMenu belonging to another company with work_menu_not_found", async () => {
    await withRollback(async (outerTx) => {
      const cur = await seedTenant(outerTx, "cur");
      const other = await seedTenant(outerTx, "oth");
      await seedReservationStatuses(outerTx, cur.companyId);

      const [otherMenu] = await outerTx
        .insert(workMenus)
        .values({ companyId: other.companyId, code: "oil", name: "Oil change" })
        .returning({ id: workMenus.id });

      const result = await createCustomerReservation(
        { ...baseInput(cur), workMenuId: otherMenu.id },
        { db: outerTx },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("work_menu_not_found");
    });
  });

  it("rejects a soft-deleted lane with lane_not_found", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "cur");
      await seedReservationStatuses(outerTx, tenant.companyId);

      await outerTx.update(lanes).set({ deletedAt: new Date() }).where(eq(lanes.id, tenant.laneId));

      const result = await createCustomerReservation(baseInput(tenant), { db: outerTx });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("lane_not_found");
    });
  });

  it("rejects an inactive store with store_not_found", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "cur");
      await seedReservationStatuses(outerTx, tenant.companyId);

      await outerTx.update(stores).set({ isActive: false }).where(eq(stores.id, tenant.storeId));

      const result = await createCustomerReservation(baseInput(tenant), { db: outerTx });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("store_not_found");
    });
  });

  it("returns store_not_found for an unknown store", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "cur");
      await seedReservationStatuses(outerTx, tenant.companyId);

      const result = await createCustomerReservation(
        { ...baseInput(tenant), storeId: crypto.randomUUID() },
        { db: outerTx },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("store_not_found");
    });
  });

  it("returns status_not_seeded when the reservation status is missing", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "cur");
      // trigger が seed した reservation status を削除して欠落状態を作る。
      await outerTx
        .delete(statuses)
        .where(
          and(eq(statuses.companyId, tenant.companyId), eq(statuses.statusType, "reservation")),
        );

      const result = await createCustomerReservation(baseInput(tenant), { db: outerTx });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("status_not_seeded");
    });
  });

  it("throws on invalid time order (startAt >= endAt)", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "cur");
      await seedReservationStatuses(outerTx, tenant.companyId);

      await expect(
        createCustomerReservation(
          {
            ...baseInput(tenant),
            startAt: new Date("2026-07-01T10:00:00Z"),
            endAt: new Date("2026-07-01T09:00:00Z"),
          },
          { db: outerTx },
        ),
      ).rejects.toThrow();
    });
  });
});
