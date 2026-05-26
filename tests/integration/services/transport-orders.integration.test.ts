import { config } from "dotenv";
import { count, eq, sql } from "drizzle-orm";
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
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrderStatusHistory } from "@/lib/db/schema/transport_order_status_history";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendorCompanyMemberships } from "@/lib/db/schema/vendor_company_memberships";
import { vendorUsers } from "@/lib/db/schema/vendor_users";
import { vendors } from "@/lib/db/schema/vendors";
import {
  ConcurrentTransportOrderResponseError,
  createTransportOrderWithNotification,
  getAdminDashboardMetrics,
  InvalidResponseValueError,
  InvitationNotPendingError,
  listTransportOrdersWithLatestInvitation,
  respondToTransportOrder,
  StatusSeedMissingError,
  StatusTransitionError,
  VendorAuthError,
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
    statusIds = await seedTransportStatuses(outerTx, company.id);
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

async function seedVendorUser(
  outerTx: Tx,
  fixture: Pick<Fixture, "companyId" | "vendorId">,
  options: { isActive?: boolean; emailLabel?: string } = {},
): Promise<{ vendorUserId: string; authUserId: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const authUserId = crypto.randomUUID();
  const [vendorUser] = await outerTx
    .insert(vendorUsers)
    .values({
      authUserId,
      companyId: fixture.companyId,
      vendorId: fixture.vendorId,
      email: `${options.emailLabel ?? "vendor"}-${suffix}@example.test`,
      name: `Vendor User ${suffix}`,
      isActive: options.isActive ?? true,
    })
    .returning({ id: vendorUsers.id });

  return { vendorUserId: vendorUser.id, authUserId };
}

async function seedAdditionalVendor(
  outerTx: Tx,
  companyId: string,
  nameLabel: string,
): Promise<{ vendorId: string; vendorUserId: string; authUserId: string }> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [vendor] = await outerTx
    .insert(vendors)
    .values({ companyId, name: `${nameLabel} ${suffix}`, isActive: true })
    .returning({ id: vendors.id });

  await outerTx.insert(vendorCompanyMemberships).values({
    vendorId: vendor.id,
    companyId,
    isEnabled: true,
  });

  const vendorUser = await seedVendorUser(
    outerTx,
    { companyId, vendorId: vendor.id },
    { emailLabel: nameLabel.toLowerCase() },
  );

  return { vendorId: vendor.id, ...vendorUser };
}

