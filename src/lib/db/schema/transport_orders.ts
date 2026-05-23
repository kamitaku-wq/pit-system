import { boolean, index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { customers } from "./customers";
import { reservations } from "./reservations";
import { serviceTickets } from "./service_tickets";
import { statuses } from "./statuses";
import { stores } from "./stores";
import { vehicles } from "./vehicles";
import { vendors } from "./vendors";

// 陸送依頼。
// spec/data-model.md §3.11
export const transportOrders = pgTable(
  "transport_orders",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    serviceTicketId: uuid("service_ticket_id").references(() => serviceTickets.id, {
      onDelete: "set null",
    }),
    reservationId: uuid("reservation_id").references(() => reservations.id, {
      onDelete: "set null",
    }),
    pickupStoreId: uuid("pickup_store_id").references(() => stores.id, { onDelete: "set null" }),
    deliveryStoreId: uuid("delivery_store_id").references(() => stores.id, {
      onDelete: "set null",
    }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    statusId: uuid("status_id").references(() => statuses.id, { onDelete: "set null" }),
    movementType: text("movement_type").notNull(),
    towRequired: boolean("tow_required").notNull().default(false),
    pickupAddress: text("pickup_address"),
    deliveryAddress: text("delivery_address"),
    requestedPickupAt: timestamp("requested_pickup_at", { withTimezone: true }),
    requestedDeliveryAt: timestamp("requested_delivery_at", { withTimezone: true }),
    assignedAt: timestamp("assigned_at", { withTimezone: true }),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    priceMinor: integer("price_minor").notNull().default(0),
    notes: text("notes"),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    vendorStatusIdx: index("ix_transport_orders_vendor_status").on(t.vendorId, t.statusId),
  }),
);

export type TransportOrder = typeof transportOrders.$inferSelect;
export type NewTransportOrder = typeof transportOrders.$inferInsert;
