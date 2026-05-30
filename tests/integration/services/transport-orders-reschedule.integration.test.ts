// Phase 64-C.4.2: rescheduleAndRenotifyTransportOrder (L3-4 希望日時変更して同業者へ再依頼)。
//
// 検証対象:
//   - rejected stall の order を同 vendor へ再オープン: requested 遷移 + requested_*_at 更新 +
//     新 invitation (同 vendor, upsert) + attempt_seq + change_log datetime_changed + outbox invitation.sent。
//   - rejected 以外 → RescheduleNotRejectedError。
//   - version mismatch → ConcurrentTransportOrderReassignError。
//   - 希望日時を 1 つも指定しないと Zod refine で reject。
//   - close 非再発火回帰。

import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { seedTransportStatuses } from "../../_helpers/seed-transport-statuses";
import { companies } from "@/lib/db/schema/companies";
import { notificationOutbox } from "@/lib/db/schema/notification_outbox";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { stores } from "@/lib/db/schema/stores";
import { transportOrderChangeLogs } from "@/lib/db/schema/transport_order_change_logs";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendorCompanyMemberships } from "@/lib/db/schema/vendor_company_memberships";
import { vendors } from "@/lib/db/schema/vendors";
import {
  ConcurrentTransportOrderReassignError,
  rescheduleAndRenotifyTransportOrder,
  RescheduleNotRejectedError,
} from "@/lib/services/transport-orders";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

type Db = NonNullable<typeof db>;
type TransactionCallback = Parameters<Db["transaction"]>[0];
type Tx = Parameters<TransactionCallback>[0];

interface Fixture {
  companyId: string;
  pickupStoreId: string;
  deliveryStoreId: string;
  vehicleId: string;
  serviceTicketId: string;
  vendorId: string;
  userId: string;
  statusIds: Awaited<ReturnType<typeof seedTransportStatuses>>;
}

function requireRow<T>(row: T | undefined, label: string): T {
  if (!row) throw new Error(`Expected ${label} row to be returned`);
  return row;
}

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

function serviceDb(outerTx: Tx): Db {
  return outerTx as unknown as Db;
}

async function seedFixture(outerTx: Tx): Promise<Fixture> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__resched_${suffix}__`, code: `rs_${suffix}` })
    .returning({ id: companies.id });
  const company = requireRow(companyRow, "company");

  const [pickupStoreRow, deliveryStoreRow] = await outerTx
    .insert(stores)
    .values([
      { companyId: company.id, code: `p_${suffix}`, name: "Pickup" },
      { companyId: company.id, code: `d_${suffix}`, name: "Delivery" },
    ])
    .returning({ id: stores.id });
  const pickupStore = requireRow(pickupStoreRow, "pickup store");
  const deliveryStore = requireRow(deliveryStoreRow, "delivery store");

  const [vehicleRow] = await outerTx
    .insert(vehicles)
    .values({ companyId: company.id, storeId: pickupStore.id, vin: `RS${suffix.toUpperCase()}000000` })
    .returning({ id: vehicles.id });
  const vehicle = requireRow(vehicleRow, "vehicle");

  const [serviceTicketRow] = await outerTx
    .insert(serviceTickets)
    .values({
      companyId: company.id,
      vehicleId: vehicle.id,
      storeId: pickupStore.id,
      ticketNo: `rs-${suffix}`,
      billingStatus: "unbilled",
    })
    .returning({ id: serviceTickets.id });
  const serviceTicket = requireRow(serviceTicketRow, "service ticket");

  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: company.id, name: `Vendor ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  const vendor = requireRow(vendorRow, "vendor");

  // users.id は auth.users(id) への非 deferrable FK ゆえ先に auth.users を seed する。
  const userResult = await outerTx.execute(sql`
    WITH auth_user AS (
      INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
      VALUES (gen_random_uuid(), 'authenticated', 'authenticated', ${`user-${suffix}@example.test`}, now(), now(), now())
      RETURNING id
    )
    INSERT INTO users (id, company_id, email, name, is_active)
    SELECT id, ${company.id}, ${`user-${suffix}@example.test`}, ${`User ${suffix}`}, true
    FROM auth_user
    RETURNING id
  `);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [userRow] = (userResult as any).rows ?? userResult;
  const user = requireRow(userRow as { id: string } | undefined, "user");

  await outerTx.insert(vendorCompanyMemberships).values({
    vendorId: vendor.id,
    companyId: company.id,
    isEnabled: true,
  });

  const statusIds = await seedTransportStatuses(outerTx, company.id);

  return {
    companyId: company.id,
    pickupStoreId: pickupStore.id,
    deliveryStoreId: deliveryStore.id,
    vehicleId: vehicle.id,
    serviceTicketId: serviceTicket.id,
    vendorId: vendor.id,
    userId: user.id,
    statusIds,
  };
}

async function seedOrder(
  outerTx: Tx,
  fixture: Fixture,
  statusId: string,
  requestedPickupAt: Date | null = null,
): Promise<string> {
  const [orderRow] = await outerTx
    .insert(transportOrders)
    .values({
      companyId: fixture.companyId,
      vendorId: fixture.vendorId,
      serviceTicketId: fixture.serviceTicketId,
      vehicleId: fixture.vehicleId,
      pickupStoreId: fixture.pickupStoreId,
      deliveryStoreId: fixture.deliveryStoreId,
      orderNumber: `TO-${crypto.randomUUID()}`,
      movementType: "one_way",
      canDrive: true,
      towRequired: false,
      statusId,
      requestedPickupAt,
    })
    .returning({ id: transportOrders.id });
  return requireRow(orderRow, "transport order").id;
}

