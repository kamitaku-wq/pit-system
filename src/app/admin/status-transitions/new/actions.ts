"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { createStatusTransition } from "@/lib/services/status-transitions";
import { STATUS_TYPES, type StatusType } from "@/lib/services/statuses";

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

function statusTypeFormValue(formData: FormData): StatusType {
  const value = requiredFormValue(formData, "statusType");
  if ((STATUS_TYPES as readonly string[]).includes(value)) return value as StatusType;
  throw new Error(`Invalid statusType: ${value}`);
}

export async function createStatusTransitionAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");

  const transition = await createStatusTransition(
    {
      statusType: statusTypeFormValue(formData),
      fromStatusId: optionalFormValue(formData, "fromStatusId"),
      toStatusId: requiredFormValue(formData, "toStatusId"),
      requiredPermissionKey: optionalFormValue(formData, "requiredPermissionKey"),
      requiredRoleKey: optionalFormValue(formData, "requiredRoleKey"),
      triggersNotification: boolFormValue(formData, "triggersNotification"),
    },
    { db, companyId: adminUser.companyId },
  );

  revalidatePath("/admin/status-transitions");
  redirect(`/admin/status-transitions/${transition.id}`);
}
