import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { customers } from "./customers";
import { reservations } from "./reservations";

// per-action token の purpose 値域 (spec §12.2/§4.7)。
// DB CHECK 制約 (0022 migration) と Zod enum の単一ソース。
// Phase 64-A.27: foundation のみ。modify/cancel token の発行・route は A.28 以降。
export const CUSTOMER_RESERVATION_TOKEN_PURPOSES = ["view", "modify", "cancel"] as const;
export type CustomerReservationTokenPurpose =
  (typeof CUSTOMER_RESERVATION_TOKEN_PURPOSES)[number];

// 顧客予約アクセス用トークン。
// spec/data-model.md §3.7
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
    // per-action discriminator。consume の WHERE 述語で必須強制 (A.27)。
    purpose: text("purpose").notNull().$type<CustomerReservationTokenPurpose>(),
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
