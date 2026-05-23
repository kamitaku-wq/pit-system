import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { notificationOutbox } from "./notification_outbox";
import { transportOrderInvitations } from "./transport_order_invitations";
import { transportOrders } from "./transport_orders";
import { vendorUsers } from "./vendor_users";
import { vendors } from "./vendors";

// 業者ポータル受信箱。
// spec/data-model.md §3.12
export const vendorPortalInbox = pgTable("vendor_portal_inbox", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  vendorId: uuid("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "cascade" }),
  recipientVendorUserId: uuid("recipient_vendor_user_id").references(() => vendorUsers.id, {
    onDelete: "set null",
  }),
  outboxId: uuid("outbox_id").references(() => notificationOutbox.id, { onDelete: "cascade" }),
  transportOrderId: uuid("transport_order_id").references(() => transportOrders.id, {
    onDelete: "cascade",
  }),
  transportOrderInvitationId: uuid("transport_order_invitation_id").references(
    () => transportOrderInvitations.id,
    { onDelete: "cascade" },
  ),
  title: text("title").notNull(),
  body: text("body").notNull(),
  severity: text("severity").notNull().default("info"),
  readAt: timestamp("read_at", { withTimezone: true }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VendorPortalInbox = typeof vendorPortalInbox.$inferSelect;
export type NewVendorPortalInbox = typeof vendorPortalInbox.$inferInsert;
