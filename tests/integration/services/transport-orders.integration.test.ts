import { config } from "dotenv";
import { count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { notificationOutbox } from "@/lib/db/schema/notification_outbox";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { statuses } from "@/lib/db/schema/statuses";
import { statusTransitions } from "@/lib/db/schema/status_transitions";
import { stores } from "@/lib/db/schema/stores";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrderStatusHistory } from "@/lib/db/schema/transport_order_status_history";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendorCompanyMemberships } from "@/lib/db/schema/vendor_company_memberships";
import { vendors } from "@/lib/db/schema/vendors";
import {
  createTransportOrderWithNotification,
  StatusSeedMissingError,
  VendorMembershipError,
} from "@/lib/services/transport-orders";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

// Drizzle does not export a stable transaction interface for nested postgres-js transactions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

interface Fixture {
  companyId: string;
  pickupStoreId: string;
  deliveryStoreId: string;
  vehicleId: string;
  serviceTicketId: string;
  vendorId: string;
  statusIds: { requested: string; accepted: string; rejected: string } | null;
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

async function seedBaseFixture(
  // Test-only helper accepts Drizzle outer transaction/savepoint objects.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  outerTx: any,
  options: {
    seedStatuses?: boolean;
    seedMembership?: boolean;
    membershipEnabled?: boolean;
    companyLabel?: string;
  } = {},
): Promise<Fixture> {
  const {
    seedStatuses = true,
    seedMembership = true,
    membershipEnabled = true,
    companyLabel = "Company",
  } = options;
  const suffix = crypto.randomUUID().slice(0, 8);
  const [company] = await outerTx
    .insert(companies)
    .values({ name: `__to_${companyLabel}_${suffix}__`, code: `to_${suffix}` })
    .returning({ id: companies.id });
  const [pickupStore, deliveryStore] = await outerTx
    .insert(stores)
    .values([
      { companyId: company.id, code: `p_${suffix}`, name: "Pickup" },
      { companyId: company.id, code: `d_${suffix}`, name: "Delivery" },
    ])
    .returning({ id: stores.id });
  const [vehicle] = await outerTx
    .insert(vehicles)
    .values({ companyId: company.id, storeId: pickupStore.id, vin: "PITTESTVIN0000001" })
    .returning({ id: vehicles.id });
  const [serviceTicket] = await outerTx
    .insert(serviceTickets)
    .values({
      companyId: company.id,
      vehicleId: vehicle.id,
      storeId: pickupStore.id,
      ticketNo: `to-${suffix}`,
      billingStatus: "unbilled",
    })
    .returning({ id: serviceTickets.id });
  const [vendor] = await outerTx
    .insert(vendors)
    .values({ companyId: company.id, name: `Vendor ${suffix}`, isActive: true })
    .returning({ id: vendors.id });

  if (seedMembership) {
    await outerTx.insert(vendorCompanyMemberships).values({
      vendorId: vendor.id,
      companyId: company.id,
      isEnabled: membershipEnabled,
    });
  }

  let statusIds: Fixture["statusIds"] = null;
  if (seedStatuses) {
    const rows = await outerTx
      .insert(statuses)
      .values([
        {
          companyId: company.id,
          statusType: "transport",
          key: "requested",
          name: "Requested",
          displayOrder: 1,
          isInitial: true,
          isActive: true,
        },
        {
          companyId: company.id,
          statusType: "transport",
          key: "accepted",
          name: "Accepted",
          displayOrder: 2,
          isActive: true,
        },
        {
          companyId: company.id,
          statusType: "transport",
          key: "rejected",
          name: "Rejected",
          displayOrder: 3,
          isTerminal: true,
          isActive: true,
        },
      ])
      .returning({ id: statuses.id, key: statuses.key });
    statusIds = Object.fromEntries(
      rows.map((row: { key: string; id: string }) => [row.key, row.id]),
    ) as Fixture["statusIds"];
    await outerTx.insert(statusTransitions).values([
      {
        companyId: company.id,
        statusType: "transport",
        fromStatusId: statusIds!.requested,
        toStatusId: statusIds!.accepted,
      },
      {
        companyId: company.id,
        statusType: "transport",
        fromStatusId: statusIds!.requested,
        toStatusId: statusIds!.rejected,
      },
    ]);
  }

  return {
    companyId: company.id,
    pickupStoreId: pickupStore.id,
    deliveryStoreId: deliveryStore.id,
    vehicleId: vehicle.id,
    serviceTicketId: serviceTicket.id,
    vendorId: vendor.id,
    statusIds,
  };
}

function inputFor(fixture: Fixture, orderNumber = `TO-${crypto.randomUUID()}`) {
  return {
    companyId: fixture.companyId,
    vendorId: fixture.vendorId,
    serviceTicketId: fixture.serviceTicketId,
    vehicleId: fixture.vehicleId,
    orderNumber,
    movementType: "one_way" as const,
    pickupStoreId: fixture.pickupStoreId,
    deliveryStoreId: fixture.deliveryStoreId,
  };
}

describeIntegration("createTransportOrderWithNotification", () => {
  it("creates transport order, history, invitation, and notification outbox", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const result = await createTransportOrderWithNotification(outerTx, inputFor(fixture));
      expect(Object.values(result).every(Boolean)).toBe(true);
      expect(result.initialStatusId).toBe(fixture.statusIds!.requested);

      const [orders] = await outerTx
        .select({ value: count() })
        .from(transportOrders)
        .where(eq(transportOrders.companyId, fixture.companyId));
      const [historyCount] = await outerTx
        .select({ value: count() })
        .from(transportOrderStatusHistory)
        .where(eq(transportOrderStatusHistory.companyId, fixture.companyId));
      const [invitations] = await outerTx
        .select({ value: count() })
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.companyId, fixture.companyId));
      const [outboxCount] = await outerTx
        .select({ value: count() })
        .from(notificationOutbox)
        .where(eq(notificationOutbox.companyId, fixture.companyId));
      const [history] = await outerTx
        .select()
        .from(transportOrderStatusHistory)
        .where(eq(transportOrderStatusHistory.transportOrderId, result.transportOrderId));
      const [outbox] = await outerTx
        .select()
        .from(notificationOutbox)
        .where(eq(notificationOutbox.id, result.outboxId));
      expect([orders.value, historyCount.value, invitations.value, outboxCount.value]).toEqual([1, 1, 1, 1]);
      expect(history.fromStatusId).toBeNull();
      expect(history.toStatusId).toBe(result.initialStatusId);
      expect(history.reason).toBe("initial");
      expect(outbox.eventType).toBe("transport_order.invitation.sent");
      expect(outbox.targetType).toBe("vendor");
      expect(outbox.targetId).toBe(fixture.vendorId);
      expect(outbox.idempotencyKey).toMatch(/^to:.+:invite:.+$/);
    });
  });

  it("throws StatusSeedMissingError and creates no transport order when statuses are absent", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx, { seedStatuses: false });
      await expect(
        createTransportOrderWithNotification(outerTx, inputFor(fixture)),
      ).rejects.toBeInstanceOf(StatusSeedMissingError);
      const [orders] = await outerTx
        .select({ value: count() })
        .from(transportOrders)
        .where(eq(transportOrders.companyId, fixture.companyId));
      expect(orders.value).toBe(0);
    });
  });

  it("throws VendorMembershipError and creates no transport order without membership", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx, { seedMembership: false });
      await expect(
        createTransportOrderWithNotification(outerTx, inputFor(fixture)),
      ).rejects.toBeInstanceOf(VendorMembershipError);
      const [orders] = await outerTx
        .select({ value: count() })
        .from(transportOrders)
        .where(eq(transportOrders.companyId, fixture.companyId));
      expect(orders.value).toBe(0);
    });
  });

  it("throws VendorMembershipError when membership is disabled", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx, { membershipEnabled: false });
      await expect(
        createTransportOrderWithNotification(outerTx, inputFor(fixture)),
      ).rejects.toBeInstanceOf(VendorMembershipError);
    });
  });

  it("throws VendorMembershipError when company B uses company A vendor", async () => {
    await withRollback(async (outerTx) => {
      const companyA = await seedBaseFixture(outerTx, { companyLabel: "CompanyA" });
      const companyB = await seedBaseFixture(outerTx, { companyLabel: "CompanyB", seedMembership: false });
      await expect(
        createTransportOrderWithNotification(outerTx, { ...inputFor(companyB), vendorId: companyA.vendorId }),
      ).rejects.toBeInstanceOf(VendorMembershipError);
    });
  });

  it("throws a unique error for duplicate order numbers", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const orderNumber = `TO-DUP-${crypto.randomUUID()}`;
      await createTransportOrderWithNotification(outerTx, inputFor(fixture, orderNumber));
      await expect(
        createTransportOrderWithNotification(outerTx, inputFor(fixture, orderNumber)),
      ).rejects.toThrow(/unique|duplicate|transport_orders_company_order_number_unique/i);
    });
  });
});
