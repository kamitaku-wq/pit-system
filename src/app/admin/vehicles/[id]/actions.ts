"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { deleteVehicle, transferOwnership, updateVehicle } from "@/lib/services/vehicles";

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

function checkboxFormValue(formData: FormData, name: string): boolean {
  const value = formData.get(name);
  return typeof value === "string" && value.length > 0;
}

export async function updateVehicleAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  const updated = await updateVehicle(
    id,
    {
      storeId: optionalFormValue(formData, "storeId"),
      vin: optionalFormValue(formData, "vin"),
      registrationNumber: optionalFormValue(formData, "registrationNumber"),
      maker: optionalFormValue(formData, "maker"),
      model: optionalFormValue(formData, "model"),
      modelYear: optionalNumberFormValue(formData, "modelYear"),
      color: optionalFormValue(formData, "color"),
    },
    { db, companyId: adminUser.companyId },
  );
  if (!updated) throw new Error("Vehicle not found");

  revalidatePath(`/admin/vehicles/${id}`);
  revalidatePath("/admin/vehicles");
}

export async function deleteVehicleAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  await deleteVehicle(id, { db, companyId: adminUser.companyId });
  revalidatePath("/admin/vehicles");
  redirect("/admin/vehicles");
}

export async function transferOwnershipAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const vehicleId = requiredFormValue(formData, "vehicleId");
  const customerId = requiredFormValue(formData, "customerId");
  const startsOn = optionalFormValue(formData, "startsOn") ?? undefined;
  const isPrimary = checkboxFormValue(formData, "isPrimary");

  await transferOwnership(
    vehicleId,
    { customerId, startsOn, isPrimary },
    { db, companyId: adminUser.companyId },
  );

  revalidatePath(`/admin/vehicles/${vehicleId}`);
}
