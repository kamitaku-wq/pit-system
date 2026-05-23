import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { statuses } from "./statuses";
import { transportOrders } from "./transport_orders";
import { users } from "./users";

// 陸送依頼ステータス変更履歴。
// spec/data-model.md §3.11
export const transportOrderStatusHistory = pgTable("transport_order_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  transportOrderId: uuid("transport_order_id")
    .notNull()
    .references(() => transportOrders.id, { onDelete: "cascade" }),
  fromStatusId: uuid("from_status_id").references(() => statuses.id, { onDelete: "set null" }),
  statusId: uuid("status_id").references(() => statuses.id, { onDelete: "set null" }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TransportOrderStatusHistory = typeof transportOrderStatusHistory.$inferSelect;
export type NewTransportOrderStatusHistory = typeof transportOrderStatusHistory.$inferInsert;
