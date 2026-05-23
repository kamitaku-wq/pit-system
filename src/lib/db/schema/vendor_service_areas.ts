import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { vendors } from "./vendors";

// 業者対応エリア。
// spec/data-model.md §3.6
export const vendorServiceAreas = pgTable("vendor_service_areas", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  vendorId: uuid("vendor_id")
    .notNull()
    .references(() => vendors.id, { onDelete: "cascade" }),
  prefecture: text("prefecture").notNull(),
  city: text("city"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type VendorServiceArea = typeof vendorServiceAreas.$inferSelect;
export type NewVendorServiceArea = typeof vendorServiceAreas.$inferInsert;
