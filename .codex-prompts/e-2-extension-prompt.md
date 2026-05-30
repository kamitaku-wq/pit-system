# Codex 委任: E-2 残 18 assertions 追加実装

## 目的

`tests/integration/record-audit-log.test.ts` に 18 ケースを追記し、Plan §E-2 「9 tables × 3 actions = 27 assertions」DoD を達成する。

## 必読資料

1. `.codex-prompts/e-2-extension-spec.md` — 18 ケースの構造、FK 解決、redact 期待値、CHECK constraints
2. `tests/integration/record-audit-log.test.ts` — Phase 11 で書かれた既存 9 ケース。**パターンを厳密に踏襲**
3. `src/lib/db/raw-migrations/alpha-1-public/23_record_audit_log.sql` — trigger 本体 (actor_kind 解決、deleted_at 分岐)
4. `src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql` — `redact_audit_payload` の 5 entity 対応

## タスク

`tests/integration/record-audit-log.test.ts` を **拡張** (新規ファイル作成不可):

1. 既存 9 ケースは **一切変更しない**
2. 末尾に `describe` ブロックを追加して 18 assertions を網羅:
   - users (3): INSERT/UPDATE/DELETE — email redact
   - vehicles (1): DELETE — vin redact
   - vendors (2): UPDATE/DELETE — passthrough
   - vendor_users (2): UPDATE/DELETE — email redact
   - service_tickets (3): INSERT/UPDATE/DELETE — passthrough
   - reservations (3): INSERT/UPDATE/DELETE — passthrough (FK: lanes 必須)
   - transport_orders (3): INSERT/UPDATE/DELETE — passthrough (movement_type='self_drive')
   - transport_order_invitations (1): INSERT — passthrough

## 厳守事項

- 各 it は `sql.begin(async (tx) => { try { ... } finally { throw new Error("__rollback__") } }).catch(err => { if (!(err instanceof Error) || err.message !== "__rollback__") throw err })` パターン
- 各 INSERT は `(await tx<{ id: string }[]>\`...RETURNING id\`)[0]!` で narrowing
- `AuditRow` interface 再利用 (既存定義流用)
- 各 company name は `__e2_<entity>_<action>__` 形式で衝突回避
- expect 型は `(audit.after_json as Record<string, ...>).<field>` 形式
- users.id は default なし → `gen_random_uuid()` を SQL 側で明示
- transport_orders.movement_type は `'self_drive'` 固定 (CHECK 違反回避)
- reservations は `start_at`, `end_at` 必須 (例: `now()`, `now() + interval '1 hour'`)
- soft delete の audit action は `'delete'`、restore は `'restore'` (既存ロジック確認済)

## 検証コマンド

```
pnpm typecheck
pnpm test tests/integration/record-audit-log.test.ts
```

→ 27/27 PASS 必須。失敗時は specifically どのケースが失敗したかを output に含めて返す。

## 出力フォーマット

1. 修正後 `tests/integration/record-audit-log.test.ts` 全文
2. `pnpm test tests/integration/record-audit-log.test.ts` の最終結果 (PASS/FAIL counts)
3. typecheck 結果

## 重要な落とし穴 (Phase 11 で実体験)

- `const [foo] = await tx<...>` パターンは `T | undefined` で typecheck failure → `(await tx<...>)[0]!` 統一
- `dynamic import postgres` で `TransactionSql` 型 unresolvable → `type Tx = any` (test 限定) を使う場合は既存パターン継承
- 半括弧 `)` 残存破壊に注意 (Phase 11 で broken parens 修正発生)
