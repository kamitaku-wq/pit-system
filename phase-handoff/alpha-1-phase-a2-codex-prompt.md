# Sprint α-1 Phase A-2 Codex 委任プロンプト (Drizzle Schema 43 新規 + 3 更新)

**用途**: Drizzle ORM TypeScript schema 定義を `src/lib/db/schema/*.ts` 配下に生成。
**実行方式**: `/codex:rescue --wait --effort high`
**出力先**: `src/lib/db/schema/<table_name>.ts` (1 ファイル = 1 テーブル)
**前提**: Phase A-1 完了 (commit `388f8ed`)、`src/lib/db/raw-migrations/alpha-1-public/*.sql` が真実の源。

---

## 役割

Phase A-1 で生成された 21 SQL ファイルから 46 テーブル分の Drizzle schema TypeScript 定義を作成する。既存 3 ファイル (`companies.ts` / `users.ts` / `vendor_users.ts`) は α-1 リリース時の nullable 列を NOT NULL + FK へ更新する。

## 既存 schema 設計規約 (厳守)

`src/lib/db/schema/companies.ts` `users.ts` `vendor_users.ts` の現状を踏襲:

```typescript
import { pgTable, uuid, text, timestamp, boolean, ... } from "drizzle-orm/pg-core";
import { 依存テーブル } from "./依存テーブル";

// テーブル説明 (短く)
// spec/data-model.md §X.Y
export const tableName = pgTable("table_name", {
  id: uuid("id").primaryKey().defaultRandom(),
  companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "restrict" }),
  // ...
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
}, (t) => ({
  // unique / index
}));

export type TableName = typeof tableName.$inferSelect;
export type NewTableName = typeof tableName.$inferInsert;
```

### 必須ルール
1. **camelCase TS フィールド名 + snake_case DB 列名** (例: `companyId: uuid("company_id")`)
2. **FK は必ず import + references**
3. **`$inferSelect` / `$inferInsert` 型エクスポート**
4. **テーブル説明コメント + `spec/data-model.md §X.Y` 参照**
5. **`drizzle-orm/pg-core` のみ import** (relations は不要)

## 出力ファイル一覧 (1 ファイル = 1 テーブル)

`alpha-1-public/*.sql` から 46 テーブル抽出済。出力ファイル名は **snake_case のテーブル名そのまま + .ts**:

### 既存 3 ファイル更新

| ファイル | 必須更新 |
|---|---|
| `companies.ts` | 列追加なし。確認のみ |
| `users.ts` | `roleId` を **NOT NULL** + FK `roles(id)` / `defaultStoreId` を FK `stores(id)` (nullable のまま) |
| `vendor_users.ts` | `vendorId` を **NOT NULL** + FK `vendors(id)` |

### 43 新規ファイル (alpha-1-public/*.sql の CREATE TABLE 列挙)

`alpha-1-public/03_roles_statuses.sql` `05_stores.sql` `06_lanes_work.sql` `07_user_memberships.sql` `08_customers_vehicles.sql` `09_vendors.sql` `10_service_tickets.sql` `11_reservations.sql` `12_transport.sql` `13_notifications.sql` `14_settings.sql` `15_audit.sql` `16_attachments.sql` `17_analytics.sql` の各 CREATE TABLE を網羅。

**必ず Codex は alpha-1-public の SQL を Read してから生成すること**。テーブル名・列名・型の真実は SQL ファイル。

### `index.ts` 更新

すべての新規 schema を re-export:
```typescript
export * from "./companies";
export * from "./users";
export * from "./vendor_users";
export * from "./<new_table_1>";
// ...
```

## drizzle で表現できる制約

✅ 表現:
- PRIMARY KEY (`.primaryKey()`)
- FK (`.references(() => parent.id, { onDelete: "..." })`)
- NOT NULL (`.notNull()`)
- DEFAULT (`.default(...)` / `.defaultNow()` / `.defaultRandom()`)
- UNIQUE (`.unique()` または `(t) => ({ ... unique("name").on(...) })`)
- 基本 INDEX (`(t) => ({ ... index("name").on(...) })`)
- CHECK (`.check(sql\`...\`)` または raw 補助、drizzle 制約能力に応じて)
- enum 風 text + CHECK (シンプルな enum は string literal union type、CHECK 制約は SQL 側に任せる)

❌ 表現しない (raw SQL に任せる):
- EXCLUDE constraint (11_reservations.sql)
- partial INDEX (WHERE 句あり、例: ix_notification_outbox_pending WHERE status IN ...)
- partial UNIQUE INDEX (transport_order_invitations_winning_unique WHERE is_winning_bid=true)
- 複雑な CHECK 制約 (movement_type/tow CHECK 等)
- REVOKE GRANT (15_audit.sql)

これらは raw migration (alpha-1-public/*.sql) で適用済。drizzle 側は表現できる範囲のみ。

## 出力ルール

Codex は **直接ファイル書き込み可能** (Phase A-1 で確認済の sandbox 経路を使用)。各 .ts ファイルを `src/lib/db/schema/` 配下に作成し、最後に commit する。

**または** sandbox 失敗時は標準出力に以下マーカーで出力 (Phase A-1 fallback パターン):
```
=== FILE: src/lib/db/schema/<name>.ts ===
<TypeScript 本文>
=== END FILE ===
```

## 完了判定

1. 43 新規 .ts ファイル + 3 既存ファイル更新 + index.ts 更新
2. すべて `pnpm typecheck` PASS (TypeScript エラーゼロ)
3. import 循環参照ゼロ
4. テーブル名・列名が `alpha-1-public/*.sql` と完全一致 (snake_case)
5. FK の `onDelete` が SQL の `ON DELETE ...` と一致

## 注意 (RENAME 6 件は反映済)

Phase A-1 で `transport_order_invitation_id` / `recipient_vendor_user_id` / `outbox_id` / `title` / `entity_type` / `before_json` + `after_json` は SQL 側で確定済。Drizzle 側は SQL の現状を踏襲するだけ。RENAME を再適用してはいけない (SQL が正)。

## α-2 送り (作らない)

- `pii_anonymization_jobs.ts` (Phase B-1b で Claude 単独実装)
- `audit_logs_cleanup_log.ts` (α-2)
- v_accounting_audit_trail (VIEW、Drizzle 対象外)

## 期待行数

合計 ~1300 行 (1 ファイル ~30 行 × 43 + 既存 3 更新 ~5 行差分)。
