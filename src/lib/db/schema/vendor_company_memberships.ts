import { boolean, date, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { vendors } from "./vendors";

// 業者と会社の利用関係。
// spec/data-model.md §3.6
export const vendorCompanyMemberships = pgTable(
  "vendor_company_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    isShared: boolean("is_shared").notNull().default(false),
    startsOn: date("starts_on"),
    endsOn: date("ends_on"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyVendorUnique: unique("vendor_company_memberships_company_id_vendor_id_unique").on(
      t.companyId,
      t.vendorId,
    ),
  }),
);

export type VendorCompanyMembership = typeof vendorCompanyMemberships.$inferSelect;
export type NewVendorCompanyMembership = typeof vendorCompanyMemberships.$inferInsert;
