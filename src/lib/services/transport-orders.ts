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
import { vendors } from "@/lib/db/schema/vendors";
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

    const orderRow = await db.execute(sql`
      SELECT s.key AS status_key, s.is_terminal AS is_terminal
      FROM transport_orders t
      JOIN statuses s ON s.id = t.status_id
      WHERE t.id = ${respondResult.transportOrderId}
        AND t.company_id = (SELECT company_id FROM transport_order_invitations WHERE id = ${parsed.invitationId})
        AND t.deleted_at IS NULL
      LIMIT 1
    `);
    const orderRows = (orderRow as any).rows ?? orderRow;
    const order = Array.isArray(orderRows) ? orderRows[0] : orderRows;
    const orderStatus = order as { status_key?: string; is_terminal?: boolean } | undefined;
    if (orderStatus && (orderStatus.status_key === "cancelled" || orderStatus.is_terminal === true)) {
      throw new StatusTransitionError(
        `cannot respond to transport order in status '${orderStatus.status_key}'`,
      );
    }

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

export const CancelTransportOrderInput = z
  .object({
    transportOrderId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    reason: z.string().max(1000).optional(),
  })
  .strict();

export type CancelTransportOrderInput = z.input<typeof CancelTransportOrderInput>;

export interface CancelTransportOrderResult {
  transportOrderId: string;
  newVersion: number;
  cancelledAt: Date;
  revokedInvitationIds: string[];
  notificationOutboxId: string;
  idempotencyKey: string;
}

export class ConcurrentTransportOrderCancelError extends Error {
  constructor(message = "transport order cancel: optimistic version mismatch") {
    super(message);
    this.name = "ConcurrentTransportOrderCancelError";
  }
}

export class AlreadyCancelledError extends Error {
  constructor(message = "transport order is already cancelled") {
    super(message);
    this.name = "AlreadyCancelledError";
  }
}

export class TerminalStatusCancelError extends Error {
  constructor(message = "transport order is in terminal status, cannot cancel") {
    super(message);
    this.name = "TerminalStatusCancelError";
  }
}

export class TransportOrderNotFoundError extends Error {
  constructor(message = "transport order not found") {
    super(message);
    this.name = "TransportOrderNotFoundError";
  }
}

export class CancelStatusSeedMissingError extends Error {
  constructor(message = "cancelled status row is not seeded for this company") {
    super(message);
    this.name = "CancelStatusSeedMissingError";
  }
}

