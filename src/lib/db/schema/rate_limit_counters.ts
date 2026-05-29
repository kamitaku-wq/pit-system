import { index, integer, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

// 公開予約 surface の IP/global 送信レート制限カウンタ (Phase 64-A.33)。
// 実 DDL = src/lib/db/raw-migrations/post/0026_rate_limit_counters.sql (真実の源)。
// 列名/型/nullable/複合 PK を DDL と厳密一致させること
// (drizzle-kit generate/push でこの定義を再生成しない — raw SQL が authoritative)。
//
// 汎用 固定窓カウンタ。bucket_key の prefix で用途を分離する ("rsv:vcode:ip:<ip>" 等)。
// company スコープを持たない (キーは IP/global) ため tenant 列を持たず、RLS は policy 不在で
// anon/authenticated 全拒否、service_role のみ書込 (rate-limiter.ts)。
export const rateLimitCounters = pgTable(
  "rate_limit_counters",
  {
    bucketKey: text("bucket_key").notNull(),
    windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
    count: integer("count").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.bucketKey, t.windowStart] }),
    // pg_cron purge 用 (A.33 follow-up)。
    expiresAtIdx: index("rate_limit_counters_expires_at_idx").on(t.expiresAt),
  }),
);

export type RateLimitCounter = typeof rateLimitCounters.$inferSelect;
export type NewRateLimitCounter = typeof rateLimitCounters.$inferInsert;
