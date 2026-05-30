import * as crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inArray, sql } from "drizzle-orm";

import type { DB } from "@/lib/db/client";
import { auditLogs } from "@/lib/db/schema/audit_logs";
import { companies } from "@/lib/db/schema/companies";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { statusTransitions } from "@/lib/db/schema/status_transitions";
import { statuses } from "@/lib/db/schema/statuses";
import { stores } from "@/lib/db/schema/stores";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrderStatusHistory } from "@/lib/db/schema/transport_order_status_history";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendorUsers } from "@/lib/db/schema/vendor_users";
import { vendors } from "@/lib/db/schema/vendors";
import { seedTransportStatuses } from "../../_helpers/seed-transport-statuses";

const PASSWORD = "TestPass123!";

export interface SeededSpotInvitationCaseC {
  rawToken: string;
  inviteeEmail: string;
  password: string;
  cleanup: () => Promise<void>;
}

type SeedState = {
  authUserId?: string;
  companyIds: string[];
  invitationIds: string[];
  transportOrderIds: string[];
  serviceTicketIds: string[];
  vehicleIds: string[];
  storeIds: string[];
  inviteeEmail: string;
};

function sha256Hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function e2eCode(prefix: string, uuid: string): string {
  return `${prefix}_${uuid.replaceAll("-", "_")}`;
}

function requireRow<T>(row: T | undefined, label: string): T {
  if (!row) {
    throw new Error(`Failed to seed spot cross-tenant E2E ${label}`);
  }

  return row;
}

async function ignoreCleanupError(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // Cleanup is best-effort so partial setup failures do not mask the original error.
  }
}

async function cleanupCrossTenantSeed(
  db: DB,
  supabaseAdmin: SupabaseClient,
  state: SeedState,
): Promise<void> {
  await ignoreCleanupError(async () => {
    if (state.authUserId) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(state.authUserId);
      if (error) {
        throw error;
      }
    }
  });

  await ignoreCleanupError(async () => {
    if (state.invitationIds.length > 0) {
      await db
        .delete(transportOrderInvitations)
        .where(inArray(transportOrderInvitations.id, state.invitationIds));
    }
  });
  await ignoreCleanupError(async () => {
    if (state.transportOrderIds.length > 0) {
      await db
        .delete(transportOrderStatusHistory)
        .where(inArray(transportOrderStatusHistory.transportOrderId, state.transportOrderIds));
    }
  });
  await ignoreCleanupError(async () => {
    if (state.transportOrderIds.length > 0) {
      await db.delete(transportOrders).where(inArray(transportOrders.id, state.transportOrderIds));
    }
  });
  await ignoreCleanupError(async () => {
    await db
      .delete(vendorUsers)
      .where(sql`lower(${vendorUsers.email}) = lower(${state.inviteeEmail})`);
  });
  await ignoreCleanupError(async () => {
    if (state.serviceTicketIds.length > 0) {
      await db.delete(serviceTickets).where(inArray(serviceTickets.id, state.serviceTicketIds));
    }
  });
  await ignoreCleanupError(async () => {
    if (state.vehicleIds.length > 0) {
      await db.delete(vehicles).where(inArray(vehicles.id, state.vehicleIds));
    }
  });
  await ignoreCleanupError(async () => {
    if (state.storeIds.length > 0) {
      await db.delete(stores).where(inArray(stores.id, state.storeIds));
    }
  });
  await ignoreCleanupError(async () => {
    await db.delete(vendors).where(sql`lower(${vendors.email}) = lower(${state.inviteeEmail})`);
  });
  await ignoreCleanupError(async () => {
    if (state.companyIds.length > 0) {
      await db
        .delete(statusTransitions)
        .where(inArray(statusTransitions.companyId, state.companyIds));
    }
  });
  await ignoreCleanupError(async () => {
    if (state.companyIds.length > 0) {
      await db.delete(statuses).where(inArray(statuses.companyId, state.companyIds));
    }
  });
  await ignoreCleanupError(async () => {
    if (state.companyIds.length > 0) {
      // record_audit_log trigger 由来の行が残ると companies DELETE が FK 違反で fail する。
      await db.delete(auditLogs).where(inArray(auditLogs.companyId, state.companyIds));
    }
  });
  await ignoreCleanupError(async () => {
    if (state.companyIds.length > 0) {
      await db.delete(companies).where(inArray(companies.id, state.companyIds));
    }
  });
}