export async function cancelTransportOrder(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: any,
  companyId: string,
  userId: string,
  input: CancelTransportOrderInput,
): Promise<CancelTransportOrderResult> {
  const parsed = CancelTransportOrderInput.parse(input);

  return database.transaction(
    // Drizzle does not export a common interface covering both DB and PgTransaction.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any): Promise<CancelTransportOrderResult> => {
      const cancelledStatusResult = await tx.execute(sql`
        SELECT id
        FROM statuses
        WHERE company_id = ${companyId}
          AND status_type = 'transport'
          AND key = 'cancelled'
        LIMIT 1
      `);
      const cancelledStatusRows = (cancelledStatusResult as any).rows ?? cancelledStatusResult;
      const cancelledStatusRow = Array.isArray(cancelledStatusRows)
        ? cancelledStatusRows[0]
        : cancelledStatusRows;
      const cancelledStatusId = (cancelledStatusRow as { id?: string } | undefined)?.id;
      if (!cancelledStatusId) {
        throw new CancelStatusSeedMissingError();
      }

      const currentOrderResult = await tx.execute(sql`
        SELECT
          t.id,
          t.version,
          t.deleted_at,
          t.status_id,
          t.vendor_id,
          s.key AS status_key,
          s.is_terminal AS is_terminal
        FROM transport_orders t
        LEFT JOIN statuses s ON s.id = t.status_id
        WHERE t.id = ${parsed.transportOrderId}
          AND t.company_id = ${companyId}
        LIMIT 1
      `);
      const currentOrderRows = (currentOrderResult as any).rows ?? currentOrderResult;
      const currentOrder = Array.isArray(currentOrderRows) ? currentOrderRows[0] : currentOrderRows;
      const currentOrderRow = currentOrder as
        | {
            id?: string;
            version?: number;
            deleted_at?: Date | string | null;
            status_id?: string;
            vendor_id?: string | null;
            status_key?: string;
            is_terminal?: boolean;
          }
        | undefined;

      if (!currentOrderRow || currentOrderRow.deleted_at) {
        throw new TransportOrderNotFoundError();
      }

      const invitationSelectResult = await tx.execute(sql`
        SELECT
          id,
          vendor_id,
          invitee_email,
          response
        FROM transport_order_invitations
        WHERE transport_order_id = ${parsed.transportOrderId}
          AND company_id = ${companyId}
          AND response IN ('pending', 'accepted')
        ORDER BY invited_at ASC, id ASC
      `);
      const invitationSelectRows = (invitationSelectResult as any).rows ?? invitationSelectResult;
      const invitationRows = Array.isArray(invitationSelectRows) ? invitationSelectRows : [];

      const updateResult = await tx.execute(sql`
        UPDATE transport_orders
        SET status_id = ${cancelledStatusId},
            cancelled_at = now(),
            version = version + 1,
            updated_at = now()
        WHERE id = ${parsed.transportOrderId}
          AND company_id = ${companyId}
          AND version = ${parsed.expectedVersion}
          AND deleted_at IS NULL
          AND status_id != ${cancelledStatusId}
          AND status_id NOT IN (
            SELECT id FROM statuses
            WHERE company_id = ${companyId}
              AND status_type = 'transport'
              AND is_terminal = true
              AND key != 'cancelled'
          )
        RETURNING id, version, cancelled_at
      `);
      const updateRows = (updateResult as any).rows ?? updateResult;
      const updatedOrder = Array.isArray(updateRows) ? updateRows[0] : updateRows;
      const updatedOrderRow = updatedOrder as
        | {
            id?: string;
            version?: number;
            cancelled_at?: Date | string | null;
          }
        | undefined;

      if (!updatedOrderRow) {
        if (currentOrderRow.status_key === "cancelled") {
          throw new AlreadyCancelledError();
        }
        if (currentOrderRow.is_terminal === true) {
          throw new TerminalStatusCancelError();
        }
        if (currentOrderRow.version !== parsed.expectedVersion) {
          throw new ConcurrentTransportOrderCancelError();
        }
        throw new TransportOrderNotFoundError();
      }

      const cancelledAt = expectNullableDate(updatedOrderRow.cancelled_at);
      if (!cancelledAt) {
        throw new Error("transport_orders.cancelled_at must not be null after cancel");
      }
      const newVersion = updatedOrderRow.version;
      if (typeof newVersion !== "number") {
        throw new Error("transport_orders.version must not be null after cancel");
      }
      const targetVendorId = currentOrderRow.vendor_id;
      if (!targetVendorId) {
        throw new Error("transport_orders.vendor_id must not be null for cancel notification");
      }

      await tx.execute(sql`
        INSERT INTO transport_order_status_history (
          company_id,
          transport_order_id,
          from_status_id,
          to_status_id,
          changed_by_user_id,
          reason
        )
        VALUES (
          ${companyId},
          ${parsed.transportOrderId},
          ${currentOrderRow.status_id ?? null},
          ${cancelledStatusId},
          ${userId},
          ${parsed.reason ?? null}
        )
      `);

      const revokedInvitationIds = invitationRows.map((row) => {
        const invitationRow = row as {
          id?: string;
          vendor_id?: string | null;
          invitee_email?: string | null;
          response?: string;
        };
        return invitationRow.id ?? "";
      }).filter((id) => id.length > 0);

      await tx.execute(sql`
        UPDATE transport_order_invitations
        SET response = 'revoked',
            responded_at = now(),
            updated_at = now()
        WHERE transport_order_id = ${parsed.transportOrderId}
          AND company_id = ${companyId}
          AND response IN ('pending', 'accepted')
      `);

      const idempotencyKey = `to:${parsed.transportOrderId}:cancelled:v${updatedOrderRow.version}`;
      const notificationPayload = {
        transportOrderId: parsed.transportOrderId,
        cancelledAt: cancelledAt.toISOString(),
        reason: parsed.reason ?? null,
        revokedInvitations: invitationRows.map((row) => {
          const invitationRow = row as {
            id?: string;
            vendor_id?: string | null;
            invitee_email?: string | null;
            response?: string;
          };
          return {
            invitationId: invitationRow.id ?? "",
            vendorId: invitationRow.vendor_id ?? null,
            inviteeEmail: invitationRow.invitee_email ?? null,
            responseBefore: invitationRow.response ?? null,
          };
        }),
      };

      const outboxResult = await tx.execute(sql`
        INSERT INTO notification_outbox (
          company_id,
          transport_order_id,
          transport_order_invitation_id,
          idempotency_key,
          event_type,
          target_type,
          target_id,
          payload
        )
        VALUES (
          ${companyId},
          ${parsed.transportOrderId},
          NULL,
          ${idempotencyKey},
          'transport_order.cancelled',
          'vendor',
          ${targetVendorId},
          ${JSON.stringify(notificationPayload)}::jsonb
        )
        RETURNING id
      `);
      const outboxRows = (outboxResult as any).rows ?? outboxResult;
      const outboxRow = Array.isArray(outboxRows) ? outboxRows[0] : outboxRows;
      const notificationOutboxId = (outboxRow as { id?: string } | undefined)?.id;
      if (!notificationOutboxId) {
        throw new Error("notification outbox insert returned no rows");
      }

      return {
        transportOrderId: parsed.transportOrderId,
        newVersion,
        cancelledAt,
        revokedInvitationIds,
        notificationOutboxId,
        idempotencyKey,
      };
    },
  );
}

