# Phase 51 入力契約: Phase 50 status seed backfill migration sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 50 (前: 49 sealed、blocked 経緯 → 選択肢 B 採用で再開) |
| 状態 | **sealed** (typecheck clean / 17 test files / 152 tests PASS) |
| 完了日時 | 2026-05-27 |
| 担当 | Claude (scope 確定 + plan + 統合検証 + Codex 引き取り + commit + seal) / Codex (1 委任: adversarial review GO 判定) |
| 前 handoff | `phase-49-priority-list-sealed.md` |
| Blocked 経緯 | `phase-50-status-seed-blocked-plan.md` (前提条件欠落で wake-up trigger 発火、ユーザー判断「選択肢 B」採用で再開) |
| Branch | `phase-42-t4-test-coverage` (Phase 49 `e1f4f03` から +2, HEAD `864a63e`) |

## 達成したこと (Phase 50)

- **MVP blocker 1 (status seed) 既存 companies 解消**: production backfill migration 1 本追加
  - `src/lib/db/raw-migrations/post/0012_seed_transport_statuses_per_company.sql` (32 行)
  - 全 companies に transport status 4 件 (`requested` / `accepted` / `rejected` / `cancelled`) + status_transitions 5 件を冪等 SQL で INSERT
  - 値は `tests/_helpers/seed-transport-statuses.ts` と完全一致 (test/production semantic invariant)
- **運用ドキュメント追加**: `docs/operations/seed-new-company.md` (76 行)
  - 初回 deploy 手順 (`pnpm db:apply-raw:post`)
  - 新規 company 追加時の手動 seed 手順 (psql / Supabase SQL Editor 経由)
  - apply-raw-sql.ts SKIP ロジック回避方法明記
  - post-check SQL 3 件 (件数検証 + 値 drift 検証)
  - Phase 51+ で自動化予定の旨を明記
- **Codex adversarial review 実施** (GO 判定、BLOCK 0 / WARN 4 全採用 / ALT 全不採用)
- **Codex T2 委任 2 件 reject**: 幻覚出力 (存在しない table / column / 完全異なる値、test helper invariant 違反) → Claude 引き取りで対応

## Claude 側の主要設計判断

1. **選択肢 B (seed migration) ユーザー確定**: A (sign-up UI) / C (orphan) / D (全体再定義) は不採用
2. **scope crisp**: Phase 50 は **既存 companies の backfill のみ**、trigger と service 関数は Phase 51-52 に切り出し
3. **`raw-migrations/post/` 配置 (`0012_`)**: 既存 pattern (`0002-0011`) 連番踏襲、drizzle migration 経路侵食なし
4. **`public.` prefix 統一**: 既存 `0010` / `0011` pattern 整合、運用事故耐性 (WARN 4)
5. **comment block で実行 role / 再実行手順 / drift 警告を明示**: WARN 1-3 全採用
6. **詳細 docs に集約**: SQL ファイル comment は最小化、運用詳細は `docs/operations/seed-new-company.md`
7. **post-check SQL は docs 側**: ON CONFLICT DO NOTHING の semantic drift 検証は別途 docs で SQL 3 件提供
8. **Codex 引き取り判断**: T2 委任 2 連続で幻覚出力 (transport_statuses table / companies.role column / pending/confirmed/dispatched 値) → advisor の品質ガードレール「1 回フィードバック改善なし or 要件大幅乖離は Claude 引き取り」適用、ledger 2 件 reject
9. **`from_status_id IS NULL` transition は seed しない**: test helper にもなく、production service の usage パターンと一致 (status_history への記録は service 側 `fromStatusId: null` で実装、transitions table は記録対象外)

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260526-212044-a4af | adversarial review (BLOCK 0 / WARN 4 / INFO 6 / ALT 3) | applied (GO 判定、WARN 4 全採用、ALT 全不採用) |
| del-20260526-212642-e132 | T2 1 回目 (migration + docs) | **rejected** (幻覚出力、存在しない table) |
| del-20260526-213454-1632 | T2 2 回目 (re-apply 依頼) | **rejected** (同じ幻覚内容) |

**Codex 出力品質**: Phase 43→44→45→46→47→48→49→50 で 0→0→0→0→1→2→0→0→**2** 引き取り。
- adversarial review は機能 (BLOCK 0 / WARN 4 適切指摘)
- 実装 (T2) は幻覚多発、Windows sandbox + apply_patch の経路で具体 schema 知識を持たない状態で幻覚生成。Phase 51+ の SQL migration 委任時は **schema 全 column 列挙 + UNIQUE 制約名明示** を委任プロンプト必須化

**Codex sandbox 状況**: 1 回目 T2 で apply_patch 完了報告も実体は無し (file create 失敗)、2 回目 SendMessage で apply_patch 再実行も同じ幻覚内容で create。Windows sandbox の apply_patch 経路が **存在しないファイル create 時に幻覚を吐く** 既知制約。Phase 41 既知制約「shell spawn 失敗」とは別の問題 (file 作成自体は機能、内容が幻覚)。

