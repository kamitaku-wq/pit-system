"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { createLane } from "@/lib/services/lanes";

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

function intFormValue(formData: FormData, name: string, fallback: number): number {
  const value = optionalFormValue(formData, name);
  if (value === null) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) ? parsed : fallback;
}

function booleanFormValue(formData: FormData, name: string, fallback: boolean): boolean {
  const value = formData.get(name);
  if (typeof value !== "string") return fallback;
  return value === "true";
}

export async function createLaneAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");

  const lane = await createLane(
    {
      storeId: requiredFormValue(formData, "storeId"),
      laneTypeId: optionalFormValue(formData, "laneTypeId"),
      name: requiredFormValue(formData, "name"),
      code: optionalFormValue(formData, "code"),
      capacity: intFormValue(formData, "capacity", 1),
      isActive: booleanFormValue(formData, "isActive", true),
    },
    { db, companyId: adminUser.companyId },
  );

  revalidatePath("/admin/lanes");
  redirect(`/admin/lanes/${lane.id}`);
}
