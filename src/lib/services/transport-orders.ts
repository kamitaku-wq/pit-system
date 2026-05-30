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
    if (
      orderStatus &&
      (orderStatus.status_key === "cancelled" || orderStatus.is_terminal === true)
    ) {
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
          t.cancelled_at,
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
            cancelled_at?: Date | string | null;
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

      // spec §7.8 / §15.6: cancel アクションを transport_order_change_logs に記録
      // requires_notification=false: 既存 `to:{id}:cancelled:v{ver}` outbox が通知責任、二重通知防止
      // snapshot 4+1 フィールド (reason 除外: status_history + outbox payload に既存)
      const changeLogBefore = {
        status_id: currentOrderRow.status_id,
        status_key: currentOrderRow.status_key,
        version: currentOrderRow.version,
        vendor_id: currentOrderRow.vendor_id,
        cancelled_at: currentOrderRow.cancelled_at ?? null,
      };
      const changeLogAfter = {
        status_id: cancelledStatusId,
        status_key: "cancelled",
        version: updatedOrderRow.version,
        vendor_id: currentOrderRow.vendor_id,
        cancelled_at: cancelledAt.toISOString(),
      };
      await tx.execute(sql`
        INSERT INTO transport_order_change_logs
          (company_id, transport_order_id, change_type, before_json, after_json, changed_by_user_id, requires_notification)
        VALUES
          (${companyId}, ${parsed.transportOrderId}, 'cancelled', ${changeLogBefore}, ${changeLogAfter}, ${userId}, false)
      `);
      const revokedInvitationIds = invitationRows
        .map((row) => {
          const invitationRow = row as {
            id?: string;
            vendor_id?: string | null;
            invitee_email?: string | null;
            response?: string;
          };
          return invitationRow.id ?? "";
        })
        .filter((id) => id.length > 0);

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

// ── Phase 64-C.4.1 再割当コア (L3-3 次候補打診 + L3-5 手動切替) ──────────────────
//
// 業者対応不可 (rejected stall) の order を別 vendor へ再割当して再オープンする。
// L3-3 (fallback = 次候補打診) と L3-5 (manual = 手動切替) は「別 vendor へ再割当」という
// 同一操作で、差分は (change_type / selection_method / selection_reason) のタグのみ。1 service +
// mode param に統合し、2 つの薄い admin action で呼び分ける (DRY, D-C4-2)。
//
// 設計判断 (C.4.1 確定, [2026-05-30]):
//   - **rejected stall からの再割当に限定**: requirements §16「業者対応不可時のフォールバック」に
//     忠実に、'rejected' 状態の order のみ再割当可。accepted (応答済) / requested (応答待ち) からの
//     vendor 差し替えは別仕様 (将来) で、accepted→requested 遷移も未 seed ゆえ MVP scope 外。
//     → ReassignNotRejectedError。完了/キャンセル (真 terminal) も当然不可 (同エラーに集約)。
//   - **invitation upsert** (OPEN-1 解決): transport_order_invitations_transport_order_vendor_unique
//     = UNIQUE(transport_order_id, vendor_id) WHERE vendor_id IS NOT NULL のため、過去に打診した
//     vendor を再選択すると新規 INSERT が衝突する。helper は「同 (order, newVendor) の既存 invitation が
//     あれば response='pending' に戻す UPDATE、なければ INSERT」で衝突を回避する。
//   - **attempt_seq は純増 INSERT** (OPEN-2): invitation を再利用しても attempts は毎回新 attempt_seq で
//     記録する (試行回数の真の記録)。invitation 1 行が複数 attempt に対応しうる。
//   - **scalar リセット** (close 再発火防止): vendor_response は NOT NULL DEFAULT 'pending' ゆえ NULL 不可、
//     'pending' にリセットする (plan の NULL 案は誤り)。これと旧 invitation revoke + 新 pending invitation に
//     より close_transport_order は v_pending>0 で再発火しない (C.4.0 で検証済)。

export const ReassignTransportOrderVendorInput = z
  .object({
    transportOrderId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    newVendorId: z.string().uuid(),
    mode: z.enum(["fallback", "manual"]),
    selectionReasonNote: z.string().max(1000).optional(),
    consideredVendorIds: z.array(z.string().uuid()).optional(),
    reason: z.string().max(1000).optional(),
  })
  .strict();

export type ReassignTransportOrderVendorInput = z.input<
  typeof ReassignTransportOrderVendorInput
>;

export interface ReassignTransportOrderVendorResult {
  transportOrderId: string;
  newVersion: number;
  newVendorId: string;
  newInvitationId: string;
  attemptSeq: number;
  notificationOutboxId: string;
  idempotencyKey: string;
}

export class ReassignNotRejectedError extends Error {
  static readonly code = "REASSIGN_NOT_REJECTED" as const;
  readonly code = ReassignNotRejectedError.code;

  constructor(
    message = "transport order is not in 'rejected' status; reassignment is only allowed after vendor decline",
  ) {
    super(message);
    this.name = "ReassignNotRejectedError";
  }
}

export class ConcurrentTransportOrderReassignError extends Error {
  static readonly code = "CONCURRENT_REASSIGN" as const;
  readonly code = ConcurrentTransportOrderReassignError.code;

  constructor(message = "transport order reassign: optimistic version mismatch") {
    super(message);
    this.name = "ConcurrentTransportOrderReassignError";
  }
}

// mode → タグの対応表 (vendor_selection_logs.selection_method/selection_reason + change_logs.change_type)。
const REASSIGN_MODE_TAGS = {
  fallback: {
    changeType: "rejected_reassigned",
    selectionMethod: "fallback",
    selectionReason: "vendor_unavailable",
  },
  manual: {
    changeType: "vendor_changed",
    selectionMethod: "manual",
    selectionReason: "manual_preference",
  },
} as const;

// reopenOrderForResolicit: rejected stall の order を targetVendor へ再オープンする共有 helper。
// 旧 invitation revoke → attempt 記録 → invitation upsert → order 再オープン (status→requested + scalar
// リセット) → status_history を 1 tx 内で実行する。reassign (C.4.1) と将来の reschedule (C.4.2) で共有。
// 返り値: { newInvitationId, attemptSeq, newVersion, fromStatusId, fromStatusKey }。
async function reopenOrderForResolicit(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  args: {
    companyId: string;
    userId: string;
    transportOrderId: string;
    expectedVersion: number;
    targetVendorId: string;
    requestedStatusId: string;
    currentStatusId: string;
    currentStatusKey: string;
    reason?: string;
    // C.4.2 reschedule 用: 店舗希望日時 (requested_*_at) を同 UPDATE 内で更新する (指定列のみ COALESCE)。
    requestedPickupAt?: Date | null;
    requestedDeliveryAt?: Date | null;
    requestedReturnAt?: Date | null;
  },
): Promise<{
  newInvitationId: string;
  attemptSeq: number;
  newVersion: number;
}> {
  // 1) 旧 pending/accepted invitation を revoked に (cancel と同作法)。
  await tx.execute(sql`
    UPDATE transport_order_invitations
    SET response = 'revoked',
        responded_at = now(),
        updated_at = now()
    WHERE transport_order_id = ${args.transportOrderId}
      AND company_id = ${args.companyId}
      AND response IN ('pending', 'accepted')
  `);

  // 2) attempt_seq = MAX(attempt_seq) + 1 で attempts に純増 INSERT (試行ログ)。
  const attemptSeqResult = await tx.execute(sql`
    SELECT COALESCE(MAX(attempt_seq), 0) + 1 AS next_seq
    FROM transport_order_vendor_attempts
    WHERE transport_order_id = ${args.transportOrderId}
  `);
  const attemptSeqRows = (attemptSeqResult as any).rows ?? attemptSeqResult;
  const attemptSeqRow = Array.isArray(attemptSeqRows) ? attemptSeqRows[0] : attemptSeqRows;
  const attemptSeq = Number((attemptSeqRow as { next_seq?: number | string })?.next_seq);
  if (!Number.isInteger(attemptSeq) || attemptSeq < 1) {
    throw new Error("failed to compute next attempt_seq for transport order reopen");
  }

  await tx.execute(sql`
    INSERT INTO transport_order_vendor_attempts
      (company_id, transport_order_id, vendor_id, attempt_seq, requested_at, response)
    VALUES
      (${args.companyId}, ${args.transportOrderId}, ${args.targetVendorId}, ${attemptSeq}, now(), 'pending')
  `);

  // 3) invitation upsert: 同 (order, targetVendor) の既存行があれば pending に戻す、なければ INSERT。
  //    UNIQUE(transport_order_id, vendor_id) WHERE vendor_id IS NOT NULL との衝突を回避する (OPEN-1)。
  const reusedResult = await tx.execute(sql`
    UPDATE transport_order_invitations
    SET response = 'pending',
        is_winning_bid = false,
        responded_at = NULL,
        invited_at = now(),
        invited_by_user_id = ${args.userId},
        bound_vendor_id = NULL,
        bound_vendor_user_id = NULL,
        updated_at = now()
    WHERE transport_order_id = ${args.transportOrderId}
      AND company_id = ${args.companyId}
      AND vendor_id = ${args.targetVendorId}
    RETURNING id
  `);
  const reusedRows = (reusedResult as any).rows ?? reusedResult;
  const reusedRow = Array.isArray(reusedRows) ? reusedRows[0] : reusedRows;
  let newInvitationId = (reusedRow as { id?: string } | undefined)?.id;

  if (!newInvitationId) {
    const insertedResult = await tx.execute(sql`
      INSERT INTO transport_order_invitations
        (company_id, transport_order_id, vendor_id, invited_by_user_id, response, is_winning_bid)
      VALUES
        (${args.companyId}, ${args.transportOrderId}, ${args.targetVendorId}, ${args.userId}, 'pending', false)
      RETURNING id
    `);
    const insertedRows = (insertedResult as any).rows ?? insertedResult;
    const insertedRow = Array.isArray(insertedRows) ? insertedRows[0] : insertedRows;
    newInvitationId = (insertedRow as { id?: string } | undefined)?.id;
  }
  if (!newInvitationId) {
    throw new Error("transport order invitation upsert returned no rows");
  }

  // 4) order 再オープン (IF MATCH version)。rejected → requested 遷移 + scalar リセット。
  //    vendor_response は NOT NULL DEFAULT 'pending' ゆえ 'pending' にリセット (NULL 不可)。
  const updatedResult = await tx.execute(sql`
    UPDATE transport_orders
    SET vendor_id = ${args.targetVendorId},
        status_id = ${args.requestedStatusId},
        vendor_response = 'pending',
        vendor_response_at = NULL,
        vendor_rejection_reason = NULL,
        requested_pickup_at = COALESCE(${args.requestedPickupAt ? args.requestedPickupAt.toISOString() : null}::timestamptz, requested_pickup_at),
        requested_delivery_at = COALESCE(${args.requestedDeliveryAt ? args.requestedDeliveryAt.toISOString() : null}::timestamptz, requested_delivery_at),
        requested_return_at = COALESCE(${args.requestedReturnAt ? args.requestedReturnAt.toISOString() : null}::timestamptz, requested_return_at),
        scheduled_pickup_at = NULL,
        scheduled_delivery_at = NULL,
        scheduled_return_at = NULL,
        store_confirmed_at = NULL,
        store_confirmed_by_user_id = NULL,
        version = version + 1,
        updated_at = now()
    WHERE id = ${args.transportOrderId}
      AND company_id = ${args.companyId}
      AND version = ${args.expectedVersion}
      AND deleted_at IS NULL
      AND status_id = ${args.currentStatusId}
    RETURNING version
  `);
  const updatedRows = (updatedResult as any).rows ?? updatedResult;
  const updatedRow = Array.isArray(updatedRows) ? updatedRows[0] : updatedRows;
  const newVersion = (updatedRow as { version?: number } | undefined)?.version;
  if (typeof newVersion !== "number") {
    // version 不一致 or status が SELECT〜UPDATE 間で変化 (並行再割当/キャンセル等)。
    throw new ConcurrentTransportOrderReassignError();
  }

  // 5) status 変更 (rejected → requested) を status_history に記録。
  await tx.execute(sql`
    INSERT INTO transport_order_status_history
      (company_id, transport_order_id, from_status_id, to_status_id, changed_by_user_id, reason)
    VALUES
      (${args.companyId}, ${args.transportOrderId}, ${args.currentStatusId}, ${args.requestedStatusId}, ${args.userId}, ${args.reason ?? "vendor reassigned (reopen)"})
  `);

  return { newInvitationId, attemptSeq, newVersion };
}

export async function reassignTransportOrderVendor(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: any,
  companyId: string,
  userId: string,
  input: ReassignTransportOrderVendorInput,
): Promise<ReassignTransportOrderVendorResult> {
  const parsed = ReassignTransportOrderVendorInput.parse(input);
  const tags = REASSIGN_MODE_TAGS[parsed.mode];

  return database.transaction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any): Promise<ReassignTransportOrderVendorResult> => {
      // requested status id (再オープン先)。
      const requestedStatusResult = await tx.execute(sql`
        SELECT id
        FROM statuses
        WHERE company_id = ${companyId}
          AND status_type = 'transport'
          AND key = 'requested'
        LIMIT 1
      `);
      const requestedStatusRows = (requestedStatusResult as any).rows ?? requestedStatusResult;
      const requestedStatusRow = Array.isArray(requestedStatusRows)
        ? requestedStatusRows[0]
        : requestedStatusRows;
      const requestedStatusId = (requestedStatusRow as { id?: string } | undefined)?.id;
      if (!requestedStatusId) {
        throw new StatusSeedMissingError("requested status not seeded for this company");
      }

      // order load (company scope + status key)。
      const currentResult = await tx.execute(sql`
        SELECT
          t.id,
          t.version,
          t.deleted_at,
          t.status_id,
          t.vendor_id,
          s.key AS status_key
        FROM transport_orders t
        LEFT JOIN statuses s ON s.id = t.status_id
        WHERE t.id = ${parsed.transportOrderId}
          AND t.company_id = ${companyId}
        LIMIT 1
      `);
      const currentRows = (currentResult as any).rows ?? currentResult;
      const currentRow = (Array.isArray(currentRows) ? currentRows[0] : currentRows) as
        | {
            id?: string;
            version?: number;
            deleted_at?: Date | string | null;
            status_id?: string;
            vendor_id?: string | null;
            status_key?: string;
          }
        | undefined;

      if (!currentRow || currentRow.deleted_at) {
        throw new TransportOrderNotFoundError();
      }

      // 再割当は rejected stall からのみ (completed/cancelled/accepted/requested は不可)。
      if (currentRow.status_key !== "rejected") {
        throw new ReassignNotRejectedError();
      }

      const currentStatusId = currentRow.status_id;
      if (!currentStatusId) {
        throw new Error("transport_orders.status_id must not be null");
      }

      // version 事前チェック (IF MATCH は helper の UPDATE が最終判定)。
      if (currentRow.version !== parsed.expectedVersion) {
        throw new ConcurrentTransportOrderReassignError();
      }

      // newVendorId の active membership 検証 (createTransportOrderWithNotification と同)。
      const membershipRows = await tx.execute(sql`
        SELECT id
        FROM vendor_company_memberships
        WHERE vendor_id = ${parsed.newVendorId}
          AND company_id = ${companyId}
          AND is_enabled = true
          AND deleted_at IS NULL
        LIMIT 1
      `);
      const membershipResultRows = (membershipRows as any).rows ?? membershipRows;
      const membership = Array.isArray(membershipResultRows)
        ? membershipResultRows[0]
        : membershipResultRows;
      if (!membership) {
        throw new VendorMembershipError();
      }

      const oldVendorId = currentRow.vendor_id ?? null;

      // 共有 helper で再オープン (旧 invitation revoke + attempt + invitation upsert + order UPDATE + history)。
      const reopened = await reopenOrderForResolicit(tx, {
        companyId,
        userId,
        transportOrderId: parsed.transportOrderId,
        expectedVersion: parsed.expectedVersion,
        targetVendorId: parsed.newVendorId,
        requestedStatusId,
        currentStatusId,
        currentStatusKey: currentRow.status_key,
        reason: parsed.reason,
      });

      // vendor_selection_logs (業者選定監査)。
      // considered_vendor_ids (uuid[]) は drizzle sql テンプレートが JS 配列を postgres 配列へ自動変換
      // しないため、postgres 配列リテラル文字列 `{uuid1,uuid2}` を構築し ::uuid[] でキャストする
      // (UUID は array literal 内で特殊文字を含まずクォート不要、空配列は '{}')。
      const consideredVendorIds = parsed.consideredVendorIds ?? [];
      const consideredVendorIdsLiteral = `{${consideredVendorIds.join(",")}}`;
      await tx.execute(sql`
        INSERT INTO vendor_selection_logs
          (company_id, transport_order_id, selected_vendor_id, selected_by_user_id,
           selection_method, selection_reason, selection_reason_note, considered_vendor_ids)
        VALUES
          (${companyId}, ${parsed.transportOrderId}, ${parsed.newVendorId}, ${userId},
           ${tags.selectionMethod}, ${tags.selectionReason}, ${parsed.selectionReasonNote ?? null},
           ${consideredVendorIdsLiteral}::uuid[])
      `);

      // change_logs (requires_notification=false: outbox が通知責任)。
      const changeLogBefore = {
        vendor_id: oldVendorId,
        status_key: "rejected",
        version: parsed.expectedVersion,
      };
      const changeLogAfter = {
        vendor_id: parsed.newVendorId,
        status_key: "requested",
        version: reopened.newVersion,
      };
      await tx.execute(sql`
        INSERT INTO transport_order_change_logs
          (company_id, transport_order_id, change_type, before_json, after_json, changed_by_user_id, requires_notification)
        VALUES
          (${companyId}, ${parsed.transportOrderId}, ${tags.changeType}, ${JSON.stringify(changeLogBefore)}::jsonb, ${JSON.stringify(changeLogAfter)}::jsonb, ${userId}, false)
      `);

      // outbox: 新 vendor へ invitation.sent。idempotency_key は invitation id ベースで attempt 間衝突なし。
      const idempotencyKey = `to:${parsed.transportOrderId}:invite:${reopened.newInvitationId}`;
      const notificationPayload = {
        transportOrderId: parsed.transportOrderId,
        invitationId: reopened.newInvitationId,
        vendorId: parsed.newVendorId,
        attemptSeq: reopened.attemptSeq,
        mode: parsed.mode,
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
          ${reopened.newInvitationId},
          ${idempotencyKey},
          'transport_order.invitation.sent',
          'vendor',
          ${parsed.newVendorId},
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
        newVersion: reopened.newVersion,
        newVendorId: parsed.newVendorId,
        newInvitationId: reopened.newInvitationId,
        attemptSeq: reopened.attemptSeq,
        notificationOutboxId,
        idempotencyKey,
      };
    },
  );
}

