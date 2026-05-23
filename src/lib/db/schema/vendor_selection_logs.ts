import { jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { transportOrderInvitations } from "./transport_order_invitations";
import { transportOrders } from "./transport_orders";
import { users } from "./users";
import { vendors } from "./vendors";

// 業者選定ログ。
// spec/data-model.md §3.11
export const vendorSelectionLogs = pgTable("vendor_selection_logs", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  transportOrderId: uuid("transport_order_id")
    .notNull()
    .references(() => transportOrders.id, { onDelete: "cascade" }),
  invitationId: uuid("invitation_id").references(() => transportOrderInvitations.id, {
    onDelete: "set null",
  }),
  vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
  selectedByUserId: uuid("selected_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  selectionReason: text("selection_reason"),
  score: jsonb("score").notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VendorSelectionLog = typeof vendorSelectionLogs.$inferSelect;
export type NewVendorSelectionLog = typeof vendorSelectionLogs.$inferInsert;
