import { integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { customers } from "./customers";
import { lanes } from "./lanes";
import { serviceTickets } from "./service_tickets";
import { statuses } from "./statuses";
import { stores } from "./stores";
import { vehicles } from "./vehicles";
import { workMenus } from "./work_menus";

// 作業予約。
// spec/data-model.md §3.10
export const reservations = pgTable("reservations", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  serviceTicketId: uuid("service_ticket_id").references(() => serviceTickets.id, {
    onDelete: "set null",
  }),
  storeId: uuid("store_id")
    .notNull()
    .references(() => stores.id, { onDelete: "restrict" }),
  laneId: uuid("lane_id")
    .notNull()
    .references(() => lanes.id, { onDelete: "restrict" }),
  workMenuId: uuid("work_menu_id").references(() => workMenus.id, { onDelete: "set null" }),
  statusId: uuid("status_id").references(() => statuses.id, { onDelete: "set null" }),
  customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
  vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
  startAt: timestamp("start_at", { withTimezone: true }).notNull(),
  endAt: timestamp("end_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes"),
  notes: text("notes"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
});

export type Reservation = typeof reservations.$inferSelect;
export type NewReservation = typeof reservations.$inferInsert;