export interface TransportOrderListItem {
  transportOrderId: string;
  orderNumber: string;
  movementType: "one_way" | "round_trip" | "pickup_only" | "three_point";
  canDrive: boolean;
  towRequired: boolean;
  requestedPickupAt: Date | null;
  requestedDeliveryAt: Date | null;
  requestedReturnAt: Date | null;
  pickupStoreName: string | null;
  deliveryStoreName: string | null;
  returnStoreName: string | null;
  notificationSentAt: Date | null;
  vendorResponse: "pending" | "accepted" | "rejected";
  vendorResponseAt: Date | null;
  storeConfirmedAt: Date | null;
  statusKey: string;
  statusName: string;
  vendorName: string | null;
  latestInvitationResponse: "pending" | "accepted" | "rejected" | "revoked" | "expired" | null;
  latestInvitationRespondedAt: Date | null;
  latestInvitationIsWinningBid: boolean | null;
  createdAt: Date;
}

type TransportOrderListRow = {
  transport_order_id: unknown;
  order_number: unknown;
  movement_type: unknown;
  can_drive: unknown;
  tow_required: unknown;
  requested_pickup_at: unknown;
  requested_delivery_at: unknown;
  requested_return_at: unknown;
  pickup_store_name: unknown;
  delivery_store_name: unknown;
  return_store_name: unknown;
  notification_sent_at: unknown;
  vendor_response: unknown;
  vendor_response_at: unknown;
  store_confirmed_at: unknown;
  status_key: unknown;
  status_name: unknown;
  vendor_name: unknown;
  latest_invitation_response: unknown;
  latest_invitation_responded_at: unknown;
  latest_invitation_is_winning_bid: unknown;
  created_at: unknown;
};

function getExecuteRows(result: unknown): unknown[] {
  const rows = (result as { rows?: unknown }).rows ?? result;
  return Array.isArray(rows) ? rows : [];
}

function expectNullableDate(value: unknown): Date | null {
  if (value === null || value === undefined) {
    return null;
  }
  if (value instanceof Date) {
    return value;
  }
  const parsed = new Date(value as string);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("expected a valid date value");
  }
  return parsed;
}

function expectBoolean(value: unknown, fieldName: string): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (value === 1 || value === "1" || value === "true") {
    return true;
  }
  if (value === 0 || value === "0" || value === "false") {
    return false;
  }
  throw new Error(`${fieldName} must be a boolean`);
}

function expectBooleanOrNull(value: unknown, fieldName: string): boolean | null {
  if (value === null || value === undefined) {
    return null;
  }
  return expectBoolean(value, fieldName);
}

