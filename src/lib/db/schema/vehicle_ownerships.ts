import { boolean, date, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { customers } from "./customers";
import { vehicles } from "./vehicles";

// 顧客と車両の所有関係。
// spec/data-model.md §3.7
export const vehicleOwnerships = pgTable("vehicle_ownerships", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  customerId: uuid("customer_id")
    .notNull()
    .references(() => customers.id, { onDelete: "cascade" }),
  vehicleId: uuid("vehicle_id")
    .notNull()
    .references(() => vehicles.id, { onDelete: "cascade" }),
  startsOn: date("starts_on").notNull().defaultNow(),
  endsOn: date("ends_on"),
  isPrimary: boolean("is_primary").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type VehicleOwnership = typeof vehicleOwnerships.$inferSelect;
export type NewVehicleOwnership = typeof vehicleOwnerships.$inferInsert;
