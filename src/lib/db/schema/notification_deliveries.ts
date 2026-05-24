import { sql } from "drizzle-orm";
import { check, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { notificationOutbox } from "./notification_outbox";

// 通知配送結果。
// spec/data-model.md §3.12
export const notificationDeliveries = pgTable(
  "notification_deliveries",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    outboxId: uuid("outbox_id")
      .notNull()
      .references(() => notificationOutbox.id, { onDelete: "cascade" }),
    channel: text("channel").notNull(),
    attemptSeq: integer("attempt_seq").notNull(),
    provider: text("provider"),
    providerMessageId: text("provider_message_id"),
    result: text("result").notNull(),
    errorMessage: text("error_message"),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    channelCheck: check(
      "notification_deliveries_channel_check",
      sql`${t.channel} IN ('email', 'portal', 'line', 'sms')`,
    ),
    resultCheck: check(
      "notification_deliveries_result_check",
      sql`${t.result} IN ('sent', 'failed', 'bounced', 'opened', 'clicked', 'delivered')`,
    ),
    outboxAttemptSeqIdx: index("ix_notification_deliveries_outbox_attempt_seq").on(
      t.outboxId,
      t.attemptSeq,
    ),
  }),
);

export type NotificationDelivery = typeof notificationDeliveries.$inferSelect;
export type NewNotificationDelivery = typeof notificationDeliveries.$inferInsert;
