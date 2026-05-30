import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { customers } from "@/lib/db/schema/customers";
import { lanes } from "@/lib/db/schema/lanes";
import { reservations } from "@/lib/db/schema/reservations";
import { statuses } from "@/lib/db/schema/statuses";
import { stores } from "@/lib/db/schema/stores";
import { vehicles } from "@/lib/db/schema/vehicles";
import { workMenus } from "@/lib/db/schema/work_menus";
import { getReservationDetailViaServiceRole } from "@/lib/services/customer-reservation-detail";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(
  databaseUrl === undefined || databaseUrl.length === 0,
);
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

describeIntegration("getReservationDetailViaServiceRole (Phase 64-A.24)", () => {
  it("loads a reservation with all 6 related entities joined", async () => {
    await withRollback(async (tx) => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const [company] = await tx
        .insert(companies)
        .values({ name: `__crd_${suffix}__`, code: `crd_${suffix}` })
        .returning({ id: companies.id });
      const [store] = await tx
        .insert(stores)
        .values({
          companyId: company.id,
          code: `s_${suffix}`,
          name: `Store ${suffix}`,
        })
        .returning({ id: stores.id });
      const [lane] = await tx
        .insert(lanes)
        .values({ companyId: company.id, storeId: store.id, name: `Lane ${suffix}` })
        .returning({ id: lanes.id });
      const [menu] = await tx
        .insert(workMenus)
        .values({
          companyId: company.id,
          code: `wm_${suffix}`,
          name: `Oil change ${suffix}`,
          durationMinutes: 30,
        })
        .returning({ id: workMenus.id });
      const [vehicle] = await tx
        .insert(vehicles)
        .values({
          companyId: company.id,
          registrationNumber: `品川 300 あ 1234`,
          maker: "Toyota",
          model: "Corolla",
        })
        .returning({ id: vehicles.id });
      const [customer] = await tx
        .insert(customers)
        .values({
          companyId: company.id,
          fullName: `山田 太郎 ${suffix}`,
          phone: "090-0000-0000",
        })
        .returning({ id: customers.id });
      const [status] = await tx
        .insert(statuses)
        .values({
          companyId: company.id,
          statusType: "reservation",
          key: `confirmed_${suffix}`,
          name: "確定",
        })
        .returning({ id: statuses.id });

      const [reservation] = await tx
        .insert(reservations)
        .values({
          companyId: company.id,
          storeId: store.id,
          laneId: lane.id,
          workMenuId: menu.id,
          vehicleId: vehicle.id,
          customerId: customer.id,
          statusId: status.id,
          startAt: new Date("2026-06-01T09:00:00Z"),
          endAt: new Date("2026-06-01T10:00:00Z"),
          notes: "顧客メモ",
        })
        .returning({ id: reservations.id });

      const detail = await getReservationDetailViaServiceRole(reservation.id, {
        db: tx,
      });
      expect(detail).not.toBeNull();
      if (!detail) return;
      expect(detail.reservation.id).toBe(reservation.id);
      expect(detail.reservation.companyId).toBe(company.id);
      expect(detail.reservation.notes).toBe("顧客メモ");
      expect(detail.store).not.toBeNull();
      expect(detail.store?.name).toContain("Store");
      expect(detail.lane?.name).toContain("Lane");
      expect(detail.workMenu?.name).toContain("Oil change");
      expect(detail.workMenu?.durationMinutes).toBe(30);
      expect(detail.vehicle?.maker).toBe("Toyota");
      expect(detail.vehicle?.model).toBe("Corolla");
      expect(detail.customer?.fullName).toContain("山田");
      expect(detail.status?.name).toBe("確定");
    });
  });

  it("returns null nullable joins (workMenu / vehicle / customer / status) when FK is null", async () => {
    await withRollback(async (tx) => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const [company] = await tx
        .insert(companies)
        .values({ name: `__crd_min_${suffix}__`, code: `crd_min_${suffix}` })
        .returning({ id: companies.id });
      const [store] = await tx
        .insert(stores)
        .values({ companyId: company.id, code: `s_${suffix}`, name: `S ${suffix}` })
        .returning({ id: stores.id });
      const [lane] = await tx
        .insert(lanes)
        .values({ companyId: company.id, storeId: store.id, name: `L ${suffix}` })
        .returning({ id: lanes.id });

      const [reservation] = await tx
        .insert(reservations)
        .values({
          companyId: company.id,
          storeId: store.id,
          laneId: lane.id,
          // workMenuId / vehicleId / customerId / statusId は全部 null
          startAt: new Date("2026-06-01T09:00:00Z"),
          endAt: new Date("2026-06-01T10:00:00Z"),
        })
        .returning({ id: reservations.id });

      const detail = await getReservationDetailViaServiceRole(reservation.id, {
        db: tx,
      });
      expect(detail).not.toBeNull();
      if (!detail) return;
      expect(detail.store).not.toBeNull();
      expect(detail.lane).not.toBeNull();
      expect(detail.workMenu).toBeNull();
      expect(detail.vehicle).toBeNull();
      expect(detail.customer).toBeNull();
      expect(detail.status).toBeNull();
      expect(detail.reservation.notes).toBeNull();
    });
  });

  it("returns null when reservation does not exist", async () => {
    await withRollback(async (tx) => {
      const fakeId = crypto.randomUUID();
      const detail = await getReservationDetailViaServiceRole(fakeId, { db: tx });
      expect(detail).toBeNull();
    });
  });

  it("is cross-tenant safe: a corrupt FK pointing to another company is rejected by the join filter", async () => {
    await withRollback(async (tx) => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const [companyA, companyB] = await tx
        .insert(companies)
        .values([
          { name: `__crd_a_${suffix}__`, code: `crd_a_${suffix}` },
          { name: `__crd_b_${suffix}__`, code: `crd_b_${suffix}` },
        ])
        .returning({ id: companies.id });

      const [storeA] = await tx
        .insert(stores)
        .values({ companyId: companyA.id, code: `sa_${suffix}`, name: `SA ${suffix}` })
        .returning({ id: stores.id });
      const [laneA] = await tx
        .insert(lanes)
        .values({ companyId: companyA.id, storeId: storeA.id, name: `LA ${suffix}` })
        .returning({ id: lanes.id });

      // Company B の関連 entity を作成 (corrupt FK の参照先)
      const [storeB] = await tx
        .insert(stores)
        .values({ companyId: companyB.id, code: `sb_${suffix}`, name: `SB ${suffix}` })
        .returning({ id: stores.id });
      const [customerB] = await tx
        .insert(customers)
        .values({
          companyId: companyB.id,
          fullName: `他社顧客 ${suffix}`,
          phone: "090-1111-1111",
        })
        .returning({ id: customers.id });
      const [menuB] = await tx
        .insert(workMenus)
        .values({
          companyId: companyB.id,
          code: `wmb_${suffix}`,
          name: `他社メニュー ${suffix}`,
          durationMinutes: 60,
        })
        .returning({ id: workMenus.id });
      const [vehicleB] = await tx
        .insert(vehicles)
        .values({
          companyId: companyB.id,
          registrationNumber: `他社車両 ${suffix}`,
          maker: "Honda",
          model: "Civic",
        })
        .returning({ id: vehicles.id });
      const [statusB] = await tx
        .insert(statuses)
        .values({
          companyId: companyB.id,
          statusType: "reservation",
          key: `corrupt_${suffix}`,
          name: "他社ステータス",
        })
        .returning({ id: statuses.id });

      // Corrupt reservation: companyA だが customerId / workMenuId / vehicleId / statusId は companyB のものを指す
      // (FK 制約は通るが cross-tenant、本来 migration では起きないはず)
      const [corruptReservation] = await tx
        .insert(reservations)
        .values({
          companyId: companyA.id,
          storeId: storeA.id, // 正常 (companyA)
          laneId: laneA.id, // 正常 (companyA)
          workMenuId: menuB.id, // CORRUPT (companyB)
          vehicleId: vehicleB.id, // CORRUPT (companyB)
          customerId: customerB.id, // CORRUPT (companyB)
          statusId: statusB.id, // CORRUPT (companyB)
          startAt: new Date("2026-06-01T09:00:00Z"),
          endAt: new Date("2026-06-01T10:00:00Z"),
        })
        .returning({ id: reservations.id });

      const detail = await getReservationDetailViaServiceRole(corruptReservation.id, {
        db: tx,
      });
      expect(detail).not.toBeNull();
      if (!detail) return;

      // 正常な store / lane は join される (companyA)
      expect(detail.store?.id).toBe(storeA.id);
      expect(detail.lane?.id).toBe(laneA.id);

      // Corrupt な FK は cross-tenant filter で null に落ちる (情報漏洩防止)
      expect(detail.workMenu).toBeNull();
      expect(detail.vehicle).toBeNull();
      expect(detail.customer).toBeNull();
      expect(detail.status).toBeNull();

      // 念のため: 別会社の store_id を指す reservation だったらどうなるか
      // (storeId は notNull なので companyB の store を指す reservation は理論上書ける)
      const [corruptStoreReservation] = await tx
        .insert(reservations)
        .values({
          companyId: companyA.id,
          storeId: storeB.id, // CORRUPT (companyB の store)
          laneId: laneA.id,
          startAt: new Date("2026-06-01T09:00:00Z"),
          endAt: new Date("2026-06-01T10:00:00Z"),
        })
        .returning({ id: reservations.id });
      const detail2 = await getReservationDetailViaServiceRole(
        corruptStoreReservation.id,
        { db: tx },
      );
      expect(detail2).not.toBeNull();
      if (!detail2) return;
      // store も cross-tenant filter で null に落ちる
      expect(detail2.store).toBeNull();
    });
  });
});
