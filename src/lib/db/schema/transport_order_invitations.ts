import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { transportOrders } from "./transport_orders";
import { users } from "./users";
import { vendorUsers } from "./vendor_users";
import { vendors } from "./vendors";

// 陸送依頼の業者招待。
// spec/data-model.md §3.11
export const transportOrderInvitations = pgTable("transport_order_invitations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  transportOrderId: uuid("transport_order_id")
    .notNull()
    .references(() => transportOrders.id, { onDelete: "cascade" }),
  vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
  invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  invitationTokenHash: text("invitation_token_hash"),
  inviteeEmail: text("invitee_email"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  response: text("response").notNull().default("pending"),
  isWinningBid: boolean("is_winning_bid").notNull().default(false),
  respondedAt: timestamp("responded_at", { withTimezone: true }),
  boundVendorUserId: uuid("bound_vendor_user_id").references(() => vendorUsers.id, {
    onDelete: "set null",
  }),
  boundAt: timestamp("bound_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type TransportOrderInvitation = typeof transportOrderInvitations.$inferSelect;
export type NewTransportOrderInvitation = typeof transportOrderInvitations.$inferInsert;
