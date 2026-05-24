import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { transportOrders } from "./transport_orders";
import { users } from "./users";
import { vendorUsers } from "./vendor_users";
import { vendors } from "./vendors";

// 陸送依頼の業者招待。
// spec/data-model.md §3.11
export const transportOrderInvitations = pgTable(
  "transport_order_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    transportOrderId: uuid("transport_order_id")
      .notNull()
      .references(() => transportOrders.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    inviteeEmail: text("invitee_email"),
    inviteeName: text("invitee_name"),
    inviteePhone: text("invitee_phone"),
    invitedAt: timestamp("invited_at", { withTimezone: true }).notNull().defaultNow(),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    invitationTokenHash: text("invitation_token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    response: text("response").notNull().default("pending"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    isWinningBid: boolean("is_winning_bid").notNull().default(false),
    boundVendorId: uuid("bound_vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    boundVendorUserId: uuid("bound_vendor_user_id").references(() => vendorUsers.id, {
      onDelete: "set null",
    }),
  },
  (t) => ({
    invitationTokenHashUnique: unique(
      "transport_order_invitations_invitation_token_hash_unique",
    ).on(t.invitationTokenHash),
    responseCheck: check(
      "transport_order_invitations_response_check",
      sql`${t.response} IN ('pending', 'accepted', 'rejected', 'revoked', 'expired')`,
    ),
    targetCheck: check(
      "invitations_target_check",
      sql`${t.vendorId} IS NOT NULL OR ${t.inviteeEmail} IS NOT NULL`,
    ),
    winningUnique: uniqueIndex("transport_order_invitations_winning_unique")
      .on(t.transportOrderId)
      .where(sql`${t.isWinningBid} = true`),
    transportOrderVendorUnique: uniqueIndex(
      "transport_order_invitations_transport_order_vendor_unique",
    )
      .on(t.transportOrderId, t.vendorId)
      .where(sql`${t.vendorId} IS NOT NULL`),
    transportOrderInviteeEmailUnique: uniqueIndex(
      "transport_order_invitations_transport_order_invitee_email_unique",
    )
      .on(t.transportOrderId, t.inviteeEmail)
      .where(sql`${t.vendorId} IS NULL`),
    vendorResponseIdx: index("idx_transport_order_invitations_vendor_response").on(
      t.vendorId,
      t.response,
    ),
    transportOrderIdx: index("idx_transport_order_invitations_transport_order").on(
      t.transportOrderId,
    ),
  }),
);

export type TransportOrderInvitation = typeof transportOrderInvitations.$inferSelect;
export type NewTransportOrderInvitation = typeof transportOrderInvitations.$inferInsert;
