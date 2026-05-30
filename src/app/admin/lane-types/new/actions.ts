"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { createLaneType } from "@/lib/services/lane-types";

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

export async function createLaneTypeAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");

  const laneType = await createLaneType(
    {
      name: requiredFormValue(formData, "name"),
      code: requiredFormValue(formData, "code"),
      sortOrder: intFormValue(formData, "sortOrder", 0),
    },
    { db, companyId: adminUser.companyId },
  );

  revalidatePath("/admin/lane-types");
  redirect(`/admin/lane-types/${laneType.id}`);
}
