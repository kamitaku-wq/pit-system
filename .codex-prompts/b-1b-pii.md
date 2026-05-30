# Phase B-1b: pii_anonymization_jobs 新規テーブル

## ゴール

**新規ファイル** `src/lib/db/raw-migrations/alpha-1-public/22_pii_anonymization_jobs.sql` を作成し、`pii_anonymization_jobs` テーブル + EXCLUDE constraint + 2 index を実装する。

ファイル番号 22 にする理由: 既存 21_seed_master.sql の後に置き、Phase B の追加テーブルとして filename sort 順を維持。`_raw_migrations` で skip されない新規 filename。

## spec 出典

spec/data-model.md §11.2b (lines 1253-1287)。reconciliation Table 3 と完全一致。

## 完全な SQL (この内容をそのままファイル化)

```sql
-- Phase B-1b: pii_anonymization_jobs (spec §11.2b, lines 1259-1287)
-- 顧客削除リクエストから 30 日後に PII を匿名化する Inngest scheduled job のタスクキュー
-- state machine: pending -> verified -> scheduled -> processing -> (completed | failed | legal_hold)
-- v_accounting_audit_trail VIEW は service_tickets 完備依存のため α-2 送り (本ファイル除外)

CREATE TABLE pii_anonymization_jobs (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id                uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  customer_id               uuid NOT NULL REFERENCES customers(id) ON DELETE CASCADE,
  anonymized_customer_key   uuid NOT NULL DEFAULT gen_random_uuid(),
  requested_at              timestamptz NOT NULL,
  verified_at               timestamptz NULL,
  scheduled_for             timestamptz NOT NULL,
  processed_at              timestamptz NULL,
  status                    text NOT NULL CHECK (status IN (
                              'pending', 'verified', 'scheduled', 'processing',
                              'completed', 'failed', 'legal_hold'
                            )),
  failure_reason            text NULL,
  legal_hold_reason         text NULL,
  retry_count               int NOT NULL DEFAULT 0,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now(),
  version                   int NOT NULL DEFAULT 1,
  CONSTRAINT pii_anonymization_jobs_unique_pending
    EXCLUDE USING btree (customer_id WITH =)
    WHERE (status IN ('pending', 'verified', 'scheduled', 'processing'))
);

CREATE INDEX idx_pii_anonymization_jobs_scheduled
  ON pii_anonymization_jobs (scheduled_for, status)
  WHERE status IN ('pending', 'verified', 'scheduled');

CREATE INDEX idx_pii_anonymization_jobs_anonymized_key
  ON pii_anonymization_jobs (anonymized_customer_key);
```

## 完了条件

- ファイル全体 ~35-40 行
- CHECK 制約に 7 値すべて含まれる
- EXCLUDE constraint が `WHERE` 句付き
- index 2 種 (scheduled / anonymized_key) すべて作成
- VIEW (v_accounting_audit_trail) は **書かない** (service_tickets 完備依存、α-2 送り)
- typecheck / pnpm 実行はしない