// ── Phase 64-C.4.2 希望日時変更再依頼 (L3-4) ────────────────────────────────────
//
// 業者対応不可 (rejected stall) の order について、店舗が希望日時 (requested_*_at) を変更して
// **同 vendor** へ再依頼する (requirements §16.2「希望日時変更して同業者へ再依頼」)。
//
// 設計判断 (C.4.2 確定, D-C4-4):
//   - **rejected-only**: 希望日時変更再依頼は業者対応不可フォールバックの一手で、rejected stall からのみ。
//     requested 中 (vendor 未応答) の日時編集は別機能 (order editing) で MVP scope 外。reassign (C.4.1) と
//     対称に rejected 限定とし、共有 helper reopenOrderForResolicit を再利用する。
//   - **同 vendor**: targetVendorId = 現 order.vendor_id。reassign と異なり vendor を変えず、希望日時のみ更新。
//     helper の invitation upsert により同 vendor の既存 (rejected) invitation を pending に戻す。
//   - **希望日時 = requested_*_at** (店舗希望、vendor 入力の scheduled_*_at とは別軸)。helper の order UPDATE で
//     COALESCE 更新 (指定列のみ)。
//   - change_type='datetime_changed'。outbox は invitation.sent (再オープン = 再招待ゆえ reassign と同イベント。
//     idempotency_key=to:{orderId}:invite:{newInvitationId} で attempt 間衝突なし)。

