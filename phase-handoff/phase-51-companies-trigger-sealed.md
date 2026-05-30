# Phase 52 入力契約: Phase 51 companies INSERT trigger sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 51 (前: 50 sealed) |
| 状態 | **sealed** (typecheck clean / 17 test files / 152 tests PASS / `db:apply-raw:post` 適用済) |
| 完了日時 | 2026-05-27 |
| 担当 | Claude (scope 確定 + plan + trigger SQL 自実装 + cleanup test 修正 + commit + seal) / Codex (2 委任: adversarial review NO-GO→GO + test helper refactor) |
| 前 handoff | `phase-50-status-seed-backfill-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 50 `ef8b93f` から +1, HEAD `0929ab6`) |

## 達成したこと (Phase 51)

- **MVP blocker 1 完全解消**: 新規 company 追加時の自動 seed が trigger 経由で動作
  - `src/lib/db/raw-migrations/post/0013_companies_insert_trigger_status_seed.sql` (61 行) 追加
  - function `public.seed_transport_statuses_on_company_insert()` (SECURITY DEFINER, `search_path` 固定)
  - trigger `trg_seed_transport_statuses_on_company_insert AFTER INSERT ON public.companies FOR EACH ROW`
  - INSERT statuses 4 件 + status_transitions 5 件、ON CONFLICT DO NOTHING で冪等
- **test helper refactor**: `tests/_helpers/seed-transport-statuses.ts` を INSERT → SELECT-only に (107 行 → 56 行、interface 互換)
- **negative test fixture 修正 (3 件)**: `transport-orders.integration.test.ts` の `seedStatuses:false` パターンに trigger seed の DELETE 追加
- **cleanup pattern 修正 (3 file)**: companies DELETE 前に `status_transitions` → `statuses` DELETE 追加 (FK cascade なし、Codex review WARN 5 採用)
- **Codex adversarial review 実施**: 初回 NO-GO (BLOCK 4 = negative test fixture 衝突指摘)、scope 拡大 (trigger + helper + 3 negative test + 3 cleanup) で再判断 GO
- **`db:apply-raw:post` 適用確認**: 0012 + 0013 both applied、test DB で trigger 動作確認済

## Claude 側の主要設計判断

1. **Codex review BLOCK 4 採用、scope 拡大を plan に明示**: Phase 47 NO-GO 教訓「軽微判定 vs 実態」を回避、scope = trigger + helper + 3 negative test fixture + 3 cleanup
2. **SECURITY DEFINER 採用、SQL comment で理由明記**: 既存 `20_triggers.sql` INVOKER 慣習から逸脱、advisor 指摘 #2 / Codex review WARN 1 採用
3. **test helper は SELECT-only**: advisor 案 (a) 採用、interface 互換維持で 14 test file 影響なし
4. **trigger SQL は Claude 自実装**: Phase 50 教訓 + advisor 指摘 #3、Codex の schema-specific 幻覚を構造的回避
5. **test helper refactor は Codex 委任 (TS なので幻覚リスク低)**: 強制委任パスの hook 通過、apply 一発成功
6. **3 箇所目 drift surface の意識喚起**: SQL comment + plan invariants 節で明示、構造的解消は Phase 52+ で SQL 関数共通化案検討
7. **DROP TRIGGER/FUNCTION IF EXISTS 冒頭**: Codex review WARN 2 採用、既存 `20_triggers.sql` の drop-first pattern 整合
8. **e2e test helper 対応は本 Phase OUT**: Codex review WARN 5 は integration test の 3 cleanup までで実態確認済、e2e は別 transaction で別 Phase

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260526-215624-0d71 | adversarial review (NO-GO 初回、BLOCK 4 件指摘) | review 採用 → scope 拡大 → 修正後 GO |
| del-20260526-220442-8100 | T2 test helper refactor (TS、SELECT-only) | applied (修正不要、Codex は TS なら安全) |

**Codex 出力品質**: Phase 43→44→45→46→47→48→49→50→51 で 0→0→0→0→1→2→0→0→2→**0** 引き取り。
- adversarial review が NO-GO BLOCK 4 を検出 → scope 拡大で品質向上に直結
- 実装委任は test helper のみ (TS = 幻覚なし)、SQL は Claude 自実装で Phase 50 教訓継続適用

**Codex sandbox 状況**: TS の test helper apply_patch は安定、SQL の幻覚は Claude 自実装で回避。Phase 51 で確立した「SQL は Claude、TS は Codex」が新規 default pattern。

## Phase 41-51 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-15 | Phase 31-A〜46 | 39-46 | (前 sealed.md 参照) |
| 16 | Phase 16-B 以降 cancel action 不在 | 47 | §1.5 cancel action |
| 17 | Phase 47 持ち越し regression 防止 | 47 | `Number.isNaN` 利用 |
| 18 | Phase 46 持ち越し store ID 直表示 | 48 | §1.5 store name 表示 |
| 19 | Phase 44 持ち越し 業務優先一覧 | 49 | §1.1 業務優先一覧テーブル |
| 20 | Phase 16-E skip された production status seed | 50 | 既存 companies backfill migration |
| **21** | Phase 50 持ち越し新規 company 自動 seed | **51** | companies INSERT trigger (MVP blocker 1 完全解消) |

## 残課題 / Phase 52 todo

### MVP blocker (Phase 47 から継続)

- **MVP blocker 1**: **解消済 ✓** (Phase 50 backfill + Phase 51 trigger)
- **MVP blocker 2**: 関連 reservation cancel 遷移 — reservation service 自体未実装
- **MVP blocker 3**: Worker 側 `transport_order.cancelled` event handler
- **MVP blocker 4**: `status_history.change_type` column 追加 migration

### Phase 52 推奨スコープ候補

1. **`createCompanyWithDefaults` service 関数** (admin sign-up UI / onboarding flow との統合候補、ただし sign-up UI は本番依存で wake-up 領域)
2. その他 status_type (`reservation` / `service` / `vendor`) の trigger seed (Phase 51 pattern 横展開)
3. SQL 関数共通化 `seed_transport_statuses_for_company(uuid)` (drift 構造的解消、3 箇所同期)
4. e2e helper cleanup 修正 (`seed-admin-e2e.ts` 等、Phase 51 と同じ FK 違反パターン)
5. MVP blocker 4 `status_history.change_type` column 追加 migration (schema 変更、scope 軽微)

### 一般 todo (Phase 47-50 から継続)

- §1.5 残 action: 業者変更 / 希望日時変更 / 次候補打診 / 手動切替 / 招待 revoke / token URL 再発行
- §1.5 招待管理ビュー単独 page
- §1.8 last_error PII redaction (cancel.reason も対象)
- §1.8 拡張: notification_deliveries / requeue_count / 担当者割当 / エスカレーション / Slack
- §1.1 拡張: requested_pickup_at 系の遅延 / 期間フィルタ / グラフ表示 / cancelled status 除外判定
- §1.2 / §1.4 / その他 (前 sealed 参照)

## Phase 52 入力契約

### 参照すべきファイル

- 本 handoff (`phase-51-companies-trigger-sealed.md`)
- `phase-50-status-seed-backfill-sealed.md` / `phase-51-companies-trigger-plan.md`
- `src/lib/db/raw-migrations/post/0012_seed_transport_statuses_per_company.sql` (Phase 50 backfill)
- `src/lib/db/raw-migrations/post/0013_companies_insert_trigger_status_seed.sql` (Phase 51 trigger)
- `tests/_helpers/seed-transport-statuses.ts` (SELECT-only)
- `docs/operations/seed-new-company.md` (Phase 50 docs)
- 既存 trigger pattern: `src/lib/db/raw-migrations/alpha-1-public/20_triggers.sql`

### 絶対に壊してはいけないもの (invariants)

- 既修正 21 bug/機能すべてに retrogression なし
- typecheck clean / 17 test files / 152 tests PASS
- CI E2E 7/7 PASS (Phase 52 で確認時に維持)
- 既存 invariants 全件 (Phase 43-50 確定)
- **transport status seed 値の 3 箇所同期** (drift surface): `tests/_helpers/seed-transport-statuses.ts` (SELECT) / `0012_*.sql` (backfill) / `0013_*.sql` (trigger)。Phase 52+ で SQL 関数共通化検討
- **Phase 51 trigger semantic**: `trg_seed_transport_statuses_on_company_insert AFTER INSERT ON public.companies FOR EACH ROW`、SECURITY DEFINER、search_path = `public, pg_temp`、削除/変更禁止
- **test cleanup pattern**: companies DELETE 前に `status_transitions` → `statuses` DELETE (FK cascade なし、Phase 51 で 3 file 確立)
- **test helper interface 互換**: `SeededTransportStatuses` / 戻り値 4 ID

### 注意点・コンテキスト

- branch: `phase-42-t4-test-coverage` (Phase 51 commit `0929ab6`、Phase 50 `ef8b93f` から +1)
- Phase 51 変更ファイル: 2 new + 5 modify = 7 files
- Codex 委任 2 件 (review + test helper)、SQL は Claude 自実装で Phase 50 教訓継続
- **deploy 担当タスク**: 本番環境で `pnpm db:apply-raw:post` 実行で 0013 を適用、新規 company INSERT 時の自動 seed を Phase 50 の post-check SQL で検証

## Codex ledger refs

- del-20260526-215624-0d71 (adversarial review NO-GO→GO)
- del-20260526-220442-8100 (T2 test helper refactor applied)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 51 commit 数 | 1 (`0929ab6`、本 sealed 含めて +2 予定) |
| 変更ファイル | 2 new + 5 modify = 7 files |
| 修正済 latent bug / 機能追加 | 1 (#21 companies INSERT trigger — 累積 21) |
| advisor 呼び出し | 1 (BLOCKER #1 = test helper UNIQUE 違反、scope 拡大判断) |
| Codex 委任 task 数 | 2 (review NO-GO→GO + TS helper refactor) |
| Codex sandbox-blocked | 0/2 |
| Claude 側修正 (Codex 出力) | **0** (review は採用、TS helper は完璧) |
| test files | 17 (変化なし) |
| integration + unit test 件数 | 152 (変化なし、新規 test は不要、既存 test の fixture/cleanup 修正のみ) |
| 新規 trigger | 1 (`trg_seed_transport_statuses_on_company_insert`) |
| 新規 function | 1 (`seed_transport_statuses_on_company_insert`) |
| 新規 migration | 1 (`0013_`) |
| MVP blocker 解消 | 1 (#1 完全解消、累計 #1 のみ、残り #2/#3/#4) |

## 振り返りメモ

- **adversarial review が機能**: NO-GO 判定で BLOCK 4 (negative test fixture 衝突) を検出 → 早期発見で実装後の手戻りを回避。Phase 47 教訓「軽微判定 vs 実態」を構造的に防止
- **「SQL は Claude、TS は Codex」pattern 確立**: Phase 50 で SQL 委任 2 件 reject (幻覚)、Phase 51 で SQL Claude 自実装 + TS Codex 委任が成功。schema-specific 知識を要する SQL は Claude 自実装が default
- **SECURITY DEFINER 採用判断**: 既存 INVOKER 慣習から意図的逸脱、SQL comment + plan で理由明記。Phase 52 admin sign-up UI で auth role が companies INSERT する将来要件に備えた
- **FK cascade なし設計の運用負荷**: Phase 51 で 3 cleanup 修正が必要に。statuses.deleted_at がないため hard delete のみ、cascade 設定検討は別 Phase (schema 変更で慎重に)
- **3 箇所目 drift surface の継続課題**: Phase 49 sealed で「formatDateTime 3 箇所目で共通化」と書いたが Phase 51 で SQL 3 箇所同期の課題が発生。SQL 関数共通化 (`seed_transport_statuses_for_company(uuid)`) を Phase 52+ で検討
- **MVP blocker 1 完全解消**: Phase 50 backfill + Phase 51 trigger で「既存 + 新規両対応」達成。残 MVP blocker 3 件 (#2 reservation cancel / #3 worker handler / #4 change_type) はそれぞれ scope と本番依存度が異なる、Phase 52+ で個別検討

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-27 (Phase 51 完了、累積 21 機能追加 + companies INSERT trigger、MVP blocker 1 完全解消)*
