// Phase 24 spot invitation MVP service layer.
// References: 27_spot_rpc.sql and Phase 22 reject-closing parity.
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import {
  ConcurrentTransportOrderResponseError,
  InvitationNotPendingError,
  InvalidResponseValueError,
  RespondToTransportOrderInput,
  RespondToTransportOrderResult,
  StatusSeedMissingError,
  StatusTransitionError,
  VendorAuthError,
  respondToTransportOrder,
} from "@/lib/services/transport-orders";
import { closeTransportOrderOnAllRejected } from "@/lib/services/close-transport-order";

export const RespondToSpotInvitationInput = z
  .object({
    invitationId: z.string().uuid(),
    response: z.enum(["accepted", "rejected"]),
    reason: z.string().max(500).optional(),
  })
  .strict();

export type RespondToSpotInvitationInput = z.input<typeof RespondToSpotInvitationInput>;

export interface RespondToSpotInvitationResult extends RespondToTransportOrderResult {
  boundVendorId: string;
  boundVendorUserId: string;
}

export async function respondToSpotInvitation(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: RespondToSpotInvitationInput,
): Promise<RespondToSpotInvitationResult> {
  const parsed = RespondToSpotInvitationInput.parse(input);

  try {
    const result = await db.execute(sql`
      SELECT transport_order_id, version, invitation_id, new_status_id, history_id, bound_vendor_id, bound_vendor_user_id
      FROM public.respond_to_spot_invitation(
        ${parsed.invitationId}::uuid,
        ${parsed.response}::text,
        ${parsed.reason ?? null}::text
      )
    `);

    // drizzle-orm execute return shape varies by driver:
    // postgres.js driver: array directly; node-postgres: { rows: [...] }
    const rows = (result as unknown as { rows?: unknown }).rows ?? result;
    const row = Array.isArray(rows) ? rows[0] : rows;
    if (!row) {
      throw new Error("respond_to_spot_invitation returned no rows");
    }

    const transportOrderId =
      (row as { transport_order_id?: string; transportOrderId?: string }).transport_order_id ??
      (row as { transportOrderId?: string }).transportOrderId;
    const invitationId =
      (row as { invitation_id?: string; invitationId?: string }).invitation_id ??
      (row as { invitationId?: string }).invitationId;
    const boundVendorId =
      (row as { bound_vendor_id?: string; boundVendorId?: string }).bound_vendor_id ??
      (row as { boundVendorId?: string }).boundVendorId;
    const boundVendorUserId =
      (row as { bound_vendor_user_id?: string; boundVendorUserId?: string }).bound_vendor_user_id ??
      (row as { boundVendorUserId?: string }).boundVendorUserId;

    if (!transportOrderId) {
      throw new Error("respond_to_spot_invitation returned no transport_order_id");
    }
    if (!invitationId) {
      throw new Error("respond_to_spot_invitation returned no invitation_id");
    }
    if (!boundVendorId) {
      throw new Error("respond_to_spot_invitation returned no bound_vendor_id");
    }
    if (!boundVendorUserId) {
      throw new Error("respond_to_spot_invitation returned no bound_vendor_user_id");
    }

    const orderRow = await db.execute(sql`
      SELECT s.key AS status_key, s.is_terminal AS is_terminal
      FROM transport_orders t
      JOIN statuses s ON s.id = t.status_id
      WHERE t.id = ${transportOrderId}
        AND t.company_id = (SELECT company_id FROM transport_order_invitations WHERE id = ${parsed.invitationId})
        AND t.deleted_at IS NULL
      LIMIT 1
    `);
    const orderRows = (orderRow as unknown as { rows?: unknown }).rows ?? orderRow;
    const order = Array.isArray(orderRows) ? orderRows[0] : orderRows;
    const orderStatus = order as { status_key?: string; is_terminal?: boolean } | undefined;
    if (orderStatus && (orderStatus.status_key === "cancelled" || orderStatus.is_terminal === true)) {
      throw new StatusTransitionError(
        `cannot respond to transport order in status '${orderStatus.status_key}'`,
      );
    }

    const respondResult: RespondToSpotInvitationResult = {
      transportOrderId,
      invitationId,
      version: Number((row as { version?: number | string }).version),
      newStatusId:
        (row as { new_status_id?: string | null; newStatusId?: string | null }).new_status_id ??
        (row as { newStatusId?: string | null }).newStatusId ??
        null,
      historyId:
        (row as { history_id?: string | null; historyId?: string | null }).history_id ??
        (row as { historyId?: string | null }).historyId ??
        null,
      boundVendorId,
      boundVendorUserId,
    };

    if (parsed.response === "rejected") {
      const closeResult = await closeTransportOrderOnAllRejected(db, respondResult.transportOrderId);
      respondResult.closed = closeResult.closed;
      if (closeResult.closed && closeResult.newStatusId) {
        respondResult.newStatusId = closeResult.newStatusId;
      }
    }

    return respondResult;
  } catch (err: unknown) {
    const code = (err as { code?: string; cause?: { code?: string } })?.code ??
      (err as { cause?: { code?: string } })?.cause?.code;
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

export const RespondToInvitationInput = z
  .object({
    invitationId: z.string().uuid(),
    response: z.enum(["accepted", "rejected"]),
    reason: z.string().max(500).optional(),
  })
  .strict();

export type RespondToInvitationInput = z.input<typeof RespondToInvitationInput>;

export type RespondToInvitationResult = RespondToTransportOrderResult | RespondToSpotInvitationResult;

export async function respondToInvitation(
  // Drizzle does not export a common interface covering both DB and PgTransaction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  input: RespondToInvitationInput,
): Promise<RespondToInvitationResult> {
  const parsed = RespondToInvitationInput.parse(input);

  const invitationRows = await db
    .select({ vendorId: transportOrderInvitations.vendorId })
    .from(transportOrderInvitations)
    .where(eq(transportOrderInvitations.id, parsed.invitationId))
    .limit(1);

  const invitation = invitationRows[0];
  if (!invitation) {
    throw new InvitationNotPendingError("Invitation not found");
  }

  if (invitation.vendorId === null) {
    return respondToSpotInvitation(db, parsed);
  }

  return respondToTransportOrder(db, parsed as RespondToTransportOrderInput);
}