## Phase 41-50 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-15 | Phase 31-A〜46 | 39-46 | (前 sealed.md 参照) |
| 16 | Phase 16-B 以降 cancel action 不在 | 47 | §1.5 cancel action |
| 17 | Phase 47 持ち越し regression 防止 | 47 | `Number.isNaN` 利用 |
| 18 | Phase 46 持ち越し store ID 直表示 | 48 | §1.5 store name 表示 |
| 19 | Phase 44 持ち越し 業務優先一覧 | 49 | §1.1 業務優先一覧テーブル |
| **20** | Phase 16-E skip された production status seed | **50** | 既存 companies backfill migration + 運用 docs (MVP blocker 1 部分解消) |

## 残課題 / Phase 51 todo

### MVP blocker (本番動作前に必須整備、Phase 47 から継続)

- **MVP blocker 1 (部分解消)**: Phase 50 で既存 companies は backfill 済、**新規 company 追加時の自動 seed が未実装** (Phase 51 trigger or Phase 52 service 関数で完全解消)
- **MVP blocker 2**: 関連 reservation cancel 遷移 — reservation service 自体未実装
- **MVP blocker 3**: Worker 側 `transport_order.cancelled` event handler
- **MVP blocker 4**: `status_history.change_type` column 追加 migration

### Phase 51 推奨スコープ候補 (advisor 再判断対象)

1. **`companies` INSERT trigger** (MVP blocker 1 完全解消、scope 軽微、spec §v2.1「DB trigger 最終防衛線」認可済)
2. `createCompanyWithDefaults` service 関数 (Phase 52 候補、admin sign-up UI とセット判断)
3. その他 status_type seed (`reservation` / `service` / `vendor`)

### 一般 todo (Phase 47-49 から継続)

- §1.5 残 action: 業者変更 / 希望日時変更 / 次候補打診 / 手動切替 / 招待 revoke / token URL 再発行 (副作用ありで wake-up 待機)
- §1.5 招待管理ビュー単独 page
- §1.8 last_error PII redaction (cancel.reason も対象)
- §1.8 拡張: notification_deliveries / requeue_count / 担当者割当 / エスカレーション / Slack
- §1.8 表示文言整備
- §1.1 拡張: requested_pickup_at 系の遅延 / 期間フィルタ / グラフ表示 / cancelled status 除外判定
- §1.4 店間整備依頼 admin UI (大規模、service 先行)
- §1.2 ピット予約カレンダー (FullCalendar)
- 本番デプロイ前の Supabase URL Configuration 更新
- `probe-invite-link.ts` CI 組み込み
- vendor 側 E2E 拡張 (callback 込み)
- spec/data-model.md に admin_vendor_invitations 定義追加
- branch merge `phase-42-t4-test-coverage` → `phase-26-ci-verify`
- headquarters_admin role 分離検討
- `expectMetricNumber` 重複疑い
- `formatDateTime` 共通化 (3 箇所目登場時)
- `PriorityTable` 共通 component 化 (再利用時)

## Phase 51 入力契約

### 参照すべきファイル

- 本 handoff (`phase-50-status-seed-backfill-sealed.md`)
- `phase-50-status-seed-backfill-plan.md` (Phase 50 plan)
- `phase-50-status-seed-blocked-plan.md` (blocked 経緯履歴)
- `phase-49-priority-list-sealed.md` (前 Phase)
- `src/lib/db/raw-migrations/post/0012_seed_transport_statuses_per_company.sql` (Phase 50 migration)
- `docs/operations/seed-new-company.md` (Phase 50 運用 docs)
- `tests/_helpers/seed-transport-statuses.ts` (semantic source of truth)
- `src/lib/db/schema/statuses.ts` / `src/lib/db/schema/status_transitions.ts` / `src/lib/db/schema/companies.ts`
- `src/lib/db/raw-migrations/post/0003_triggers.sql` (既存 trigger 実装の pattern 参考)
- `src/lib/db/raw-migrations/alpha-1-public/20_triggers.sql` (既存 trigger pattern 参考)

### 絶対に壊してはいけないもの (invariants)

- 既修正 20 bug/機能すべてに retrogression なし
- typecheck clean / 17 test files / 152 tests PASS
- CI E2E 7/7 PASS (Phase 51 で CI 確認時に維持)
- 既存 invariants 全件 (Phase 43-49 確定)
- **Phase 50 status seed 値の semantic invariant**: `tests/_helpers/seed-transport-statuses.ts` と `0012_seed_transport_statuses_per_company.sql` の値が常に一致 (display_order 10/20/30/40, is_initial は requested のみ, is_terminal は rejected/cancelled, is_active true, triggers_notification true)
- **Phase 50 SQL の冪等性**: ON CONFLICT DO NOTHING で何度実行しても安全 (UNIQUE 制約に依存)
- **Phase 50 docs の手動 seed 手順**: `pnpm db:apply-raw:post` は SKIP される、`psql` または `Supabase SQL Editor` で SQL 本体を直接実行する手順

