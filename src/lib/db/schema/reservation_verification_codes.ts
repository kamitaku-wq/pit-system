import { sql } from "drizzle-orm";
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { companies } from "./companies";

// 顧客公開予約フローの email 6 桁コード本人確認 (Phase 64-A.32a)。
// 実 DDL = src/lib/db/raw-migrations/post/0025_reservation_verification_codes.sql (真実の源)。
// 列名/型/nullable/partial unique index を DDL と厳密一致させること
// (drizzle-kit generate/push でこの定義を再生成しない — raw SQL が authoritative)。
//
// create-on-confirm の帰結で reservation 作成前の検証状態を保持するため、reservation_id は持たない
// (customer_reservation_tokens とは別テーブル)。company_id + email でスコープ。
// code_hash = HMAC-SHA256(pepper, companyId:email:code) hex。生コードは保存しない (spec/data-model.md §3.x)。
export const reservationVerificationCodes = pgTable(
  "reservation_verification_codes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    codeHash: text("code_hash").notNull(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(5),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    attemptCountNonneg: check(
      "reservation_verification_codes_attempt_count_nonneg",
      sql`${t.attemptCount} >= 0`,
    ),
    maxAttemptsPositive: check(
      "reservation_verification_codes_max_attempts_positive",
      sql`${t.maxAttempts} > 0`,
    ),
    emailNormalized: check(
      "reservation_verification_codes_email_normalized",
      sql`${t.email} = lower(${t.email})`,
    ),
    // active コードは (company_id, email) 毎に最大 1 件 (concurrent issue 直列化 / 決定論)。
    activePerEmailUnique: uniqueIndex("reservation_verification_codes_active_per_email_uniq")
      .on(t.companyId, t.email)
      .where(sql`${t.consumedAt} IS NULL`),
    // TTL purge 用。A.34 で配線: public.purge_expired_reservation_rows() (post/0027) を
    // cron.schedule (manual/0007、本番専用) が定期実行し expires_at < now() 行を削除する。
    expiresAtIdx: index("reservation_verification_codes_expires_at_idx").on(t.expiresAt),
  }),
);

export type ReservationVerificationCode = typeof reservationVerificationCodes.$inferSelect;
export type NewReservationVerificationCode = typeof reservationVerificationCodes.$inferInsert;
