import { boolean, index, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// 予約・陸送などの状態マスタ。
// spec/data-model.md §3.8
export const statuses = pgTable(
  "statuses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    domain: text("domain").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isTerminal: boolean("is_terminal").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyDomainCodeUnique: unique("statuses_company_id_domain_code_unique").on(
      t.companyId,
      t.domain,
      t.code,
    ),
    domainCodeIdx: index("ix_statuses_domain_code").on(t.domain, t.code),
  }),
);

export type Status = typeof statuses.$inferSelect;
export type NewStatus = typeof statuses.$inferInsert;
