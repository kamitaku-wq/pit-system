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
    // 表示色 (hex)。NULL の場合はフロントの既定色マップ (status-color.ts) にフォールバック。
    // 会社が任意ステータスに色を指定できる (Phase 69 S0a, spec/screen-list §1.2 色分け)。
    color: text("color"),
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
    colorHexCheck: check(
      "statuses_color_hex_check",
      sql`${t.color} IS NULL OR ${t.color} ~ '^#[0-9A-Fa-f]{6}$'`,
    ),
  }),
);

export type Status = typeof statuses.$inferSelect;
export type NewStatus = typeof statuses.$inferInsert;
