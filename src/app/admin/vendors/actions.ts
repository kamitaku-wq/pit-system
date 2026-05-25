"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  AdminVendorInvitationAuthError,
  AdminVendorInvitationCrossTenantError,
  AdminVendorInvitationInvalidStateError,
  AdminVendorInvitationNotFoundError,
  AdminVendorInvitationResendTooEarlyError,
  resendAdminVendorInvitation,
  revokeAdminVendorInvitation,
} from "@/lib/services/admin-vendor-invitations";
import { getConfiguredSupabaseAdmin } from "@/lib/supabase/admin";

const invitationIdSchema = z.string().uuid();

export type ResendInvitationActionState = {
  error: string | null;
  success: false;
};

export type RevokeInvitationActionState = {
  error: string | null;
  success: false;
};

function getInvitationId(formData: FormData): string | null {
  const parsed = invitationIdSchema.safeParse(String(formData.get("invitationId") ?? ""));
  return parsed.success ? parsed.data : null;
}

function resendErrorState(error: string): ResendInvitationActionState {
  return { error, success: false };
}

function revokeErrorState(error: string): RevokeInvitationActionState {
  return { error, success: false };
}

function getResendInvitationErrorMessage(error: unknown): string | null {
  if (error instanceof AdminVendorInvitationNotFoundError) {
    return "招待が見つかりません。";
  }
  if (error instanceof AdminVendorInvitationCrossTenantError) {
    return "この招待を再送信できません。";
  }
  if (error instanceof AdminVendorInvitationInvalidStateError) {
    return "この招待は再送信できない状態です。";
  }
  if (error instanceof AdminVendorInvitationResendTooEarlyError) {
    return "前回の再送信から 60 秒以上経過してから再度お試しください。";
  }
  if (error instanceof AdminVendorInvitationAuthError) {
    return "招待メールの再送信に失敗しました。時間をおいて再度お試しください。";
  }
  return null;
}

function getRevokeInvitationErrorMessage(error: unknown): string | null {
  if (error instanceof AdminVendorInvitationNotFoundError) {
    return "招待が見つかりません。";
  }
  if (error instanceof AdminVendorInvitationCrossTenantError) {
    return "この招待を取り消せません。";
  }
  if (error instanceof AdminVendorInvitationInvalidStateError) {
    return "この招待は取り消せない状態です。";
  }
  return null;
}

export async function resendInvitationAction(
  _previousState: ResendInvitationActionState,
  formData: FormData,
): Promise<ResendInvitationActionState> {
  const invitationId = getInvitationId(formData);
  if (!invitationId) {
    return resendErrorState("無効な招待 ID です。");
  }

  const adminUser = await getAdminUser();
  if (!adminUser) {
    return resendErrorState("管理者としてログインしてください。");
  }

  const supabaseAdmin = getConfiguredSupabaseAdmin();
  if (!supabaseAdmin) {
    return resendErrorState("招待メール送信の設定が不足しています。");
  }

  try {
    await resendAdminVendorInvitation(db, supabaseAdmin, adminUser, invitationId);
  } catch (error: unknown) {
    const message = getResendInvitationErrorMessage(error);
    if (message) {
      return resendErrorState(message);
    }
    throw error;
  }

  redirect("/admin/vendors?resent=ok");
}

export async function revokeInvitationAction(
  _previousState: RevokeInvitationActionState,
  formData: FormData,
): Promise<RevokeInvitationActionState> {
  const invitationId = getInvitationId(formData);
  if (!invitationId) {
    return revokeErrorState("無効な招待 ID です。");
  }

  const adminUser = await getAdminUser();
  if (!adminUser) {
    return revokeErrorState("管理者としてログインしてください。");
  }

  try {
    await revokeAdminVendorInvitation(db, adminUser, invitationId);
  } catch (error: unknown) {
    const message = getRevokeInvitationErrorMessage(error);
    if (message) {
      return revokeErrorState(message);
    }
    throw error;
  }

  redirect("/admin/vendors?revoked=ok");
}
