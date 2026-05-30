import { sql } from "drizzle-orm";
import { check, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { transportOrders } from "./transport_orders";
import { vendors } from "./vendors";

// 陸送依頼の業者打診試行。
// spec/data-model.md §3.11
export const transportOrderVendorAttempts = pgTable(
  "transport_order_vendor_attempts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    transportOrderId: uuid("transport_order_id")
      .notNull()
      .references(() => transportOrders.id, { onDelete: "cascade" }),
    vendorId: uuid("vendor_id")
      .notNull()
      .references(() => vendors.id, { onDelete: "restrict" }),
    attemptSeq: integer("attempt_seq").notNull(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    response: text("response"),
    respondedAt: timestamp("responded_at", { withTimezone: true }),
    rejectionReason: text("rejection_reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    transportOrderAttemptSeqUnique: unique(
      "transport_order_vendor_attempts_transport_order_attempt_seq_unique",
    ).on(t.transportOrderId, t.attemptSeq),
    responseCheck: check(
      "transport_order_vendor_attempts_response_check",
      sql`${t.response} IN ('pending', 'accepted', 'rejected', 'timeout')`,
    ),
  }),
);

export type TransportOrderVendorAttempt = typeof transportOrderVendorAttempts.$inferSelect;
export type NewTransportOrderVendorAttempt = typeof transportOrderVendorAttempts.$inferInsert;
