import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { DB } from "@/lib/db/client";
import { companies } from "@/lib/db/schema/companies";
import { notificationOutbox } from "@/lib/db/schema/notification_outbox";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { statuses } from "@/lib/db/schema/statuses";
import { stores } from "@/lib/db/schema/stores";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendorCompanyMemberships } from "@/lib/db/schema/vendor_company_memberships";
import { vendors } from "@/lib/db/schema/vendors";
import { getTransportOrderDetail } from "@/lib/services/transport-orders";
import { seedTransportStatuses } from "../../_helpers/seed-transport-statuses";

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

interface DetailFixture {
  companyId: string;
  pickupStoreId: string;
  deliveryStoreId: string;
  returnStoreId: string;
  vehicleId: string;
  serviceTicketId: string;
  vendorId: string;
  statusIds: { requested: string; accepted: string; rejected: string };
}

function requireRow<T>(row: T | undefined, label: string): T {
  if (!row) throw new Error(`Expected ${label} row to be returned`);
  return row;
}

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

async function seedDetailFixture(
  outerTx: Tx,
  options: { companyLabel?: string } = {},
): Promise<DetailFixture> {
  const { companyLabel = "Company" } = options;
  const suffix = crypto.randomUUID().slice(0, 8);
  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__to_${companyLabel}_${suffix}__`, code: `to_${suffix}` })
    .returning({ id: companies.id });
  const company = requireRow(companyRow, "company");

  const [pickupStoreRow, deliveryStoreRow, returnStoreRow] = await outerTx
    .insert(stores)
    .values([
      { companyId: company.id, code: `p_${suffix}`, name: "引取店舗A" },
      { companyId: company.id, code: `d_${suffix}`, name: "納車店舗A" },
      { companyId: company.id, code: `r_${suffix}`, name: "返却店舗A" },
    ])
    .returning({ id: stores.id });
  const pickupStore = requireRow(pickupStoreRow, "pickup store");
  const deliveryStore = requireRow(deliveryStoreRow, "delivery store");
  const returnStore = requireRow(returnStoreRow, "return store");

  const [vehicleRow] = await outerTx
    .insert(vehicles)
    .values({
      companyId: company.id,
      storeId: pickupStore.id,
      vin: `PIT${suffix.toUpperCase()}000000`,
    })
    .returning({ id: vehicles.id });
  const vehicle = requireRow(vehicleRow, "vehicle");

  const [serviceTicketRow] = await outerTx
    .insert(serviceTickets)
    .values({
      companyId: company.id,
      vehicleId: vehicle.id,
      storeId: pickupStore.id,
      ticketNo: `to-${suffix}`,
      billingStatus: "unbilled",
    })
    .returning({ id: serviceTickets.id });
  const serviceTicket = requireRow(serviceTicketRow, "service ticket");

  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: company.id, name: `Vendor ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  const vendor = requireRow(vendorRow, "vendor");

  await outerTx.insert(vendorCompanyMemberships).values({
    vendorId: vendor.id,
    companyId: company.id,
    isEnabled: true,
  });

  const statusIds = await seedTransportStatuses(outerTx, company.id);
  const [requestedStatusRow] = await outerTx
    .select({ id: statuses.id })
    .from(statuses)
    .where(eq(statuses.id, statusIds.requested))
    .limit(1);
  requireRow(requestedStatusRow, "requested status");

  return {
    companyId: company.id,
    pickupStoreId: pickupStore.id,
    deliveryStoreId: deliveryStore.id,
    returnStoreId: returnStore.id,
    vehicleId: vehicle.id,
    serviceTicketId: serviceTicket.id,
    vendorId: vendor.id,
    statusIds,
  };
}

async function seedTransportOrder(outerTx: Tx, fixture: DetailFixture): Promise<string> {
  const [transportOrderRow] = await outerTx
    .insert(transportOrders)
    .values({
      companyId: fixture.companyId,
      vendorId: fixture.vendorId,
      serviceTicketId: fixture.serviceTicketId,
      vehicleId: fixture.vehicleId,
      pickupStoreId: fixture.pickupStoreId,
      deliveryStoreId: fixture.deliveryStoreId,
      returnStoreId: fixture.returnStoreId,
      orderNumber: `TO-${crypto.randomUUID()}`,
      movementType: "one_way",
      canDrive: true,
      towRequired: false,
      statusId: fixture.statusIds.requested,
    })
    .returning({ id: transportOrders.id });
  const transportOrder = requireRow(transportOrderRow, "transport order");

  return transportOrder.id;
}

function serviceDb(outerTx: Tx): DB {
  return outerTx as unknown as DB;
}