export const RescheduleTransportOrderInput = z
  .object({
    transportOrderId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
    requestedPickupAt: z.date().optional(),
    requestedDeliveryAt: z.date().optional(),
    requestedReturnAt: z.date().optional(),
    reason: z.string().max(1000).optional(),
  })
  .strict()
  .refine(
    (v) =>
      v.requestedPickupAt !== undefined ||
      v.requestedDeliveryAt !== undefined ||
      v.requestedReturnAt !== undefined,
    { message: "at least one of requested_*_at must be provided" },
  );

export type RescheduleTransportOrderInput = z.input<typeof RescheduleTransportOrderInput>;

export interface RescheduleTransportOrderResult {
  transportOrderId: string;
  newVersion: number;
  vendorId: string;
  newInvitationId: string;
  attemptSeq: number;
  notificationOutboxId: string;
  idempotencyKey: string;
}

export class RescheduleNotRejectedError extends Error {
  static readonly code = "RESCHEDULE_NOT_REJECTED" as const;
  readonly code = RescheduleNotRejectedError.code;

  constructor(
    message = "transport order is not in 'rejected' status; reschedule is only allowed after vendor decline",
  ) {
    super(message);
    this.name = "RescheduleNotRejectedError";
  }
}

export class RescheduleNoVendorError extends Error {
  static readonly code = "RESCHEDULE_NO_VENDOR" as const;
  readonly code = RescheduleNoVendorError.code;

