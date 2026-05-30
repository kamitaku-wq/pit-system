import { integer, pgTable, time, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { lanes } from "./lanes";

// レーン稼働時間。
// spec/data-model.md §3.4
export const laneWorkingHours = pgTable("lane_working_hours", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id")
    .notNull()
    .references(() => companies.id, { onDelete: "restrict" }),
  laneId: uuid("lane_id")
    .notNull()
    .references(() => lanes.id, { onDelete: "cascade" }),
  dayOfWeek: integer("day_of_week").notNull(),
  startsAt: time("starts_at").notNull(),
  endsAt: time("ends_at").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type LaneWorkingHour = typeof laneWorkingHours.$inferSelect;
export type NewLaneWorkingHour = typeof laneWorkingHours.$inferInsert;
