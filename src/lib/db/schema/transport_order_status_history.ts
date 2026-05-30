import { foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { statuses } from "./statuses";
import { transportOrders } from "./transport_orders";
import { users } from "./users";

// 陸送依頼ステータス変更履歴。
// spec/data-model.md §3.11
// Composite FK enforces (changed_by_user_id, company_id) -> users(id, company_id).
// raw migration 0017 is authoritative; drizzle-kit generate/push must not be used to regenerate this FK.
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
    changedByUserId: uuid("changed_by_user_id"),
    reason: text("reason"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    transportOrderChangedAtIdx: index(
      "idx_transport_order_status_history_transport_order_changed_at",
    ).on(t.transportOrderId, t.changedAt),
    changedByUserCompanyFk: foreignKey({
      columns: [t.changedByUserId, t.companyId],
      foreignColumns: [users.id, users.companyId],
      name: "transport_order_status_history_changed_by_user_company_fk",
    }).onUpdate("restrict"),
  }),
);

export type TransportOrderStatusHistory = typeof transportOrderStatusHistory.$inferSelect;
export type NewTransportOrderStatusHistory = typeof transportOrderStatusHistory.$inferInsert;
