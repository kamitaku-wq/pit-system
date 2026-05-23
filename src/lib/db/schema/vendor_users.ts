import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// 業者ユーザー = 業者ポータルにログインする外部アカウント。users とは別テーブル。
// spec/data-model.md §3.6
// vertical slice 制約: vendors テーブル未作成のため vendor_id は nullable で先送り。
// enforce_vendor_user_tenancy trigger は α-1 で vendors 追加時に有効化。
export const vendorUsers = pgTable(
  "vendor_users",
  {
    id: uuid("id").primaryKey(), // auth.users.id と一致
    vendorId: uuid("vendor_id"), // vertical slice: nullable, α-1 で NOT NULL + FK
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    emailUnique: unique("vendor_users_email_unique").on(t.email),
  }),
);

export type VendorUser = typeof vendorUsers.$inferSelect;
export type NewVendorUser = typeof vendorUsers.$inferInsert;
