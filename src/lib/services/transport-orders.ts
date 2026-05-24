// Phase 16-B transport order invitation service.
// References: spec §7.10 / §15.6 and ADR-0008 (案件単位招待).
// Scope limits: registered vendor only; notification_rules resolver bypassed;
// multiple invitations, first-acceptance handling, revoke, and unregistered vendors are deferred.
import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { notificationOutbox } from "@/lib/db/schema/notification_outbox";
import { statuses } from "@/lib/db/schema/statuses";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrderStatusHistory } from "@/lib/db/schema/transport_order_status_history";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vendorCompanyMemberships } from "@/lib/db/schema/vendor_company_memberships";
import { closeTransportOrderOnAllRejected } from "@/lib/services/close-transport-order";

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
  static readonly code = "STATUS_SEED_MISSING" as const;
  readonly code = StatusSeedMissingError.code;

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

export const RespondToTransportOrderInput = z
  .object({
    invitationId: z.string().uuid(),
    response: z.enum(["accepted", "rejected"]),
    reason: z.string().max(500).optional(),
  })
  .strict();

export type RespondToTransportOrderInput = z.input<typeof RespondToTransportOrderInput>;

export interface RespondToTransportOrderResult {
  transportOrderId: string;
  invitationId: string;
  version: number;
  newStatusId: string | null;
  historyId: string | null;
  // Phase 22 / 16-E: reject 経路で全 invitation rejected の時に true、close_transport_order により terminal status 設定済
  closed?: boolean;
}

export class InvitationNotPendingError extends Error {
  static readonly code = "INVITATION_NOT_PENDING" as const;
  readonly code = InvitationNotPendingError.code;

  constructor(message = "Invitation not pending or not found") {
    super(message);
    this.name = "InvitationNotPendingError";
  }
}

export class VendorAuthError extends Error {
  static readonly code = "VENDOR_AUTH_ERROR" as const;
  readonly code = VendorAuthError.code;

  constructor(message = "Caller is not authorized vendor user") {
    super(message);
    this.name = "VendorAuthError";
  }
}

export class StatusTransitionError extends Error {
  static readonly code = "STATUS_TRANSITION_ERROR" as const;
  readonly code = StatusTransitionError.code;

  constructor(message = "Invalid status transition") {
    super(message);
    this.name = "StatusTransitionError";
  }
}

export class ConcurrentTransportOrderResponseError extends Error {
  static readonly code = "CONCURRENT_RESPONSE" as const;
  readonly code = ConcurrentTransportOrderResponseError.code;

  constructor(message = "Transport order is being processed concurrently") {
    super(message);
    this.name = "ConcurrentTransportOrderResponseError";
  }
}

export class InvalidResponseValueError extends Error {
  static readonly code = "INVALID_RESPONSE_VALUE" as const;
  readonly code = InvalidResponseValueError.code;

  constructor(message = "Invalid response value") {
    super(message);
    this.name = "InvalidResponseValueError";
  }
}

export async function respondToTransportOrder(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: RespondToTransportOrderInput,
): Promise<RespondToTransportOrderResult> {
  const parsed = RespondToTransportOrderInput.parse(input);

  try {
    const result = await db.execute(sql`
      SELECT transport_order_id, version, invitation_id, new_status_id, history_id
      FROM public.respond_to_transport_order(
        ${parsed.invitationId}::uuid,
        ${parsed.response}::text,
        ${parsed.reason ?? null}::text
      )
    `);

    // drizzle-orm execute return shape varies by driver:
    // postgres.js driver: array directly; node-postgres: { rows: [...] }
    const rows = (result as any).rows ?? result;
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) {
      throw new Error("respond_to_transport_order returned no rows");
    }

    const respondResult: RespondToTransportOrderResult = {
      transportOrderId: row.transport_order_id ?? row.transportOrderId,
      invitationId: row.invitation_id ?? row.invitationId,
      version: Number(row.version),
      newStatusId: row.new_status_id ?? row.newStatusId ?? null,
      historyId: row.history_id ?? row.historyId ?? null,
    };

    // Phase 22 / 16-E: reject 経路で全 invitation reject なら close_transport_order を呼ぶ。
    // 同じ db/tx を渡して同一 transaction 内で完結させる (caller の withAuthenticatedDb 配下)。
    if (parsed.response === "rejected") {
      const closeResult = await closeTransportOrderOnAllRejected(
        db,
        respondResult.transportOrderId,
      );
      respondResult.closed = closeResult.closed;
      if (closeResult.closed && closeResult.newStatusId) {
        respondResult.newStatusId = closeResult.newStatusId;
      }
    }

    return respondResult;
  } catch (err: unknown) {
    const code = (err as any)?.code ?? (err as any)?.cause?.code;
    const message = (err as Error)?.message ?? "";

    if (code === "P0001" && message.toLowerCase().includes("invalid status transition")) {
      throw new StatusTransitionError(message);
    }
    if (code === "22023") {
      throw new InvalidResponseValueError(message);
    }
    if (code === "P0002") {
      if (message.includes("accepted status not seeded")) {
        throw new StatusSeedMissingError(message);
      }
      throw new InvitationNotPendingError(message);
    }
    if (code === "42501") {
      throw new VendorAuthError(message);
    }
    if (code === "55P03") {
      throw new ConcurrentTransportOrderResponseError(message);
    }
    throw err;
  }
}
