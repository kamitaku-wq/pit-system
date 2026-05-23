import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { statuses } from "./statuses";

// ステータス遷移ルール。
// spec/data-model.md §3.8
export const statusTransitions = pgTable(
  "status_transitions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    fromStatusId: uuid("from_status_id").references(() => statuses.id, { onDelete: "cascade" }),
    toStatusId: uuid("to_status_id").references(() => statuses.id, { onDelete: "cascade" }),
    requiredPermission: text("required_permission"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    fromStatusIdx: index("ix_status_transitions_from").on(t.fromStatusId),
  }),
);

export type StatusTransition = typeof statusTransitions.$inferSelect;
export type NewStatusTransition = typeof statusTransitions.$inferInsert;