  constructor(message = "transport order has no vendor to re-request") {
    super(message);
    this.name = "RescheduleNoVendorError";
  }
}

export async function rescheduleAndRenotifyTransportOrder(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: any,
  companyId: string,
  userId: string,
  input: RescheduleTransportOrderInput,
): Promise<RescheduleTransportOrderResult> {
  const parsed = RescheduleTransportOrderInput.parse(input);

  return database.transaction(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any): Promise<RescheduleTransportOrderResult> => {
      const requestedStatusResult = await tx.execute(sql`
        SELECT id
        FROM statuses
        WHERE company_id = ${companyId}
          AND status_type = 'transport'
          AND key = 'requested'
        LIMIT 1
      `);
      const requestedStatusRows = (requestedStatusResult as any).rows ?? requestedStatusResult;
      const requestedStatusRow = Array.isArray(requestedStatusRows)
        ? requestedStatusRows[0]
        : requestedStatusRows;
      const requestedStatusId = (requestedStatusRow as { id?: string } | undefined)?.id;
      if (!requestedStatusId) {
        throw new StatusSeedMissingError("requested status not seeded for this company");
      }

      const currentResult = await tx.execute(sql`
        SELECT
          t.id,
          t.version,
          t.deleted_at,
          t.status_id,
          t.vendor_id,
          t.requested_pickup_at,
          t.requested_delivery_at,
          t.requested_return_at,
          s.key AS status_key
        FROM transport_orders t
        LEFT JOIN statuses s ON s.id = t.status_id
        WHERE t.id = ${parsed.transportOrderId}
          AND t.company_id = ${companyId}
        LIMIT 1
      `);
      const currentRows = (currentResult as any).rows ?? currentResult;
      const currentRow = (Array.isArray(currentRows) ? currentRows[0] : currentRows) as
        | {
            id?: string;
            version?: number;
            deleted_at?: Date | string | null;
            status_id?: string;
            vendor_id?: string | null;
            requested_pickup_at?: Date | string | null;
            requested_delivery_at?: Date | string | null;
            requested_return_at?: Date | string | null;
            status_key?: string;
          }
        | undefined;

      if (!currentRow || currentRow.deleted_at) {
        throw new TransportOrderNotFoundError();
      }
      if (currentRow.status_key !== "rejected") {
        throw new RescheduleNotRejectedError();
      }
      const currentStatusId = currentRow.status_id;
      if (!currentStatusId) {
        throw new Error("transport_orders.status_id must not be null");
      }
      if (currentRow.version !== parsed.expectedVersion) {
        throw new ConcurrentTransportOrderReassignError();
      }
      const targetVendorId = currentRow.vendor_id;
      if (!targetVendorId) {
        throw new RescheduleNoVendorError();
      }

      // 同 vendor へ再オープン (希望日時を helper の order UPDATE で COALESCE 更新)。
      const reopened = await reopenOrderForResolicit(tx, {
        companyId,
        userId,
        transportOrderId: parsed.transportOrderId,
        expectedVersion: parsed.expectedVersion,
        targetVendorId,
        requestedStatusId,
        currentStatusId,
        currentStatusKey: currentRow.status_key,
        reason: parsed.reason ?? "datetime changed, re-requested (reschedule)",
        requestedPickupAt: parsed.requestedPickupAt,
        requestedDeliveryAt: parsed.requestedDeliveryAt,
        requestedReturnAt: parsed.requestedReturnAt,
      });

      // change_logs (datetime_changed, requires_notification=false: outbox が通知責任)。
      // before/after は requested_*_at の値遷移を記録する。
      const changeLogBefore = {
        requested_pickup_at:
          currentRow.requested_pickup_at instanceof Date
            ? currentRow.requested_pickup_at.toISOString()
            : (currentRow.requested_pickup_at ?? null),
        requested_delivery_at:
          currentRow.requested_delivery_at instanceof Date
            ? currentRow.requested_delivery_at.toISOString()
            : (currentRow.requested_delivery_at ?? null),
        requested_return_at:
          currentRow.requested_return_at instanceof Date
            ? currentRow.requested_return_at.toISOString()
            : (currentRow.requested_return_at ?? null),
        status_key: "rejected",
        version: parsed.expectedVersion,
      };
      const changeLogAfter = {
        requested_pickup_at:
          parsed.requestedPickupAt?.toISOString() ?? changeLogBefore.requested_pickup_at,
        requested_delivery_at:
          parsed.requestedDeliveryAt?.toISOString() ?? changeLogBefore.requested_delivery_at,
        requested_return_at:
          parsed.requestedReturnAt?.toISOString() ?? changeLogBefore.requested_return_at,
        status_key: "requested",
        version: reopened.newVersion,
      };
      await tx.execute(sql`
        INSERT INTO transport_order_change_logs
          (company_id, transport_order_id, change_type, before_json, after_json, changed_by_user_id, requires_notification)
        VALUES
          (${companyId}, ${parsed.transportOrderId}, 'datetime_changed', ${JSON.stringify(changeLogBefore)}::jsonb, ${JSON.stringify(changeLogAfter)}::jsonb, ${userId}, false)
      `);

      // outbox: 同 vendor へ invitation.sent (再オープン = 再招待)。
      const idempotencyKey = `to:${parsed.transportOrderId}:invite:${reopened.newInvitationId}`;
      const notificationPayload = {
        transportOrderId: parsed.transportOrderId,
        invitationId: reopened.newInvitationId,
        vendorId: targetVendorId,
        attemptSeq: reopened.attemptSeq,
        reason: "reschedule",
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
          ${reopened.newInvitationId},
          ${idempotencyKey},
          'transport_order.invitation.sent',
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
        newVersion: reopened.newVersion,
        vendorId: targetVendorId,
        newInvitationId: reopened.newInvitationId,
        attemptSeq: reopened.attemptSeq,
        notificationOutboxId,
        idempotencyKey,
      };
    },
  );
}

