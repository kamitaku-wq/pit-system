import { integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// 作業カテゴリ。
// spec/data-model.md §3.5
export const workCategories = pgTable(
  "work_categories",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyCodeUnique: unique("work_categories_company_id_code_unique").on(t.companyId, t.code),
  }),
);

export type WorkCategory = typeof workCategories.$inferSelect;
export type NewWorkCategory = typeof workCategories.$inferInsert;
