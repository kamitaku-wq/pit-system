import * as crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { eq, inArray } from "drizzle-orm";

import type { DB } from "@/lib/db/client";
import { companies } from "@/lib/db/schema/companies";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { statusTransitions } from "@/lib/db/schema/status_transitions";
import { statuses } from "@/lib/db/schema/statuses";
import { stores } from "@/lib/db/schema/stores";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendorUsers } from "@/lib/db/schema/vendor_users";
import { vendors } from "@/lib/db/schema/vendors";
import { seedTransportStatuses, type SeededTransportStatuses } from "./seed-transport-statuses";

const VENDOR_PASSWORD = "e2e-vendor-pass-001";
const VENDOR_KEYS = ["a", "b", "c"] as const;

type VendorKey = (typeof VENDOR_KEYS)[number];
type InvitationIds = [string, string, string];
type SeededVendorUsers = Record<VendorKey, SeededVendorE2EUser>;

export interface SeededVendorE2EUser {
  authUserId: string;
  vendorId: string;
  vendorUserId: string;
  email: string;
  password: string;
}

export interface SeededVendorE2ELoop {
  companyId: string;
  orderId: string;
  orderNumber: string;
  serviceTicketId: string;
  vehicleId: string;
  storeIds: string[];
  statusIds: SeededTransportStatuses;
  invitationIds: InvitationIds;
  vendorUsers: SeededVendorUsers;
}

interface SeededVendorRow {
  key: VendorKey;
  vendorId: string;
  email: string;
  password: string;
}

interface SeededAuthUser {
  key: VendorKey;
  vendorId: string;
  authUserId: string;
  email: string;
  password: string;
}

// TODO: Phase 22 sealed までは vendor portal E2E loop test 専用。Sprint β で admin invitation 経路実装時に統合 helper 化検討
export async function seedVendorE2ELoop(
  db: DB,
  supabaseAdmin: SupabaseClient,
): Promise<SeededVendorE2ELoop> {
  const uuid = crypto.randomUUID();
  const orderNumber = `e2e-loop-${uuid}`;
  const authUsersToCleanup: string[] = [];

  try {
    return await db.transaction(async (tx) => {
      const [company] = await tx
        .insert(companies)
        .values({
          name: `E2E Loop Company ${uuid}`,
          code: `e2e_loop_${uuid.replaceAll("-", "_")}`,
          deletedAt: null,
        })
        .returning({ id: companies.id });
      const companyId = requireRow(company, "company").id;

      const statusIds = await seedTransportStatuses(tx, companyId);

      const [pickupStore, deliveryStore] = await tx
        .insert(stores)
        .values([
          {
            companyId,
            code: `e2e_pickup_${uuid.slice(0, 8)}`,
            name: "E2E Pickup Store",
            deletedAt: null,
          },
          {
            companyId,
            code: `e2e_delivery_${uuid.slice(0, 8)}`,
            name: "E2E Delivery Store",
            deletedAt: null,
          },
        ])
        .returning({ id: stores.id });
      const pickupStoreId = requireRow(pickupStore, "pickup store").id;
      const deliveryStoreId = requireRow(deliveryStore, "delivery store").id;
      const storeIds = [pickupStoreId, deliveryStoreId];

      const [vehicle] = await tx
        .insert(vehicles)
        .values({
          companyId,
          storeId: pickupStoreId,
          vin: `E2ELOOP${uuid.replaceAll("-", "").slice(0, 10)}`,
          maker: "E2E",
          model: "Loop Fixture",
          deletedAt: null,
        })
        .returning({ id: vehicles.id });
      const vehicleId = requireRow(vehicle, "vehicle").id;

      const [serviceTicket] = await tx
        .insert(serviceTickets)
        .values({
          companyId,
          vehicleId,
          storeId: pickupStoreId,
          ticketNo: `e2e-ticket-${uuid}`,
          billingStatus: "unbilled",
        })
        .returning({ id: serviceTickets.id });
      const serviceTicketId = requireRow(serviceTicket, "service ticket").id;

      const vendorRows: SeededVendorRow[] = await seedVendors(tx, companyId);
      const authRows = await createAuthUsers(supabaseAdmin, vendorRows, authUsersToCleanup);

      const vendorUserRows = await tx
        .insert(vendorUsers)
        .values(
          authRows.map((user) => ({
            authUserId: user.authUserId,
            companyId,
            vendorId: user.vendorId,
            email: user.email,
            name: `E2E Vendor ${user.key.toUpperCase()}`,
            isActive: true,
            deletedAt: null,
          })),
        )
        .returning({
          id: vendorUsers.id,
          vendorId: vendorUsers.vendorId,
        });

      const seededVendorUsers = toSeededVendorUsers(authRows, vendorUserRows);

      const [order] = await tx
        .insert(transportOrders)
        .values({
          companyId,
          orderNumber,
          serviceTicketId,
          vehicleId,
          movementType: "one_way",
          pickupStoreId,
          deliveryStoreId,
          canDrive: true,
          towRequired: false,
          vendorResponse: "pending",
          confirmationMode: "auto",
          statusId: statusIds.requested,
          notes: "E2E vendor portal loop fixture",
          deletedAt: null,
        })
        .returning({ id: transportOrders.id });
      const orderId = requireRow(order, "transport order").id;

      const invitationRows = await tx
        .insert(transportOrderInvitations)
        .values(
          authRows.map((user) => ({
            companyId,
            transportOrderId: orderId,
            vendorId: user.vendorId,
            inviteeEmail: user.email,
            inviteeName: `E2E Vendor ${user.key.toUpperCase()}`,
            invitationTokenHash: `e2e-loop-${user.key}-${crypto.randomUUID()}`,
            response: "pending",
            isWinningBid: false,
          })),
        )
        .returning({
          id: transportOrderInvitations.id,
          vendorId: transportOrderInvitations.vendorId,
        });

      return {
        companyId,
        orderId,
        orderNumber,
        serviceTicketId,
        vehicleId,
        storeIds,
        statusIds,
        invitationIds: toInvitationIds(authRows, invitationRows),
        vendorUsers: seededVendorUsers,
      };
    });
  } catch (error) {
    await deleteAuthUsers(supabaseAdmin, authUsersToCleanup);
    throw error;
  }
}

