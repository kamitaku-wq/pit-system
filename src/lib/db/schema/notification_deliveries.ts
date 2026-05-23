import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { notificationOutbox } from "./notification_outbox";

// 通知配送結果。
// spec/data-model.md §3.12
export const notificationDeliveries = pgTable("notification_deliveries", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  notificationOutboxId: uuid("notification_outbox_id")
    .notNull()
    .references(() => notificationOutbox.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  providerMessageId: text("provider_message_id"),
  status: text("status").notNull().default("pending"),
  error: text("error"),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDelivery = typeof notificationDeliveries.$inferInsert;
