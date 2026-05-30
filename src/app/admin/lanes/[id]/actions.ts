"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { replaceLaneWorkMenus } from "@/lib/services/lane-work-menus";
import { replaceLaneWorkingHours } from "@/lib/services/lane-working-hours";
import { deleteLane, updateLane } from "@/lib/services/lanes";

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

export async function updateLaneAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  const updated = await updateLane(
    id,
    {
      name: requiredFormValue(formData, "name"),
      code: optionalFormValue(formData, "code"),
      laneTypeId: optionalFormValue(formData, "laneTypeId"),
      capacity: intFormValue(formData, "capacity", 1),
      isActive: booleanFormValue(formData, "isActive", true),
    },
    { db, companyId: adminUser.companyId },
  );
  if (!updated) throw new Error("Lane not found");

  revalidatePath(`/admin/lanes/${id}`);
  revalidatePath("/admin/lanes");
}

export async function replaceLaneWorkMenusAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const laneId = requiredFormValue(formData, "laneId");
  const workMenuIds = formData
    .getAll("workMenuIds")
    .filter((value): value is string => typeof value === "string" && value.length > 0);

  await replaceLaneWorkMenus(
    laneId,
    { workMenuIds },
    { db, companyId: adminUser.companyId },
  );

  revalidatePath(`/admin/lanes/${laneId}`);
}

const WEEKDAYS = [0, 1, 2, 3, 4, 5, 6] as const;

export async function replaceLaneWorkingHoursAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const laneId = requiredFormValue(formData, "laneId");

  const hours: { dayOfWeek: number; startsAt: string; endsAt: string }[] = [];
  for (const day of WEEKDAYS) {
    const open = formData.get(`open_${day}`);
    if (open !== "on") continue;
    const startsAt = optionalFormValue(formData, `starts_at_${day}`);
    const endsAt = optionalFormValue(formData, `ends_at_${day}`);
    if (!startsAt || !endsAt) continue;
    hours.push({ dayOfWeek: day, startsAt, endsAt });
  }

  await replaceLaneWorkingHours(laneId, { hours }, { db, companyId: adminUser.companyId });

  revalidatePath(`/admin/lanes/${laneId}`);
}

export async function deleteLaneAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredFormValue(formData, "id");

  await deleteLane(id, { db, companyId: adminUser.companyId });
  revalidatePath("/admin/lanes");
  redirect("/admin/lanes");
}
