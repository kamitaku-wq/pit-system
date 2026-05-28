"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { revokeToken } from "@/lib/services/customer-reservation-tokens";

function requiredString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string") throw new Error(`Invalid ${name}`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Invalid ${name}`);
  return trimmed;
}

export async function revokeTokenAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredString(formData, "id");

  await revokeToken(id, { db, companyId: adminUser.companyId });
  revalidatePath(`/admin/customer-reservation-tokens/${id}`);
  revalidatePath("/admin/customer-reservation-tokens");
  redirect("/admin/customer-reservation-tokens");
}
