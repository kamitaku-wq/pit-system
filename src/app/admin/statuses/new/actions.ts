"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { createStatus, STATUS_TYPES, type StatusType } from "@/lib/services/statuses";

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

function intFormValue(formData: FormData, name: string, fallback: number | null): number | null {
  const value = optionalFormValue(formData, name);
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function boolFormValue(formData: FormData, name: string): boolean {
  return formData.get(name) === "on";
}

function statusTypeFormValue(formData: FormData): StatusType {
  const value = requiredFormValue(formData, "statusType");
  if ((STATUS_TYPES as readonly string[]).includes(value)) return value as StatusType;
  throw new Error(`Invalid statusType: ${value}`);
}

export async function createStatusAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");

  const status = await createStatus(
    {
      statusType: statusTypeFormValue(formData),
      key: requiredFormValue(formData, "key"),
      name: requiredFormValue(formData, "name"),
      displayOrder: intFormValue(formData, "displayOrder", null),
      isInitial: boolFormValue(formData, "isInitial"),
      isTerminal: boolFormValue(formData, "isTerminal"),
      isActive: boolFormValue(formData, "isActive"),
    },
    { db, companyId: adminUser.companyId },
  );

  revalidatePath("/admin/statuses");
  redirect(`/admin/statuses/${status.id}`);
}
