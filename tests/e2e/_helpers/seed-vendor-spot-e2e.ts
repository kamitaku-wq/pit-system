import * as crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { inArray, sql } from "drizzle-orm";

import type { DB } from "@/lib/db/client";
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

export interface SeededSpotInvitationCaseA {
  rawToken: string;
  invitationId: string;
  transportOrderId: string;
  companyId: string;
  inviteeEmail: string;
  password: string;
  authUserId: string;
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
    throw new Error(`Failed to seed spot E2E ${label}`);
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

async function cleanupSpotInvitationSeed(
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
      await db.delete(companies).where(inArray(companies.id, state.companyIds));
    }
  });
}

export async function seedSpotInvitationCaseA(
  supabaseAdmin: SupabaseClient,
  db: DB,
): Promise<SeededSpotInvitationCaseA> {
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

    const seeded = await db.transaction(async (tx) => {
      const [company] = await tx
        .insert(companies)
        .values({
          name: `Spot E2E Company ${uuid}`,
          code: e2eCode("spot_e2e", uuid),
          deletedAt: null,
        })
        .returning({ id: companies.id });
      const companyId = requireRow(company, "company").id;
      state.companyIds.push(companyId);

      const statusIds = await seedTransportStatuses(tx, companyId);

      const [pickupStore, deliveryStore] = await tx
        .insert(stores)
        .values([
          {
            companyId,
            code: `spot_pickup_${uuid.slice(0, 8)}`,
            name: "Spot E2E Pickup Store",
            deletedAt: null,
          },
          {
            companyId,
            code: `spot_delivery_${uuid.slice(0, 8)}`,
            name: "Spot E2E Delivery Store",
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
          companyId,
          storeId: pickupStoreId,
          vin: `SPOTE2E${uuid.replaceAll("-", "").slice(0, 10)}`,
          maker: "E2E",
          model: "Spot Fixture",
          deletedAt: null,
        })
        .returning({ id: vehicles.id });
      const vehicleId = requireRow(vehicle, "vehicle").id;
      state.vehicleIds.push(vehicleId);

      const [serviceTicket] = await tx
        .insert(serviceTickets)
        .values({
          companyId,
          vehicleId,
          storeId: pickupStoreId,
          ticketNo: `spot-ticket-${uuid}`,
          billingStatus: "unbilled",
        })
        .returning({ id: serviceTickets.id });
      const serviceTicketId = requireRow(serviceTicket, "service ticket").id;
      state.serviceTicketIds.push(serviceTicketId);

      const [transportOrder] = await tx
        .insert(transportOrders)
        .values({
          companyId,
          orderNumber: `spot-order-${uuid}`,
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
          notes: "E2E spot vendor portal fixture",
          deletedAt: null,
        })
        .returning({ id: transportOrders.id });
      const transportOrderId = requireRow(transportOrder, "transport order").id;
      state.transportOrderIds.push(transportOrderId);

      const [invitation] = await tx
        .insert(transportOrderInvitations)
        .values({
          companyId,
          transportOrderId,
          vendorId: null,
          inviteeEmail,
          inviteeName: "Spot E2E Vendor",
          invitationTokenHash: sha256Hex(rawToken),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          response: "pending",
        })
        .returning({ id: transportOrderInvitations.id });
      const invitationId = requireRow(invitation, "invitation").id;
      state.invitationIds.push(invitationId);

      return { companyId, transportOrderId, invitationId };
    });

    return {
      rawToken,
      invitationId: seeded.invitationId,
      transportOrderId: seeded.transportOrderId,
      companyId: seeded.companyId,
      inviteeEmail,
      password: PASSWORD,
      authUserId,
      cleanup: async () => cleanupSpotInvitationSeed(db, supabaseAdmin, state),
    };
  } catch (error) {
    await cleanupSpotInvitationSeed(db, supabaseAdmin, state);
    throw error;
  }
}
