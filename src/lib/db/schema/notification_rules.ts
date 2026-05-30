import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";

// 通知ルール。
// spec/data-model.md §3.12
export const notificationRules = pgTable(
  "notification_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    eventType: text("event_type").notNull(),
    targetType: text("target_type").notNull(),
    channel: text("channel").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    timingMinutesOffset: integer("timing_minutes_offset"),
    retryAfterMinutes: integer("retry_after_minutes"),
    maxReminders: integer("max_reminders"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    targetTypeCheck: check(
      "notification_rules_target_type_check",
      sql`${t.targetType} IN ('vendor', 'customer', 'store_user')`,
    ),
    channelCheck: check(
      "notification_rules_channel_check",
      sql`${t.channel} IN ('email', 'portal', 'line', 'sms', 'both')`,
    ),
    ruleUnique: unique("notification_rules_company_id_event_type_target_type_channel_key").on(
      t.companyId,
      t.eventType,
      t.targetType,
      t.channel,
    ),
  }),
);

export type NotificationRule = typeof notificationRules.$inferSelect;
export type NewNotificationRule = typeof notificationRules.$inferInsert;