function expectString(value: unknown, fieldName: string): string {
  if (typeof value !== "string") {
    throw new Error(`${fieldName} must be a string`);
  }
  return value;
}

function expectNullableString(value: unknown): string | null {
  if (value === null || value === undefined) {
    return null;
  }
  return expectString(value, "value");
}

function expectTransportOrderListItem(row: TransportOrderListRow): TransportOrderListItem {
  const latestInvitationResponse = expectNullableString(row.latest_invitation_response);
  if (
    latestInvitationResponse !== null &&
    !["pending", "accepted", "rejected", "revoked", "expired"].includes(latestInvitationResponse)
  ) {
    throw new Error("latest invitation response must be a known invitation response");
  }

  return {
    transportOrderId: expectString(row.transport_order_id, "transport_orders.id"),
    orderNumber: expectString(row.order_number, "transport_orders.order_number"),
    movementType: expectString(row.movement_type, "transport_orders.movement_type") as
      | "one_way"
      | "round_trip"
      | "pickup_only"
      | "three_point",
    canDrive: expectBoolean(row.can_drive, "transport_orders.can_drive"),
    towRequired: expectBoolean(row.tow_required, "transport_orders.tow_required"),
    requestedPickupAt: expectNullableDate(row.requested_pickup_at),
    requestedDeliveryAt: expectNullableDate(row.requested_delivery_at),
    requestedReturnAt: expectNullableDate(row.requested_return_at),
    pickupStoreName: expectNullableString(row.pickup_store_name),
    deliveryStoreName: expectNullableString(row.delivery_store_name),
    returnStoreName: expectNullableString(row.return_store_name),
    notificationSentAt: expectNullableDate(row.notification_sent_at),
    vendorResponse: expectString(row.vendor_response, "transport_orders.vendor_response") as
      | "pending"
      | "accepted"
      | "rejected",
    vendorResponseAt: expectNullableDate(row.vendor_response_at),
    storeConfirmedAt: expectNullableDate(row.store_confirmed_at),
    statusKey: expectString(row.status_key, "statuses.key"),
    statusName: expectString(row.status_name, "statuses.name"),
    vendorName: expectNullableString(row.vendor_name),
    latestInvitationResponse: latestInvitationResponse as TransportOrderListItem["latestInvitationResponse"],
    latestInvitationRespondedAt: expectNullableDate(row.latest_invitation_responded_at),
    latestInvitationIsWinningBid: expectBooleanOrNull(
      row.latest_invitation_is_winning_bid,
      "transport_order_invitations.is_winning_bid",
    ),
    createdAt: expectNullableDate(row.created_at) ?? (() => {
      throw new Error("transport_orders.created_at must not be null");
    })(),
  };
}

export async function listTransportOrdersWithLatestInvitation(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  companyId: string,
  options?: { statusKey?: string },
): Promise<TransportOrderListItem[]> {
  const result = await db.execute(sql`
    SELECT
      t.id AS transport_order_id,
      t.order_number,
      t.movement_type,
      t.can_drive,
      t.tow_required,
      t.requested_pickup_at,
      t.requested_delivery_at,
      t.requested_return_at,
      ps.name AS pickup_store_name,
      ds.name AS delivery_store_name,
      rs.name AS return_store_name,
      t.notification_sent_at,
      t.vendor_response,
      t.vendor_response_at,
      t.store_confirmed_at,
      s.key AS status_key,
      s.name AS status_name,
      v.name AS vendor_name,
      li.response AS latest_invitation_response,
      li.responded_at AS latest_invitation_responded_at,
      li.is_winning_bid AS latest_invitation_is_winning_bid,
      t.created_at
    FROM ${transportOrders} t
    INNER JOIN ${statuses} s
      ON t.status_id = s.id AND s.status_type = 'transport'
    LEFT JOIN ${vendors} v
      ON t.vendor_id = v.id
    LEFT JOIN stores ps
      ON t.pickup_store_id = ps.id
    LEFT JOIN stores ds
      ON t.delivery_store_id = ds.id
    LEFT JOIN stores rs
      ON t.return_store_id = rs.id
    LEFT JOIN LATERAL (
      SELECT response, responded_at, is_winning_bid
      FROM ${transportOrderInvitations}
      WHERE transport_order_id = t.id
      ORDER BY is_winning_bid DESC, invited_at DESC
      LIMIT 1
    ) li ON TRUE
    WHERE t.company_id = ${companyId} AND t.deleted_at IS NULL
      ${options?.statusKey ? sql`AND s.key = ${options.statusKey}` : sql``}
    ORDER BY t.created_at DESC
  `);

  return getExecuteRows(result).map((row) => expectTransportOrderListItem(row as TransportOrderListRow));
}

