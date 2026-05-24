import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { statuses } from "./statuses";
import { transportOrders } from "./transport_orders";
import { users } from "./users";

// 陸送依頼ステータス変更履歴。
// spec/data-model.md §3.11
export const transportOrderStatusHistory = pgTable(
  "transport_order_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    transportOrderId: uuid("transport_order_id")
      .notNull()
      .references(() => transportOrders.id, { onDelete: "cascade" }),
    fromStatusId: uuid("from_status_id").references(() => statuses.id, { onDelete: "set null" }),
    toStatusId: uuid("to_status_id")
      .notNull()
      .references(() => statuses.id, { onDelete: "restrict" }),
    changedByUserId: uuid("changed_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reason: text("reason"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    transportOrderChangedAtIdx: index(
      "idx_transport_order_status_history_transport_order_changed_at",
    ).on(t.transportOrderId, t.changedAt),
  }),
);

export type TransportOrderStatusHistory = typeof transportOrderStatusHistory.$inferSelect;
export type NewTransportOrderStatusHistory = typeof transportOrderStatusHistory.$inferInsert;
