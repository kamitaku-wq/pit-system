# Phase 51 計画: companies INSERT trigger で status seed 自動化

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 51 (前: 50 sealed) |
| 状態 | planning |
| 立案日時 | 2026-05-27 |
| 前 handoff | `phase-50-status-seed-backfill-sealed.md` |
| Branch | `phase-42-t4-test-coverage` |
| 採用方針 | MVP blocker 1 完全解消 (新規 company の自動 seed)、spec §v2.1「DB trigger 最終防衛線」認可済 |

## Scope (advisor BLOCKER 指摘により拡張、scope crisp 維持)

### IN

1. **新規 trigger function + trigger 登録**: `src/lib/db/raw-migrations/post/0013_companies_insert_trigger_status_seed.sql`
   - function `public.seed_transport_statuses_on_company_insert()`: AFTER INSERT on companies、`NEW.id` に対して transport status 4 件 + status_transitions 5 件を INSERT
   - 値は `tests/_helpers/seed-transport-statuses.ts` および Phase 50 の `0012_` と完全一致 (3 箇所目 = drift surface、comment で警告)
   - 冪等: ON CONFLICT DO NOTHING (backfill 後の companies に対して trigger が空打ちで safe)
   - `SECURITY DEFINER` (db owner 権限、RLS bypass) + `SET search_path = public, pg_temp` (security 対策、既存 trigger pattern 踏襲)
   - 既存 `20_triggers.sql` の trigger は INVOKER-safe (set_updated_at / enforce_status_transition)、本 trigger は RLS bypass のため DEFINER 使用、SQL comment で理由明記
   - trigger 登録: `CREATE TRIGGER trg_seed_transport_statuses_on_company_insert AFTER INSERT ON public.companies FOR EACH ROW EXECUTE FUNCTION ...`

2. **test helper refactor**: `tests/_helpers/seed-transport-statuses.ts`
   - 現状: `.insert(statuses).values([...]).returning(...)` → trigger 追加後は UNIQUE 違反で test 152 件破壊
   - 修正: trigger 経由で既に seed されている前提で SELECT のみに変更
   - interface (`SeededTransportStatuses` / 戻り値 4 ID) は互換維持、14 test file への影響なし
   - status_transitions の追加 INSERT も削除 (trigger で seed 済)

3. **test 確認**: 14 test file (`companies INSERT → seedTransportStatuses` パターン) で 152 tests PASS 維持

4. **negative test fixture 修正** (Codex review BLOCK 4 採用、scope 拡張):
   - `tests/integration/services/transport-orders.integration.test.ts` 3 件:
     - line 257 `throws StatusSeedMissingError when statuses are absent`: 既存 fixture は `seedStatuses:false` で statuses なし状態を想定 → trigger 追加後は status 4 件自動 seed されるため、test 冒頭で `DELETE FROM status_transitions WHERE company_id = ?` → `DELETE FROM statuses WHERE company_id = ?` を追加 (cascade なし、transitions → statuses 順序必須)
     - line 500 `throws StatusTransitionError when accepted status transition is not seeded`: trigger seed (4件) と独自 INSERT (3件 requested/accepted/rejected) が UNIQUE 違反 → 同上 DELETE 追加後に独自 INSERT
     - line 554 `throws StatusSeedMissingError when accepted status is not seeded`: trigger seed (4件) と独自 INSERT (requested のみ) が UNIQUE 違反 → 同上 DELETE 追加後に独自 INSERT
   - WARN 5 (e2e helper cleanup): `seed-admin-e2e.ts` 等の e2e helper は本 Phase scope 外 (e2e は integration とは別 DB / 別 transaction、cleanup pattern を確認後に別 Phase で対応)

### OUT (scope crisp、後続 Phase に分離)

- `createCompanyWithDefaults` service 関数 (Phase 52、admin sign-up UI とセット判断、本 Phase は DB 層のみ)
- 他 status_type (`reservation` / `service` / `vendor`) の自動 seed (alpha-core 範囲外)
- notification_rules / reservation_settings の per-company seed (別 Phase)
- Phase 50 backfill SQL の修正 (3 箇所目 drift surface は comment 警告のみ、構造変更は別 Phase)

## 主要設計判断