export interface AdminDashboardMetrics {
  pendingVendorResponseCount: number;
  rejectedVendorResponseCount: number;
  delayedNotificationCount: number;
}

type AdminDashboardMetricsRow = {
  pending_vendor_response_count: unknown;
  rejected_vendor_response_count: unknown;
  delayed_notification_count: unknown;
};

function expectMetricNumber(value: unknown, fieldName: string): number {
  if (typeof value === 'number') {
    if (Number.isNaN(value)) throw new Error(`Field ${fieldName} is NaN`);
    return value;
  }
  if (typeof value === 'string') {
    const n = Number(value);
    if (Number.isNaN(n)) throw new Error(`Field ${fieldName} is not a valid number string: ${value}`);
    return n;
  }
  if (typeof value === 'bigint') {
    return Number(value);
  }
  throw new Error(`Field ${fieldName} has unexpected type: ${typeof value}`);
}

export async function getAdminDashboardMetrics(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  companyId: string,
): Promise<AdminDashboardMetrics> {
  const result = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE vendor_response = 'pending') AS pending_vendor_response_count,
      COUNT(*) FILTER (WHERE vendor_response = 'rejected') AS rejected_vendor_response_count,
      COUNT(*) FILTER (
        WHERE vendor_response = 'pending'
          AND notification_sent_at IS NOT NULL
          AND notification_sent_at < now() - interval '24 hours'
      ) AS delayed_notification_count
    FROM ${transportOrders}
    WHERE company_id = ${companyId} AND deleted_at IS NULL
  `);

  const rows = getExecuteRows(result);
  const row = rows[0] as AdminDashboardMetricsRow | undefined;
  if (!row) {
    return {
      pendingVendorResponseCount: 0,
      rejectedVendorResponseCount: 0,
      delayedNotificationCount: 0,
    };
  }

  return {
    pendingVendorResponseCount: expectMetricNumber(row.pending_vendor_response_count, 'pending_vendor_response_count'),
    rejectedVendorResponseCount: expectMetricNumber(row.rejected_vendor_response_count, 'rejected_vendor_response_count'),
    delayedNotificationCount: expectMetricNumber(row.delayed_notification_count, 'delayed_notification_count'),
  };
}

export interface TransportOrderInvitationItem {
  invitationId: string;
  vendorId: string | null;
  vendorName: string | null;
  inviteeEmail: string | null;
  inviteeName: string | null;
  response: 'pending' | 'accepted' | 'rejected' | 'revoked' | 'expired';
  invitedAt: Date;
  respondedAt: Date | null;
  isWinningBid: boolean;
}

export interface TransportOrderNotificationItem {
  outboxId: string;
  eventType: string;
  status: 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled';
  attempts: number;
  createdAt: Date;
  sentAt: Date | null;
  lastError: string | null;
}

export interface TransportOrderDetail {
  transportOrderId: string;
  orderNumber: string;
  version: number;
  movementType: 'one_way' | 'round_trip' | 'pickup_only' | 'three_point';
  canDrive: boolean;
  towRequired: boolean;
  pickupStoreId: string | null;
  deliveryStoreId: string | null;
  returnStoreId: string | null;
  pickupStoreName: string | null;
  deliveryStoreName: string | null;
  returnStoreName: string | null;
  requestedPickupAt: Date | null;
  requestedDeliveryAt: Date | null;
  requestedReturnAt: Date | null;
  notificationSentAt: Date | null;
  vendorResponse: 'pending' | 'accepted' | 'rejected';
  vendorResponseAt: Date | null;
  storeConfirmedAt: Date | null;
  statusKey: string;
  statusName: string;
  vendorId: string | null;
  vendorName: string | null;
  notes: string | null;
  createdAt: Date;
  invitations: TransportOrderInvitationItem[];
  notifications: TransportOrderNotificationItem[];
}

const MOVEMENT_TYPES = ['one_way', 'round_trip', 'pickup_only', 'three_point'] as const;
const VENDOR_RESPONSES = ['pending', 'accepted', 'rejected'] as const;
const INVITATION_RESPONSES = ['pending', 'accepted', 'rejected', 'revoked', 'expired'] as const;
const OUTBOX_STATUSES = ['pending', 'processing', 'sent', 'failed', 'cancelled'] as const;

function expectNumber(row: Record<string, unknown>, col: string): number {
  const v = row[col];
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  throw new Error(`Expected number for ${col}, got ${String(v)}`);
}

function expectTransportOrderDetailBase(
  row: Record<string, unknown>,
): Omit<TransportOrderDetail, 'invitations' | 'notifications'> {
  const movementType = expectString(row.movement_type, 'transport_orders.movement_type');
  if (!MOVEMENT_TYPES.includes(movementType as (typeof MOVEMENT_TYPES)[number])) {
    throw new Error(`Unknown movement type: ${movementType}`);
  }

  const vendorResponse = expectString(row.vendor_response, 'transport_orders.vendor_response');
  if (!VENDOR_RESPONSES.includes(vendorResponse as (typeof VENDOR_RESPONSES)[number])) {
    throw new Error(`Unknown vendor response: ${vendorResponse}`);
  }

  return {
    transportOrderId: expectString(row.id, 'transport_orders.id'),
    orderNumber: expectString(row.order_number, 'transport_orders.order_number'),
    version: expectNumber(row, 'transport_orders.version'),
    movementType: movementType as TransportOrderDetail['movementType'],
    canDrive: expectBoolean(row.can_drive, 'transport_orders.can_drive'),
    towRequired: expectBoolean(row.tow_required, 'transport_orders.tow_required'),
    pickupStoreId: expectNullableString(row.pickup_store_id),
    deliveryStoreId: expectNullableString(row.delivery_store_id),
    returnStoreId: expectNullableString(row.return_store_id),
    pickupStoreName: expectNullableString(row.pickup_store_name),
    deliveryStoreName: expectNullableString(row.delivery_store_name),
    returnStoreName: expectNullableString(row.return_store_name),
    requestedPickupAt: expectNullableDate(row.requested_pickup_at),
    requestedDeliveryAt: expectNullableDate(row.requested_delivery_at),
    requestedReturnAt: expectNullableDate(row.requested_return_at),
    notificationSentAt: expectNullableDate(row.notification_sent_at),
    vendorResponse: vendorResponse as TransportOrderDetail['vendorResponse'],
    vendorResponseAt: expectNullableDate(row.vendor_response_at),
    storeConfirmedAt: expectNullableDate(row.store_confirmed_at),
    statusKey: expectString(row.status_key, 'statuses.key'),
    statusName: expectString(row.status_name, 'statuses.name'),
    vendorId: expectNullableString(row.vendor_id),
    vendorName: expectNullableString(row.vendor_name),
    notes: expectNullableString(row.notes),
    createdAt: expectNullableDate(row.created_at) ?? (() => {
      throw new Error('transport_orders.created_at must not be null');
    })(),
  };
}

function expectTransportOrderInvitationItem(
  row: Record<string, unknown>,
): TransportOrderInvitationItem {
  const response = expectString(row.response, 'transport_order_invitations.response');
  if (!INVITATION_RESPONSES.includes(response as (typeof INVITATION_RESPONSES)[number])) {
    throw new Error(`Unknown invitation response: ${response}`);
  }

  return {
    invitationId: expectString(row.invitation_id, 'transport_order_invitations.id'),
    vendorId: expectNullableString(row.vendor_id),
    vendorName: expectNullableString(row.vendor_name),
    inviteeEmail: expectNullableString(row.invitee_email),
    inviteeName: expectNullableString(row.invitee_name),
    response: response as TransportOrderInvitationItem['response'],
    invitedAt: expectNullableDate(row.invited_at) ?? (() => {
      throw new Error('transport_order_invitations.invited_at must not be null');
    })(),
    respondedAt: expectNullableDate(row.responded_at),
    isWinningBid: expectBoolean(
      row.is_winning_bid,
      'transport_order_invitations.is_winning_bid',
    ),
  };
}

function expectTransportOrderNotificationItem(
  row: Record<string, unknown>,
): TransportOrderNotificationItem {
  const status = expectString(row.status, 'notification_outbox.status');
  if (!OUTBOX_STATUSES.includes(status as (typeof OUTBOX_STATUSES)[number])) {
    throw new Error(`Unknown outbox status: ${status}`);
  }

  return {
    outboxId: expectString(row.outbox_id, 'notification_outbox.id'),
    eventType: expectString(row.event_type, 'notification_outbox.event_type'),
    status: status as TransportOrderNotificationItem['status'],
    attempts: expectNumber(row, 'attempts'),
    createdAt: expectNullableDate(row.created_at) ?? (() => {
      throw new Error('notification_outbox.created_at must not be null');
    })(),
    sentAt: expectNullableDate(row.sent_at),
    lastError: expectNullableString(row.last_error),
  };
}

export async function getTransportOrderDetail(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  companyId: string,
  id: string,
): Promise<TransportOrderDetail | null> {
  const detailResult = await db.execute(sql`
    SELECT
      t.id,
      t.order_number,
      t.movement_type,
      t.version,
      t.can_drive,
      t.tow_required,
      t.pickup_store_id,
      t.delivery_store_id,
      t.return_store_id,
      ps.name AS pickup_store_name,
      ds.name AS delivery_store_name,
      rs.name AS return_store_name,
      t.requested_pickup_at,
      t.requested_delivery_at,
      t.requested_return_at,
      t.notification_sent_at,
      t.vendor_response,
      t.vendor_response_at,
      t.store_confirmed_at,
      t.notes,
      t.created_at,
      t.vendor_id,
      s.key AS status_key,
      s.name AS status_name,
      v.name AS vendor_name
    FROM transport_orders t
    INNER JOIN statuses s ON t.status_id = s.id
    LEFT JOIN vendors v ON t.vendor_id = v.id
    LEFT JOIN stores ps ON t.pickup_store_id = ps.id
    LEFT JOIN stores ds ON t.delivery_store_id = ds.id
    LEFT JOIN stores rs ON t.return_store_id = rs.id
    WHERE t.id = ${id}
      AND t.company_id = ${companyId}
      AND t.deleted_at IS NULL
  `);

  const detailRows = getExecuteRows(detailResult);
  if (detailRows.length === 0) {
    return null;
  }

  const detail = expectTransportOrderDetailBase(detailRows[0] as Record<string, unknown>);

  const [invitationsResult, notificationsResult] = await Promise.all([
    db.execute(sql`
      SELECT
        toi.id AS invitation_id,
        toi.vendor_id,
        v.name AS vendor_name,
        toi.invitee_email,
        toi.invitee_name,
        toi.response,
        toi.invited_at,
        toi.responded_at,
        toi.is_winning_bid
      FROM transport_order_invitations toi
      LEFT JOIN vendors v ON toi.vendor_id = v.id
      WHERE toi.transport_order_id = ${id}
        AND toi.company_id = ${companyId}
      ORDER BY toi.is_winning_bid DESC, toi.invited_at DESC, toi.id DESC
    `),
    db.execute(sql`
      SELECT
        n.id AS outbox_id,
        n.event_type,
        n.status,
        n.attempts,
        n.created_at,
        n.sent_at,
        n.last_error
      FROM notification_outbox n
      WHERE n.company_id = ${companyId}
        AND (
          n.transport_order_id = ${id}
          OR n.transport_order_invitation_id IN (
            SELECT id FROM transport_order_invitations
            WHERE transport_order_id = ${id}
              AND company_id = ${companyId}
          )
        )
      ORDER BY n.created_at DESC
    `),
  ]);

  return {
    ...detail,
    invitations: getExecuteRows(invitationsResult).map((row) =>
      expectTransportOrderInvitationItem(row as Record<string, unknown>),
    ),
    notifications: getExecuteRows(notificationsResult).map((row) =>
      expectTransportOrderNotificationItem(row as Record<string, unknown>),
    ),
  };
}
