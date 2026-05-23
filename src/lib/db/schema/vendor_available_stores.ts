import { pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { stores } from "./stores";
import { vendors } from "./vendors";

// 業者が利用可能な店舗。
// spec/data-model.md §3.6
export const vendorAvailableStores = pgTable(
  "vendor_available_stores",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    vendorStoreUnique: unique("vendor_available_stores_vendor_id_store_id_unique").on(
      t.vendorId,
      t.storeId,
    ),
  }),
);

export type VendorAvailableStore = typeof vendorAvailableStores.$inferSelect;
export type NewVendorAvailableStore = typeof vendorAvailableStores.$inferInsert;
