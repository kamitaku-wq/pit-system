"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { createVendor } from "@/lib/services/vendors";

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

function optionalNumberFormValue(formData: FormData, name: string): number | null {
  const value = formData.get(name);
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function notificationMethodFromForm(formData: FormData): "email" | "portal" | "both" {
  const value = formData.get("notificationMethod");
  if (value === "email" || value === "portal" || value === "both") return value;
  return "both";
}

export async function createVendorAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");

  const vendor = await createVendor(
    {
      name: requiredFormValue(formData, "name"),
      contactPersonName: optionalFormValue(formData, "contactPersonName"),
      email: optionalFormValue(formData, "email"),
      phone: optionalFormValue(formData, "phone"),
      notificationMethod: notificationMethodFromForm(formData),
      isShared: formData.get("isShared") === "true",
      priority: optionalNumberFormValue(formData, "priority"),
      displayOrder: optionalNumberFormValue(formData, "displayOrder"),
      notes: optionalFormValue(formData, "notes"),
    },
    { db, companyId: adminUser.companyId },
  );

  revalidatePath("/admin/vendors");
  redirect(`/admin/vendors/${vendor.id}`);
}
