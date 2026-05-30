"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { createVehicle } from "@/lib/services/vehicles";

function optionalFormValue(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function optionalNumberFormValue(formData: FormData, name: string): number | null {
  const value = formData.get(name);
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function createVehicleAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");

  const vehicle = await createVehicle(
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

  revalidatePath("/admin/vehicles");
  redirect(`/admin/vehicles/${vehicle.id}`);
}
