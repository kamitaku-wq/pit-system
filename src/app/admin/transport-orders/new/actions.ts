"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { createTransportOrderWithNotification } from "@/lib/services/transport-orders";
import {
  isMovementType,
  validateMovementPattern,
} from "@/lib/transport/movement-pattern";

function requiredFormValue(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
  return value.trim();
}

function optionalFormValue(formData: FormData, name: string): string | undefined {
  const value = formData.get(name);
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

// datetime-local ("YYYY-MM-DDTHH:mm") → Date | undefined。空文字は undefined。
function optionalDateValue(formData: FormData, name: string): Date | undefined {
  const raw = optionalFormValue(formData, name);
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${name} is invalid`);
  }
  return date;
}

export async function createTransportOrderAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    throw new Error("Unauthorized");
  }

  const serviceTicketId = requiredFormValue(formData, "serviceTicketId");
  const vehicleId = requiredFormValue(formData, "vehicleId");
  const vendorId = requiredFormValue(formData, "vendorId");

  const movementTypeRaw = requiredFormValue(formData, "movementType");
  if (!isMovementType(movementTypeRaw)) {
    throw new Error("Invalid movementType");
  }
  const movementType = movementTypeRaw;

  const pickupStoreId = optionalFormValue(formData, "pickupStoreId");
  const deliveryStoreId = optionalFormValue(formData, "deliveryStoreId");
  const returnStoreId = optionalFormValue(formData, "returnStoreId");
  validateMovementPattern(movementType, pickupStoreId, deliveryStoreId, returnStoreId);

  // can_drive=false のときレッカー必須 (spec §14.2: tow_required を立てる)。
  const canDrive = formData.get("canDrive") === "on" || formData.get("canDrive") === "true";
  const towRequired = !canDrive;

  const created = await createTransportOrderWithNotification(db, {
    companyId: adminUser.companyId,
    vendorId,
    serviceTicketId,
    vehicleId,
    orderNumber: `TO-${crypto.randomUUID()}`,
    movementType,
    pickupStoreId,
    deliveryStoreId,
    returnStoreId,
    canDrive,
    towRequired,
    requestedPickupAt: optionalDateValue(formData, "requestedPickupAt"),
    requestedDeliveryAt: optionalDateValue(formData, "requestedDeliveryAt"),
    requestedReturnAt: optionalDateValue(formData, "requestedReturnAt"),
    notes: optionalFormValue(formData, "notes"),
    actingUserId: adminUser.userId,
  });

  revalidatePath("/admin/transport-orders");
  redirect(`/admin/transport-orders/${created.transportOrderId}`);
}
