# Phase 54 入力契約: Phase 53 transport_order_change_logs sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 53 (前: 52 sealed) |
| 状態 | **sealed** (typecheck clean / 17 test files / 152 tests PASS / db:apply-raw:post 0014 適用済) |
| 完了日時 | 2026-05-27 |
| 担当 | Claude (scope 訂正 + plan + SQL 自実装 + commit + seal) / Codex (2 委任: adversarial review NO-GO + schema TS apply) |
| 前 handoff | `phase-52-e2e-cleanup-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 52 `0528782` から +1, HEAD `9a45af3`) |

## 達成したこと (Phase 53)

- **MVP blocker 4 完全解消**: `transport_order_change_logs` を spec §7.8 完全準拠 schema に DROP + recreate
  - 旧 schema (payload jsonb + updated_at の 7 column、service 未利用) を破棄
  - 新 schema 10 column: id / company_id / transport_order_id / change_type (CHECK IN 5 値) / before_json / after_json / changed_by_user_id / requires_notification / notified_at / created_at
  - INDEX (transport_order_id, created_at) 追加
  - RLS tenant_isolation policy recreate
  - 旧 updated_at trigger は CASCADE で自動 drop + 明示 DROP 併記
- **scope 訂正**: Phase 47 sealed の MVP blocker 4 記述 (status_history.change_type column 追加) は誤り、真の対象は spec §7.8 の別テーブル `transport_order_change_logs` だった
- **service 統合は OUT**: Phase 54+ で cancelTransportOrder の history pattern を change_logs 経由に拡張予定
- **Codex adversarial review 実施**: 初回 NO-GO (BLOCK 2 件 = 既存 schema 衝突 + updated_at trigger 衝突) → ユーザー判断 B (DROP + recreate) で再採用 GO

## Claude 側の主要設計判断

1. **ユーザー判断 B 採用 (DROP + recreate)**: service 未利用 = data 蓄積なし前提、A (ALTER TABLE) より scope シンプル
2. **CASCADE で dependent objects 全削除 + 明示 DROP も併記**: 冪等性確保、RLS / trigger / index 一括 drop
3. **RLS は 0014 内で recreate**: 既存 19_rls_policies.sql の `tenant_isolation` pattern 踏襲、security 維持
4. **schema TS は Codex 委任 (完全コピー指示)**: Phase 51 同 pattern、TS は Codex で安全 (幻覚リスク低)
5. **SQL は Claude 自実装**: Phase 50/51 教訓継続、schema-specific は幻覚回避
6. **旧 12_transport.sql は触らない**: 過去 migration の改変は破壊的、新規 deploy も 12 → 0014 順で結果同じ
7. **adversarial review が機能**: 初回 NO-GO で既存 schema 衝突を検出、ユーザー判断 B で scope crisp に再確定

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260527-002534-57eb | adversarial review (NO-GO 初回、BLOCK 2 = 既存 schema 衝突 + updated_at trigger 衝突) | review 採用 → ユーザー判断 B → 修正後 implicit GO |
| del-20260527-003541-8aa7 | schema TS 完全コピー apply (53 行) | applied (修正不要、完全コピー指示で幻覚回避) |

**Codex 出力品質**: Phase 43→44→45→46→47→48→49→50→51→52→53 で 0→0→0→0→1→2→0→0→2→0→0→**0** 引き取り。
- review が NO-GO で BLOCK 2 件指摘 → 早期発見、ユーザー判断で scope crisp 化
- TS apply は完全コピー指示で 1 件 0 引き取り達成

**Codex sandbox 状況**: 安定継続。Phase 51 確立「SQL は Claude、TS は Codex」default pattern 維持。

## Phase 41-53 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-15 | Phase 31-A〜46 | 39-46 | (前 sealed.md 参照) |
| 16 | cancel action 不在 | 47 | §1.5 cancel action |
| 17 | Phase 47 持ち越し | 47 | Number.isNaN |
| 18 | Phase 46 持ち越し | 48 | §1.5 store name 表示 |
| 19 | Phase 44 持ち越し | 49 | §1.1 業務優先一覧 |
| 20 | Phase 16-E skip | 50 | backfill migration |
| 21 | Phase 50 持ち越し | 51 | companies INSERT trigger |
| 22 | Phase 51 横展開漏れ | 52 | seed-admin-e2e.ts cleanup |
| **23** | Phase 16 以降 spec §7.8 未整合 | **53** | transport_order_change_logs を spec §7.8 準拠に置換 (MVP blocker 4 解消) |

## 残課題 / Phase 54 todo

### MVP blocker

- **MVP blocker 1**: **解消済 ✓** (Phase 50 backfill + Phase 51 trigger)
- **MVP blocker 2**: 関連 reservation cancel 遷移 — reservation service 自体未実装
- **MVP blocker 3**: Worker 側 `transport_order.cancelled` event handler
- **MVP blocker 4**: **解消済 ✓** (Phase 53 schema 整合、service 統合は Phase 54+)

### Phase 54 推奨スコープ候補

1. **`transport_order_change_logs` への service 統合** (Phase 53 schema 完了、cancelTransportOrder で change_type='cancelled' 書き込み、before_json/after_json 記録、redaction policy)
2. **SQL 関数共通化** (`seed_transport_statuses_for_company(uuid)`、Phase 51 sealed 推奨 #3、drift 構造的解消)
3. 他 status_type (reservation/service/vendor) の trigger seed (Phase 51 pattern 横展開、各 status_type の test 整備が必要)
4. **MVP blocker 2 reservation cancel 遷移** (reservation service 自体未実装で大規模、wake-up 領域)
5. **MVP blocker 3 Worker event handler** (本番依存で wake-up 領域)
6. `createCompanyWithDefaults` service 関数 (admin sign-up UI とセット、wake-up 領域)

### 一般 todo (継続、Phase 47-52 sealed 参照)

## Phase 54 入力契約

### 参照すべきファイル

- 本 handoff (`phase-53-change-logs-sealed.md`)
- `phase-52-e2e-cleanup-sealed.md`
- `phase-53-change-logs-plan.md`
- `src/lib/db/schema/transport_order_change_logs.ts` (新 schema)
- `src/lib/db/raw-migrations/post/0014_recreate_transport_order_change_logs.sql` (Phase 53 migration)
- `src/lib/services/transport-orders.ts` cancelTransportOrder (Phase 47、change_logs 統合候補)
- `src/lib/db/schema/transport_order_status_history.ts` (Phase 47 history pattern 参考)
- spec/data-model.md §7.7-7.8 (status_history vs change_logs の責務分担)

### 絶対に壊してはいけないもの (invariants)

- 既修正 23 bug/機能すべてに retrogression なし
- typecheck clean / 17 test files / 152 tests PASS
- CI E2E 7/7 PASS
- 既存 invariants 全件 (Phase 43-52 確定)
- **`transport_order_change_logs` schema = spec §7.8 完全準拠** (Phase 53 確定): 10 column / CHECK / INDEX / RLS 維持、追加 only
- **CHECK constraint 値域** (Phase 53 確定): change_type IN ('vendor_changed','datetime_changed','cancelled','recreated','rejected_reassigned') 削除/変更禁止
- **RLS tenant_isolation policy** (Phase 53 確定): `company_id = public.current_user_company_id()` で全 access 制御
- **transport status seed 3 箇所同期** (Phase 51-52 継続課題)

### 注意点

- branch: `phase-42-t4-test-coverage` (Phase 53 commit `9a45af3`、Phase 52 `0528782` から +1)
- Phase 53 変更ファイル: 1 modify + 2 new = 3 files
- `db:apply-raw:post` で 0014 適用済、本番 deploy 時に同 SQL で recreate
- **本番 deploy 担当タスク**: 0014 適用前に本番 DB の `transport_order_change_logs` table にデータが存在しないことを確認 (service 未利用前提、念のため `SELECT count(*)` で 0 確認)
- 旧 12_transport.sql の旧 schema は触らない (新規 deploy も 12 → 0014 順で recreate される、結果一致)

## Codex ledger refs

- del-20260527-002534-57eb (adversarial review NO-GO→GO)
- del-20260527-003541-8aa7 (schema TS apply)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 53 commit 数 | 1 (`9a45af3`、本 sealed +2 予定) |
| 変更ファイル | 1 modify + 2 new = 3 files |
| 修正済 latent bug / 機能追加 | 1 (#23 change_logs 整合 — 累積 23) |
| advisor 呼び出し | 0 (Codex review NO-GO で十分、ユーザー判断 B 採用で進行) |
| Codex 委任 task 数 | 2 (review NO-GO + TS schema apply) |
| Codex sandbox-blocked | 0/2 |
| Claude 側修正 (Codex 出力) | 0 (review 採用、TS schema 完璧) |
| test files | 17 (変化なし、新規 schema 誰も使わない) |
| integration + unit test 件数 | 152 (変化なし) |
| 新規 migration | 1 (`0014_`) |
| 旧 schema 削除 | 1 (旧 transport_order_change_logs payload + updated_at) |
| MVP blocker 解消 | 1 (#4 完全解消、累計 #1 + #4) |

## 振り返りメモ

- **scope 訂正経験の蓄積**: Phase 50 (createCompany 経路欠落) + Phase 53 (Phase 47 sealed 記述誤り) で 2 度 scope 前提条件の精査が必要に。今後 Phase handoff 記述は **着手前に必ず spec で検証** する pattern を default 化
- **Codex adversarial review の継続的有効性**: Phase 47/51/53 で NO-GO 判定が早期発見に寄与。schema 系の独立評価は人間 + Codex の 2 重チェックが効果的
- **「SQL は Claude、TS は Codex」default の定着**: Phase 50-53 で連続成功、Codex の TS apply は完全コピー指示で 0 引き取り達成
- **旧 schema の発見**: 既存コードベースに spec と乖離した実装が散在している可能性。今後 spec 関連の scope は **着手前に grep + read** で実体確認するルール定着
- **MVP blocker 残 2 件 (#2 #3) はいずれも wake-up 領域**: Phase 54 で取り組むなら #2 reservation (大規模)、#3 worker (本番依存)。軽微 scope では SQL 関数共通化 (#3 候補) や service 統合 (Phase 53 続き) が安全

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-27 (Phase 53 完了、累積 23 機能追加 + change_logs schema 整合、MVP blocker 4 解消)*
