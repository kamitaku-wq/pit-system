import { integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";

// レーン種別マスタ。
// spec/data-model.md §3.4
export const laneTypes = pgTable(
  "lane_types",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }),
    code: text("code").notNull(),
    name: text("name").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    companyCodeUnique: unique("lane_types_company_id_code_unique").on(t.companyId, t.code),
  }),
);

export type LaneType = typeof laneTypes.$inferSelect;
export type NewLaneType = typeof laneTypes.$inferInsert;
