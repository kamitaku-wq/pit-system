"use server";

import { revalidatePath } from "next/cache";

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { cancelTransportOrder } from "@/lib/services/transport-orders";

export async function cancelTransportOrderAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    throw new Error("Unauthorized");
  }

  const transportOrderId = formData.get("transportOrderId");
  if (typeof transportOrderId !== "string" || transportOrderId.length === 0) {
    throw new Error("Invalid transportOrderId");
  }

  const expectedVersionRaw = formData.get("expectedVersion");
  const expectedVersion = Number(expectedVersionRaw);
  if (Number.isNaN(expectedVersion) || expectedVersion < 0 || !Number.isInteger(expectedVersion)) {
    throw new Error("Invalid expectedVersion");
  }

  const reasonRaw = formData.get("reason");
  const reason =
    typeof reasonRaw === "string" && reasonRaw.trim().length > 0 ? reasonRaw.trim().slice(0, 1000) : undefined;

  await cancelTransportOrder(db, adminUser.companyId, adminUser.userId, {
    transportOrderId,
    expectedVersion,
    reason,
  });

  revalidatePath(`/admin/transport-orders/${transportOrderId}`);
  revalidatePath(`/admin/transport-orders`);
}
