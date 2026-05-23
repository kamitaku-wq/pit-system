import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// 通知ルール。
// spec/data-model.md §3.12
export const notificationRules = pgTable(
  "notification_rules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    eventKey: text("event_key").notNull(),
    channel: text("channel").notNull(),
    targetType: text("target_type").notNull(),
    isEnabled: boolean("is_enabled").notNull().default(true),
    templateKey: text("template_key"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    ruleUnique: unique("notification_rules_company_id_event_key_channel_target_type_unique").on(
      t.companyId,
      t.eventKey,
      t.channel,
      t.targetType,
    ),
  }),
);

export type NotificationRule = typeof notificationRules.$inferSelect;
export type NewNotificationRule = typeof notificationRules.$inferInsert;