export async function cleanupVendorE2ELoop(
  db: DB,
  supabaseAdmin: SupabaseClient,
  seeded: SeededVendorE2ELoop,
): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .delete(transportOrderInvitations)
      .where(inArray(transportOrderInvitations.id, Object.values(seeded.invitationIds)));
    await tx.delete(transportOrders).where(eq(transportOrders.id, seeded.orderId));
    await tx.delete(serviceTickets).where(eq(serviceTickets.id, seeded.serviceTicketId));
    await tx.delete(vehicles).where(eq(vehicles.id, seeded.vehicleId));
    await tx.delete(stores).where(inArray(stores.id, seeded.storeIds));
    await tx
      .delete(vendorUsers)
      .where(
        inArray(
          vendorUsers.id,
          VENDOR_KEYS.map((key) => seeded.vendorUsers[key].vendorUserId),
        ),
      );
    await tx
      .delete(vendors)
      .where(
        inArray(
          vendors.id,
          VENDOR_KEYS.map((key) => seeded.vendorUsers[key].vendorId),
        ),
      );
    await tx.delete(statusTransitions).where(eq(statusTransitions.companyId, seeded.companyId));
    await tx.delete(statuses).where(eq(statuses.companyId, seeded.companyId));
    await tx.delete(companies).where(eq(companies.id, seeded.companyId));
  });

  await deleteAuthUsers(
    supabaseAdmin,
    VENDOR_KEYS.map((key) => seeded.vendorUsers[key].authUserId),
  );
}

