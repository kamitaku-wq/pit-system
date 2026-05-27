# Phase 53 計画: transport_order_change_logs 新規 table 追加

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 53 (前: 52 sealed) |
| 状態 | planning |
| 立案日時 | 2026-05-27 |
| 前 handoff | `phase-52-e2e-cleanup-sealed.md` |
| Branch | `phase-42-t4-test-coverage` |
| 採用方針 | scope A (schema + migration のみ、service 統合は Phase 54+)、ユーザー判断 |
| Spec 参照 | `spec/data-model.md` §7.8 |

## scope 訂正経緯

Phase 47 sealed の MVP blocker 4 記述「`status_history.change_type` column 追加 migration」は **誤り**:
- spec §7.7 `transport_order_status_history` には change_type 言及なし (現状 schema 正しい)
- spec §7.8 **`transport_order_change_logs` 新規テーブル** に change_type (CHECK IN 5 値) 等 8 column 定義あり、schema 未存在

つまり真の MVP blocker 4 = 新規テーブル追加。本 Phase で schema + migration のみ、service 統合は次 Phase に切り分け。

## Scope (副作用なし、新規 table のみ、breaking なし)

### IN

1. **新規 drizzle schema**: `src/lib/db/schema/transport_order_change_logs.ts`
   - 8 column: `id` / `company_id` / `transport_order_id` / `change_type` / `before_json` / `after_json` / `changed_by_user_id` / `requires_notification` / `notified_at` / `created_at`
   - CHECK constraint: `change_type IN ('vendor_changed','datetime_changed','cancelled','recreated','rejected_reassigned')`
   - INDEX `(transport_order_id, created_at)`
   - FK: `company_id` → companies(id), `transport_order_id` → transport_orders(id), `changed_by_user_id` → users(id) ON DELETE SET NULL
   - drizzle 既存 pattern 踏襲 (defaultRandom / withTimezone / inferSelect/Insert)
2. **schema index export**: `src/lib/db/schema/index.ts` に export 追加
3. **新規 raw migration**: `src/lib/db/raw-migrations/post/0014_create_transport_order_change_logs.sql`
   - `CREATE TABLE` + CHECK + INDEX
   - 既存 raw migration pattern 踏襲 (Phase 50 `0012_` 以来の path/連番)
   - 冪等化なし (CREATE TABLE は再実行で重複エラー、apply-raw-sql.ts SKIP ロジックに依存)
4. **db:apply-raw:post 実行**: test DB に table 作成
5. **typecheck + test:all 確認**: 既存 152 tests 維持 (新規 table 誰も使わないので影響なし)

### OUT (Phase 54+ で扱う)

- service 統合 (`cancelTransportOrder` で change_logs INSERT 等)
- `transport_order_change_logs` 利用 RLS / trigger
- before_json / after_json の redaction policy
- requires_notification → outbox 連携
- 既存 cancel action の history pattern との整合性検討
- admin UI で change_logs 表示
- test 統合 (assertion 追加)

## 主要設計判断

1. **schema は drizzle TS で定義、migration は raw SQL** (既存 pattern 踏襲、Phase 50/51 と整合)
2. **CHECK constraint は SQL レベル + drizzle check() 両方** (drizzle の `check()` は migration には反映されないが、schema 文書化として有効)
3. **`before_json` / `after_json` は `jsonb` type** (drizzle の `jsonb()` 使用)
4. **`requires_notification` は NOT NULL DEFAULT true** (spec §7.8 厳守)
5. **FK ON DELETE policy**: `changed_by_user_id` のみ `SET NULL` (user 削除時に履歴保持)、その他は cascade なし (Phase 51 cleanup pattern 維持)
6. **adversarial review skip 判断**: 新規 table 追加で副作用 0 / breaking 0、ただし schema 変更は production 影響あり → Codex review 1 件で構造確認
7. **service 統合を OUT に**: scope crisp 維持、Phase 47 NO-GO 教訓踏襲
8. **SQL は Claude 自実装** (Phase 50 教訓継続、schema-specific は Codex 幻覚リスク)
9. **`db:apply-raw:post` で 0014 を適用** (Phase 50/51 同 pattern)

## ファイル変更見積

| ファイル | 種別 | 行数 |
|---|---|---|
| `src/lib/db/schema/transport_order_change_logs.ts` | A | ~50 |
| `src/lib/db/schema/index.ts` | M | +1 (export 追加) |
| `src/lib/db/raw-migrations/post/0014_create_transport_order_change_logs.sql` | A | ~50 |
| `phase-handoff/phase-53-change-logs-plan.md` | A | +110 (本ファイル) |
| `phase-handoff/phase-53-change-logs-sealed.md` | A (後) | ~150 |
| **合計** | 2 M + 4 A | ~360 行 (handoff 込み) |

## Codex 委任戦略

| 委任 | 内容 |
|---|---|
| T1 (adversarial review) | schema + migration の SQL / FK / CHECK / INDEX 構造を Codex に独立評価 (実装不要) |
| (実装) | Claude 自実装 (Phase 50/51 教訓継続) |

## 品質ガードレール

1. typecheck clean
2. `npm run test:all` 152 件 PASS (新規 table 誰も使わない、regression 0 想定)
3. SQL syntax 確認 (CREATE TABLE 構文 + CHECK + INDEX)
4. `db:apply-raw:post` 実行で apply 成功確認
5. drizzle schema の TS 型がエラーなし

## 完了条件 (DoD)

- [ ] Codex adversarial review GO 判定 (BLOCK 0)
- [ ] Claude 実装: schema + migration + index export
- [ ] `db:apply-raw:post` で 0014 適用成功
- [ ] typecheck clean
- [ ] `npm run test:all` 152 件 PASS
- [ ] commit 1 件
- [ ] seal handoff 作成

## invariants (drift surface)

- Phase 50/51 確立の transport status seed 3 箇所同期は継続課題
- 本 Phase 追加の `transport_order_change_logs` は **service 未統合**、Phase 54+ で実装責任あり
- spec §7.8 の 8 column 仕様と本 Phase 実装が完全一致 (将来 Phase で service が依存)
