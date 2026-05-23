import { boolean, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

// 販売会社 (法人) = 最上位テナント。唯一 company_id を持たない。
// spec/data-model.md §3.1
export const companies = pgTable("companies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  code: text("code").unique(),
  timeZone: text("time_zone").notNull().default("Asia/Tokyo"),
  defaultCurrency: text("default_currency").notNull().default("JPY"),
  isActive: boolean("is_active").notNull().default(true),
  plan: text("plan"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Company = typeof companies.$inferSelect;
export type NewCompany = typeof companies.$inferInsert;
