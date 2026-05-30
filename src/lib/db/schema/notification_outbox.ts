import { integer, jsonb, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { reservations } from "./reservations";
import { transportOrderInvitations } from "./transport_order_invitations";
import { transportOrders } from "./transport_orders";

// 通知送信アウトボックス。
// spec/data-model.md §3.12
export const notificationOutbox = pgTable(
  "notification_outbox",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    transportOrderId: uuid("transport_order_id").references(() => transportOrders.id, {
      onDelete: "cascade",
    }),
    reservationId: uuid("reservation_id").references(() => reservations.id, {
      onDelete: "cascade",
    }),
    transportOrderInvitationId: uuid("transport_order_invitation_id").references(
      () => transportOrderInvitations.id,
      { onDelete: "cascade" },
    ),
    idempotencyKey: text("idempotency_key").notNull(),
    eventType: text("event_type").notNull(),
    targetType: text("target_type").notNull(),
    targetId: uuid("target_id").notNull(),
    payload: jsonb("payload").notNull().default({}),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    nextAttemptAt: timestamp("next_attempt_at", { withTimezone: true }).notNull().defaultNow(),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    lastError: text("last_error"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    processingStartedAt: timestamp("processing_started_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    idempotencyKeyUnique: unique("notification_outbox_idempotency_key_unique").on(
      t.idempotencyKey,
    ),
  }),
);

export type NotificationOutbox = typeof notificationOutbox.$inferSelect;
export type NewNotificationOutbox = typeof notificationOutbox.$inferInsert;
