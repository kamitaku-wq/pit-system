import { boolean, date, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { vendors } from "./vendors";

// 業者と会社の利用関係。
// spec/data-model.md §3.6
export const vendorCompanyMemberships = pgTable(
  "vendor_company_memberships",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    isEnabled: boolean("is_enabled").notNull().default(true),
    contractStartedAt: date("contract_started_at"),
    contractEndedAt: date("contract_ended_at"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    vendorCompanyUnique: unique("vendor_company_memberships_vendor_id_company_id_key").on(
      t.vendorId,
      t.companyId,
    ),
  }),
);

export type VendorCompanyMembership = typeof vendorCompanyMemberships.$inferSelect;
export type NewVendorCompanyMembership = typeof vendorCompanyMemberships.$inferInsert;
