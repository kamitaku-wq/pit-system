import { boolean, integer, pgTable, time, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { stores } from "./stores";

// 店舗営業時間。
// spec/data-model.md §3.3
export const storeBusinessHours = pgTable("store_business_hours", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  opensAt: time("opens_at").notNull(),
  closesAt: time("closes_at").notNull(),
  acceptsReservations: boolean("accepts_reservations").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type StoreBusinessHour = typeof storeBusinessHours.$inferSelect;
export type NewStoreBusinessHour = typeof storeBusinessHours.$inferInsert;
