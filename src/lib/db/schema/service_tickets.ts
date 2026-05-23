import { index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { customers } from "./customers";
import { statuses } from "./statuses";
import { stores } from "./stores";
import { vehicles } from "./vehicles";
import { workCategories } from "./work_categories";
import { workMenus } from "./work_menus";

// サービスチケット。
// spec/data-model.md §3.9
export const serviceTickets = pgTable(
  "service_tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "set null" }),
    statusId: uuid("status_id").references(() => statuses.id, { onDelete: "set null" }),
    workCategoryId: uuid("work_category_id").references(() => workCategories.id, {
      onDelete: "set null",
    }),
    workMenuId: uuid("work_menu_id").references(() => workMenus.id, { onDelete: "set null" }),
    ticketNo: text("ticket_no"),
    quotedAmountMinor: integer("quoted_amount_minor").notNull().default(0),
    taxRateBps: integer("tax_rate_bps").notNull().default(1000),
    billingStatus: text("billing_status").notNull().default("unbilled"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyTicketNoUnique: unique("service_tickets_company_id_ticket_no_unique").on(
      t.companyId,
      t.ticketNo,
    ),
    companyStatusIdx: index("ix_service_tickets_company_status").on(t.companyId, t.statusId),
  }),
);

export type ServiceTicket = typeof serviceTickets.$inferSelect;
export type NewServiceTicket = typeof serviceTickets.$inferInsert;