### 注意点・コンテキスト

- branch: `phase-42-t4-test-coverage` (Phase 50 commit `864a63e`、Phase 49 `e1f4f03` から +2 含む blocked plan commit)
- Phase 50 変更ファイル: 3 new = 3 files
  - `src/lib/db/raw-migrations/post/0012_seed_transport_statuses_per_company.sql` (new、32 行)
  - `docs/operations/seed-new-company.md` (new、76 行)
  - `phase-handoff/phase-50-status-seed-backfill-plan.md` (new、plan)
- Codex 委任 3 件 (review 1 / 実装 2)、review GO 判定、実装 2 件 reject → Claude 引き取り
- Phase 50 教訓: Codex に schema-specific SQL を書かせると幻覚多発 (具体 column / table 名を知らない)。Phase 51+ で SQL migration 委任時は schema dump を委任プロンプトに含める or Claude 自実装を default 化
- **deploy 担当タスク** (本 Phase で生成された artifact):
  - 本番環境で `pnpm db:apply-raw:post` 実行で `0012_` を適用
  - 既存 companies に対して 4 status + 5 transitions が seed されたことを post-check SQL で確認

## Codex ledger refs

- del-20260526-212044-a4af (adversarial review GO 判定)
- del-20260526-212642-e132 (T2 1 回目 rejected: 幻覚)
- del-20260526-213454-1632 (T2 2 回目 rejected: 幻覚)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 50 commit 数 | 2 (`e1f4f03` blocked plan + `864a63e` sealed の前段 commit) |
| 変更ファイル | 3 new = 3 files |
| 修正済 latent bug / 機能追加 | 1 (#20 status seed backfill — 累積 20、MVP blocker 1 部分解消) |
| advisor 呼び出し | 1 (wake-up trigger 判定、選択肢 B 採用後の再開判断) |
| Codex 委任 task 数 | 3 (review + 実装 2 回) |
| Codex sandbox-blocked | 0/3 (apply_patch は完了報告も内容が幻覚、別問題) |
| Codex exec stdin hang | 0 件 |
| Claude 側修正 (Codex 出力) | **2** (実装 2 回 reject、Claude 引き取り) |
| test files | 17 (変化なし、test 環境は影響なし) |
| integration + unit test 件数 | 152 (変化なし、production migration のみ) |
| 新規 service 関数 | 0 |
| 新規 server action | 0 |
| 新規 migration | 1 (`0012_`、production backfill 用) |
| 新規 docs | 1 (`docs/operations/seed-new-company.md`) |
| MVP blocker 解消 | 1 (#1 status seed、既存 companies に対して、新規追加は手動運用 → Phase 51 で完全自動化) |

## 振り返りメモ

- **wake-up trigger の発火 → ユーザー判断 → 再開の流れが機能**: Phase 50 着手前確認で「createCompany 経路なし」を発見、夜間自律進行を停止し起床まで待機。ユーザー判断「選択肢 B」で scope crisp 化、Phase 50 再開。Phase 47 の「軽微判定 vs 実態」教訓を構造的に防止した
- **Codex adversarial review は機能、実装は幻覚**: review で BLOCK 0 / WARN 4 全採用 → 品質向上に直結。一方で実装委任 (T2) は schema specifics を知らないため transport_statuses / companies.role 等の幻覚を生成。**Phase 51+ で SQL migration を委任する場合は schema dump を委任プロンプトに含める** か **Claude 自実装** を default
- **migration の WARN 4 全採用が効いた**: WARN 1 (再実行手順、SKIP logic 回避), WARN 2 (drift 警告), WARN 3 (実行 role 明記), WARN 4 (`public.` prefix) は全て docs + comment block に反映、運用事故耐性が大幅向上
- **scope crisp = Phase 分離が成功**: Phase 50 backfill / Phase 51 trigger / Phase 52 service 関数 と分離することで、本 Phase の影響範囲を「既存 companies に対する seed」だけに限定。MVP blocker 1 の完全解消は Phase 51 でも spec 認可済 trigger pattern で達成可能
- **Codex 幻覚への対策**: ledger reject 2 件は適切な対応。盲従せず Claude 引き取りで品質維持。advisor の品質ガードレール「1 回フィードバック改善なし or 要件大幅乖離は Claude 引き取り」が機能

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-27 (Phase 50 完了、累積 20 機能追加 + status seed backfill、MVP blocker 1 部分解消、Codex 引き取り 2 件 (実装委任 reject))*
