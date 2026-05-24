"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { withAuthenticatedDb } from "@/lib/db/with-auth";
import {
  ConcurrentTransportOrderResponseError,
  InvalidResponseValueError,
  InvitationNotPendingError,
  respondToTransportOrder,
  StatusSeedMissingError,
  StatusTransitionError,
  VendorAuthError,
} from "@/lib/services/transport-orders";
import { createClient } from "@/lib/supabase/server";

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
    await withAuthenticatedDb(user.id, (tx) => respondToTransportOrder(tx, parsed.data));
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
