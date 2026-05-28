"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { softDeleteAttachment } from "@/lib/services/attachments";

function requiredString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string") throw new Error(`Invalid ${name}`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Invalid ${name}`);
  return trimmed;
}

export async function softDeleteAttachmentAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredString(formData, "id");

  await softDeleteAttachment(id, { db, companyId: adminUser.companyId });
  revalidatePath(`/admin/attachments/${id}`);
  revalidatePath("/admin/attachments");
  redirect("/admin/attachments");
}
