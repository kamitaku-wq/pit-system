import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { roles } from "./roles";

// 社内ユーザー。Supabase Auth と 1:1 (auth.users.id と一致)。
// spec/data-model.md §3.2
// auth.users(id) への FK は raw SQL (04_auth.sql) 側で表現。
// default_store_id は raw SQL 側で FK 無し (spec α-1 互換)。
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(), // auth.users.id と一致するため defaultRandom() なし
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    roleId: uuid("role_id").references(() => roles.id, { onDelete: "set null" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    defaultStoreId: uuid("default_store_id"),
    isActive: boolean("is_active").notNull().default(true),
    lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    companyEmailUnique: unique("users_company_id_email_unique").on(t.companyId, t.email),
  }),
);

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