async function seedVendors(
  // Drizzle does not export a compact transaction interface for local test helpers.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  companyId: string,
): Promise<SeededVendorRow[]> {
  const rows = await tx
    .insert(vendors)
    .values(
      VENDOR_KEYS.map((key, index) => ({
        companyId,
        name: `E2E Vendor ${key.toUpperCase()}`,
        contactPersonName: `E2E Vendor ${key.toUpperCase()}`,
        email: `e2e-vendor-${key}-${crypto.randomUUID()}@example.com`,
        notificationMethod: "portal",
        isShared: false,
        priority: index + 1,
        isActive: true,
        displayOrder: (index + 1) * 10,
        deletedAt: null,
      })),
    )
    .returning({
      id: vendors.id,
      email: vendors.email,
    });

  if (rows.length !== VENDOR_KEYS.length) {
    throw new Error("Failed to seed all E2E vendors");
  }

  return VENDOR_KEYS.map((key, index) => {
    const row = requireRow(rows[index] as { id: string; email: string | null } | undefined, "vendor");
    const email = row.email;
    if (!email) {
      throw new Error("Seeded E2E vendor returned no email");
    }

    return {
      key,
      vendorId: row.id,
      email,
      password: VENDOR_PASSWORD,
    };
  });
}

async function createAuthUsers(
  supabaseAdmin: SupabaseClient,
  vendorsToBind: SeededVendorRow[],
  authUsersToCleanup: string[],
): Promise<SeededAuthUser[]> {
  const authUsers: SeededAuthUser[] = [];

  for (const vendor of vendorsToBind) {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: vendor.email,
      password: vendor.password,
      email_confirm: true,
    });

    if (error) {
      throw error;
    }

    if (!data.user) {
      throw new Error(`Supabase createUser returned no user for ${vendor.email}`);
    }

    authUsersToCleanup.push(data.user.id);
    authUsers.push({
      key: vendor.key,
      vendorId: vendor.vendorId,
      authUserId: data.user.id,
      email: vendor.email,
      password: vendor.password,
    });
  }

  return authUsers;
}

function toSeededVendorUsers(
  authRows: SeededAuthUser[],
  vendorUserRows: Array<{ id: string; vendorId: string }>,
): SeededVendorUsers {
  const result = {} as Partial<SeededVendorUsers>;

  for (const authRow of authRows) {
    const vendorUser = vendorUserRows.find((row) => row.vendorId === authRow.vendorId);
    if (!vendorUser) {
      throw new Error(`Failed to seed vendor_user for vendor ${authRow.vendorId}`);
    }

    result[authRow.key] = {
      authUserId: authRow.authUserId,
      vendorId: authRow.vendorId,
      vendorUserId: vendorUser.id,
      email: authRow.email,
      password: authRow.password,
    };
  }

  return requireVendorKeyedRecord(result, "vendor users");
}

function toInvitationIds(
  authRows: SeededAuthUser[],
  invitationRows: Array<{ id: string; vendorId: string | null }>,
): InvitationIds {
  const result = {} as Partial<Record<VendorKey, string>>;

  for (const authRow of authRows) {
    const invitation = invitationRows.find((row) => row.vendorId === authRow.vendorId);
    if (!invitation) {
      throw new Error(`Failed to seed invitation for vendor ${authRow.vendorId}`);
    }

    result[authRow.key] = invitation.id;
  }

  const invitationIdsByVendor = requireVendorKeyedRecord(result, "invitations");
  return [invitationIdsByVendor.a, invitationIdsByVendor.b, invitationIdsByVendor.c];
}

function requireVendorKeyedRecord<T>(
  value: Partial<Record<VendorKey, T>>,
  label: string,
): Record<VendorKey, T> {
  for (const key of VENDOR_KEYS) {
    if (!value[key]) {
      throw new Error(`Missing E2E ${label} entry for vendor ${key}`);
    }
  }

  return value as Record<VendorKey, T>;
}

function requireRow<T>(row: T | undefined, label: string): T {
  if (!row) {
    throw new Error(`Failed to seed E2E ${label}`);
  }

  return row;
}

async function deleteAuthUsers(
  supabaseAdmin: SupabaseClient,
  authUserIds: string[],
): Promise<void> {
  const uniqueAuthUserIds = [...new Set(authUserIds)];

  await Promise.all(
    uniqueAuthUserIds.map(async (authUserId) => {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
      if (error) {
        throw error;
      }
    }),
  );
}
