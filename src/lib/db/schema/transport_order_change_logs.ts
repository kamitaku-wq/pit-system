import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { transportOrders } from "./transport_orders";
import { users } from "./users";

// 陸送依頼の変更履歴 (status_history とは別軸、change_type 別の業務的変更を記録)。
// spec/data-model.md §7.8
// Phase 53 で旧 schema (payload jsonb + updated_at) から spec §7.8 完全準拠の新 schema に
// DROP + recreate で置換 (service 未利用、data 蓄積なし前提)。
export const transportOrderChangeLogs = pgTable(
  "transport_order_change_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    transportOrderId: uuid("transport_order_id")
      .notNull()
      .references(() => transportOrders.id, { onDelete: "cascade" }),
    changeType: text("change_type").notNull(),
    beforeJson: jsonb("before_json"),
    afterJson: jsonb("after_json"),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    requiresNotification: boolean("requires_notification").notNull().default(true),
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    changeTypeCheck: check(
      "transport_order_change_logs_change_type_check",
      sql`${t.changeType} IN ('vendor_changed', 'datetime_changed', 'cancelled', 'recreated', 'rejected_reassigned')`,
    ),
    transportOrderCreatedAtIdx: index(
      "idx_transport_order_change_logs_transport_order_created_at",
    ).on(t.transportOrderId, t.createdAt),
  }),
);

export type TransportOrderChangeLog = typeof transportOrderChangeLogs.$inferSelect;
export type NewTransportOrderChangeLog = typeof transportOrderChangeLogs.$inferInsert;
