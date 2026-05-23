import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { transportOrders } from "./transport_orders";
import { vendors } from "./vendors";

// 陸送依頼の業者打診試行。
// spec/data-model.md §3.11
export const transportOrderVendorAttempts = pgTable("transport_order_vendor_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  transportOrderId: uuid("transport_order_id")
    .notNull()
    .references(() => transportOrders.id, { onDelete: "cascade" }),
  vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
  attemptNo: integer("attempt_no").notNull().default(1),
  status: text("status").notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type TransportOrderVendorAttempt = typeof transportOrderVendorAttempts.$inferSelect;
export type NewTransportOrderVendorAttempt = typeof transportOrderVendorAttempts.$inferInsert;
