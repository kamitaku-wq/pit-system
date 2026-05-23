import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// 社内ユーザー。Supabase Auth と 1:1 (auth.users.id と一致)。
// spec/data-model.md §3.2
// vertical slice 制約: roles テーブル未作成のため role_id は nullable で先送り。
// stores テーブル未作成のため default_store_id は nullable。
// α-1 で 46 テーブル展開時に NOT NULL 化と FK 追加。
export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey(), // auth.users.id と一致するため defaultRandom() なし
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    email: text("email").notNull(),
    name: text("name").notNull(),
    roleId: uuid("role_id"), // vertical slice: nullable, α-1 で NOT NULL + FK
    defaultStoreId: uuid("default_store_id"), // vertical slice: nullable, α-1 で FK
    isActive: boolean("is_active").notNull().default(true),
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
