"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  AdminVendorInvitationAuthError,
  AdminVendorInvitationCrossTenantError,
  AdminVendorInvitationDuplicateError,
  createAdminVendorInvitation,
} from "@/lib/services/admin-vendor-invitations";
import { getConfiguredSupabaseAdmin } from "@/lib/supabase/admin";

const roleSchema = z.enum(["vendor_admin", "vendor_member"]);

const inviteVendorSchema = z.object({
  vendorId: z.string().uuid("業者を選択してください。"),
  name: z
    .string()
    .trim()
    .max(100, "名前は100文字以内で入力してください。")
    .optional()
    .transform((value) => (value ? value : null)),
  email: z.string().trim().email("有効なメールアドレスを入力してください。"),
  role: roleSchema,
});

type InviteVendorFormValues = {
  vendorId: string;
  name: string;
  email: string;
  role: string;
};

export type InviteVendorActionState = {
  error: string | null;
  values: InviteVendorFormValues;
};

function getFormValues(formData: FormData): InviteVendorFormValues {
  return {
    vendorId: String(formData.get("vendorId") ?? ""),
    name: String(formData.get("name") ?? ""),
    email: String(formData.get("email") ?? ""),
    role: String(formData.get("role") ?? "vendor_admin"),
  };
}

function getValidationErrorMessage(error: z.ZodError): string {
  return error.issues[0]?.message ?? "入力内容を確認してください。";
}

function getInviteErrorMessage(error: unknown): string | null {
  if (error instanceof AdminVendorInvitationDuplicateError) {
    return "このメールアドレスへの招待はすでに送信されています。";
  }
  if (error instanceof AdminVendorInvitationCrossTenantError) {
    return "選択した業者に招待を送信できません。";
  }
  if (error instanceof AdminVendorInvitationAuthError) {
    return "招待メールの送信に失敗しました。時間をおいて再度お試しください。";
  }
  return null;
}

export async function inviteVendorAction(
  _previousState: InviteVendorActionState,
  formData: FormData,
): Promise<InviteVendorActionState> {
  const values = getFormValues(formData);
  const parsed = inviteVendorSchema.safeParse(values);

  if (!parsed.success) {
    return {
      error: getValidationErrorMessage(parsed.error),
      values,
    };
  }

  const adminUser = await getAdminUser();
  if (!adminUser) {
    return {
      error: "管理者としてログインしてください。",
      values,
    };
  }

  const supabaseAdmin = getConfiguredSupabaseAdmin();
  if (!supabaseAdmin) {
    return {
      error: "招待メール送信の設定が不足しています。",
      values,
    };
  }

  try {
    await createAdminVendorInvitation(db, supabaseAdmin, adminUser, parsed.data);
  } catch (error: unknown) {
    const message = getInviteErrorMessage(error);
    if (message) {
      return {
        error: message,
        values,
      };
    }
    throw error;
  }

  redirect("/admin/vendors?invited=ok");
}
