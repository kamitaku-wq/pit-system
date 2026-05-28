"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { deleteWorkMenu, updateWorkMenu } from "@/lib/services/work-menus";

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

function intFormValue(formData: FormData, name: string, fallback: number): number {
  const value = optionalFormValue(formData, name);
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function booleanFormValue(formData: FormData, name: string, fallback: boolean): boolean {
  const value = formData.get(name);
  if (typeof value !== "string") return fallback;
  return value === "true";
}

export async function updateWorkMenuAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  const updated = await updateWorkMenu(
    id,
    {
      name: requiredFormValue(formData, "name"),
      code: requiredFormValue(formData, "code"),
      workCategoryId: optionalFormValue(formData, "workCategoryId"),
      durationMinutes: intFormValue(formData, "durationMinutes", 60),
      priceMinor: intFormValue(formData, "priceMinor", 0),
      isActive: booleanFormValue(formData, "isActive", true),
    },
    { db, companyId: adminUser.companyId },
  );
  if (!updated) throw new Error("WorkMenu not found");

  revalidatePath(`/admin/work-menus/${id}`);
  revalidatePath("/admin/work-menus");
}

export async function deleteWorkMenuAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  await deleteWorkMenu(id, { db, companyId: adminUser.companyId });
  revalidatePath("/admin/work-menus");
  redirect("/admin/work-menus");
}
