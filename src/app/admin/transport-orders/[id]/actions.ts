"use server";

import { revalidatePath } from "next/cache";

import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  cancelTransportOrder,
  confirmTransportOrder,
  reassignTransportOrderVendor,
  rescheduleAndRenotifyTransportOrder,
} from "@/lib/services/transport-orders";

// FormData から transportOrderId + expectedVersion を取り出して検証する共通ヘルパー。
function parseOrderActionBase(formData: FormData): {
  transportOrderId: string;
  expectedVersion: number;
} {
  const transportOrderId = formData.get("transportOrderId");
  if (typeof transportOrderId !== "string" || transportOrderId.length === 0) {
    throw new Error("Invalid transportOrderId");
  }
  const expectedVersion = Number(formData.get("expectedVersion"));
  if (Number.isNaN(expectedVersion) || expectedVersion < 0 || !Number.isInteger(expectedVersion)) {
    throw new Error("Invalid expectedVersion");
  }
  return { transportOrderId, expectedVersion };
}

// datetime-local input ("YYYY-MM-DDTHH:mm") → Date | undefined。空文字は undefined。
function parseOptionalDateField(formData: FormData, field: string): Date | undefined {
  const raw = formData.get(field);
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return undefined;
  }
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${field}`);
  }
  return date;
}

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
    typeof reasonRaw === "string" && reasonRaw.trim().length > 0
      ? reasonRaw.trim().slice(0, 1000)
      : undefined;

  await cancelTransportOrder(db, adminUser.companyId, adminUser.userId, {
    transportOrderId,
    expectedVersion,
    reason,
  });

  revalidatePath(`/admin/transport-orders/${transportOrderId}`);
  revalidatePath(`/admin/transport-orders`);
}

export async function confirmTransportOrderAction(formData: FormData): Promise<void> {
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

  await confirmTransportOrder(db, adminUser.companyId, adminUser.userId, {
    transportOrderId,
    expectedVersion,
  });

  revalidatePath(`/admin/transport-orders/${transportOrderId}`);
  revalidatePath(`/admin/transport-orders`);
}

// Phase 64-C.4.3: 業者対応不可フォールバックの 3 アクション。
// 全て rejected stall の order に対してのみ有効 (service 側で ReassignNotRejected/RescheduleNotRejected ガード)。

// L3-3 次候補打診: 別業者へ fallback 再割当。
export async function nextVendorAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    throw new Error("Unauthorized");
  }
  const { transportOrderId, expectedVersion } = parseOrderActionBase(formData);
  const newVendorId = formData.get("newVendorId");
  if (typeof newVendorId !== "string" || newVendorId.length === 0) {
    throw new Error("Invalid newVendorId");
  }

  await reassignTransportOrderVendor(db, adminUser.companyId, adminUser.userId, {
    transportOrderId,
    expectedVersion,
    newVendorId,
    mode: "fallback",
  });

  revalidatePath(`/admin/transport-orders/${transportOrderId}`);
  revalidatePath(`/admin/transport-orders`);
}

// L3-5 手動切替: 別業者へ manual 再割当 (店舗の手動指名)。
export async function switchVendorAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    throw new Error("Unauthorized");
  }
  const { transportOrderId, expectedVersion } = parseOrderActionBase(formData);
  const newVendorId = formData.get("newVendorId");
  if (typeof newVendorId !== "string" || newVendorId.length === 0) {
    throw new Error("Invalid newVendorId");
  }
  const reasonRaw = formData.get("selectionReasonNote");
  const selectionReasonNote =
    typeof reasonRaw === "string" && reasonRaw.trim().length > 0
      ? reasonRaw.trim().slice(0, 1000)
      : undefined;

  await reassignTransportOrderVendor(db, adminUser.companyId, adminUser.userId, {
    transportOrderId,
    expectedVersion,
    newVendorId,
    mode: "manual",
    selectionReasonNote,
  });

  revalidatePath(`/admin/transport-orders/${transportOrderId}`);
  revalidatePath(`/admin/transport-orders`);
}

// L3-4 希望日時変更再依頼: 同業者へ希望日時を変えて再依頼。
export async function rescheduleAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    throw new Error("Unauthorized");
  }
  const { transportOrderId, expectedVersion } = parseOrderActionBase(formData);
  const requestedPickupAt = parseOptionalDateField(formData, "requestedPickupAt");
  const requestedDeliveryAt = parseOptionalDateField(formData, "requestedDeliveryAt");
  const requestedReturnAt = parseOptionalDateField(formData, "requestedReturnAt");
  if (
    requestedPickupAt === undefined &&
    requestedDeliveryAt === undefined &&
    requestedReturnAt === undefined
  ) {
    throw new Error("At least one requested datetime must be provided");
  }
  const reasonRaw = formData.get("reason");
  const reason =
    typeof reasonRaw === "string" && reasonRaw.trim().length > 0
      ? reasonRaw.trim().slice(0, 1000)
      : undefined;

  await rescheduleAndRenotifyTransportOrder(db, adminUser.companyId, adminUser.userId, {
    transportOrderId,
    expectedVersion,
    requestedPickupAt,
    requestedDeliveryAt,
    requestedReturnAt,
    reason,
  });

  revalidatePath(`/admin/transport-orders/${transportOrderId}`);
  revalidatePath(`/admin/transport-orders`);
}