async function setAuthUid(outerTx: Tx, authUserId: string): Promise<void> {
  await outerTx.execute(sql`
    SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: authUserId })}, true)
  `);
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

describeIntegration("respondToTransportOrder", () => {
  it("accepts a single pending invitation and records accepted status history", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const vendorUser = await seedVendorUser(outerTx, fixture);
      await setAuthUid(outerTx, vendorUser.authUserId);

      const created = await createTransportOrderWithNotification(outerTx, inputFor(fixture));
      const [beforeOrder] = await outerTx
        .select()
        .from(transportOrders)
        .where(eq(transportOrders.id, created.transportOrderId));

      const result = await respondToTransportOrder(outerTx, {
        invitationId: created.invitationId,
        response: "accepted",
      });

      const [invitation] = await outerTx
        .select()
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.id, created.invitationId));
      const [order] = await outerTx
        .select()
        .from(transportOrders)
        .where(eq(transportOrders.id, created.transportOrderId));
      const histories = await outerTx
        .select()
        .from(transportOrderStatusHistory)
        .where(eq(transportOrderStatusHistory.transportOrderId, created.transportOrderId));
      const acceptHistory = histories.find((history: (typeof histories)[number]) => history.reason === "vendor_accept");

      expect(result.transportOrderId).toBe(created.transportOrderId);
      expect(result.invitationId).toBe(created.invitationId);
      expect(result.version).toBe(beforeOrder.version + 1);
      expect(result.newStatusId).toBe(fixture.statusIds!.accepted);
      expect(result.historyId).not.toBeNull();
      expect(invitation.response).toBe("accepted");
      expect(invitation.isWinningBid).toBe(true);
      expect(invitation.boundVendorId).toBe(fixture.vendorId);
      expect(invitation.boundVendorUserId).toBe(vendorUser.vendorUserId);
      expect(order.statusId).toBe(fixture.statusIds!.accepted);
      expect(order.vendorId).toBe(fixture.vendorId);
      expect(order.version).toBe(beforeOrder.version + 1);
      expect(histories).toHaveLength(2);
      expect(acceptHistory?.id).toBe(result.historyId);
      expect(acceptHistory?.fromStatusId).toBe(fixture.statusIds!.requested);
      expect(acceptHistory?.toStatusId).toBe(fixture.statusIds!.accepted);
      expect(acceptHistory?.changedByUserId).toBeNull();
      expect(acceptHistory?.reason).toBe("vendor_accept");
    });
  });

  it("rejects a single pending invitation without changing transport order status", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const vendorUser = await seedVendorUser(outerTx, fixture);
      await setAuthUid(outerTx, vendorUser.authUserId);

      const created = await createTransportOrderWithNotification(outerTx, inputFor(fixture));
      const [beforeOrder] = await outerTx
        .select()
        .from(transportOrders)
        .where(eq(transportOrders.id, created.transportOrderId));

      const result = await respondToTransportOrder(outerTx, {
        invitationId: created.invitationId,
        response: "rejected",
      });

      const [invitation] = await outerTx
        .select()
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.id, created.invitationId));
      const [order] = await outerTx
        .select()
        .from(transportOrders)
        .where(eq(transportOrders.id, created.transportOrderId));
      const histories = await outerTx
        .select()
        .from(transportOrderStatusHistory)
        .where(eq(transportOrderStatusHistory.transportOrderId, created.transportOrderId));

      expect(result.transportOrderId).toBe(created.transportOrderId);
      expect(result.invitationId).toBe(created.invitationId);
      expect(result.version).toBe(beforeOrder.version);
      expect(result.newStatusId).toBeNull();
      expect(result.historyId).toBeNull();
      expect(invitation.response).toBe("rejected");
      expect(invitation.respondedAt).toBeTruthy();
      expect(invitation.boundVendorUserId).toBe(vendorUser.vendorUserId);
      expect(order.statusId).toBe(fixture.statusIds!.requested);
      expect(order.version).toBe(beforeOrder.version);
      expect(histories).toHaveLength(1);
    });
  });

  it("accepts one of multiple invitations and revokes the others", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const vendorAUser = await seedVendorUser(outerTx, fixture, { emailLabel: "vendor-a" });
      const vendorB = await seedAdditionalVendor(outerTx, fixture.companyId, "Vendor B");
      const vendorC = await seedAdditionalVendor(outerTx, fixture.companyId, "Vendor C");
      await setAuthUid(outerTx, vendorAUser.authUserId);

      const created = await createTransportOrderWithNotification(outerTx, inputFor(fixture));
      await outerTx.insert(transportOrderInvitations).values([
        {
          companyId: fixture.companyId,
          transportOrderId: created.transportOrderId,
          vendorId: vendorB.vendorId,
        },
        {
          companyId: fixture.companyId,
          transportOrderId: created.transportOrderId,
          vendorId: vendorC.vendorId,
        },
      ]);

      await respondToTransportOrder(outerTx, {
        invitationId: created.invitationId,
        response: "accepted",
      });

      const invitations = await outerTx
        .select()
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.transportOrderId, created.transportOrderId));
      const vendorAInvitation = invitations.find((row: (typeof invitations)[number]) => row.vendorId === fixture.vendorId);
      const vendorBInvitation = invitations.find((row: (typeof invitations)[number]) => row.vendorId === vendorB.vendorId);
      const vendorCInvitation = invitations.find((row: (typeof invitations)[number]) => row.vendorId === vendorC.vendorId);
      const [order] = await outerTx
        .select()
        .from(transportOrders)
        .where(eq(transportOrders.id, created.transportOrderId));

      expect(vendorAInvitation?.response).toBe("accepted");
      expect(vendorAInvitation?.isWinningBid).toBe(true);
      expect(vendorAInvitation?.boundVendorId).toBe(fixture.vendorId);
      expect(vendorAInvitation?.boundVendorUserId).toBe(vendorAUser.vendorUserId);
      expect(vendorBInvitation?.response).toBe("revoked");
      expect(vendorCInvitation?.response).toBe("revoked");
      expect(order.vendorId).toBe(fixture.vendorId);
    });
  });

  it("throws InvitationNotPendingError when responding to an already accepted invitation", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const vendorUser = await seedVendorUser(outerTx, fixture);
      await setAuthUid(outerTx, vendorUser.authUserId);

      const created = await createTransportOrderWithNotification(outerTx, inputFor(fixture));
      await respondToTransportOrder(outerTx, {
        invitationId: created.invitationId,
        response: "accepted",
      });

      await expect(
        respondToTransportOrder(outerTx, {
          invitationId: created.invitationId,
          response: "accepted",
        }),
      ).rejects.toThrow(InvitationNotPendingError);
    });
  });

  it("throws VendorAuthError when a different vendor user accepts the invitation", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const vendorB = await seedAdditionalVendor(outerTx, fixture.companyId, "Vendor B");
      await setAuthUid(outerTx, vendorB.authUserId);

      const created = await createTransportOrderWithNotification(outerTx, inputFor(fixture));

      await expect(
        respondToTransportOrder(outerTx, {
          invitationId: created.invitationId,
          response: "accepted",
        }),
      ).rejects.toThrow(VendorAuthError);
    });
  });

  it("throws StatusTransitionError when accepted status transition is not seeded", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx, { seedStatuses: false });
      const statusRows = await outerTx
        .insert(statuses)
        .values([
          {
            companyId: fixture.companyId,
            statusType: "transport",
            key: "requested",
            name: "Requested",
            displayOrder: 10,
            isInitial: true,
            isActive: true,
          },
          {
            companyId: fixture.companyId,
            statusType: "transport",
            key: "accepted",
            name: "Accepted",
            displayOrder: 20,
            isActive: true,
          },
          {
            companyId: fixture.companyId,
            statusType: "transport",
            key: "rejected",
            name: "Rejected",
            displayOrder: 30,
            isTerminal: true,
            isActive: true,
          },
        ])
        .returning({ id: statuses.id, key: statuses.key });
      const statusIds = Object.fromEntries(
        statusRows.map((row: { key: string; id: string }) => [row.key, row.id]),
      ) as { requested: string; accepted: string; rejected: string };
      const vendorUser = await seedVendorUser(outerTx, fixture);
      await setAuthUid(outerTx, vendorUser.authUserId);

      const created = await createTransportOrderWithNotification(outerTx, inputFor(fixture));

      await expect(
        respondToTransportOrder(outerTx, {
          invitationId: created.invitationId,
          response: "accepted",
        }),
      ).rejects.toThrow(StatusTransitionError);
      expect(statusIds.requested).toBeTruthy();
      expect(statusIds.accepted).toBeTruthy();
      expect(statusIds.rejected).toBeTruthy();
    });
  });

  it("throws StatusSeedMissingError when accepted status is not seeded", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx, { seedStatuses: false });
      await outerTx.insert(statuses).values({
        companyId: fixture.companyId,
        statusType: "transport",
        key: "requested",
        name: "Requested",
        displayOrder: 10,
        isInitial: true,
        isActive: true,
      });
      const vendorUser = await seedVendorUser(outerTx, fixture);
      await setAuthUid(outerTx, vendorUser.authUserId);

      const created = await createTransportOrderWithNotification(outerTx, inputFor(fixture));

      await expect(
        respondToTransportOrder(outerTx, {
          invitationId: created.invitationId,
          response: "accepted",
        }),
      ).rejects.toThrow(StatusSeedMissingError);
    });
  });

  it("throws VendorAuthError when the vendor user is inactive", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const vendorUser = await seedVendorUser(outerTx, fixture, { isActive: false });
      await setAuthUid(outerTx, vendorUser.authUserId);

      const created = await createTransportOrderWithNotification(outerTx, inputFor(fixture));

      await expect(
        respondToTransportOrder(outerTx, {
          invitationId: created.invitationId,
          response: "accepted",
        }),
      ).rejects.toThrow(VendorAuthError);
    });
  });

  it("error classes expose correct code properties", () => {
    expect(new InvitationNotPendingError().code).toBe("INVITATION_NOT_PENDING");
    expect(new VendorAuthError().code).toBe("VENDOR_AUTH_ERROR");
    expect(new StatusTransitionError().code).toBe("STATUS_TRANSITION_ERROR");
    expect(new ConcurrentTransportOrderResponseError().code).toBe("CONCURRENT_RESPONSE");
    expect(new InvalidResponseValueError().code).toBe("INVALID_RESPONSE_VALUE");
    expect(new StatusSeedMissingError().code).toBe("STATUS_SEED_MISSING");
  });

  it("respondToTransportOrder raises VendorAuthError when no auth uid set", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const created = await createTransportOrderWithNotification(outerTx, inputFor(fixture));

      try {
        await respondToTransportOrder(outerTx, {
          invitationId: created.invitationId,
          response: "accepted",
        });
        throw new Error("Expected respondToTransportOrder to throw");
      } catch (err) {
        expect((err as VendorAuthError).code).toBe("VENDOR_AUTH_ERROR");
      }
    });
  });

  it("respondToTransportOrder raises VendorAuthError when wrong vendor responds", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const vendorB = await seedAdditionalVendor(outerTx, fixture.companyId, "Vendor B");
      await setAuthUid(outerTx, vendorB.authUserId);

      const created = await createTransportOrderWithNotification(outerTx, inputFor(fixture));

      try {
        await respondToTransportOrder(outerTx, {
          invitationId: created.invitationId,
          response: "accepted",
        });
        throw new Error("Expected respondToTransportOrder to throw");
      } catch (err) {
        expect((err as VendorAuthError).code).toBe("VENDOR_AUTH_ERROR");
      }
    });
  });
});