describeIntegration("getTransportOrderDetail", () => {
  it("returns detail data with invitations and notifications", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedDetailFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);
      const [transportOrder] = await outerTx
        .select({
          orderNumber: transportOrders.orderNumber,
          movementType: transportOrders.movementType,
          canDrive: transportOrders.canDrive,
          towRequired: transportOrders.towRequired,
        })
        .from(transportOrders)
        .where(eq(transportOrders.id, transportOrderId))
        .limit(1);
      const transportOrderRow = requireRow(transportOrder, "transport order detail seed");

      const [registeredInvitationRow] = await outerTx
        .insert(transportOrderInvitations)
        .values({
          companyId: fixture.companyId,
          transportOrderId,
          vendorId: fixture.vendorId,
          inviteeEmail: null,
          response: "pending",
          isWinningBid: false,
        })
        .returning({ id: transportOrderInvitations.id });
      const registeredInvitation = requireRow(registeredInvitationRow, "registered invitation");

      await outerTx.insert(transportOrderInvitations).values({
        companyId: fixture.companyId,
        transportOrderId,
        vendorId: null,
        inviteeEmail: "spot@example.test",
        inviteeName: "Spot Inc",
        response: "accepted",
        isWinningBid: true,
      });

      const olderCreatedAt = new Date("2026-01-01T00:00:00.000Z");
      const newerCreatedAt = new Date("2026-01-02T00:00:00.000Z");
      const [orderOutboxRow] = await outerTx
        .insert(notificationOutbox)
        .values({
          companyId: fixture.companyId,
          transportOrderId,
          transportOrderInvitationId: null,
          idempotencyKey: `detail-order-${crypto.randomUUID()}`,
          eventType: "transport_order_created",
          targetType: "vendor",
          targetId: fixture.vendorId,
          payload: {},
          status: "pending",
          attempts: 0,
          maxAttempts: 5,
          createdAt: olderCreatedAt,
        })
        .returning({ id: notificationOutbox.id });
      const orderOutbox = requireRow(orderOutboxRow, "order notification outbox");

      const [invitationOutboxRow] = await outerTx
        .insert(notificationOutbox)
        .values({
          companyId: fixture.companyId,
          transportOrderId: null,
          transportOrderInvitationId: registeredInvitation.id,
          idempotencyKey: `detail-invitation-${crypto.randomUUID()}`,
          eventType: "transport_order_invitation_created",
          targetType: "vendor",
          targetId: fixture.vendorId,
          payload: {},
          status: "sent",
          attempts: 1,
          maxAttempts: 5,
          createdAt: newerCreatedAt,
        })
        .returning({ id: notificationOutbox.id });
      const invitationOutbox = requireRow(invitationOutboxRow, "invitation notification outbox");

      const detail = await getTransportOrderDetail(
        serviceDb(outerTx),
        fixture.companyId,
        transportOrderId,
      );

      expect(detail).not.toBeNull();
      if (!detail) throw new Error("Expected transport order detail");
      expect(detail.transportOrderId).toBe(transportOrderId);
      expect(detail.orderNumber).toBe(transportOrderRow.orderNumber);
      expect(detail.movementType).toBe(transportOrderRow.movementType);
      expect(detail.canDrive).toBe(transportOrderRow.canDrive);
      expect(detail.towRequired).toBe(transportOrderRow.towRequired);
      expect(detail.pickupStoreName).toBe("引取店舗A");
      expect(detail.deliveryStoreName).toBe("納車店舗A");
      expect(detail.returnStoreName).toBe("返却店舗A");
      expect(detail.invitations).toHaveLength(2);
      expect(detail.invitations[0]?.vendorId).toBeNull();
      expect(detail.invitations[0]?.inviteeName).toBe("Spot Inc");
      expect(detail.invitations[0]?.response).toBe("accepted");
      expect(detail.invitations[0]?.isWinningBid).toBe(true);
      expect(detail.invitations[1]?.vendorId).toBe(fixture.vendorId);
      expect(detail.invitations[1]?.response).toBe("pending");
      expect(detail.notifications).toHaveLength(2);
      expect(detail.notifications.map((notification) => notification.outboxId)).toEqual([
        invitationOutbox.id,
        orderOutbox.id,
      ]);
      expect(detail.notifications[0]?.createdAt.getTime()).toBeGreaterThanOrEqual(
        detail.notifications[1]?.createdAt.getTime() ?? 0,
      );
    });
  });

  it("returns null for cross-tenant access", async () => {
    await withRollback(async (outerTx) => {
      const companyA = await seedDetailFixture(outerTx, { companyLabel: "A" });
      const companyB = await seedDetailFixture(outerTx, { companyLabel: "B" });
      const transportOrderId = await seedTransportOrder(outerTx, companyA);

      const detail = await getTransportOrderDetail(
        serviceDb(outerTx),
        companyB.companyId,
        transportOrderId,
      );

      expect(detail).toBeNull();
    });
  });

  it("returns null for a non-existent id", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedDetailFixture(outerTx);

      const detail = await getTransportOrderDetail(
        serviceDb(outerTx),
        fixture.companyId,
        crypto.randomUUID(),
      );

      expect(detail).toBeNull();
    });
  });

  it("returns empty invitations and notifications arrays", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedDetailFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);

      const detail = await getTransportOrderDetail(
        serviceDb(outerTx),
        fixture.companyId,
        transportOrderId,
      );

      expect(detail).not.toBeNull();
      if (!detail) throw new Error("Expected transport order detail");
      expect(detail.invitations).toEqual([]);
      expect(detail.notifications).toEqual([]);
    });
  });

  it("returns null for a soft-deleted transport order", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedDetailFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);

      await outerTx
        .update(transportOrders)
        .set({ deletedAt: new Date() })
        .where(eq(transportOrders.id, transportOrderId));

      const detail = await getTransportOrderDetail(
        serviceDb(outerTx),
        fixture.companyId,
        transportOrderId,
      );

      expect(detail).toBeNull();
    });
  });
});
