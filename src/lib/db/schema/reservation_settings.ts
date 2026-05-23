import { integer, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { stores } from "./stores";

// 予約設定。
// spec/data-model.md §3.13
export const reservationSettings = pgTable(
  "reservation_settings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    storeId: uuid("store_id").references(() => stores.id, { onDelete: "cascade" }),
    slotIntervalMinutes: integer("slot_interval_minutes").notNull().default(30),
    minLeadTimeMinutes: integer("min_lead_time_minutes").notNull().default(0),
    maxAdvanceDays: integer("max_advance_days").notNull().default(90),
    cancellationDeadlineMinutes: integer("cancellation_deadline_minutes").notNull().default(0),
    bufferBeforeMinutes: integer("buffer_before_minutes").notNull().default(0),
    bufferAfterMinutes: integer("buffer_after_minutes").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyStoreUnique: unique("reservation_settings_company_id_store_id_unique").on(
      t.companyId,
      t.storeId,
    ),
  }),
);

export type ReservationSetting = typeof reservationSettings.$inferSelect;
export type NewReservationSetting = typeof reservationSettings.$inferInsert;
