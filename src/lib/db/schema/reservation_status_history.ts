import { foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { reservations } from "./reservations";
import { statuses } from "./statuses";
import { users } from "./users";

// 予約ステータス変更履歴。
// spec/data-model.md §3.10
// Composite FK enforces (changed_by_user_id, company_id) -> users(id, company_id).
// raw migration 0018 is authoritative; drizzle-kit generate/push must not be used to regenerate this FK.
// onDelete intentionally omitted in drizzle (raw SQL sets ON DELETE NO ACTION; ON UPDATE RESTRICT here mirrors raw migration).
export const reservationStatusHistory = pgTable(
  "reservation_status_history",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    reservationId: uuid("reservation_id")
      .notNull()
      .references(() => reservations.id, { onDelete: "cascade" }),
    fromStatusId: uuid("from_status_id").references(() => statuses.id, { onDelete: "set null" }),
    toStatusId: uuid("to_status_id")
      .notNull()
      .references(() => statuses.id, { onDelete: "restrict" }),
    changedByUserId: uuid("changed_by_user_id"),
    reason: text("reason"),
    changedAt: timestamp("changed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    reservationChangedAtIdx: index("idx_reservation_status_history_reservation_changed_at").on(
      t.reservationId,
      t.changedAt,
    ),
    changedByUserCompanyFk: foreignKey({
      columns: [t.changedByUserId, t.companyId],
      foreignColumns: [users.id, users.companyId],
      name: "reservation_status_history_changed_by_user_company_fk",
    }).onUpdate("restrict"),
  }),
);

export type ReservationStatusHistory = typeof reservationStatusHistory.$inferSelect;
export type NewReservationStatusHistory = typeof reservationStatusHistory.$inferInsert;
