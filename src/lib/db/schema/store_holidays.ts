import { boolean, date, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { stores } from "./stores";

// 店舗休業日。
// spec/data-model.md §3.3
export const storeHolidays = pgTable(
  "store_holidays",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    holidayDate: date("holiday_date").notNull(),
    name: text("name"),
    isClosed: boolean("is_closed").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    storeHolidayDateUnique: unique("store_holidays_store_id_holiday_date_unique").on(
      t.storeId,
      t.holidayDate,
    ),
  }),
);

export type StoreHoliday = typeof storeHolidays.$inferSelect;
export type NewStoreHoliday = typeof storeHolidays.$inferInsert;
