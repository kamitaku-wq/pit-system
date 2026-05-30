"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { deleteCustomer, updateCustomer } from "@/lib/services/customers";

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

export async function updateCustomerAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  const updated = await updateCustomer(
    id,
    {
      fullName: requiredFormValue(formData, "fullName"),
      fullNameKana: optionalFormValue(formData, "fullNameKana"),
      email: optionalFormValue(formData, "email"),
      phone: optionalFormValue(formData, "phone"),
      postalCode: optionalFormValue(formData, "postalCode"),
      address: optionalFormValue(formData, "address"),
      notes: optionalFormValue(formData, "notes"),
    },
    { db, companyId: adminUser.companyId },
  );
  if (!updated) throw new Error("Customer not found");

  revalidatePath(`/admin/customers/${id}`);
  revalidatePath("/admin/customers");
}

export async function deleteCustomerAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  await deleteCustomer(id, { db, companyId: adminUser.companyId });
  revalidatePath("/admin/customers");
  redirect("/admin/customers");
}