describeIntegration("close_transport_order / closeTransportOrderOnAllRejected", () => {
  it("closes transport_order when all invitations are rejected (happy_close)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const vendorAUser = await seedVendorUser(outerTx, fixture, { emailLabel: "vendor-a" });
      const vendorB = await seedAdditionalVendor(outerTx, fixture.companyId, "Vendor B");
      const vendorC = await seedAdditionalVendor(outerTx, fixture.companyId, "Vendor C");
      const created = await createTransportOrderWithNotification(outerTx, inputFor(fixture));
      const [inviteB] = await outerTx
        .insert(transportOrderInvitations)
        .values({
          companyId: fixture.companyId,
          transportOrderId: created.transportOrderId,
          vendorId: vendorB.vendorId,
          response: "pending",
        })
        .returning({ id: transportOrderInvitations.id });
      const [inviteC] = await outerTx
        .insert(transportOrderInvitations)
        .values({
          companyId: fixture.companyId,
          transportOrderId: created.transportOrderId,
          vendorId: vendorC.vendorId,
          response: "pending",
        })
        .returning({ id: transportOrderInvitations.id });

      await setAuthUid(outerTx, vendorAUser.authUserId);
      await respondToTransportOrder(outerTx, {
        invitationId: created.invitationId,
        response: "rejected",
      });
      await setAuthUid(outerTx, vendorB.authUserId);
      await respondToTransportOrder(outerTx, {
        invitationId: inviteB.id,
        response: "rejected",
      });
      await setAuthUid(outerTx, vendorC.authUserId);
      const result = await respondToTransportOrder(outerTx, {
        invitationId: inviteC.id,
        response: "rejected",
      });

      const [order] = await outerTx
        .select()
        .from(transportOrders)
        .where(eq(transportOrders.id, created.transportOrderId));
      const histories = await outerTx
        .select()
        .from(transportOrderStatusHistory)
        .where(eq(transportOrderStatusHistory.transportOrderId, created.transportOrderId));
      const autoCloseHistory = histories.find(
        (history: (typeof histories)[number]) => history.reason === "all invitations rejected (auto close)",
      );

      expect(result.closed).toBe(true);
      expect(result.newStatusId).toBe(fixture.statusIds!.rejected);
      expect(order.statusId).toBe(fixture.statusIds!.rejected);
      expect(order.vendorResponse).toBe("rejected");
      expect(autoCloseHistory?.toStatusId).toBe(fixture.statusIds!.rejected);
    });
  });

  it("does not close when some invitations are still pending (partial_no_close)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const vendorAUser = await seedVendorUser(outerTx, fixture, { emailLabel: "vendor-a" });
      const vendorB = await seedAdditionalVendor(outerTx, fixture.companyId, "Vendor B");
      const vendorC = await seedAdditionalVendor(outerTx, fixture.companyId, "Vendor C");
      const created = await createTransportOrderWithNotification(outerTx, inputFor(fixture));
      const [inviteB] = await outerTx
        .insert(transportOrderInvitations)
        .values({
          companyId: fixture.companyId,
          transportOrderId: created.transportOrderId,
          vendorId: vendorB.vendorId,
          response: "pending",
        })
        .returning({ id: transportOrderInvitations.id });
      await outerTx.insert(transportOrderInvitations).values({
        companyId: fixture.companyId,
        transportOrderId: created.transportOrderId,
        vendorId: vendorC.vendorId,
        response: "pending",
      });

      await setAuthUid(outerTx, vendorAUser.authUserId);
      await respondToTransportOrder(outerTx, {
        invitationId: created.invitationId,
        response: "rejected",
      });
      await setAuthUid(outerTx, vendorB.authUserId);
      const result = await respondToTransportOrder(outerTx, {
        invitationId: inviteB.id,
        response: "rejected",
      });

      const [order] = await outerTx
        .select()
        .from(transportOrders)
        .where(eq(transportOrders.id, created.transportOrderId));
      const histories = await outerTx
        .select()
        .from(transportOrderStatusHistory)
        .where(eq(transportOrderStatusHistory.transportOrderId, created.transportOrderId));
      const autoCloseHistory = histories.find(
        (history: (typeof histories)[number]) => history.reason === "all invitations rejected (auto close)",
      );

      expect(result.closed).toBeFalsy();
      expect(order.statusId).toBe(fixture.statusIds!.requested);
      expect(autoCloseHistory).toBeUndefined();
    });
  });

  it("does not close when an invitation has been accepted (accepted_no_close)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const vendorAUser = await seedVendorUser(outerTx, fixture, { emailLabel: "vendor-a" });
      const vendorB = await seedAdditionalVendor(outerTx, fixture.companyId, "Vendor B");
      const vendorC = await seedAdditionalVendor(outerTx, fixture.companyId, "Vendor C");
      const created = await createTransportOrderWithNotification(outerTx, inputFor(fixture));
      const [inviteB] = await outerTx
        .insert(transportOrderInvitations)
        .values({
          companyId: fixture.companyId,
          transportOrderId: created.transportOrderId,
          vendorId: vendorB.vendorId,
          response: "pending",
        })
        .returning({ id: transportOrderInvitations.id });
      const [inviteC] = await outerTx
        .insert(transportOrderInvitations)
        .values({
          companyId: fixture.companyId,
          transportOrderId: created.transportOrderId,
          vendorId: vendorC.vendorId,
          response: "pending",
        })
        .returning({ id: transportOrderInvitations.id });

      await setAuthUid(outerTx, vendorAUser.authUserId);
      await respondToTransportOrder(outerTx, {
        invitationId: created.invitationId,
        response: "accepted",
      });
      await outerTx
        .update(transportOrderInvitations)
        .set({ response: "pending", respondedAt: null })
        .where(eq(transportOrderInvitations.id, inviteB.id));
      await outerTx
        .update(transportOrderInvitations)
        .set({ response: "pending", respondedAt: null })
        .where(eq(transportOrderInvitations.id, inviteC.id));
      await setAuthUid(outerTx, vendorB.authUserId);
      await respondToTransportOrder(outerTx, {
        invitationId: inviteB.id,
        response: "rejected",
      });
      await setAuthUid(outerTx, vendorC.authUserId);
      const result = await respondToTransportOrder(outerTx, {
        invitationId: inviteC.id,
        response: "rejected",
      });

      const [order] = await outerTx
        .select()
        .from(transportOrders)
        .where(eq(transportOrders.id, created.transportOrderId));

      expect(result.closed).toBeFalsy();
      expect(order.statusId).toBe(fixture.statusIds!.accepted);
      expect(order.statusId).not.toBe(fixture.statusIds!.rejected);
      expect(order.vendorId).toBe(fixture.vendorId);
    });
  });

  it("treats concurrent reject of the same invitation as not-pending (race_double_submit)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const vendorAUser = await seedVendorUser(outerTx, fixture, { emailLabel: "vendor-a" });
      const created = await createTransportOrderWithNotification(outerTx, inputFor(fixture));
      await setAuthUid(outerTx, vendorAUser.authUserId);

      await expect(
        respondToTransportOrder(outerTx, {
          invitationId: created.invitationId,
          response: "rejected",
        }),
      ).resolves.toBeTruthy();
      await expect(
        respondToTransportOrder(outerTx, {
          invitationId: created.invitationId,
          response: "rejected",
        }),
      ).rejects.toMatchObject({ code: new InvitationNotPendingError().code });

      const invitations = await outerTx
        .select()
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.transportOrderId, created.transportOrderId));
      const [invitation] = invitations;

      expect(invitations).toHaveLength(1);
      expect(invitation.response).toBe("rejected");
    });
  });
});

