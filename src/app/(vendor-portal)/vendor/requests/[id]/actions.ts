"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { withAuthenticatedDb } from "@/lib/db/with-auth";
import { respondToInvitation } from "@/lib/services/spot-invitations";
import {
  completeTransportOrder,
  ConcurrentTransportOrderResponseError,
  InvalidResponseValueError,
  InvitationNotAcceptedError,
  InvitationNotPendingError,
  scheduleTransportOrder,
  StatusSeedMissingError,
  StatusTransitionError,
  TransportOrderNotCompletableError,
  VendorAuthError,
} from "@/lib/services/transport-orders";
import { createClient } from "@/lib/supabase/server";

function optionalDate(formData: FormData, key: string): Date | undefined {
  const raw = formData.get(key);
  if (typeof raw !== "string" || raw.length === 0) {
    return undefined;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

async function requireVendorUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    redirect("/vendor/login");
  }
  return user;
}

const inputSchema = z.object({
  invitationId: z.string().uuid(),
  response: z.enum(["accepted", "rejected"]),
  reason: z.string().max(500).optional(),
});

export async function respondAction(formData: FormData): Promise<never> {
  const parsed = inputSchema.safeParse({
    invitationId: formData.get("invitationId"),
    response: formData.get("response"),
    reason: formData.get("reason") || undefined,
  });

  if (!parsed.success) {
    redirect(`/vendor/requests/${formData.get("invitationId")}?error=invalid_input`);
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/vendor/login");
  }

  try {
    await withAuthenticatedDb(user.id, (tx) => respondToInvitation(tx, parsed.data));
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;

    switch (code) {
      case InvitationNotPendingError.code:
        redirect(`/vendor/requests/${parsed.data.invitationId}?error=not_pending`);
      case VendorAuthError.code:
        redirect("/vendor/login?error=auth_required");
      case ConcurrentTransportOrderResponseError.code:
        redirect(`/vendor/requests/${parsed.data.invitationId}?error=concurrent`);
      case StatusTransitionError.code:
        redirect(`/vendor/requests/${parsed.data.invitationId}?error=transition`);
      case InvalidResponseValueError.code:
        redirect(`/vendor/requests/${parsed.data.invitationId}?error=invalid_response`);
      case StatusSeedMissingError.code:
        redirect(`/vendor/requests/${parsed.data.invitationId}?error=seed_missing`);
      default:
        throw e;
    }
  }

  revalidatePath("/vendor/requests");
  redirect("/vendor/requests");
}

const scheduleSchema = z.object({
  invitationId: z.string().uuid(),
});

export async function scheduleAction(formData: FormData): Promise<never> {
  const parsed = scheduleSchema.safeParse({ invitationId: formData.get("invitationId") });
  if (!parsed.success) {
    redirect(`/vendor/requests/${formData.get("invitationId")}?error=invalid_input`);
  }

  const user = await requireVendorUser();
  const invitationId = parsed.data.invitationId;

  try {
    await withAuthenticatedDb(user.id, (tx) =>
      scheduleTransportOrder(tx, {
        invitationId,
        scheduledPickupAt: optionalDate(formData, "scheduledPickupAt"),
        scheduledDeliveryAt: optionalDate(formData, "scheduledDeliveryAt"),
        scheduledReturnAt: optionalDate(formData, "scheduledReturnAt"),
      }),
    );
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    switch (code) {
      case InvitationNotAcceptedError.code:
        redirect(`/vendor/requests/${invitationId}?error=not_accepted`);
      case VendorAuthError.code:
        redirect("/vendor/login?error=auth_required");
      default:
        throw e;
    }
  }

  revalidatePath(`/vendor/requests/${invitationId}`);
  redirect(`/vendor/requests/${invitationId}?scheduled=1`);
}

export async function completeAction(formData: FormData): Promise<never> {
  const parsed = scheduleSchema.safeParse({ invitationId: formData.get("invitationId") });
  if (!parsed.success) {
    redirect(`/vendor/requests/${formData.get("invitationId")}?error=invalid_input`);
  }

  const user = await requireVendorUser();
  const invitationId = parsed.data.invitationId;

  try {
    await withAuthenticatedDb(user.id, (tx) =>
      completeTransportOrder(tx, {
        invitationId,
        pickedUpAt: optionalDate(formData, "pickedUpAt"),
        deliveredAt: optionalDate(formData, "deliveredAt"),
        returnedAt: optionalDate(formData, "returnedAt"),
      }),
    );
  } catch (e: unknown) {
    const code = (e as { code?: string })?.code;
    switch (code) {
      case TransportOrderNotCompletableError.code:
        redirect(`/vendor/requests/${invitationId}?error=not_completable`);
      case ConcurrentTransportOrderResponseError.code:
        redirect(`/vendor/requests/${invitationId}?error=concurrent`);
      case VendorAuthError.code:
        redirect("/vendor/login?error=auth_required");
      default:
        throw e;
    }
  }

  revalidatePath(`/vendor/requests/${invitationId}`);
  redirect(`/vendor/requests/${invitationId}?completed=1`);
}
