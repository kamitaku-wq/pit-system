import { jsonb, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { transportOrders } from "./transport_orders";
import { users } from "./users";

// 陸送依頼変更ログ。
// spec/data-model.md §3.11
export const transportOrderChangeLogs = pgTable("transport_order_change_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  transportOrderId: uuid("transport_order_id")
    .notNull()
    .references(() => transportOrders.id, { onDelete: "cascade" }),
  changedByUserId: uuid("changed_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  payload: jsonb("payload").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TransportOrderChangeLog = typeof transportOrderChangeLogs.$inferSelect;
export type NewTransportOrderChangeLog = typeof transportOrderChangeLogs.$inferInsert;
