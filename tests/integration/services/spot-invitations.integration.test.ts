import { config } from "dotenv";
import { and, count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import type { SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it, vi } from "vitest";
import { seedTransportStatuses } from "../../_helpers/seed-transport-statuses";
import { companies } from "@/lib/db/schema/companies";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { stores } from "@/lib/db/schema/stores";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrderStatusHistory } from "@/lib/db/schema/transport_order_status_history";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendorCompanyMemberships } from "@/lib/db/schema/vendor_company_memberships";
import { vendorUsers } from "@/lib/db/schema/vendor_users";
import { vendors } from "@/lib/db/schema/vendors";
import {
  respondToInvitation,
  respondToSpotInvitation,
} from "@/lib/services/spot-invitations";
import { ConcurrentTransportOrderResponseError } from "@/lib/services/transport-orders";
import {
  InvitationTokenInvalidError,
  VendorCrossTenantError,
  verifyAndOnboardSpotInvitation,
} from "@/lib/services/spot-onboarding";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

// Drizzle transaction types vary by driver; this file stays test-only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

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
): Promise<{
  companyId: string;
  pickupStoreId: string;
  deliveryStoreId: string;
  vehicleId: string;
  serviceTicketId: string;
  vendorId: string;
  statusIds: { requested: string; accepted: string; rejected: string } | null;
}> {
  const {
    seedStatuses = true,
    seedMembership = true,
    membershipEnabled = true,
    companyLabel = "Company",
  } = options;
  const suffix = crypto.randomUUID().slice(0, 8);
  const [company] = await outerTx
    .insert(companies)
    .values({ name: `__spot_${companyLabel}_${suffix}__`, code: `spot_${suffix}` })
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
      ticketNo: `spot-${suffix}`,
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

  let statusIds: { requested: string; accepted: string; rejected: string } | null = null;
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

async function seedVendorUser(
  outerTx: Tx,
  fixture: { companyId: string; vendorId: string },
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
  await outerTx.execute(sql`SET LOCAL ROLE authenticated`);
  await outerTx.execute(sql`
    SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: authUserId, role: "authenticated" })}, true)
  `);
}

function tokenAndHash(): { raw: string; hash: string } {
  const raw = crypto.randomBytes(32).toString("base64url");
  return { raw, hash: crypto.createHash("sha256").update(raw).digest("hex") };
}

function buildMockAdmin(
  options: {
    listUsersResult?: { data?: { users?: Array<{ id: string; email?: string | null }> }; error?: null };
    inviteUserResult?: { data?: { user?: { id: string; email?: string | null } }; error?: null };
    deleteUserResult?: { error?: null };
  } = {},
): SupabaseClient {
  return {
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue(options.listUsersResult ?? { data: { users: [] }, error: null }),
        inviteUserByEmail: vi
          .fn()
          .mockResolvedValue(
            options.inviteUserResult ?? {
              data: { user: { id: crypto.randomUUID(), email: "user@example.test" } },
              error: null,
            },
          ),
        deleteUser: vi.fn().mockResolvedValue(options.deleteUserResult ?? { error: null }),
      },
    },
  } as unknown as SupabaseClient;
}

async function seedSpotInvitation(
  outerTx: Tx,
  options: {
    companyId: string;
    transportOrderId: string;
    inviteeEmail: string | null;
    inviteeName?: string | null;
    inviteePhone?: string | null;
    expiresAt?: Date | null;
    tokenHash?: string | null;
    vendorId?: string | null;
  },
): Promise<string> {
  const [invitation] = await outerTx
    .insert(transportOrderInvitations)
    .values({
      companyId: options.companyId,
      transportOrderId: options.transportOrderId,
      vendorId: options.vendorId ?? null,
      inviteeEmail: options.inviteeEmail,
      inviteeName: options.inviteeName ?? null,
      inviteePhone: options.inviteePhone ?? null,
      expiresAt: options.expiresAt ?? null,
      invitationTokenHash: options.tokenHash ?? null,
      response: "pending",
    })
    .returning({ id: transportOrderInvitations.id });

  return invitation.id;
}

