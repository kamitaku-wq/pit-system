import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { users } from "./users";
import { vendorUsers } from "./vendor_users";
import { vendors } from "./vendors";

// Phase 31-B admin vendor invitations.
// References migration post/0010_admin_vendor_invitations.sql.
export const adminVendorInvitations = pgTable(
  "admin_vendor_invitations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    invitedByUserId: uuid("invited_by_user_id").references(() => users.id, {
      onDelete: "set null",
    }),
    vendorUserId: uuid("vendor_user_id").references(() => vendorUsers.id, {
      onDelete: "set null",
    }),
    email: text("email").notNull(),
    name: text("name"),
    role: text("role").notNull().default("vendor_admin"),
    status: text("status").notNull().default("pending"),
    tokenHash: text("token_hash"),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    roleCheck: check(
      "admin_vendor_invitations_role_check",
      sql`${t.role} IN ('vendor_admin', 'vendor_member')`,
    ),
    statusCheck: check(
      "admin_vendor_invitations_status_check",
      sql`${t.status} IN ('pending', 'sent', 'accepted', 'expired', 'revoked')`,
    ),
    tokenHashUnique: unique("admin_vendor_invitations_token_hash_unique").on(t.tokenHash),
    pendingUnique: uniqueIndex("admin_vendor_invitations_pending_unique")
      .on(t.vendorId, t.email)
      .where(sql`${t.status} = 'pending'`),
  }),
);

export type AdminVendorInvitation = typeof adminVendorInvitations.$inferSelect;
export type NewAdminVendorInvitation = typeof adminVendorInvitations.$inferInsert;
