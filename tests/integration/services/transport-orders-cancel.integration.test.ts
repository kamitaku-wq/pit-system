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
import { statuses } from "@/lib/db/schema/statuses";
import { stores } from "@/lib/db/schema/stores";
import { users } from "@/lib/db/schema/users";
import { transportOrderChangeLogs } from "@/lib/db/schema/transport_order_change_logs";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrderStatusHistory } from "@/lib/db/schema/transport_order_status_history";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendorCompanyMemberships } from "@/lib/db/schema/vendor_company_memberships";
import { vendors } from "@/lib/db/schema/vendors";
import {
  AlreadyCancelledError,
  cancelTransportOrder,
  CancelStatusSeedMissingError,
  ConcurrentTransportOrderCancelError,
  respondToTransportOrder,
  StatusTransitionError,
  TerminalStatusCancelError,
  TransportOrderNotFoundError,
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
  statusIds: { requested: string; accepted: string; rejected: string; cancelled: string };
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

async function seedFixture(outerTx: Tx, options: { companyLabel?: string; seedStatuses?: boolean } = {}): Promise<Fixture> {
  const { companyLabel = "Company", seedStatuses = true } = options;
  const suffix = crypto.randomUUID().slice(0, 8);
  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__to_${companyLabel}_${suffix}__`, code: `to_${suffix}` })
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
    .values({ companyId: company.id, storeId: pickupStore.id, vin: `PIT${suffix.toUpperCase()}000000` })
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

  const [userRow] = await outerTx
    .insert(users)
    .values({
      id: crypto.randomUUID(),
      companyId: company.id,
      email: `user-${suffix}@example.test`,
      name: `User ${suffix}`,
      isActive: true,
    })
    .returning({ id: users.id });
  const user = requireRow(userRow, "user");

  await outerTx.insert(vendorCompanyMemberships).values({
    vendorId: vendor.id,
    companyId: company.id,
    isEnabled: true,
  });

  const statusIds = seedStatuses
    ? await seedTransportStatuses(outerTx, company.id)
    : (() => {
        throw new Error("seedStatuses=false is not supported by seedFixture");
      })();

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

async function seedTransportOrder(outerTx: Tx, fixture: Fixture, statusId = fixture.statusIds.requested): Promise<string> {
  const [transportOrderRow] = await outerTx
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
    })
    .returning({ id: transportOrders.id });
  return requireRow(transportOrderRow, "transport order").id;
}

async function seedInvitation(outerTx: Tx, fixture: Fixture, transportOrderId: string, response: "pending" | "accepted" = "pending") {
  const [invitationRow] = await outerTx
    .insert(transportOrderInvitations)
    .values({
      companyId: fixture.companyId,
      transportOrderId,
      vendorId: fixture.vendorId,
      response,
      isWinningBid: false,
    })
    .returning({ id: transportOrderInvitations.id });
  return requireRow(invitationRow, "transport order invitation").id;
}

function serviceDb(outerTx: Tx): Db {
  return outerTx as unknown as Db;
}

describeIntegration("cancelTransportOrder", () => {
  it("cancels a pending transport order and revokes its invitation", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);
      const invitationId = await seedInvitation(outerTx, fixture, transportOrderId, "pending");

      const result = await cancelTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
        transportOrderId,
        expectedVersion: 1,
        reason: "customer request",
      });

      expect(result.transportOrderId).toBe(transportOrderId);
      expect(result.newVersion).toBe(2);
      expect(result.cancelledAt).toBeInstanceOf(Date);
      expect(result.revokedInvitationIds).toHaveLength(1);
      expect(result.revokedInvitationIds[0]).toBe(invitationId);
      expect(result.notificationOutboxId).toBeTruthy();
      expect(result.idempotencyKey).toBe(`to:${transportOrderId}:cancelled:v2`);

      const [order] = await outerTx.select().from(transportOrders).where(eq(transportOrders.id, transportOrderId)).limit(1);
      const [invitation] = await outerTx
        .select()
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.id, invitationId))
        .limit(1);
      const [history] = await outerTx
        .select()
        .from(transportOrderStatusHistory)
        .where(eq(transportOrderStatusHistory.transportOrderId, transportOrderId))
        .orderBy(transportOrderStatusHistory.changedAt);
      const [outbox] = await outerTx.select().from(notificationOutbox).where(eq(notificationOutbox.id, result.notificationOutboxId)).limit(1);

      expect(order?.statusId).toBe(fixture.statusIds.cancelled);
      expect(order?.cancelledAt).toBeInstanceOf(Date);
      expect(order?.version).toBe(2);
      expect(invitation?.response).toBe("revoked");
      expect(invitation?.respondedAt).toBeInstanceOf(Date);
      expect(history?.toStatusId).toBe(fixture.statusIds.cancelled);
      expect(history?.reason).toBe("customer request");
      expect(outbox?.eventType).toBe("transport_order.cancelled");
      expect(outbox?.targetType).toBe("vendor");
      expect(outbox?.targetId).toBe(fixture.vendorId);
      expect((outbox?.payload as { revokedInvitations?: Array<{ invitationId: string }> })?.revokedInvitations).toHaveLength(1);
      const changeLogs = await outerTx
        .select()
        .from(transportOrderChangeLogs)
        .where(eq(transportOrderChangeLogs.transportOrderId, transportOrderId));
      expect(changeLogs).toHaveLength(1);
      const changeLog = changeLogs[0];
      expect(changeLog?.companyId).toBe(fixture.companyId);
      expect(changeLog?.changeType).toBe("cancelled");
      expect(changeLog?.changedByUserId).toBe(fixture.userId);
      expect(changeLog?.requiresNotification).toBe(false);
      expect(changeLog?.notifiedAt).toBeNull();
      const beforeJson = changeLog?.beforeJson as Record<string, unknown> | null;
      const afterJson = changeLog?.afterJson as Record<string, unknown> | null;
      expect(beforeJson?.status_id).toBe(fixture.statusIds.requested);
      expect(beforeJson?.status_key).toBe("requested");
      expect(beforeJson?.version).toBe(1);
      expect(beforeJson?.vendor_id).toBe(fixture.vendorId);
      expect(beforeJson?.cancelled_at).toBeNull();
      expect(afterJson?.status_id).toBe(fixture.statusIds.cancelled);
      expect(afterJson?.status_key).toBe("cancelled");
      expect(afterJson?.version).toBe(2);
      expect(afterJson?.vendor_id).toBe(fixture.vendorId);
      expect(typeof afterJson?.cancelled_at).toBe("string");
      // reason は snapshot から除去 (status_history + outbox payload に既存)
      expect(beforeJson).not.toHaveProperty("reason");
      expect(afterJson).not.toHaveProperty("reason");
    });
  });

  it("throws ConcurrentTransportOrderCancelError for a version conflict", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);

      await expect(
        cancelTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
          transportOrderId,
          expectedVersion: 999,
          reason: "stale",
        }),
      ).rejects.toBeInstanceOf(ConcurrentTransportOrderCancelError);

      const [order] = await outerTx.select().from(transportOrders).where(eq(transportOrders.id, transportOrderId)).limit(1);
      expect(order?.statusId).toBe(fixture.statusIds.requested);
      expect(order?.version).toBe(1);
      const changeLogs = await outerTx
        .select()
        .from(transportOrderChangeLogs)
        .where(eq(transportOrderChangeLogs.transportOrderId, transportOrderId));
      expect(changeLogs).toHaveLength(0);
    });
  });

  it("throws AlreadyCancelledError when cancelling twice", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);

      await cancelTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
        transportOrderId,
        expectedVersion: 1,
        reason: "first cancel",
      });

      await expect(
        cancelTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
          transportOrderId,
          expectedVersion: 2,
          reason: "second cancel",
        }),
      ).rejects.toBeInstanceOf(AlreadyCancelledError);
      const changeLogs = await outerTx
        .select()
        .from(transportOrderChangeLogs)
        .where(eq(transportOrderChangeLogs.transportOrderId, transportOrderId));
      expect(changeLogs).toHaveLength(1);
      expect(changeLogs[0]?.changeType).toBe("cancelled");
    });
  });

  it("throws TerminalStatusCancelError for a terminal non-cancelled status", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const [terminalStatusRow] = await outerTx
        .insert(statuses)
        .values({
          companyId: fixture.companyId,
          statusType: "transport",
          key: `terminal_${crypto.randomUUID().slice(0, 8)}`,
          name: "Terminal",
          displayOrder: 999,
          isTerminal: true,
          isActive: true,
        })
        .returning({ id: statuses.id });
      const terminalStatus = requireRow(terminalStatusRow, "terminal status");
      const transportOrderId = await seedTransportOrder(outerTx, fixture, terminalStatus.id);

      await expect(
        cancelTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
          transportOrderId,
          expectedVersion: 1,
          reason: "terminal",
        }),
      ).rejects.toBeInstanceOf(TerminalStatusCancelError);
      const changeLogs = await outerTx
        .select()
        .from(transportOrderChangeLogs)
        .where(eq(transportOrderChangeLogs.transportOrderId, transportOrderId));
      expect(changeLogs).toHaveLength(0);
    });
  });

  it("throws TransportOrderNotFoundError for a cross-tenant cancel", async () => {
    await withRollback(async (outerTx) => {
      const fixtureA = await seedFixture(outerTx, { companyLabel: "A" });
      const fixtureB = await seedFixture(outerTx, { companyLabel: "B" });
      const transportOrderId = await seedTransportOrder(outerTx, fixtureA);

      await expect(
        cancelTransportOrder(serviceDb(outerTx), fixtureB.companyId, fixtureB.userId, {
          transportOrderId,
          expectedVersion: 1,
          reason: "cross tenant",
        }),
      ).rejects.toBeInstanceOf(TransportOrderNotFoundError);
      const changeLogs = await outerTx
        .select()
        .from(transportOrderChangeLogs)
        .where(eq(transportOrderChangeLogs.transportOrderId, transportOrderId));
      expect(changeLogs).toHaveLength(0);
    });
  });

  it("throws TransportOrderNotFoundError for a soft-deleted transport order", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);
      await outerTx.update(transportOrders).set({ deletedAt: new Date() }).where(eq(transportOrders.id, transportOrderId));

      await expect(
        cancelTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
          transportOrderId,
          expectedVersion: 1,
          reason: "deleted",
        }),
      ).rejects.toBeInstanceOf(TransportOrderNotFoundError);
      const changeLogs = await outerTx
        .select()
        .from(transportOrderChangeLogs)
        .where(eq(transportOrderChangeLogs.transportOrderId, transportOrderId));
      expect(changeLogs).toHaveLength(0);
    });
  });

  it("throws CancelStatusSeedMissingError when cancelled status is not seeded", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await outerTx.delete(statuses).where(eq(statuses.id, fixture.statusIds.cancelled));
      const transportOrderId = await seedTransportOrder(outerTx, fixture);

      await expect(
        cancelTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
          transportOrderId,
          expectedVersion: 1,
          reason: "missing seed",
        }),
      ).rejects.toBeInstanceOf(CancelStatusSeedMissingError);
      const changeLogs = await outerTx
        .select()
        .from(transportOrderChangeLogs)
        .where(eq(transportOrderChangeLogs.transportOrderId, transportOrderId));
      expect(changeLogs).toHaveLength(0);
    });
  });

  it("cancels an order without invitations", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);

      const result = await cancelTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
        transportOrderId,
        expectedVersion: 1,
        reason: "no invites",
      });

      expect(result.revokedInvitationIds).toEqual([]);
      const [outbox] = await outerTx.select().from(notificationOutbox).where(eq(notificationOutbox.id, result.notificationOutboxId)).limit(1);
      expect((outbox?.payload as { revokedInvitations?: unknown[] })?.revokedInvitations).toEqual([]);
    });
  });

  it("revokes accepted invitations during cancel", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);
      const invitationId = await seedInvitation(outerTx, fixture, transportOrderId, "accepted");

      const result = await cancelTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
        transportOrderId,
        expectedVersion: 1,
        reason: "accept race",
      });

      const [invitation] = await outerTx
        .select()
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.id, invitationId))
        .limit(1);
      const [outbox] = await outerTx.select().from(notificationOutbox).where(eq(notificationOutbox.id, result.notificationOutboxId)).limit(1);

      expect(invitation?.response).toBe("revoked");
      expect(invitation?.respondedAt).toBeInstanceOf(Date);
      expect((outbox?.payload as { revokedInvitations?: Array<{ invitationId: string; responseBefore: string }> })?.revokedInvitations?.[0]?.responseBefore).toBe("accepted");
    });
  });

  it("appends a status history row on cancel", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);

      const result = await cancelTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
        transportOrderId,
        expectedVersion: 1,
        reason: "history check",
      });

      const histories = await outerTx
        .select()
        .from(transportOrderStatusHistory)
        .where(eq(transportOrderStatusHistory.transportOrderId, transportOrderId));
      expect(histories).toHaveLength(2);
      const cancelHistory = histories.find((history) => history.toStatusId === fixture.statusIds.cancelled);
      expect(cancelHistory?.fromStatusId).toBe(fixture.statusIds.requested);
      expect(cancelHistory?.changedByUserId).toBe(fixture.userId);
      expect(cancelHistory?.reason).toBe("history check");
      expect(result.newVersion).toBe(2);
    });
  });

  it("handles two concurrent cancels with one success and one rejection", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);
      const [r1, r2] = await Promise.allSettled([
        cancelTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
          transportOrderId,
          expectedVersion: 1,
          reason: "concurrent A",
        }),
        cancelTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
          transportOrderId,
          expectedVersion: 1,
          reason: "concurrent B",
        }),
      ]);

      expect([r1.status, r2.status].filter((status) => status === "fulfilled")).toHaveLength(1);
      expect([r1.status, r2.status].filter((status) => status === "rejected")).toHaveLength(1);
    });
  }, 5000);
});

describeIntegration("respondToTransportOrder cancel guard", () => {
  it("throws StatusTransitionError after cancel", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);
      const invitationId = await seedInvitation(outerTx, fixture, transportOrderId, "pending");

      await cancelTransportOrder(serviceDb(outerTx), fixture.companyId, fixture.userId, {
        transportOrderId,
        expectedVersion: 1,
        reason: "guard",
      });

      await expect(
        respondToTransportOrder(serviceDb(outerTx), {
          invitationId,
          response: "accepted",
        }),
      ).rejects.toThrow(StatusTransitionError);
      await expect(
        respondToTransportOrder(serviceDb(outerTx), {
          invitationId,
          response: "accepted",
        }),
      ).rejects.toThrow(/cancelled/i);
    });
  });
});
