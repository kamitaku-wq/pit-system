"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  deleteStatusTransition,
  updateStatusTransition,
} from "@/lib/services/status-transitions";

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

function boolFormValue(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

export async function updateStatusTransitionAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  const updated = await updateStatusTransition(
    id,
    {
      fromStatusId: optionalFormValue(formData, "fromStatusId"),
      toStatusId: requiredFormValue(formData, "toStatusId"),
      requiredPermissionKey: optionalFormValue(formData, "requiredPermissionKey"),
      requiredRoleKey: optionalFormValue(formData, "requiredRoleKey"),
      triggersNotification: boolFormValue(formData, "triggersNotification"),
    },
    { db, companyId: adminUser.companyId },
  );
  if (!updated) throw new Error("Status transition not found");

  revalidatePath(`/admin/status-transitions/${id}`);
  revalidatePath("/admin/status-transitions");
}

export async function deleteStatusTransitionAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  await deleteStatusTransition(id, { db, companyId: adminUser.companyId });
  revalidatePath("/admin/status-transitions");
  redirect("/admin/status-transitions");
}
