import { integer, pgTable, time, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { vendors } from "./vendors";

// 業者対応曜日。
// spec/data-model.md §3.6
export const vendorAvailableDays = pgTable("vendor_available_days", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  vendorId: uuid("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  startsAt: time("starts_at"),
  endsAt: time("ends_at"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VendorAvailableDay = typeof vendorAvailableDays.$inferSelect;
export type NewVendorAvailableDay = typeof vendorAvailableDays.$inferInsert;
