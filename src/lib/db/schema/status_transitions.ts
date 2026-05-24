import { boolean, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { statuses } from "./statuses";

// ステータス遷移ルール。
// spec/data-model.md §3.8
export const statusTransitions = pgTable(
  "status_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    statusType: text("status_type").notNull(),
    fromStatusId: uuid("from_status_id").references(() => statuses.id),
    toStatusId: uuid("to_status_id")
      .notNull()
      .references(() => statuses.id),
    requiredPermissionKey: text("required_permission_key"),
    requiredRoleKey: text("required_role_key"),
    triggersNotification: boolean("triggers_notification").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyStatusTransitionUnique: unique(
      "status_transitions_company_id_status_type_from_status_id_to_status_id_unique",
    ).on(t.companyId, t.statusType, t.fromStatusId, t.toStatusId),
  }),
);

export type StatusTransition = typeof statusTransitions.$inferSelect;
export type NewStatusTransition = typeof statusTransitions.$inferInsert;
