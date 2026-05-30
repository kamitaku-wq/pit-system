"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { deleteRole, updateRole } from "@/lib/services/roles";

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

export async function updateRoleAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  const updated = await updateRole(
    id,
    {
      code: requiredFormValue(formData, "code"),
      name: requiredFormValue(formData, "name"),
      description: optionalFormValue(formData, "description"),
    },
    { db, companyId: adminUser.companyId },
  );
  if (!updated) throw new Error("Role not found");

  revalidatePath(`/admin/roles/${id}`);
  revalidatePath("/admin/roles");
}

export async function deleteRoleAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  await deleteRole(id, { db, companyId: adminUser.companyId });
  revalidatePath("/admin/roles");
  redirect("/admin/roles");
}
