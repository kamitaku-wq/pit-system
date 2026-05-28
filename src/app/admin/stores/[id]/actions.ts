"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
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

export async function deleteStoreAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  await deleteStore(id, { db, companyId: adminUser.companyId });
  revalidatePath("/admin/stores");
  redirect("/admin/stores");
}