async function seedVendorUserWithEmail(
  outerTx: Tx,
  options: {
    companyId: string;
    vendorId: string;
    email: string;
    authUserId: string;
    isActive?: boolean;
  },
): Promise<{ vendorUserId: string; authUserId: string }> {
  const [vendorUser] = await outerTx
    .insert(vendorUsers)
    .values({
      companyId: options.companyId,
      vendorId: options.vendorId,
      email: options.email,
      authUserId: options.authUserId,
      isActive: options.isActive ?? true,
      name: options.email.split("@")[0] ?? null,
    })
    .returning({ id: vendorUsers.id });

  return { vendorUserId: vendorUser.id, authUserId: options.authUserId };
}

describeIntegration("spot-invitations services", () => {
  it("onboards a first-touch spot invitation by creating an inactive vendor user", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const { raw, hash } = tokenAndHash();
      const inviteeEmail = "new@example.test";
      const invitationId = await seedSpotInvitation(outerTx, {
        companyId: fixture.companyId,
        transportOrderId: await (async () => {
          const [order] = await outerTx
            .insert(transportOrders)
            .values({
              companyId: fixture.companyId,
              orderNumber: `spot-${crypto.randomUUID()}`,
              serviceTicketId: fixture.serviceTicketId,
              vehicleId: fixture.vehicleId,
              vendorId: fixture.vendorId,
              movementType: "one_way",
              pickupStoreId: fixture.pickupStoreId,
              deliveryStoreId: fixture.deliveryStoreId,
              statusId: fixture.statusIds!.requested,
            })
            .returning({ id: transportOrders.id });
          return order.id;
        })(),
        inviteeEmail,
        inviteeName: "New Co",
        inviteePhone: "000-0000-0000",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        tokenHash: hash,
      });
      const mockAdmin = buildMockAdmin({
        inviteUserResult: { data: { user: { id: crypto.randomUUID(), email: inviteeEmail } }, error: null },
      });

      const result = await verifyAndOnboardSpotInvitation(outerTx, mockAdmin as SupabaseClient, raw);
      expect(result.case).toBe("new");
      expect(result.invitationId).toBe(invitationId);
      expect(result.companyId).toBe(fixture.companyId);

      const [vendorRow] = await outerTx.select().from(vendors).where(eq(vendors.id, result.vendorId)).limit(1);
      const [vendorUserRow] = await outerTx
        .select()
        .from(vendorUsers)
        .where(eq(vendorUsers.id, result.vendorUserId))
        .limit(1);
      expect(vendorRow.companyId).toBe(fixture.companyId);
      expect(vendorRow.name).toBe("New Co");
      expect(vendorRow.notificationMethod).toBe("both");
      expect(vendorRow.isShared).toBe(false);
      expect(vendorUserRow.isActive).toBe(false);
      expect(vendorUserRow.authUserId).toBe(result.authUserId);

      expect(vi.mocked((mockAdmin.auth as any).admin.listUsers)).toHaveBeenCalledTimes(1);
      expect(vi.mocked((mockAdmin.auth as any).admin.inviteUserByEmail)).toHaveBeenCalledTimes(1);
      expect(vi.mocked((mockAdmin.auth as any).admin.inviteUserByEmail)).toHaveBeenCalledWith(
        inviteeEmail,
        expect.objectContaining({ redirectTo: expect.stringContaining("/vendor/invitations/callback") }),
      );
    });
  });

  it("reuses an existing vendor row when the same email already has a vendor in the company (idempotency)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const { raw, hash } = tokenAndHash();
      const testEmail = "idempotent@example.test";
      const [order] = await outerTx
        .insert(transportOrders)
        .values({
          companyId: fixture.companyId,
          orderNumber: `spot-${crypto.randomUUID()}`,
          serviceTicketId: fixture.serviceTicketId,
          vehicleId: fixture.vehicleId,
          vendorId: fixture.vendorId,
          movementType: "one_way",
          pickupStoreId: fixture.pickupStoreId,
          deliveryStoreId: fixture.deliveryStoreId,
          statusId: fixture.statusIds!.requested,
        })
        .returning({ id: transportOrders.id });
      await seedSpotInvitation(outerTx, {
        companyId: fixture.companyId,
        transportOrderId: order.id,
        inviteeEmail: testEmail,
        inviteeName: "Idempotent Co",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        tokenHash: hash,
      });
      const [existingVendor] = await outerTx
        .insert(vendors)
        .values({
          companyId: fixture.companyId,
          name: "Idempotent Co",
          email: testEmail,
          isActive: true,
        })
        .returning({ id: vendors.id });
      const authUserId = crypto.randomUUID();
      const mockAdmin = buildMockAdmin({
        inviteUserResult: { data: { user: { id: authUserId, email: testEmail } }, error: null },
      });

      const result = await verifyAndOnboardSpotInvitation(outerTx, mockAdmin as SupabaseClient, raw);
      expect(result.case).toBe("new");
      expect(result.vendorId).toBe(existingVendor.id);

      const [vendorCount] = await outerTx
        .select({ value: count() })
        .from(vendors)
        .where(and(eq(vendors.email, testEmail), eq(vendors.companyId, fixture.companyId)));
      const [vendorUserRow] = await outerTx
        .select()
        .from(vendorUsers)
        .where(eq(vendorUsers.id, result.vendorUserId))
        .limit(1);
      expect(vendorCount.value).toBe(1);
      expect(vendorUserRow.vendorId).toBe(existingVendor.id);
    });
  });

  it("throws VendorCrossTenantError when a matching email already exists in another company", async () => {
    await withRollback(async (outerTx) => {
      const companyA = await seedBaseFixture(outerTx, { companyLabel: "A" });
      const companyB = await seedBaseFixture(outerTx, { companyLabel: "B" });
      const email = "dup@example.test";
      await seedVendorUserWithEmail(outerTx, {
        companyId: companyA.companyId,
        vendorId: companyA.vendorId,
        email,
        authUserId: crypto.randomUUID(),
      });
      const token = tokenAndHash();
      const [order] = await outerTx
        .insert(transportOrders)
        .values({
          companyId: companyB.companyId,
          orderNumber: `spot-${crypto.randomUUID()}`,
          serviceTicketId: companyB.serviceTicketId,
          vehicleId: companyB.vehicleId,
          vendorId: companyB.vendorId,
          movementType: "one_way",
          pickupStoreId: companyB.pickupStoreId,
          deliveryStoreId: companyB.deliveryStoreId,
          statusId: companyB.statusIds!.requested,
        })
        .returning({ id: transportOrders.id });
      await seedSpotInvitation(outerTx, {
        companyId: companyB.companyId,
        transportOrderId: order.id,
        inviteeEmail: email,
        inviteeName: "Dup Co",
        tokenHash: token.hash,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
      });
      const mockAdmin = buildMockAdmin();

      await expect(
        verifyAndOnboardSpotInvitation(outerTx, mockAdmin as SupabaseClient, token.raw),
      ).rejects.toBeInstanceOf(VendorCrossTenantError);

      const [vendorCount] = await outerTx
        .select({ value: count() })
        .from(vendors)
        .where(eq(vendors.companyId, companyB.companyId));
      const [vendorUserCount] = await outerTx
        .select({ value: count() })
        .from(vendorUsers)
        .where(eq(vendorUsers.companyId, companyB.companyId));
      expect(vendorCount.value).toBe(1);
      expect(vendorUserCount.value).toBe(0);
    });
  });

  it("returns an existing same-tenant vendor user without creating a new account", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const email = "exist@example.test";
      const existing = await seedVendorUserWithEmail(outerTx, {
        companyId: fixture.companyId,
        vendorId: fixture.vendorId,
        email,
        authUserId: crypto.randomUUID(),
      });
      const { raw, hash } = tokenAndHash();
      const [order] = await outerTx
        .insert(transportOrders)
        .values({
          companyId: fixture.companyId,
          orderNumber: `spot-${crypto.randomUUID()}`,
          serviceTicketId: fixture.serviceTicketId,
          vehicleId: fixture.vehicleId,
          vendorId: fixture.vendorId,
          movementType: "one_way",
          pickupStoreId: fixture.pickupStoreId,
          deliveryStoreId: fixture.deliveryStoreId,
          statusId: fixture.statusIds!.requested,
        })
        .returning({ id: transportOrders.id });
      const invitationId = await seedSpotInvitation(outerTx, {
        companyId: fixture.companyId,
        transportOrderId: order.id,
        inviteeEmail: email,
        inviteeName: "Exist Co",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        tokenHash: hash,
      });
      const mockAdmin = buildMockAdmin();

      const result = await verifyAndOnboardSpotInvitation(outerTx, mockAdmin as SupabaseClient, raw);
      expect(result.case).toBe("existing");
      expect(result.invitationId).toBe(invitationId);
      expect(result.vendorUserId).toBe(existing.vendorUserId);
      expect(result.authUserId).toBe(existing.authUserId);
      expect(vi.mocked((mockAdmin.auth as any).admin.listUsers)).not.toHaveBeenCalled();
      expect(vi.mocked((mockAdmin.auth as any).admin.inviteUserByEmail)).not.toHaveBeenCalled();
    });
  });

  it("throws InvitationTokenInvalidError for an expired token", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const { raw, hash } = tokenAndHash();
      const [order] = await outerTx
        .insert(transportOrders)
        .values({
          companyId: fixture.companyId,
          orderNumber: `spot-${crypto.randomUUID()}`,
          serviceTicketId: fixture.serviceTicketId,
          vehicleId: fixture.vehicleId,
          vendorId: fixture.vendorId,
          movementType: "one_way",
          pickupStoreId: fixture.pickupStoreId,
          deliveryStoreId: fixture.deliveryStoreId,
          statusId: fixture.statusIds!.requested,
        })
        .returning({ id: transportOrders.id });
      await seedSpotInvitation(outerTx, {
        companyId: fixture.companyId,
        transportOrderId: order.id,
        inviteeEmail: "expired@example.test",
        expiresAt: new Date(Date.now() - 60 * 60 * 1000),
        tokenHash: hash,
      });

      await expect(
        verifyAndOnboardSpotInvitation(outerTx, buildMockAdmin() as SupabaseClient, raw),
      ).rejects.toBeInstanceOf(InvitationTokenInvalidError);
    });
  });

  it("throws InvitationTokenInvalidError for a token hash mismatch", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const token = tokenAndHash();
      const wrong = tokenAndHash();
      const [order] = await outerTx
        .insert(transportOrders)
        .values({
          companyId: fixture.companyId,
          orderNumber: `spot-${crypto.randomUUID()}`,
          serviceTicketId: fixture.serviceTicketId,
          vehicleId: fixture.vehicleId,
          vendorId: fixture.vendorId,
          movementType: "one_way",
          pickupStoreId: fixture.pickupStoreId,
          deliveryStoreId: fixture.deliveryStoreId,
          statusId: fixture.statusIds!.requested,
        })
        .returning({ id: transportOrders.id });
      await seedSpotInvitation(outerTx, {
        companyId: fixture.companyId,
        transportOrderId: order.id,
        inviteeEmail: "hash@example.test",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        tokenHash: token.hash,
      });

      await expect(
        verifyAndOnboardSpotInvitation(outerTx, buildMockAdmin() as SupabaseClient, wrong.raw),
      ).rejects.toBeInstanceOf(InvitationTokenInvalidError);
    });
  });

  it("rejecting the only spot invitation closes the transport order and records terminal history", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const { raw, hash } = tokenAndHash();
      const [order] = await outerTx
        .insert(transportOrders)
        .values({
          companyId: fixture.companyId,
          orderNumber: `spot-${crypto.randomUUID()}`,
          serviceTicketId: fixture.serviceTicketId,
          vehicleId: fixture.vehicleId,
          vendorId: fixture.vendorId,
          movementType: "one_way",
          pickupStoreId: fixture.pickupStoreId,
          deliveryStoreId: fixture.deliveryStoreId,
          statusId: fixture.statusIds!.requested,
        })
        .returning({ id: transportOrders.id });
      const invitationId = await seedSpotInvitation(outerTx, {
        companyId: fixture.companyId,
        transportOrderId: order.id,
        inviteeEmail: "spot-reject@example.test",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000),
        tokenHash: hash,
      });
      const user = await seedVendorUserWithEmail(outerTx, {
        companyId: fixture.companyId,
        vendorId: fixture.vendorId,
        email: "spot-reject@example.test",
        authUserId: crypto.randomUUID(),
      });
      await setAuthUid(outerTx, user.authUserId);

      const result = await respondToSpotInvitation(outerTx, { invitationId, response: "rejected" });
      expect(result.closed).toBe(true);
      expect(result.newStatusId).toBe(fixture.statusIds!.rejected);
      const [updatedOrder] = await outerTx
        .select()
        .from(transportOrders)
        .where(eq(transportOrders.id, order.id))
        .limit(1);
      expect(updatedOrder.statusId).toBe(fixture.statusIds!.rejected);
      const [historyCount] = await outerTx
        .select({ value: count() })
        .from(transportOrderStatusHistory)
        .where(and(eq(transportOrderStatusHistory.transportOrderId, order.id), eq(transportOrderStatusHistory.toStatusId, fixture.statusIds!.rejected)));
      expect(historyCount.value).toBeGreaterThan(0);
    });
  });

  it("parallel accept of two spot invitations yields one winner and one concurrent response error", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const [order] = await outerTx
        .insert(transportOrders)
        .values({
          companyId: fixture.companyId,
          orderNumber: `spot-${crypto.randomUUID()}`,
          serviceTicketId: fixture.serviceTicketId,
          vehicleId: fixture.vehicleId,
          vendorId: fixture.vendorId,
          movementType: "one_way",
          pickupStoreId: fixture.pickupStoreId,
          deliveryStoreId: fixture.deliveryStoreId,
          statusId: fixture.statusIds!.requested,
        })
        .returning({ id: transportOrders.id });
      const inv1 = await seedSpotInvitation(outerTx, {
        companyId: fixture.companyId,
        transportOrderId: order.id,
        inviteeEmail: "a@example.test",
        tokenHash: tokenAndHash().hash,
      });
      const inv2 = await seedSpotInvitation(outerTx, {
        companyId: fixture.companyId,
        transportOrderId: order.id,
        inviteeEmail: "b@example.test",
        tokenHash: tokenAndHash().hash,
      });
      const user1 = await seedVendorUserWithEmail(outerTx, {
        companyId: fixture.companyId,
        vendorId: fixture.vendorId,
        email: "a@example.test",
        authUserId: crypto.randomUUID(),
      });
      const vendor2 = await seedAdditionalVendor(outerTx, fixture.companyId, "Alt");
      const user2 = await seedVendorUserWithEmail(outerTx, {
        companyId: fixture.companyId,
        vendorId: vendor2.vendorId,
        email: "b@example.test",
        authUserId: crypto.randomUUID(),
      });

      await setAuthUid(outerTx, user1.authUserId);
      const first = await respondToSpotInvitation(outerTx, { invitationId: inv1, response: "accepted" });
      expect(first.version).toBeGreaterThanOrEqual(1);

      await setAuthUid(outerTx, user2.authUserId);
      await expect(
        respondToSpotInvitation(outerTx, { invitationId: inv2, response: "accepted" }),
      ).rejects.toSatisfy((err: unknown) => {
        return (
          err instanceof ConcurrentTransportOrderResponseError ||
          (err instanceof Error && err.message.toLowerCase().includes("already has winning bid"))
        );
      });
    });
  });

  it("accepting a spot invitation revokes registered pending invitations", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const [order] = await outerTx
        .insert(transportOrders)
        .values({
          companyId: fixture.companyId,
          orderNumber: `spot-${crypto.randomUUID()}`,
          serviceTicketId: fixture.serviceTicketId,
          vehicleId: fixture.vehicleId,
          vendorId: fixture.vendorId,
          movementType: "one_way",
          pickupStoreId: fixture.pickupStoreId,
          deliveryStoreId: fixture.deliveryStoreId,
          statusId: fixture.statusIds!.requested,
        })
        .returning({ id: transportOrders.id });
      const registeredVendor = await seedAdditionalVendor(outerTx, fixture.companyId, "Registered");
      const registeredUser = await seedVendorUserWithEmail(outerTx, {
        companyId: fixture.companyId,
        vendorId: registeredVendor.vendorId,
        email: "registered@example.test",
        authUserId: crypto.randomUUID(),
      });
      const spotUser = await seedVendorUserWithEmail(outerTx, {
        companyId: fixture.companyId,
        vendorId: fixture.vendorId,
        email: "spot-accept@example.test",
        authUserId: crypto.randomUUID(),
      });
      const [registeredInvitation] = await outerTx
        .insert(transportOrderInvitations)
        .values({
          companyId: fixture.companyId,
          transportOrderId: order.id,
          vendorId: registeredVendor.vendorId,
          response: "pending",
        })
        .returning({ id: transportOrderInvitations.id });
      const spotInvitation = await seedSpotInvitation(outerTx, {
        companyId: fixture.companyId,
        transportOrderId: order.id,
        inviteeEmail: "spot-accept@example.test",
        tokenHash: tokenAndHash().hash,
      });
      await setAuthUid(outerTx, spotUser.authUserId);

      const result = await respondToSpotInvitation(outerTx, {
        invitationId: spotInvitation,
        response: "accepted",
      });
      expect(result.boundVendorId).toBeTruthy();
      const [revoked] = await outerTx
        .select()
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.id, registeredInvitation.id))
        .limit(1);
      expect(revoked.response).toBe("revoked");
      expect(registeredUser.vendorUserId).toBeTruthy();
    });
  });

  it("RLS visibility returns the invitation only for the matching-email vendor user", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const [order] = await outerTx
        .insert(transportOrders)
        .values({
          companyId: fixture.companyId,
          orderNumber: `spot-${crypto.randomUUID()}`,
          serviceTicketId: fixture.serviceTicketId,
          vehicleId: fixture.vehicleId,
          vendorId: fixture.vendorId,
          movementType: "one_way",
          pickupStoreId: fixture.pickupStoreId,
          deliveryStoreId: fixture.deliveryStoreId,
          statusId: fixture.statusIds!.requested,
        })
        .returning({ id: transportOrders.id });
      const invitationId = await seedSpotInvitation(outerTx, {
        companyId: fixture.companyId,
        transportOrderId: order.id,
        inviteeEmail: "match@example.test",
        tokenHash: tokenAndHash().hash,
      });
      const matchVendor = await seedAdditionalVendor(outerTx, fixture.companyId, "Match");
      const nomatchVendor = await seedAdditionalVendor(outerTx, fixture.companyId, "NoMatch");
      const matchUser = await seedVendorUserWithEmail(outerTx, {
        companyId: fixture.companyId,
        vendorId: matchVendor.vendorId,
        email: "match@example.test",
        authUserId: crypto.randomUUID(),
      });
      const noMatchUser = await seedVendorUserWithEmail(outerTx, {
        companyId: fixture.companyId,
        vendorId: nomatchVendor.vendorId,
        email: "nomatch@example.test",
        authUserId: crypto.randomUUID(),
      });

      await setAuthUid(outerTx, matchUser.authUserId);
      const matchRows = await outerTx
        .select({ value: count() })
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.id, invitationId));
      expect(matchRows[0]?.value).toBe(1);

      await setAuthUid(outerTx, noMatchUser.authUserId);
      const noMatchRows = await outerTx
        .select({ value: count() })
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.id, invitationId));
      expect(noMatchRows[0]?.value).toBe(0);
    });
  });

  it("violates the target check when both vendor_id and invitee_email are null", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const [order] = await outerTx
        .insert(transportOrders)
        .values({
          companyId: fixture.companyId,
          orderNumber: `spot-${crypto.randomUUID()}`,
          serviceTicketId: fixture.serviceTicketId,
          vehicleId: fixture.vehicleId,
          vendorId: fixture.vendorId,
          movementType: "one_way",
          pickupStoreId: fixture.pickupStoreId,
          deliveryStoreId: fixture.deliveryStoreId,
          statusId: fixture.statusIds!.requested,
        })
        .returning({ id: transportOrders.id });

      await expect(
        outerTx.insert(transportOrderInvitations).values({
          companyId: fixture.companyId,
          transportOrderId: order.id,
          vendorId: null,
          inviteeEmail: null,
        }),
      ).rejects.toThrow(/invitations_target_check|check/i);
    });
  });

  it("routes registered invitations through respondToTransportOrder", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const [order] = await outerTx
        .insert(transportOrders)
        .values({
          companyId: fixture.companyId,
          orderNumber: `spot-${crypto.randomUUID()}`,
          serviceTicketId: fixture.serviceTicketId,
          vehicleId: fixture.vehicleId,
          vendorId: fixture.vendorId,
          movementType: "one_way",
          pickupStoreId: fixture.pickupStoreId,
          deliveryStoreId: fixture.deliveryStoreId,
          statusId: fixture.statusIds!.requested,
        })
        .returning({ id: transportOrders.id });
      const registeredVendor = await seedAdditionalVendor(outerTx, fixture.companyId, "Registered");
      const user = await seedVendorUserWithEmail(outerTx, {
        companyId: fixture.companyId,
        vendorId: registeredVendor.vendorId,
        email: "router@example.test",
        authUserId: crypto.randomUUID(),
      });
      const [invitation] = await outerTx
        .insert(transportOrderInvitations)
        .values({
          companyId: fixture.companyId,
          transportOrderId: order.id,
          vendorId: registeredVendor.vendorId,
          response: "pending",
        })
        .returning({ id: transportOrderInvitations.id });
      await setAuthUid(outerTx, user.authUserId);

      const result = await respondToInvitation(outerTx, { invitationId: invitation.id, response: "rejected" });
      expect(result.closed).toBe(true);
    });
  });

  it("routes spot invitations through respondToSpotInvitation and returns the bound vendor", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedBaseFixture(outerTx);
      const [order] = await outerTx
        .insert(transportOrders)
        .values({
          companyId: fixture.companyId,
          orderNumber: `spot-${crypto.randomUUID()}`,
          serviceTicketId: fixture.serviceTicketId,
          vehicleId: fixture.vehicleId,
          vendorId: fixture.vendorId,
          movementType: "one_way",
          pickupStoreId: fixture.pickupStoreId,
          deliveryStoreId: fixture.deliveryStoreId,
          statusId: fixture.statusIds!.requested,
        })
        .returning({ id: transportOrders.id });
      const spotUser = await seedVendorUserWithEmail(outerTx, {
        companyId: fixture.companyId,
        vendorId: fixture.vendorId,
        email: "router-spot@example.test",
        authUserId: crypto.randomUUID(),
      });
      const invitationId = await seedSpotInvitation(outerTx, {
        companyId: fixture.companyId,
        transportOrderId: order.id,
        inviteeEmail: "router-spot@example.test",
        tokenHash: tokenAndHash().hash,
      });
      await setAuthUid(outerTx, spotUser.authUserId);

      const result = await respondToInvitation(outerTx, { invitationId, response: "accepted" });
      expect("boundVendorId" in result ? result.boundVendorId : null).toBeTruthy();
      expect(result.transportOrderId).toBe(order.id);
    });
  });
});
