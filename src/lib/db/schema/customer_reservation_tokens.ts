import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { customers } from "./customers";
import { reservations } from "./reservations";

// 顧客予約アクセス用トークン。
// spec/data-model.md §3.10
export const customerReservationTokens = pgTable(
  "customer_reservation_tokens",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id").references(() => customers.id, { onDelete: "set null" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    tokenHashUnique: unique("customer_reservation_tokens_token_hash_unique").on(t.tokenHash),
  }),
);

export type CustomerReservationToken = typeof customerReservationTokens.$inferSelect;
export type NewCustomerReservationToken = typeof customerReservationTokens.$inferInsert;
