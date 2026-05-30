# Phase 16-A0 Codex 委任 prompt (seed/helper drift 全面 reconcile)

> 委任先: Codex (`/codex:rescue --wait --effort high`)
> 目的: R-H-000 incident 6 件 drift を spec/data-model.md v2.4 と現行 DDL に合わせて全面 reconcile
> 前提: Phase 15 sealed @ commit 11333a9。Phase 14/15 と同じ pattern で 1 行ずつ照合必須

## あなたへの指示

`pit_system` repo の `src/lib/db/raw-migrations/alpha-1-public/` 配下の **seed/helper drift 6 件** を、spec/data-model.md v2.4 と現行 DDL に整合させる。**spec 1 行ずつ照合**しながら修正し、最終的に `pnpm test` 36/36 維持 + migration full apply 成功を達成すること。

## 必読 (作業開始前に Read)

1. `spec/data-model.md` §7.10 (line 833-942) — transport_order_invitations 確定列セット + accept_invitation_and_revoke_others spec 実装
2. `spec/data-model.md` §8.3 (line 1071-1086) — notification_rules
3. `spec/data-model.md` §9.1-9.2 (line 1113-1150) — statuses / status_transitions
4. `spec/data-model.md` §17 (line 1620-1732) — migration 順序と seed 責務
5. `spec/data-model.md` §18.1 (line 1738-1745) — 新規 company 作成時の自動シード方針
6. `src/lib/db/raw-migrations/alpha-1-public/06_lanes_work.sql` — lane_types 実 DDL
7. `src/lib/db/raw-migrations/alpha-1-public/13_notifications.sql` — notification_rules 実 DDL
8. `src/lib/db/raw-migrations/alpha-1-public/11_vendors.sql` (または vendor_company_memberships 定義箇所) — 現行列名 (`is_enabled` / `contract_started_at` / `contract_ended_at` か `starts_on/ends_on` か)
9. `phase-handoff/phase-15-alpha-3-reconciliation.md` — Phase 15 で vendor_company_memberships 列を reconcile したか確認
10. `phase-handoff/phase-16-vendor-loop-plan.md` — Phase 16 計画 v2 (Drift 6 件詳細)

## Claude 側で確定済みの spec 照合結果

### 21_seed_master.sql の方針 (Claude 判断確定)

| seed 対象 | 方針 | 根拠 |
|---|---|---|
| `lane_types` | **現行列名で 6 件 INSERT 維持** | DDL 要 audit。`company_id` NULL 許容を 06 で確認後 |
| `statuses` | **完全削除** | DDL `company_id NOT NULL` で構造的に不可能。§18.1 で per-tenant auto-seed と確定 |
| `status_transitions` | **完全削除** | 同上 |
| `notification_rules` | **完全削除** | 同上 |
| `roles` | **現状維持 (6 件 INSERT)** | DDL `company_id` NULLABLE 確認済み (03 line 3)、`code/name/is_system` カラム名一致 |

per-tenant seed の TS 側テンプレートは Phase 16-B 以降 (会社作成 service 関数実装時) に作る。今 Phase では作らない。

### lane_types DDL audit (Codex 担当)

- `06_lanes_work.sql` の `CREATE TABLE lane_types` を Read
- 列名 (`sort_order` or `display_order`)、`company_id` NULL 可否を確定
- 不一致なら seed の列名/value を合わせる

### 18_helper_functions.sql の修正方針 (Claude 判断確定 + Codex audit 必須)

**(1) `vendor_accessible_company_ids` (line 51-68)**:
- 現状: `vendor_company_memberships.starts_on/ends_on` 参照
- Phase 15 で vendor_company_memberships が `is_enabled` / `contract_started_at` / `contract_ended_at` に統一されたか **要 audit**
  - もし統一済みなら helper を新列名に書換 (`is_enabled = true AND (contract_started_at IS NULL OR contract_started_at <= CURRENT_DATE) AND (contract_ended_at IS NULL OR contract_ended_at >= CURRENT_DATE)`)
  - もし旧名のままなら冒頭コメント (line 1-4) と整合しているので **そのまま** で OK
- 修正後、冒頭の `-- spec §14.2 deviations` コメントは現実と一致するように更新

