import { integer, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { stores } from "./stores";
import { vendors } from "./vendors";

// 業者 SLA 上書き設定。
// spec/data-model.md §3.6
export const vendorSlaOverrides = pgTable(
  "vendor_sla_overrides",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "cascade" }),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    responseDeadlineMinutes: integer("response_deadline_minutes"),
    pickupDeadlineMinutes: integer("pickup_deadline_minutes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    vendorStoreUnique: unique("vendor_sla_overrides_vendor_id_store_id_unique").on(
      t.vendorId,
      t.storeId,
    ),
  }),
);

export type VendorSlaOverride = typeof vendorSlaOverrides.$inferSelect;
export type NewVendorSlaOverride = typeof vendorSlaOverrides.$inferInsert;
