import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { reservations } from "./reservations";
import { statuses } from "./statuses";
import { users } from "./users";

// 予約ステータス変更履歴。
// spec/data-model.md §3.10
export const reservationStatusHistory = pgTable("reservation_status_history", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  reservationId: uuid("reservation_id")
    .notNull()
    .references(() => reservations.id, { onDelete: "cascade" }),
  fromStatusId: uuid("from_status_id").references(() => statuses.id, { onDelete: "set null" }),
  statusId: uuid("status_id").references(() => statuses.id, { onDelete: "set null" }),
  createdByUserId: uuid("created_by_user_id").references(() => users.id, {
    onDelete: "set null",
  }),
  reason: text("reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ReservationStatusHistory = typeof reservationStatusHistory.$inferSelect;
export type NewReservationStatusHistory = typeof reservationStatusHistory.$inferInsert;