export const ConfirmTransportOrderInput = z
  .object({
    transportOrderId: z.string().uuid(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .strict();

export type ConfirmTransportOrderInput = z.input<typeof ConfirmTransportOrderInput>;

export interface ConfirmTransportOrderResult {
  transportOrderId: string;
  newVersion: number;
  storeConfirmedAt: Date;
  notificationOutboxId: string;
  idempotencyKey: string;
}

export class ConcurrentTransportOrderConfirmError extends Error {
  constructor(message = "transport order confirm: optimistic version mismatch") {
    super(message);
    this.name = "ConcurrentTransportOrderConfirmError";
  }
}

export class AlreadyStoreConfirmedError extends Error {
  constructor(message = "transport order is already store-confirmed") {
    super(message);
    this.name = "AlreadyStoreConfirmedError";
  }
}

export class NotAcceptedForConfirmError extends Error {
  constructor(message = "transport order must be in 'accepted' status to store-confirm") {
    super(message);
    this.name = "NotAcceptedForConfirmError";
  }
}

export class NotManualModeError extends Error {
  constructor(message = "transport order is not in 'manual' confirmation mode") {
    super(message);
    this.name = "NotManualModeError";
  }
}

// Phase 64-C.2 (L3-8): 店舗による manual 確定。confirmation_mode='manual' で accept された案件を
// 店舗が確定して store_confirmed_at / store_confirmed_by_user_id をセットし、業者へ確定通知を
// outbox に enqueue する。
//   - service_role db (RLS / column GRANT bypass) 経由で呼ぶ前提 (admin action, cancelTransportOrder と同経路)。
//     store_confirmed_at は vendor/authenticated の column GRANT 外のため、この経路でのみ書ける。
//   - store_confirmed_at は status 変更ではない (status は 'accepted' のまま) → status_history /
//     transport_order_change_logs は書かない (change_type CHECK に 'store_confirmed' は無く、
//     監査は audit_logs trigger の UPDATE 記録が担い、通知は本 outbox が担う)。
//   - 冪等: UPDATE は store_confirmed_at IS NULL を条件に含むため二重確定しない。
//     idempotency_key `to:{id}:store_confirmed:v{newVersion}` (spec §15.6)。
//   - auto 確定 (C.1 trigger) との関係: auto 案件は accept 時に store_confirmed_at が既にセット済のため、
//     本 action の store_confirmed_at IS NULL ガードで弾かれる (= 本 action は実質 manual 専用)。
export async function confirmTransportOrder(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  database: any,
  companyId: string,
  userId: string,
  input: ConfirmTransportOrderInput,
): Promise<ConfirmTransportOrderResult> {
  const parsed = ConfirmTransportOrderInput.parse(input);

  return database.transaction(
    // Drizzle does not export a common interface covering both DB and PgTransaction.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    async (tx: any): Promise<ConfirmTransportOrderResult> => {
      const acceptedStatusResult = await tx.execute(sql`
        SELECT id
        FROM statuses
        WHERE company_id = ${companyId}
          AND status_type = 'transport'
          AND key = 'accepted'
        LIMIT 1
      `);
      const acceptedStatusRows = (acceptedStatusResult as any).rows ?? acceptedStatusResult;
      const acceptedStatusRow = Array.isArray(acceptedStatusRows)
        ? acceptedStatusRows[0]
        : acceptedStatusRows;
      const acceptedStatusId = (acceptedStatusRow as { id?: string } | undefined)?.id;
      if (!acceptedStatusId) {
        throw new StatusSeedMissingError("accepted status not seeded for this company");
      }

      const currentResult = await tx.execute(sql`
        SELECT
          t.id,
          t.version,
          t.deleted_at,
          t.status_id,
          t.vendor_id,
          t.confirmation_mode,
          t.store_confirmed_at,
          s.key AS status_key
        FROM transport_orders t
        LEFT JOIN statuses s ON s.id = t.status_id
        WHERE t.id = ${parsed.transportOrderId}
          AND t.company_id = ${companyId}
        LIMIT 1
      `);
      const currentRows = (currentResult as any).rows ?? currentResult;
      const currentRow = (Array.isArray(currentRows) ? currentRows[0] : currentRows) as
        | {
            id?: string;
            version?: number;
            deleted_at?: Date | string | null;
            status_id?: string;
            vendor_id?: string | null;
            confirmation_mode?: string;
            store_confirmed_at?: Date | string | null;
            status_key?: string;
          }
        | undefined;

      if (!currentRow || currentRow.deleted_at) {
        throw new TransportOrderNotFoundError();
      }

      const updateResult = await tx.execute(sql`
        UPDATE transport_orders
        SET store_confirmed_at = now(),
            store_confirmed_by_user_id = ${userId},
            version = version + 1,
            updated_at = now()
        WHERE id = ${parsed.transportOrderId}
          AND company_id = ${companyId}
          AND version = ${parsed.expectedVersion}
          AND deleted_at IS NULL
          AND store_confirmed_at IS NULL
          AND confirmation_mode = 'manual'
          AND status_id = ${acceptedStatusId}
        RETURNING id, version, store_confirmed_at
      `);
      const updateRows = (updateResult as any).rows ?? updateResult;
      const updatedRow = (Array.isArray(updateRows) ? updateRows[0] : updateRows) as
        | { id?: string; version?: number; store_confirmed_at?: Date | string | null }
        | undefined;

      if (!updatedRow) {
        // currentRow は UPDATE 前に存在確認済 (上で !currentRow/deleted_at は NotFound 済)。
        // 各分岐は pre-UPDATE snapshot で原因を区別する。
        if (currentRow.store_confirmed_at) {
          throw new AlreadyStoreConfirmedError();
        }
        if (currentRow.status_key !== "accepted") {
          throw new NotAcceptedForConfirmError();
        }
        if (currentRow.confirmation_mode !== "manual") {
          throw new NotManualModeError();
        }
        if (currentRow.version !== parsed.expectedVersion) {
          throw new ConcurrentTransportOrderConfirmError();
        }
        // snapshot 上は確定可能 (accepted/manual/未確定/version 一致) だが 0 行 = SELECT〜UPDATE 間で
        // 並行に変更された (二重確定レース等)。NotFound でなく Concurrent を返す (Codex C.2 review W2)。
        throw new ConcurrentTransportOrderConfirmError();
      }

      const storeConfirmedAt = expectNullableDate(updatedRow.store_confirmed_at);
      if (!storeConfirmedAt) {
        throw new Error("transport_orders.store_confirmed_at must not be null after confirm");
      }
      const newVersion = updatedRow.version;
      if (typeof newVersion !== "number") {
        throw new Error("transport_orders.version must not be null after confirm");
      }
      const targetVendorId = currentRow.vendor_id;
      if (!targetVendorId) {
        throw new Error("transport_orders.vendor_id must not be null for confirm notification");
      }

      const idempotencyKey = `to:${parsed.transportOrderId}:store_confirmed:v${newVersion}`;
      const notificationPayload = {
        transportOrderId: parsed.transportOrderId,
        storeConfirmedAt: storeConfirmedAt.toISOString(),
        confirmedByUserId: userId,
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
          'transport_order.store_confirmed',
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
        storeConfirmedAt,
        notificationOutboxId,
        idempotencyKey,
      };
    },
  );
}

// ── Phase 64-C.3 (L2-11 予定入力 / L2-12 完了報告) ──────────────────────────────

export const ScheduleTransportOrderInput = z
  .object({
    invitationId: z.string().uuid(),
    scheduledPickupAt: z.date().optional(),
    scheduledDeliveryAt: z.date().optional(),
    scheduledReturnAt: z.date().optional(),
  })
  .strict();

export type ScheduleTransportOrderInput = z.input<typeof ScheduleTransportOrderInput>;

export const CompleteTransportOrderInput = z
  .object({
    invitationId: z.string().uuid(),
    pickedUpAt: z.date().optional(),
    deliveredAt: z.date().optional(),
    returnedAt: z.date().optional(),
  })
  .strict();

export type CompleteTransportOrderInput = z.input<typeof CompleteTransportOrderInput>;

export interface CompleteTransportOrderResult {
  transportOrderId: string;
  version: number;
  newStatusId: string;
  historyId: string;
}

export class InvitationNotAcceptedError extends Error {
  static readonly code = "INVITATION_NOT_ACCEPTED" as const;
  readonly code = InvitationNotAcceptedError.code;
  constructor(message = "invitation is not accepted (cannot schedule/complete)") {
    super(message);
    this.name = "InvitationNotAcceptedError";
  }
}

export class TransportOrderNotCompletableError extends Error {
  static readonly code = "TRANSPORT_ORDER_NOT_COMPLETABLE" as const;
  readonly code = TransportOrderNotCompletableError.code;
  constructor(message = "transport order is not in a completable (accepted) state") {
    super(message);
    this.name = "TransportOrderNotCompletableError";
  }
}

// L2-11 予定入力: vendor が引取/搬入/返却の予定日時を入力する。scheduled_* は vendor の
// column GRANT 内ゆえ vendor session (withAuthenticatedDb) の直接 UPDATE で完結する (RPC 不要)。
// status_history を伴わない (status 変更でない) ため audit_logs trigger が UPDATE を記録する。
// accept 済 invitation 経由でのみ order を解決し、RLS (vendor_portal_update) が自社案件に限定する。
export async function scheduleTransportOrder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: ScheduleTransportOrderInput,
): Promise<{ transportOrderId: string }> {
  const parsed = ScheduleTransportOrderInput.parse(input);

  const invitationResult = await db.execute(sql`
    SELECT transport_order_id
    FROM transport_order_invitations
    WHERE id = ${parsed.invitationId}
      AND response = 'accepted'
    LIMIT 1
  `);
  const invitationRows = (invitationResult as any).rows ?? invitationResult;
  const invitationRow = Array.isArray(invitationRows) ? invitationRows[0] : invitationRows;
  const transportOrderId = (invitationRow as { transport_order_id?: string } | undefined)
    ?.transport_order_id;
  if (!transportOrderId) {
    throw new InvitationNotAcceptedError();
  }

  // COALESCE で未指定列は既存値維持。RLS vendor_portal_update が自社 (vendor_id) のみ許可。
  // accepted 状態のみ予定編集を許可する (completed/cancelled 等 terminal 案件は対象外, Codex C.3 review)。
  // 相関サブクエリで当該 order の company の accepted status と突合 (0 行 → not completable)。
  const updateResult = await db.execute(sql`
    UPDATE transport_orders
    SET scheduled_pickup_at = COALESCE(${parsed.scheduledPickupAt ?? null}, scheduled_pickup_at),
        scheduled_delivery_at = COALESCE(${parsed.scheduledDeliveryAt ?? null}, scheduled_delivery_at),
        scheduled_return_at = COALESCE(${parsed.scheduledReturnAt ?? null}, scheduled_return_at),
        updated_at = now()
    WHERE id = ${transportOrderId}
      AND deleted_at IS NULL
      AND status_id = (
        SELECT s.id FROM statuses s
        WHERE s.company_id = transport_orders.company_id
          AND s.status_type = 'transport'
          AND s.key = 'accepted'
        LIMIT 1
      )
    RETURNING id
  `);
  const updateRows = (updateResult as any).rows ?? updateResult;
  const updatedRow = Array.isArray(updateRows) ? updateRows[0] : updateRows;
  if (!(updatedRow as { id?: string } | undefined)?.id) {
    // invitation は accepted だが order が accepted 状態でない (terminal 等) → 予定編集不可。
    throw new TransportOrderNotCompletableError();
  }

  return { transportOrderId };
}

// L2-12 完了報告: vendor が accept 済案件を「完了」報告する。status_history を残すため
// (vendor session は history を INSERT 不可) SECURITY DEFINER RPC complete_transport_order
// (post/0030) を呼ぶ。status accepted→completed + picked_up/delivered/returned_at をセット。
// RPC の RAISE EXCEPTION を error class に正規化する (respondToTransportOrder と同方針)。
export async function completeTransportOrder(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: CompleteTransportOrderInput,
): Promise<CompleteTransportOrderResult> {
  const parsed = CompleteTransportOrderInput.parse(input);

  try {
    const result = await db.execute(sql`
      SELECT transport_order_id, version, new_status_id, history_id
      FROM public.complete_transport_order(
        ${parsed.invitationId}::uuid,
        ${parsed.pickedUpAt ?? null}::timestamptz,
        ${parsed.deliveredAt ?? null}::timestamptz,
        ${parsed.returnedAt ?? null}::timestamptz
      )
    `);
    const rows = (result as any).rows ?? result;
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) {
      throw new Error("complete_transport_order returned no rows");
    }
    return {
      transportOrderId: row.transport_order_id ?? row.transportOrderId,
      version: Number(row.version),
      newStatusId: row.new_status_id ?? row.newStatusId,
      historyId: row.history_id ?? row.historyId,
    };
  } catch (err: unknown) {
    const code = (err as any)?.code ?? (err as any)?.cause?.code;
    const message = (err as Error)?.message ?? "";
    if (code === "P0001" && message.toLowerCase().includes("invalid status transition")) {
      // enforce_status_transition (accepted→completed 未 seed 等の防衛線)。respondToTransportOrder と整合。
      throw new StatusTransitionError(message);
    }
    if (code === "42501") {
      throw new VendorAuthError(message);
    }
    if (code === "55P03") {
      throw new ConcurrentTransportOrderResponseError(message);
    }
    if (code === "P0002") {
      // seed 欠落 (運用障害) は業務エラーと区別して StatusSeedMissingError に正規化する。
      if (message.includes("not seeded")) {
        throw new StatusSeedMissingError(message);
      }
      // invitation not accepted / order not found / not in accepted status
      throw new TransportOrderNotCompletableError(message);
    }
    throw err;
  }
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
    latestInvitationResponse:
      latestInvitationResponse as TransportOrderListItem["latestInvitationResponse"],
    latestInvitationRespondedAt: expectNullableDate(row.latest_invitation_responded_at),
    latestInvitationIsWinningBid: expectBooleanOrNull(
      row.latest_invitation_is_winning_bid,
      "transport_order_invitations.is_winning_bid",
    ),
    createdAt:
      expectNullableDate(row.created_at) ??
      (() => {
        throw new Error("transport_orders.created_at must not be null");
      })(),
  };
}