describeIntegration("listTransportOrdersWithLatestInvitation", () => {
  it("returns only orders belonging to the requested company", async () => {
    await withRollback(async (outerTx) => {
      const fixtureA = await seedBaseFixture(outerTx, { companyLabel: "A" });
      const fixtureB = await seedBaseFixture(outerTx, { companyLabel: "B" });

      await createTransportOrderWithNotification(outerTx, {
        companyId: fixtureA.companyId,
        vendorId: fixtureA.vendorId,
        serviceTicketId: fixtureA.serviceTicketId,
        vehicleId: fixtureA.vehicleId,
        orderNumber: "ORDER-A-1",
        movementType: "one_way",
        pickupStoreId: fixtureA.pickupStoreId,
        deliveryStoreId: fixtureA.deliveryStoreId,
      });
      await createTransportOrderWithNotification(outerTx, {
        companyId: fixtureB.companyId,
        vendorId: fixtureB.vendorId,
        serviceTicketId: fixtureB.serviceTicketId,
        vehicleId: fixtureB.vehicleId,
        orderNumber: "ORDER-B-1",
        movementType: "one_way",
        pickupStoreId: fixtureB.pickupStoreId,
        deliveryStoreId: fixtureB.deliveryStoreId,
      });

      const rowsA = await listTransportOrdersWithLatestInvitation(outerTx, fixtureA.companyId);
      expect(rowsA).toHaveLength(1);
      expect(rowsA[0]?.orderNumber).toBe("ORDER-A-1");

      const rowsB = await listTransportOrdersWithLatestInvitation(outerTx, fixtureB.companyId);
      expect(rowsB).toHaveLength(1);
      expect(rowsB[0]?.orderNumber).toBe("ORDER-B-1");
    });
  });

  it("filters by statusKey when provided", async () => {  // describe block continues

    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      await createTransportOrderWithNotification(outerTx, {
        companyId: fixture.companyId,
        vendorId: fixture.vendorId,
        serviceTicketId: fixture.serviceTicketId,
        vehicleId: fixture.vehicleId,
        orderNumber: "ORDER-FILTER-1",
        movementType: "one_way",
        pickupStoreId: fixture.pickupStoreId,
        deliveryStoreId: fixture.deliveryStoreId,
      });

      const matched = await listTransportOrdersWithLatestInvitation(outerTx, fixture.companyId, {
        statusKey: "requested",
      });
      expect(matched).toHaveLength(1);
      expect(matched[0]?.statusKey).toBe("requested");

      const noMatch = await listTransportOrdersWithLatestInvitation(outerTx, fixture.companyId, {
        statusKey: "nonexistent_key_xyz",
      });
      expect(noMatch).toHaveLength(0);
    });
  });

  it("joins the latest invitation row created by createTransportOrderWithNotification", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      await createTransportOrderWithNotification(outerTx, {
        companyId: fixture.companyId,
        vendorId: fixture.vendorId,
        serviceTicketId: fixture.serviceTicketId,
        vehicleId: fixture.vehicleId,
        orderNumber: "ORDER-INV-1",
        movementType: "one_way",
        pickupStoreId: fixture.pickupStoreId,
        deliveryStoreId: fixture.deliveryStoreId,
      });

      const rows = await listTransportOrdersWithLatestInvitation(outerTx, fixture.companyId);
      expect(rows).toHaveLength(1);
      expect(rows[0]?.vendorName).not.toBeNull();
      expect(rows[0]?.latestInvitationResponse).toBe("pending");
      expect(rows[0]?.latestInvitationIsWinningBid).toBe(false);
    });
  });
});

