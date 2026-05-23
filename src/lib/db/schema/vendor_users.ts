import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { vendors } from "./vendors";

// 業者ユーザー = 業者ポータルにログインする外部アカウント。users とは別テーブル。
// spec/data-model.md §3.6
// enforce_vendor_user_tenancy trigger は α-1 で vendors 追加時に有効化。
export const vendorUsers = pgTable(
  "vendor_users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    authUserId: uuid("auth_user_id"),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    vendorEmailUnique: unique("vendor_users_vendor_id_email_unique").on(t.vendorId, t.email),
  }),
);

export type VendorUser = typeof vendorUsers.$inferSelect;
export type NewVendorUser = typeof vendorUsers.$inferInsert;