export async function listTransportOrdersWithLatestInvitation(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  companyId: string,
  options?: {
    statusKey?: string;
    vendorResponse?: "pending" | "rejected";
    delayedOnly?: boolean;
    limit?: number;
  },
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
      ${options?.vendorResponse ? sql`AND t.vendor_response = ${options.vendorResponse}` : sql``}
      ${
        options?.delayedOnly
          ? sql`AND t.vendor_response = 'pending' AND t.notification_sent_at IS NOT NULL AND t.notification_sent_at < now() - interval '24 hours'`
          : sql``
      }
    ORDER BY t.created_at DESC
      ${options?.limit !== undefined ? sql`LIMIT ${options.limit}` : sql``}
  `);

  return getExecuteRows(result).map((row) =>
    expectTransportOrderListItem(row as TransportOrderListRow),
  );
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
  if (typeof value === "number") {
    if (Number.isNaN(value)) throw new Error(`Field ${fieldName} is NaN`);
    return value;
  }
  if (typeof value === "string") {
    const n = Number(value);
    if (Number.isNaN(n))
      throw new Error(`Field ${fieldName} is not a valid number string: ${value}`);
    return n;
  }
  if (typeof value === "bigint") {
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
    pendingVendorResponseCount: expectMetricNumber(
      row.pending_vendor_response_count,
      "pending_vendor_response_count",
    ),
    rejectedVendorResponseCount: expectMetricNumber(
      row.rejected_vendor_response_count,
      "rejected_vendor_response_count",
    ),
    delayedNotificationCount: expectMetricNumber(
      row.delayed_notification_count,
      "delayed_notification_count",
    ),
  };
}

export interface TransportOrderInvitationItem {
  invitationId: string;
  vendorId: string | null;
  vendorName: string | null;
  inviteeEmail: string | null;
  inviteeName: string | null;
  response: "pending" | "accepted" | "rejected" | "revoked" | "expired";
  invitedAt: Date;
  respondedAt: Date | null;
  isWinningBid: boolean;
}

export interface TransportOrderNotificationItem {
  outboxId: string;
  eventType: string;
  status: "pending" | "processing" | "sent" | "failed" | "cancelled";
  attempts: number;
  createdAt: Date;
  sentAt: Date | null;
  lastError: string | null;
}

export interface TransportOrderDetail {
  transportOrderId: string;
  orderNumber: string;
  version: number;
  movementType: "one_way" | "round_trip" | "pickup_only" | "three_point";
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
  vendorResponse: "pending" | "accepted" | "rejected";
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

const MOVEMENT_TYPES = ["one_way", "round_trip", "pickup_only", "three_point"] as const;
const VENDOR_RESPONSES = ["pending", "accepted", "rejected"] as const;
const INVITATION_RESPONSES = ["pending", "accepted", "rejected", "revoked", "expired"] as const;
const OUTBOX_STATUSES = ["pending", "processing", "sent", "failed", "cancelled"] as const;

function expectNumber(row: Record<string, unknown>, col: string): number {
  const v = row[col];
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    if (!Number.isNaN(n)) return n;
  }
  throw new Error(`Expected number for ${col}, got ${String(v)}`);
}

function expectTransportOrderDetailBase(
  row: Record<string, unknown>,
): Omit<TransportOrderDetail, "invitations" | "notifications"> {
  const movementType = expectString(row.movement_type, "transport_orders.movement_type");
  if (!MOVEMENT_TYPES.includes(movementType as (typeof MOVEMENT_TYPES)[number])) {
    throw new Error(`Unknown movement type: ${movementType}`);
  }

  const vendorResponse = expectString(row.vendor_response, "transport_orders.vendor_response");
  if (!VENDOR_RESPONSES.includes(vendorResponse as (typeof VENDOR_RESPONSES)[number])) {
    throw new Error(`Unknown vendor response: ${vendorResponse}`);
  }

  return {
    transportOrderId: expectString(row.id, "transport_orders.id"),
    orderNumber: expectString(row.order_number, "transport_orders.order_number"),
    version: expectNumber(row, "transport_orders.version"),
    movementType: movementType as TransportOrderDetail["movementType"],
    canDrive: expectBoolean(row.can_drive, "transport_orders.can_drive"),
    towRequired: expectBoolean(row.tow_required, "transport_orders.tow_required"),
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
    vendorResponse: vendorResponse as TransportOrderDetail["vendorResponse"],
    vendorResponseAt: expectNullableDate(row.vendor_response_at),
    storeConfirmedAt: expectNullableDate(row.store_confirmed_at),
    statusKey: expectString(row.status_key, "statuses.key"),
    statusName: expectString(row.status_name, "statuses.name"),
    vendorId: expectNullableString(row.vendor_id),
    vendorName: expectNullableString(row.vendor_name),
    notes: expectNullableString(row.notes),
    createdAt:
      expectNullableDate(row.created_at) ??
      (() => {
        throw new Error("transport_orders.created_at must not be null");
      })(),
  };
}

function expectTransportOrderInvitationItem(
  row: Record<string, unknown>,
): TransportOrderInvitationItem {
  const response = expectString(row.response, "transport_order_invitations.response");
  if (!INVITATION_RESPONSES.includes(response as (typeof INVITATION_RESPONSES)[number])) {
    throw new Error(`Unknown invitation response: ${response}`);
  }

  return {
    invitationId: expectString(row.invitation_id, "transport_order_invitations.id"),
    vendorId: expectNullableString(row.vendor_id),
    vendorName: expectNullableString(row.vendor_name),
    inviteeEmail: expectNullableString(row.invitee_email),
    inviteeName: expectNullableString(row.invitee_name),
    response: response as TransportOrderInvitationItem["response"],
    invitedAt:
      expectNullableDate(row.invited_at) ??
      (() => {
        throw new Error("transport_order_invitations.invited_at must not be null");
      })(),
    respondedAt: expectNullableDate(row.responded_at),
    isWinningBid: expectBoolean(row.is_winning_bid, "transport_order_invitations.is_winning_bid"),
  };
}

function expectTransportOrderNotificationItem(
  row: Record<string, unknown>,
): TransportOrderNotificationItem {
  const status = expectString(row.status, "notification_outbox.status");
  if (!OUTBOX_STATUSES.includes(status as (typeof OUTBOX_STATUSES)[number])) {
    throw new Error(`Unknown outbox status: ${status}`);
  }

  return {
    outboxId: expectString(row.outbox_id, "notification_outbox.id"),
    eventType: expectString(row.event_type, "notification_outbox.event_type"),
    status: status as TransportOrderNotificationItem["status"],
    attempts: expectNumber(row, "attempts"),
    createdAt:
      expectNullableDate(row.created_at) ??
      (() => {
        throw new Error("notification_outbox.created_at must not be null");
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
