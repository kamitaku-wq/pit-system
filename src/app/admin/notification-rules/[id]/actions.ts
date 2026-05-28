"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import {
  deleteNotificationRule,
  NOTIFICATION_RULE_CHANNELS,
  NOTIFICATION_RULE_TARGET_TYPES,
  type NotificationRuleChannel,
  type NotificationRuleTargetType,
  updateNotificationRule,
} from "@/lib/services/notification-rules";

function requiredString(formData: FormData, name: string): string {
  const value = formData.get(name);
  if (typeof value !== "string") throw new Error(`Invalid ${name}`);
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`Invalid ${name}`);
  return trimmed;
}

function optionalInt(formData: FormData, name: string): number | null {
  const raw = formData.get(name);
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  if (!Number.isInteger(value)) throw new Error(`Invalid ${name}`);
  return value;
}

function parseTargetType(value: string): NotificationRuleTargetType {
  if ((NOTIFICATION_RULE_TARGET_TYPES as readonly string[]).includes(value)) {
    return value as NotificationRuleTargetType;
  }
  throw new Error(`Invalid targetType`);
}

function parseChannel(value: string): NotificationRuleChannel {
  if ((NOTIFICATION_RULE_CHANNELS as readonly string[]).includes(value)) {
    return value as NotificationRuleChannel;
  }
  throw new Error(`Invalid channel`);
}

export async function updateNotificationRuleAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredString(formData, "id");

  const updated = await updateNotificationRule(
    id,
    {
      eventType: requiredString(formData, "eventType"),
      targetType: parseTargetType(requiredString(formData, "targetType")),
      channel: parseChannel(requiredString(formData, "channel")),
      isEnabled: formData.get("isEnabled") === "1",
      timingMinutesOffset: optionalInt(formData, "timingMinutesOffset"),
      retryAfterMinutes: optionalInt(formData, "retryAfterMinutes"),
      maxReminders: optionalInt(formData, "maxReminders"),
    },
    { db, companyId: adminUser.companyId },
  );
  if (!updated) throw new Error("Notification rule not found");

  revalidatePath(`/admin/notification-rules/${id}`);
  revalidatePath("/admin/notification-rules");
}

export async function deleteNotificationRuleAction(formData: FormData): Promise<void> {
  const adminUser = await getAdminUser();
  if (!adminUser) throw new Error("Unauthorized");
  const id = requiredString(formData, "id");

  await deleteNotificationRule(id, { db, companyId: adminUser.companyId });
  revalidatePath("/admin/notification-rules");
  redirect("/admin/notification-rules");
}
