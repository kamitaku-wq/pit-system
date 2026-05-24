// Phase 16-B transport order invitation service.
// References: spec §7.10 / §15.6 and ADR-0008 (案件単位招待).
// Scope limits: registered vendor only; notification_rules resolver bypassed;
// multiple invitations, first-acceptance handling, revoke, and unregistered vendors are deferred.
import { and, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { notificationOutbox } from "@/lib/db/schema/notification_outbox";
import { statuses } from "@/lib/db/schema/statuses";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrderStatusHistory } from "@/lib/db/schema/transport_order_status_history";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vendorCompanyMemberships } from "@/lib/db/schema/vendor_company_memberships";

export const CreateTransportOrderInput = z
  .object({
    companyId: z.string().uuid(),
    vendorId: z.string().uuid(),
    serviceTicketId: z.string().uuid(),
    vehicleId: z.string().uuid(),
    orderNumber: z.string().min(1).max(255),
    movementType: z.enum(["one_way", "round_trip", "pickup_only", "three_point"]),
    pickupStoreId: z.string().uuid().optional(),
    deliveryStoreId: z.string().uuid().optional(),
    returnStoreId: z.string().uuid().optional(),
    canDrive: z.boolean().default(true),
    towRequired: z.boolean().default(false),
    requestedPickupAt: z.date().optional(),
    requestedDeliveryAt: z.date().optional(),
    requestedReturnAt: z.date().optional(),
    notes: z.string().optional(),
    actingUserId: z.string().uuid().optional(),
    notificationPayload: z.record(z.string(), z.unknown()).optional(),
  })
  .strict();

export type CreateTransportOrderInput = z.input<typeof CreateTransportOrderInput>;

export interface CreateTransportOrderWithNotificationResult {
  transportOrderId: string;
  invitationId: string;
  outboxId: string;
  initialStatusId: string;
  idempotencyKey: string;
}

export class VendorMembershipError extends Error {
  constructor(message = "Vendor active membership not found") {
    super(message);
    this.name = "VendorMembershipError";
  }
}

export class StatusSeedMissingError extends Error {
  constructor(message = "Initial transport status not found for company") {
    super(message);
    this.name = "StatusSeedMissingError";
  }
}

export async function createTransportOrderWithNotification(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: CreateTransportOrderInput,
): Promise<CreateTransportOrderWithNotificationResult> {
  const parsed = CreateTransportOrderInput.parse(input);

  return db.transaction(
    // Drizzle does not export a common interface covering both DB and PgTransaction.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any): Promise<CreateTransportOrderWithNotificationResult> => {
      const membershipRows = await tx
        .select({ id: vendorCompanyMemberships.id })
        .from(vendorCompanyMemberships)
        .where(
          and(
            eq(vendorCompanyMemberships.vendorId, parsed.vendorId),
            eq(vendorCompanyMemberships.companyId, parsed.companyId),
            eq(vendorCompanyMemberships.isEnabled, true),
            isNull(vendorCompanyMemberships.deletedAt),
          ),
        )
        .limit(1);
      const membership = membershipRows[0];
      if (!membership) {
        throw new VendorMembershipError();
      }

      const initialStatusRows = await tx
        .select({ id: statuses.id })
        .from(statuses)
        .where(
          and(
            eq(statuses.companyId, parsed.companyId),
            eq(statuses.statusType, "transport"),
            eq(statuses.isInitial, true),
          ),
        )
        .limit(1);
      const initialStatus = initialStatusRows[0];
      if (!initialStatus) {
        throw new StatusSeedMissingError();
      }

      const transportOrderRows = await tx
        .insert(transportOrders)
        .values({
          companyId: parsed.companyId,
          orderNumber: parsed.orderNumber,
          serviceTicketId: parsed.serviceTicketId,
          vehicleId: parsed.vehicleId,
          vendorId: parsed.vendorId,
          movementType: parsed.movementType,
          pickupStoreId: parsed.pickupStoreId ?? null,
          deliveryStoreId: parsed.deliveryStoreId ?? null,
          returnStoreId: parsed.returnStoreId ?? null,
          canDrive: parsed.canDrive,
          towRequired: parsed.towRequired,
          requestedPickupAt: parsed.requestedPickupAt ?? null,
          requestedDeliveryAt: parsed.requestedDeliveryAt ?? null,
          requestedReturnAt: parsed.requestedReturnAt ?? null,
          statusId: initialStatus.id,
          notes: parsed.notes ?? null,
        })
        .returning({ id: transportOrders.id });
      const transportOrder = transportOrderRows[0];
      if (!transportOrder) {
        throw new Error("transport order insert returned no rows");
      }

      const historyRows = await tx
        .insert(transportOrderStatusHistory)
        .values({
          companyId: parsed.companyId,
          transportOrderId: transportOrder.id,
          fromStatusId: null,
          toStatusId: initialStatus.id,
          changedByUserId: parsed.actingUserId ?? null,
          reason: "initial",
        })
        .returning({ id: transportOrderStatusHistory.id });
      const history = historyRows[0];
      if (!history) {
        throw new Error("transport order status history insert returned no rows");
      }

      const invitationRows = await tx
        .insert(transportOrderInvitations)
        .values({
          companyId: parsed.companyId,
          transportOrderId: transportOrder.id,
          vendorId: parsed.vendorId,
          invitedByUserId: parsed.actingUserId ?? null,
        })
        .returning({ id: transportOrderInvitations.id });
      const invitation = invitationRows[0];
      if (!invitation) {
        throw new Error("transport order invitation insert returned no rows");
      }

      const idempotencyKey = `to:${transportOrder.id}:invite:${invitation.id}`;
      const outboxRows = await tx
        .insert(notificationOutbox)
        .values({
          companyId: parsed.companyId,
          transportOrderId: transportOrder.id,
          transportOrderInvitationId: invitation.id,
          idempotencyKey,
          eventType: "transport_order.invitation.sent",
          targetType: "vendor",
          targetId: parsed.vendorId,
          payload: parsed.notificationPayload ?? {},
        })
        .returning({ id: notificationOutbox.id });
      const outbox = outboxRows[0];
      if (!outbox) {
        throw new Error("notification outbox insert returned no rows");
      }

      return {
        transportOrderId: transportOrder.id,
        invitationId: invitation.id,
        outboxId: outbox.id,
        initialStatusId: initialStatus.id,
        idempotencyKey,
      };
    },
  );
}