async function seedRejectedOrder(
  outerTx: Tx,
  fixture: Fixture,
  requestedPickupAt: Date | null = null,
): Promise<string> {
  const orderId = await seedOrder(outerTx, fixture, fixture.statusIds.rejected, requestedPickupAt);
  await outerTx.insert(transportOrderInvitations).values({
    companyId: fixture.companyId,
    transportOrderId: orderId,
    vendorId: fixture.vendorId,
    response: "rejected",
    isWinningBid: false,
  });
  return orderId;
}

describeIntegration("rescheduleAndRenotifyTransportOrder", () => {
  it("reopens a rejected order to the same vendor with new requested datetime", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const oldPickup = new Date("2026-06-01T09:00:00.000Z");
      const newPickup = new Date("2026-06-05T14:00:00.000Z");
      const orderId = await seedRejectedOrder(outerTx, fixture, oldPickup);

      const result = await rescheduleAndRenotifyTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
        transportOrderId: orderId,
        expectedVersion: 1,
        requestedPickupAt: newPickup,
        reason: "顧客都合で日時変更",
      });

      expect(result.transportOrderId).toBe(orderId);
      expect(result.vendorId).toBe(fixture.vendorId);
      expect(result.newVersion).toBe(2);
      expect(result.attemptSeq).toBe(1);
      expect(result.idempotencyKey).toBe(`to:${orderId}:invite:${result.newInvitationId}`);

      // order: requested 再オープン + 同 vendor + requested_pickup_at 更新。
      const [order] = await outerTx.select().from(transportOrders).where(eq(transportOrders.id, orderId));
      expect(order?.statusId).toBe(fixture.statusIds.requested);
      expect(order?.vendorId).toBe(fixture.vendorId);
      expect(order?.vendorResponse).toBe("pending");
      expect(order?.requestedPickupAt?.toISOString()).toBe(newPickup.toISOString());

      // 同 vendor の invitation は upsert で pending (1 行のみ)。
      const invitations = await outerTx
        .select()
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.transportOrderId, orderId));
      expect(invitations).toHaveLength(1);
      expect(invitations[0]?.response).toBe("pending");
      expect(invitations[0]?.vendorId).toBe(fixture.vendorId);

      // change_log datetime_changed。
      const changeLogs = await outerTx
        .select()
        .from(transportOrderChangeLogs)
        .where(eq(transportOrderChangeLogs.transportOrderId, orderId));
      expect(changeLogs).toHaveLength(1);
      expect(changeLogs[0]?.changeType).toBe("datetime_changed");
      expect(changeLogs[0]?.requiresNotification).toBe(false);
      const afterJson = changeLogs[0]?.afterJson as Record<string, unknown> | null;
      expect(afterJson?.requested_pickup_at).toBe(newPickup.toISOString());

      // outbox invitation.sent → 同 vendor。
      const [outbox] = await outerTx
        .select()
        .from(notificationOutbox)
        .where(eq(notificationOutbox.id, result.notificationOutboxId));
      expect(outbox?.eventType).toBe("transport_order.invitation.sent");
      expect(outbox?.targetId).toBe(fixture.vendorId);
    });
  });

  it("throws RescheduleNotRejectedError when order is not in 'rejected' status", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const orderId = await seedOrder(outerTx, fixture, fixture.statusIds.requested);

      await expect(
        rescheduleAndRenotifyTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
          transportOrderId: orderId,
          expectedVersion: 1,
          requestedPickupAt: new Date("2026-06-05T14:00:00.000Z"),
        }),
      ).rejects.toBeInstanceOf(RescheduleNotRejectedError);
    });
  });

  it("throws ConcurrentTransportOrderReassignError on version mismatch", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const orderId = await seedRejectedOrder(outerTx, fixture);

      await expect(
        rescheduleAndRenotifyTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
          transportOrderId: orderId,
          expectedVersion: 999,
          requestedPickupAt: new Date("2026-06-05T14:00:00.000Z"),
        }),
      ).rejects.toBeInstanceOf(ConcurrentTransportOrderReassignError);
    });
  });

  it("rejects input with no requested_*_at provided (Zod refine)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const orderId = await seedRejectedOrder(outerTx, fixture);

      await expect(
        rescheduleAndRenotifyTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
          transportOrderId: orderId,
          expectedVersion: 1,
        }),
      ).rejects.toThrow();
    });
  });

  it("does not re-fire close_transport_order after reschedule (new pending invitation)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const orderId = await seedRejectedOrder(outerTx, fixture);

      await rescheduleAndRenotifyTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
        transportOrderId: orderId,
        expectedVersion: 1,
        requestedPickupAt: new Date("2026-06-05T14:00:00.000Z"),
      });

      const result = await outerTx.execute(sql`
        SELECT closed FROM public.close_transport_order(${orderId}::uuid)
      `);
      const rows = (result as unknown as { rows?: unknown }).rows ?? result;
      const row = (Array.isArray(rows) ? rows[0] : rows) as { closed?: boolean } | undefined;
      expect(row?.closed).toBe(false);
    });
  });
});
