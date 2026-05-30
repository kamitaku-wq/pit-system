"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { createPermission } from "@/lib/services/permissions";

function optionalFormValue(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function requiredFormValue(formData: FormData, name: string): string {
  const value = optionalFormValue(formData, name);
  if (!value) throw new Error(`Invalid ${name}`);
  return value;
}

export async function createPermissionAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");

  const created = await createPermission(
    {
      roleId: requiredFormValue(formData, "roleId"),
      code: requiredFormValue(formData, "code"),
      resource: optionalFormValue(formData, "resource"),
      action: optionalFormValue(formData, "action"),
    },
    { db, companyId: adminUser.companyId },
  );

  revalidatePath("/admin/permissions");
  redirect(`/admin/permissions/${created.id}`);
}