**(2) `vendor_invited_transport_order_ids` (line 70-82)**:
- 現状: `transport_order_invitations.deleted_at IS NULL` を WHERE に含む
- 12_transport.sql の transport_order_invitations に **deleted_at は存在しない** (確認済み)
- 修正: `AND deleted_at IS NULL` を削除

**(3) `accept_invitation_and_revoke_others` (line 149-237)**:
- 現状: `deleted_at IS NULL` / `bound_at = now()` / `updated_at = now()` 参照
- 12_transport.sql に **deleted_at / bound_at / updated_at は存在しない**
- 修正: spec §7.10.2 (line 881-933) の実装に合わせる
  - SELECT 句から `AND toi.deleted_at IS NULL` 削除
  - UPDATE 句から `bound_at = now()` と `updated_at = now()` 削除（spec 実装では追加していない）
  - revoke UPDATE からも `updated_at = now()` 削除と `AND deleted_at IS NULL` 削除
  - **`bound_vendor_id` も UPDATE で SET する** (spec line 914)。現状の helper は `bound_vendor_user_id` のみ SET しているが、spec では `bound_vendor_id = v_invite_vendor_id` も含む
  - 関数シグネチャ・引数は **現状の `(p_invitation_id uuid)` 単一引数を維持** (spec は `(p_invitation_id, p_acting_vendor_user_id)` 2 引数だが、Claude が `current_vendor_user_id()` 経由で actor 取得する設計を採用済み。spec ADR-0008 line 1794 で「service 関数は薄い wrapper」と確定しており、auth context 経由が現実的)
  - advisory lock + 認可ガードは **現状維持** (spec より厳しい防御で安全側)

### audit 補強 (Codex 担当、drift 追加検出)

`spec/data-model.md` §17 (line 1620-1732) に挙がっている他の seed/helper に未発見 drift がないか確認:
- `permissions` シードは現行に無いが OK か?
- `01_extensions.sql` で btree_gist が CREATE EXTENSION されているか?
- spec §17 順序 v2.3 (`18_helper → 19_rls → 20_triggers`) と現行ファイル命名が一致しているか?

drift 追加発見時は **Phase 16-A0 scope 内で修正**、scope 外 (β に繰越) なら risks.md 案を提示。

## 実装手順

1. 必読ファイルを Read (上記 1-10)
2. lane_types / vendor_company_memberships / notification_rules / permissions の現行 DDL を audit
3. 修正対象ファイル 2 件を Edit:
   - `src/lib/db/raw-migrations/alpha-1-public/21_seed_master.sql` (statuses/status_transitions/notification_rules INSERT 削除、lane_types/roles は DDL 整合確認後維持)
   - `src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql` (3 関数修正)
4. **必要なら** `src/lib/db/schema.ts` (Drizzle) の対応列を確認 (drift があれば再生成案を提示)
5. 検証:
   - `pnpm test` 実行 → 36/36 PASS 維持
   - migration full apply test (`pnpm db:reset` 相当 or 既存スクリプト) 成功
6. 修正サマリを 30 行以内で報告:
   - 各ファイルの diff 概要
   - audit で発見した追加 drift (あれば)
   - test/migration 結果
   - β 繰越提案 (あれば)

## 制約

- **spec を勝手に編集しない** (data-model.md は read-only)
- **DDL に列追加しない** (helper を spec に合わせる方針確定済み)
- **テストを書き換えない** (drift 修正で既存テストが落ちたら原因報告)
- **fixtures は触らない** (Phase 16-B 以降のスコープ)
- 1 ファイル単位の修正は完結させる (中途半端な編集状態にしない)

## DoD (Definition of Done)

- [ ] 21_seed_master.sql から statuses/status_transitions/notification_rules INSERT 削除
- [ ] 21_seed_master.sql の lane_types/roles は現行 DDL に整合
- [ ] 18_helper_functions.sql の 3 関数 (vendor_accessible_company_ids / vendor_invited_transport_order_ids / accept_invitation_and_revoke_others) を spec/DDL に整合
- [ ] `pnpm test` 36/36 PASS
- [ ] migration full apply (空 DB → full schema) 成功
- [ ] audit 補強で発見した追加 drift を報告 (修正 or β 繰越判断)
- [ ] 修正サマリを 30 行以内で返す
