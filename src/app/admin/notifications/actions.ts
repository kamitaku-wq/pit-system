"use server";

import { revalidatePath } from "next/cache";

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { requeueFailedNotification } from "@/lib/services/notifications";

function getOutboxId(formData: FormData): string {
  const outboxId = formData.get("outboxId");

  if (typeof outboxId !== "string" || outboxId.trim().length === 0) {
    throw new Error("Invalid outboxId");
  }

  return outboxId;
}

export async function requeueFailedNotificationAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();

  if (!adminUser) {
    throw new Error("Unauthorized");
  }

  await requeueFailedNotification(db, adminUser.companyId, getOutboxId(formData));
  revalidatePath("/admin/notifications");
}
