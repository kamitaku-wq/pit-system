import { pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { lanes } from "./lanes";
import { workMenus } from "./work_menus";

// レーンで提供可能な作業メニュー。
// spec/data-model.md §3.5
export const laneWorkMenus = pgTable(
  "lane_work_menus",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "restrict" }),
    laneId: uuid("lane_id")
      .notNull()
      .references(() => lanes.id, { onDelete: "cascade" }),
    workMenuId: uuid("work_menu_id")
      .notNull()
      .references(() => workMenus.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    laneWorkMenuUnique: unique("lane_work_menus_lane_id_work_menu_id_unique").on(
      t.laneId,
      t.workMenuId,
    ),
  }),
);

export type LaneWorkMenu = typeof laneWorkMenus.$inferSelect;
export type NewLaneWorkMenu = typeof laneWorkMenus.$inferInsert;
