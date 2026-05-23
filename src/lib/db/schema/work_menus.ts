import { boolean, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { workCategories } from "./work_categories";

// 作業メニュー。
// spec/data-model.md §3.5
export const workMenus = pgTable(
  "work_menus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    workCategoryId: uuid("work_category_id").references(() => workCategories.id, {
      onDelete: "set null",
    }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    durationMinutes: integer("duration_minutes").notNull().default(60),
    priceMinor: integer("price_minor").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    companyCodeUnique: unique("work_menus_company_id_code_unique").on(t.companyId, t.code),
  }),
);

export type WorkMenu = typeof workMenus.$inferSelect;
export type NewWorkMenu = typeof workMenus.$inferInsert;
