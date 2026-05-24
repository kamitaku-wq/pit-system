import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";

// 予約・陸送などの状態マスタ。
// spec/data-model.md §3.8
export const statuses = pgTable(
  "statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id),
    statusType: text("status_type").notNull(),
    key: text("key").notNull(),
    name: text("name").notNull(),
    displayOrder: integer("display_order"),
    isInitial: boolean("is_initial").notNull().default(false),
    isTerminal: boolean("is_terminal").notNull().default(false),
    isActive: boolean("is_active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyStatusTypeKeyUnique: unique("statuses_company_id_status_type_key_unique").on(
      t.companyId,
      t.statusType,
      t.key,
    ),
    statusTypeCheck: check(
      "statuses_status_type_check",
      sql`${t.statusType} IN ('reservation', 'service', 'transport', 'vendor')`,
    ),
  }),
);

export type Status = typeof statuses.$inferSelect;
export type NewStatus = typeof statuses.$inferInsert;