export async function seedSpotInvitationCaseC(
  supabaseAdmin: SupabaseClient,
  db: DB,
): Promise<SeededSpotInvitationCaseC> {
  const uuid = crypto.randomUUID();
  const inviteeEmail = `spot-e2e-${uuid}@example.com`;
  const rawToken = crypto.randomBytes(32).toString("base64url");
  const state: SeedState = {
    companyIds: [],
    invitationIds: [],
    transportOrderIds: [],
    serviceTicketIds: [],
    vehicleIds: [],
    storeIds: [],
    inviteeEmail,
  };

  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email: inviteeEmail,
      email_confirm: true,
      password: PASSWORD,
    });

    if (error) {
      throw error;
    }
    if (!data.user) {
      throw new Error(`Supabase createUser returned no user for ${inviteeEmail}`);
    }
    const authUserId = data.user.id;
    state.authUserId = authUserId;

    await db.transaction(async (tx) => {
      const [companyA, companyB] = await tx
        .insert(companies)
        .values([
          {
            name: `Spot E2E Owner Company ${uuid}`,
            code: e2eCode("spot_owner", uuid),
            deletedAt: null,
          },
          {
            name: `Spot E2E Existing Vendor Company ${uuid}`,
            code: e2eCode("spot_existing_vendor", uuid),
            deletedAt: null,
          },
        ])
        .returning({ id: companies.id });
      const companyAId = requireRow(companyA, "owner company").id;
      const companyBId = requireRow(companyB, "existing vendor company").id;
      state.companyIds.push(companyAId, companyBId);

      const statusIds = await seedTransportStatuses(tx, companyAId);

      const [pickupStore, deliveryStore] = await tx
        .insert(stores)
        .values([
          {
            companyId: companyAId,
            code: `spot_ct_pickup_${uuid.slice(0, 8)}`,
            name: "Spot Cross Tenant Pickup Store",
            deletedAt: null,
          },
          {
            companyId: companyAId,
            code: `spot_ct_delivery_${uuid.slice(0, 8)}`,
            name: "Spot Cross Tenant Delivery Store",
            deletedAt: null,
          },
        ])
        .returning({ id: stores.id });
      const pickupStoreId = requireRow(pickupStore, "pickup store").id;
      const deliveryStoreId = requireRow(deliveryStore, "delivery store").id;
      state.storeIds.push(pickupStoreId, deliveryStoreId);

      const [vehicle] = await tx
        .insert(vehicles)
        .values({
          companyId: companyAId,
          storeId: pickupStoreId,
          vin: `SPOTCT${uuid.replaceAll("-", "").slice(0, 10)}`,
          maker: "E2E",
          model: "Spot Cross Tenant Fixture",
          deletedAt: null,
        })
        .returning({ id: vehicles.id });
      const vehicleId = requireRow(vehicle, "vehicle").id;
      state.vehicleIds.push(vehicleId);

      const [serviceTicket] = await tx
        .insert(serviceTickets)
        .values({
          companyId: companyAId,
          vehicleId,
          storeId: pickupStoreId,
          ticketNo: `spot-ct-ticket-${uuid}`,
          billingStatus: "unbilled",
        })
        .returning({ id: serviceTickets.id });
      const serviceTicketId = requireRow(serviceTicket, "service ticket").id;
      state.serviceTicketIds.push(serviceTicketId);

      const [transportOrder] = await tx
        .insert(transportOrders)
        .values({
          companyId: companyAId,
          orderNumber: `spot-ct-order-${uuid}`,
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
          notes: "E2E spot cross-tenant vendor portal fixture",
          deletedAt: null,
        })
        .returning({ id: transportOrders.id });
      const transportOrderId = requireRow(transportOrder, "transport order").id;
      state.transportOrderIds.push(transportOrderId);

      const [invitation] = await tx
        .insert(transportOrderInvitations)
        .values({
          companyId: companyAId,
          transportOrderId,
          vendorId: null,
          inviteeEmail,
          inviteeName: "Spot Cross Tenant E2E Vendor",
          invitationTokenHash: sha256Hex(rawToken),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          response: "pending",
        })
        .returning({ id: transportOrderInvitations.id });
      state.invitationIds.push(requireRow(invitation, "invitation").id);

      const [vendor] = await tx
        .insert(vendors)
        .values({
          companyId: companyBId,
          name: "Spot Cross Tenant Existing Vendor",
          contactPersonName: "Spot Cross Tenant Existing Vendor",
          email: inviteeEmail,
          notificationMethod: "portal",
          isShared: false,
          isActive: true,
          deletedAt: null,
        })
        .returning({ id: vendors.id });
      const vendorId = requireRow(vendor, "vendor").id;

      await tx.insert(vendorUsers).values({
        authUserId,
        companyId: companyBId,
        vendorId,
        email: inviteeEmail,
        name: "Spot Cross Tenant Existing Vendor",
        isActive: true,
        deletedAt: null,
      });
    });

    return {
      rawToken,
      inviteeEmail,
      password: PASSWORD,
      cleanup: async () => cleanupCrossTenantSeed(db, supabaseAdmin, state),
    };
  } catch (error) {
    await cleanupCrossTenantSeed(db, supabaseAdmin, state);
    throw error;
  }
}
