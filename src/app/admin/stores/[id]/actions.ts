"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { replaceStoreBusinessHours } from "@/lib/services/store-business-hours";
import { deleteStore, updateStore } from "@/lib/services/stores";

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

function booleanFormValue(formData: FormData, name: string, fallback: boolean): boolean {
  const value = formData.get(name);
  if (typeof value !== "string") return fallback;
  return value === "true";
}

export async function updateStoreAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  const updated = await updateStore(
    id,
    {
      name: requiredFormValue(formData, "name"),
      code: optionalFormValue(formData, "code"),
      postalCode: optionalFormValue(formData, "postalCode"),
      address: optionalFormValue(formData, "address"),
      phone: optionalFormValue(formData, "phone"),
      isActive: booleanFormValue(formData, "isActive", true),
    },
    { db, companyId: adminUser.companyId },
  );
  if (!updated) throw new Error("Store not found");

  revalidatePath(`/admin/stores/${id}`);
  revalidatePath("/admin/stores");
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export async function replaceStoreBusinessHoursAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const storeId = requiredFormValue(formData, "storeId");

  const hours: {
    dayOfWeek: number;
    opensAt: string;
    closesAt: string;
    acceptsReservations: boolean;
  }[] = [];
  for (const day of WEEKDAYS) {
    const open = formData.get(`open_${day}`);
    if (open !== "on") continue;
    const opensAt = optionalFormValue(formData, `opens_at_${day}`);
    const closesAt = optionalFormValue(formData, `closes_at_${day}`);
    if (!opensAt || !closesAt) continue;
    const acceptsReservations = formData.get(`accepts_reservations_${day}`) === "on";
    hours.push({ dayOfWeek: day, opensAt, closesAt, acceptsReservations });
  }

  await replaceStoreBusinessHours(storeId, { hours }, { db, companyId: adminUser.companyId });

  revalidatePath(`/admin/stores/${storeId}`);
}

export async function deleteStoreAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  await deleteStore(id, { db, companyId: adminUser.companyId });
  revalidatePath("/admin/stores");
  redirect("/admin/stores");
}