1. **scope 拡張を plan 段階で明示**: Phase 47 NO-GO 教訓「軽微判定 vs 実態」を回避。advisor BLOCKER #1 を採用、scope = trigger + helper refactor + test sweep
2. **`SECURITY DEFINER` 採用、SQL comment で理由明記**: 既存 `20_triggers.sql` 慣習 (INVOKER) から逸脱、advisor 指摘 #2 採用
3. **test helper は SELECT-only に refactor**: advisor 案 (a) 採用。interface 互換維持で 14 test 影響なし
4. **3 箇所目 drift surface の意識喚起**: SQL comment + plan invariants 節で明示、構造的解消は将来検討 (advisor 指摘 #4 採用)
5. **Codex は adversarial review のみ、実装は Claude 自実装**: Phase 50 教訓 + advisor 指摘 #3 採用。schema-specific SQL の幻覚を構造的に回避
6. **冪等性**: trigger も ON CONFLICT DO NOTHING で、backfill 済 company に対する trigger 再実行も safe (companies UPDATE 等で偶発再 fire しても影響なし、AFTER INSERT トリガなので INSERT のみ fire)
7. **既存 trigger 経路と整合**: `raw-migrations/post/0013_` 連番 (Phase 50 の `0012_` の次)、drizzle migration 経路侵食なし

## ファイル変更見積

| ファイル | 種別 | 行数 |
|---|---|---|
| `src/lib/db/raw-migrations/post/0013_companies_insert_trigger_status_seed.sql` | A | ~60 (function + trigger + comment block) |
| `tests/_helpers/seed-transport-statuses.ts` | M | -50 +25 (INSERT 削除、SELECT 追加) |
| `phase-handoff/phase-51-companies-trigger-plan.md` | A | +120 (本ファイル) |
| `phase-handoff/phase-51-companies-trigger-sealed.md` | A (後) | ~180 |
| **合計** | 1 M + 3 A | ~430 行 (handoff 込み) |

## 品質ガードレール

1. typecheck clean
2. `npm run test:all` 152 件 PASS (helper refactor 後、trigger seed → SELECT pattern で同じ ID が取れる)
3. SQL syntax 確認 (function 構文 + trigger 登録)
4. SQL invariants 確認: 値が test helper (Phase 50 backfill SQL も含む) と完全一致
5. RLS bypass 動作確認: SECURITY DEFINER で statuses / status_transitions INSERT 可能
6. **実 DB への適用は本 Phase scope 外** (deploy 担当が `pnpm db:apply-raw:post` で `0013_` を適用、再実行は Phase 50 docs 参照)

## Codex 委任戦略

| 委任 | 内容 | 行数 |
|---|---|---|
| T1 (adversarial review) | SQL / test helper refactor / scope / security の独立評価 | - |
| (実装) | **Claude 自実装** (Phase 50 教訓 + advisor 指摘 #3) | - |

委任なしで Claude が trigger SQL + helper refactor を書く。

## 完了条件 (DoD)

- [ ] Codex adversarial review GO 判定 (BLOCK 0)
- [ ] Claude 実装: `0013_*.sql` + `seed-transport-statuses.ts` refactor
- [ ] typecheck clean
- [ ] `npm run test:all` 152 件 PASS
- [ ] SQL syntax 確認 (Postgres function 構文)
- [ ] commit 1 件
- [ ] seal handoff 作成

## invariants (drift surface 警告)

**Phase 50 から継続**: transport status seed 値は 3 箇所で同期必須:
- `tests/_helpers/seed-transport-statuses.ts` (Phase 51 で SELECT-only に refactor、INSERT 削除)
- `src/lib/db/raw-migrations/post/0012_seed_transport_statuses_per_company.sql` (backfill、既存)
- `src/lib/db/raw-migrations/post/0013_*.sql` (trigger 経由の seed、Phase 51 で追加)

値: `requested (display_order=10, is_initial=true)` / `accepted (20)` / `rejected (30, is_terminal=true)` / `cancelled (40, is_terminal=true)`、全件 `is_active=true`。
transitions: `requested→accepted` / `requested→rejected` / `accepted→cancelled` / `requested→cancelled` / `rejected→cancelled`、全件 `triggers_notification=true`。

drift 検出は Phase 50 の `docs/operations/seed-new-company.md` の post-check SQL で実施。

将来共通化案 (本 Phase OUT): SQL 関数 `seed_transport_statuses_for_company(company_id uuid)` を作って 0012 + trigger 両方から呼ぶ pattern。本 Phase は scope crisp 維持、3 箇所同期は SQL comment で警告のみ。
