"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { createServiceTicket } from "@/lib/services/service-tickets";

function optionalFormValue(formData: FormData, name: string): string | null {
  const value = formData.get(name);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function numberFormValue(formData: FormData, name: string, fallback: number): number {
  const value = formData.get(name);
  if (typeof value !== "string" || value.trim().length === 0) return fallback;
  return Number(value);
}

export async function createServiceTicketAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");

  const ticket = await createServiceTicket(
    {
      ticketNo: optionalFormValue(formData, "ticketNo"),
      vehicleId: optionalFormValue(formData, "vehicleId"),
      customerId: optionalFormValue(formData, "customerId"),
      storeId: optionalFormValue(formData, "storeId"),
      statusId: optionalFormValue(formData, "statusId"),
      workCategoryId: optionalFormValue(formData, "workCategoryId"),
      workMenuId: optionalFormValue(formData, "workMenuId"),
      quotedAmountMinor: numberFormValue(formData, "quotedAmountMinor", 0),
      taxRateBps: numberFormValue(formData, "taxRateBps", 1000),
      billingStatus: optionalFormValue(formData, "billingStatus") ?? "unbilled",
      notes: optionalFormValue(formData, "notes"),
    },
    { db, companyId: adminUser.companyId },
  );

  revalidatePath("/admin/service-tickets");
  redirect(`/admin/service-tickets/${ticket.id}`);
}
