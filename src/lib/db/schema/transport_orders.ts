// Composite FK enforces (store_confirmed_by_user_id, company_id) -> users(id, company_id). raw migration 0021 is authoritative; drizzle-kit generate/push must not be used to regenerate this FK. onDelete intentionally omitted in drizzle (raw SQL sets ON DELETE NO ACTION; ON UPDATE RESTRICT here mirrors raw migration).
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { reservations } from "./reservations";
import { serviceTickets } from "./service_tickets";
import { statuses } from "./statuses";
import { stores } from "./stores";
import { users } from "./users";
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
    orderNumber: text("order_number").notNull(),
    serviceTicketId: uuid("service_ticket_id")
      .notNull()
      .references(() => serviceTickets.id, { onDelete: "restrict" }),
    reservationId: uuid("reservation_id").references(() => reservations.id, {
      onDelete: "set null",
    }),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "restrict" }),
    vendorId: uuid("vendor_id").references(() => vendors.id, { onDelete: "set null" }),
    movementType: text("movement_type").notNull(),
    pickupStoreId: uuid("pickup_store_id").references(() => stores.id, { onDelete: "set null" }),
    deliveryStoreId: uuid("delivery_store_id").references(() => stores.id, {
      onDelete: "set null",
    }),
    returnStoreId: uuid("return_store_id").references(() => stores.id, { onDelete: "set null" }),
    canDrive: boolean("can_drive").notNull().default(true),
    towRequired: boolean("tow_required").notNull().default(false),
    requestedPickupAt: timestamp("requested_pickup_at", { withTimezone: true }),
    requestedDeliveryAt: timestamp("requested_delivery_at", { withTimezone: true }),
    requestedReturnAt: timestamp("requested_return_at", { withTimezone: true }),
    scheduledPickupAt: timestamp("scheduled_pickup_at", { withTimezone: true }),
    scheduledDeliveryAt: timestamp("scheduled_delivery_at", { withTimezone: true }),
    scheduledReturnAt: timestamp("scheduled_return_at", { withTimezone: true }),
    pickedUpAt: timestamp("picked_up_at", { withTimezone: true }),
    deliveredAt: timestamp("delivered_at", { withTimezone: true }),
    returnedAt: timestamp("returned_at", { withTimezone: true }),
    vendorResponse: text("vendor_response").notNull().default("pending"),
    vendorResponseAt: timestamp("vendor_response_at", { withTimezone: true }),
    vendorRejectionReason: text("vendor_rejection_reason"),
    confirmationMode: text("confirmation_mode").notNull().default("auto"),
    storeConfirmedAt: timestamp("store_confirmed_at", { withTimezone: true }),
    storeConfirmedByUserId: uuid("store_confirmed_by_user_id"),
    statusId: uuid("status_id")
      .notNull()
      .references(() => statuses.id, { onDelete: "restrict" }),
    notificationSentAt: timestamp("notification_sent_at", { withTimezone: true }),
    notes: text("notes"),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    version: integer("version").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    companyOrderNumberUnique: unique("transport_orders_company_order_number_unique").on(
      t.companyId,
      t.orderNumber,
    ),
    movementTypeCheck: check(
      "transport_orders_movement_type_check",
      sql`${t.movementType} IN ('one_way', 'round_trip', 'pickup_only', 'three_point')`,
    ),
    vendorResponseCheck: check(
      "transport_orders_vendor_response_check",
      sql`${t.vendorResponse} IN ('pending', 'accepted', 'rejected')`,
    ),
    confirmationModeCheck: check(
      "transport_orders_confirmation_mode_check",
      sql`${t.confirmationMode} IN ('auto', 'manual')`,
    ),
    movementPatternCheck: check(
      "transport_orders_movement_pattern_check",
      sql`(
        (${t.movementType} = 'one_way' AND ${t.pickupStoreId} IS NOT NULL AND ${t.deliveryStoreId} IS NOT NULL AND ${t.returnStoreId} IS NULL)
        OR
        (${t.movementType} = 'round_trip' AND ${t.pickupStoreId} IS NOT NULL AND ${t.deliveryStoreId} IS NOT NULL AND ${t.returnStoreId} IS NOT NULL)
        OR
        (${t.movementType} = 'pickup_only' AND ${t.pickupStoreId} IS NOT NULL AND ${t.deliveryStoreId} IS NULL AND ${t.returnStoreId} IS NULL)
        OR
        (${t.movementType} = 'three_point' AND ${t.pickupStoreId} IS NOT NULL AND ${t.deliveryStoreId} IS NOT NULL AND ${t.returnStoreId} IS NOT NULL
          AND ${t.pickupStoreId} != ${t.deliveryStoreId}
          AND ${t.deliveryStoreId} != ${t.returnStoreId}
          AND ${t.pickupStoreId} != ${t.returnStoreId})
      )`,
    ),
    towCheck: check(
      "transport_orders_tow_check",
      sql`(NOT ${t.canDrive}) = ${t.towRequired} OR (${t.canDrive} AND NOT ${t.towRequired})`,
    ),
    vendorStatusIdx: index("idx_transport_orders_vendor_status").on(t.vendorId, t.statusId),
    companyStatusIdx: index("idx_transport_orders_company_status").on(t.companyId, t.statusId),
    pickupStoreIdx: index("idx_transport_orders_pickup_store").on(t.pickupStoreId),
    deliveryStoreIdx: index("idx_transport_orders_delivery_store").on(t.deliveryStoreId),
    storeConfirmedByUserCompanyFk: foreignKey({
      columns: [t.storeConfirmedByUserId, t.companyId],
      foreignColumns: [users.id, users.companyId],
      name: "transport_orders_store_confirmed_by_user_company_fk",
    }).onUpdate("restrict"),
  }),
);

export type TransportOrder = typeof transportOrders.$inferSelect;
export type NewTransportOrder = typeof transportOrders.$inferInsert;
