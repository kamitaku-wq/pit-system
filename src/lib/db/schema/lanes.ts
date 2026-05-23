import { boolean, integer, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { laneTypes } from "./lane_types";
import { stores } from "./stores";

// 店舗内レーン。
// spec/data-model.md §3.4
export const lanes = pgTable(
  "lanes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    storeId: uuid("store_id")
      .notNull()
      .references(() => stores.id, { onDelete: "cascade" }),
    laneTypeId: uuid("lane_type_id").references(() => laneTypes.id, { onDelete: "set null" }),
    code: text("code"),
    name: text("name").notNull(),
    capacity: integer("capacity").notNull().default(1),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
  },
  (t) => ({
    storeCodeUnique: unique("lanes_store_id_code_unique").on(t.storeId, t.code),
  }),
);

export type Lane = typeof lanes.$inferSelect;
export type NewLane = typeof lanes.$inferInsert;
