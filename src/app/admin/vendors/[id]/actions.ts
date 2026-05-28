"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  replaceVendorAvailableDays,
  VendorAvailableDayConstraintError,
  VendorNotFoundError,
} from "@/lib/services/vendor-available-days";
import {
  replaceVendorAvailableStores,
  StoreNotInCompanyError,
  VendorNotFoundError as VendorNotFoundForStoresError,
} from "@/lib/services/vendor-available-stores";
import { deleteVendor, updateVendor } from "@/lib/services/vendors";

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

function optionalNumberFormValue(formData: FormData, name: string): number | null {
  const value = formData.get(name);
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function notificationMethodFromForm(formData: FormData): "email" | "portal" | "both" {
  const value = formData.get("notificationMethod");
  if (value === "email" || value === "portal" || value === "both") return value;
  return "both";
}

export async function updateVendorAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  const updated = await updateVendor(
    id,
    {
      name: requiredFormValue(formData, "name"),
      contactPersonName: optionalFormValue(formData, "contactPersonName"),
      email: optionalFormValue(formData, "email"),
      phone: optionalFormValue(formData, "phone"),
      notificationMethod: notificationMethodFromForm(formData),
      isShared: formData.get("isShared") === "true",
      priority: optionalNumberFormValue(formData, "priority"),
      displayOrder: optionalNumberFormValue(formData, "displayOrder"),
      notes: optionalFormValue(formData, "notes"),
    },
    { db, companyId: adminUser.companyId },
  );
  if (!updated) throw new Error("Vendor not found");

  revalidatePath(`/admin/vendors/${id}`);
  revalidatePath("/admin/vendors");
}

export async function deleteVendorAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  await deleteVendor(id, { db, companyId: adminUser.companyId });
  revalidatePath("/admin/vendors");
  redirect("/admin/vendors");
}

export async function replaceAvailableDaysAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const vendorId = requiredFormValue(formData, "vendorId");

  // 曜日 0-6 × 1 枠 (MVP: 1 day = 1 time range)。両方空欄ならその曜日を未登録扱い。
  const rows: { dayOfWeek: number; startsAt: string | null; endsAt: string | null }[] = [];
  for (let day = 0; day <= 6; day++) {
    const startsAt = optionalFormValue(formData, `day_${day}_starts_0`);
    const endsAt = optionalFormValue(formData, `day_${day}_ends_0`);
    if (startsAt === null && endsAt === null) continue;
    rows.push({ dayOfWeek: day, startsAt, endsAt });
  }

  try {
    await replaceVendorAvailableDays(vendorId, { rows }, { db, companyId: adminUser.companyId });
  } catch (error) {
    if (error instanceof VendorNotFoundError) {
      throw new Error("Vendor not found");
    }
    if (error instanceof VendorAvailableDayConstraintError) {
      throw new Error(`対応曜日の保存に失敗: ${error.detail}`);
    }
    throw error;
  }

  revalidatePath(`/admin/vendors/${vendorId}`);
}

export async function replaceAvailableStoresAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const vendorId = requiredFormValue(formData, "vendorId");

  const storeIds = formData.getAll("storeIds")
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  try {
    await replaceVendorAvailableStores(vendorId, { storeIds }, { db, companyId: adminUser.companyId });
  } catch (error) {
    if (error instanceof VendorNotFoundForStoresError) {
      throw new Error("Vendor not found");
    }
    if (error instanceof StoreNotInCompanyError) {
      throw new Error(`対応店舗の保存に失敗: 不正な店舗ID`);
    }
    throw error;
  }

  revalidatePath(`/admin/vendors/${vendorId}`);
}
