# Phase B-1b 追加: Drizzle schema for pii_anonymization_jobs

## ゴール

**新規ファイル** `src/lib/db/schema/pii_anonymization_jobs.ts` を作成する。SQL ファイル `22_pii_anonymization_jobs.sql` に対応する Drizzle schema 定義。

## 完全なコード (この内容をそのままファイル化)

```typescript
import { index, integer, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { companies } from "./companies";
import { customers } from "./customers";

// PII 匿名化ジョブキュー。
// spec/data-model.md §11.2b
// state machine: pending -> verified -> scheduled -> processing -> (completed | failed | legal_hold)
// EXCLUDE constraint と部分 index は raw SQL で定義 (22_pii_anonymization_jobs.sql 参照)。
export const piiAnonymizationJobs = pgTable(
  "pii_anonymization_jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    companyId: uuid("company_id")
      .notNull()
      .references(() => companies.id, { onDelete: "cascade" }),
    customerId: uuid("customer_id")
      .notNull()
      .references(() => customers.id, { onDelete: "cascade" }),
    anonymizedCustomerKey: uuid("anonymized_customer_key").notNull().defaultRandom(),
    requestedAt: timestamp("requested_at", { withTimezone: true }).notNull(),
    verifiedAt: timestamp("verified_at", { withTimezone: true }),
    scheduledFor: timestamp("scheduled_for", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
    status: text("status").notNull(),
    failureReason: text("failure_reason"),
    legalHoldReason: text("legal_hold_reason"),
    retryCount: integer("retry_count").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    version: integer("version").notNull().default(1),
  },
  (t) => ({
    scheduledIdx: index("idx_pii_anonymization_jobs_scheduled").on(t.scheduledFor, t.status),
    anonymizedKeyIdx: index("idx_pii_anonymization_jobs_anonymized_key").on(t.anonymizedCustomerKey),
  }),
);

export type PiiAnonymizationJob = typeof piiAnonymizationJobs.$inferSelect;
export type NewPiiAnonymizationJob = typeof piiAnonymizationJobs.$inferInsert;
```

## 完了条件

- ファイルは上記をそのまま書き出す
- typecheck / pnpm 実行はしない
- 他ファイル (index.ts 等) は触らない