describeIntegration("getAdminDashboardMetrics", () => {
  it("returns metrics only for the requested company", async () => {
    await withRollback(async (outerTx) => {
      const fixtureA = await seedBaseFixture(outerTx, { companyLabel: "A" });
      const fixtureB = await seedBaseFixture(outerTx, { companyLabel: "B" });

      // company A: 2 pending orders
      await createTransportOrderWithNotification(outerTx, {
        companyId: fixtureA.companyId,
        vendorId: fixtureA.vendorId,
        serviceTicketId: fixtureA.serviceTicketId,
        vehicleId: fixtureA.vehicleId,
        orderNumber: "ORDER-A-1",
        movementType: "one_way",
        pickupStoreId: fixtureA.pickupStoreId,
        deliveryStoreId: fixtureA.deliveryStoreId,
      });
      await createTransportOrderWithNotification(outerTx, {
        companyId: fixtureA.companyId,
        vendorId: fixtureA.vendorId,
        serviceTicketId: fixtureA.serviceTicketId,
        vehicleId: fixtureA.vehicleId,
        orderNumber: "ORDER-A-2",
        movementType: "one_way",
        pickupStoreId: fixtureA.pickupStoreId,
        deliveryStoreId: fixtureA.deliveryStoreId,
      });

      // company B: 1 pending order
      await createTransportOrderWithNotification(outerTx, {
        companyId: fixtureB.companyId,
        vendorId: fixtureB.vendorId,
        serviceTicketId: fixtureB.serviceTicketId,
        vehicleId: fixtureB.vehicleId,
        orderNumber: "ORDER-B-1",
        movementType: "one_way",
        pickupStoreId: fixtureB.pickupStoreId,
        deliveryStoreId: fixtureB.deliveryStoreId,
      });

      const metricsA = await getAdminDashboardMetrics(outerTx, fixtureA.companyId);
      expect(metricsA.pendingVendorResponseCount).toBe(2);

      const metricsB = await getAdminDashboardMetrics(outerTx, fixtureB.companyId);
      expect(metricsB.pendingVendorResponseCount).toBe(1);
    });
  });

  it("counts pending, rejected, and delayed orders correctly", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);

      // pending 1 (default)
      await createTransportOrderWithNotification(outerTx, {
        companyId: fixture.companyId,
        vendorId: fixture.vendorId,
        serviceTicketId: fixture.serviceTicketId,
        vehicleId: fixture.vehicleId,
        orderNumber: "ORDER-PENDING-1",
        movementType: "one_way",
        pickupStoreId: fixture.pickupStoreId,
        deliveryStoreId: fixture.deliveryStoreId,
      });

      // rejected 1
      const rejectedResult = await createTransportOrderWithNotification(outerTx, {
        companyId: fixture.companyId,
        vendorId: fixture.vendorId,
        serviceTicketId: fixture.serviceTicketId,
        vehicleId: fixture.vehicleId,
        orderNumber: "ORDER-REJECTED-1",
        movementType: "one_way",
        pickupStoreId: fixture.pickupStoreId,
        deliveryStoreId: fixture.deliveryStoreId,
      });
      const vendorUser = await seedVendorUser(outerTx, fixture);
      await setAuthUid(outerTx, vendorUser.authUserId);
      await respondToTransportOrder(outerTx, {
        invitationId: rejectedResult.invitationId,
        response: "rejected",
      });

      // delayed 1: pending + notification_sent_at set to 25h ago
      const delayedResult = await createTransportOrderWithNotification(outerTx, {
        companyId: fixture.companyId,
        vendorId: fixture.vendorId,
        serviceTicketId: fixture.serviceTicketId,
        vehicleId: fixture.vehicleId,
        orderNumber: "ORDER-DELAYED-1",
        movementType: "one_way",
        pickupStoreId: fixture.pickupStoreId,
        deliveryStoreId: fixture.deliveryStoreId,
      });
      await outerTx.execute(sql`
        UPDATE transport_orders
        SET notification_sent_at = now() - interval '25 hours'
        WHERE id = ${delayedResult.transportOrderId}
      `);

      const metrics = await getAdminDashboardMetrics(outerTx, fixture.companyId);
      // pending + delayed both have vendor_response='pending', so pendingVendorResponseCount = 2
      expect(metrics.pendingVendorResponseCount).toBe(2);
      expect(metrics.rejectedVendorResponseCount).toBe(1);
      expect(metrics.delayedNotificationCount).toBe(1);
    });
  });
});
