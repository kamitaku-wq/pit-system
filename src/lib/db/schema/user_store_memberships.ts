import { boolean, date, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { roles } from "./roles";
import { stores } from "./stores";
import { users } from "./users";

// ユーザーの店舗所属。
// spec/data-model.md §3.3
export const userStoreMemberships = pgTable(
  "user_store_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    roleId: uuid("role_id").references(() => roles.id, { onDelete: "set null" }),
    isPrimary: boolean("is_primary").notNull().default(false),
    effectiveFrom: date("effective_from"),
    effectiveTo: date("effective_to"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    userStoreUnique: unique("user_store_memberships_user_id_store_id_unique").on(
      t.userId,
      t.storeId,
    ),
  }),
);

export type UserStoreMembership = typeof userStoreMemberships.$inferSelect;
export type NewUserStoreMembership = typeof userStoreMemberships.$inferInsert;
