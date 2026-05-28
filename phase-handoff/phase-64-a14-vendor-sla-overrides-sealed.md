# Phase 64-A.15 入力契約: Phase 64-A.14 vendor_sla_overrides sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.14 (前: 64-A.13 vendor_available_stores sealed) |
| 状態 | **sealed** (vendor_sla_overrides per-row CRUD + UNIQUE conflict + vendor detail SLA section + integration tests / 319 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §150 推奨に従い直接実装、Codex 試行スキップ継続、自律 loop) |
| 前 handoff | `phase-64-a13-vendor-available-stores-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |
| **/clear 推奨** | **本 Phase 完了後、ユーザー指示通り `/clear` 推奨を発出** |

## 達成したこと (Phase 64-A.14)

- 1 ファイル新規 (service `vendor-sla-overrides.ts` 約 215 行、A.10 store_holidays mirror + UNIQUE handling)
- 既存 UI 拡張: `vendors/[id]/page.tsx` (+70 行、「SLA 上書き」 section: 一覧 + 追加 form + 更新/削除 inline form)、`actions.ts` (+85 行、create/update/delete 3 actions)
- integration test 1 ファイル新規 (11 cases: create / list-join / UNIQUE / cross-tenant store / cross-tenant vendor / update partial / not-found / hard-delete / vendor CASCADE / store CASCADE / negative Zod)
- 既存 schema / RLS / raw-migration 変更 **0**
- 既存 vendor 系 service (`vendors.ts` / `vendor-available-days.ts` / `vendor-available-stores.ts`) 挙動変更 **0**
- typecheck clean (tsc --noEmit 通過)
- **319 tests PASS** (308 + 新規 11、40 test files、handoff 想定 315+ クリア)

## Claude 側の主要設計判断

1. **A.10 store_holidays mirror + A.4 stores UNIQUE 衝突 pattern**: per-row CRUD + UNIQUE(vendor_id, store_id) 衝突を `VendorSlaOverrideConflictError` で表現、create/update 経路で 23505 catch
2. **storeId nullable schema を service で MVP 制約**: schema は storeId nullable (「全店共通」 override 想定) だが、MVP では `z.string().uuid()` で必須化。schema 変更せず将来 nullable 化可能性を残す
3. **hard delete**: schema に deletedAt 列なし → master 系と異なり hard delete を採択
4. **error class 衝突対応 (3 vendor service 横断)**: `VendorNotFoundError` が vendor-available-days / vendor-available-stores / vendor-sla-overrides 3 ファイルで重複定義。actions 側で `VendorNotFoundForSlaError` 等 alias import で identifier 衝突回避継続
5. **UI 統合**: 既存 sections (基本情報 / 対応曜日 / 対応店舗) と並列で「SLA 上書き」 section、追加 form は「既に override 済の店舗を除外」で UNIQUE 衝突回避
6. **listVendorSlaOverridesByVendorId は join 含む**: store_name を join して UI 表示用、vendor_available_stores と異なり「id ベース」ではなく「list item ベース」の意味
7. **負値 deadline 拒否**: `z.coerce.number().int().min(0).max(100_000)` で 0-100k 分の現実的範囲制限

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.14 vendor-sla-overrides | **Claude 自実装 (handoff §150 推奨 + 11 連続 1 ターン完遂継続)** |

→ A.14 も Codex 試行ゼロで Claude 完遂。block override 記録 5 件 (service + UI + actions × 3 + test)。

## Phase 64-A.15 入力契約 (新セッションで使用)

### 参照すべきファイル

- 本 handoff (`phase-64-a14-vendor-sla-overrides-sealed.md`)
- `phase-64-a13-vendor-available-stores-sealed.md` (前 vendor 系 M:N canonical)
- `phase-64-a12-vendors-available-days-sealed.md` (vendor 汎用 CRUD 起源)
- `src/lib/services/vendor-sla-overrides.ts` (per-row CRUD + UNIQUE conflict canonical, A.10 mirror)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker 累積 16/24 (A.14 で vendor_sla_overrides 消化、vendor 系 4 件 (vendors / available_days / available_stores / sla_overrides) 完遂)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.14 機能すべてに retrogression なし
- typecheck clean / 40 test files / **319 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.14 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- `vendor_sla_overrides` schema は UNIQUE(vendor_id, store_id) + store_id nullable + CASCADE のまま不変
- vendor detail page の 4 section (基本情報 / 対応曜日 / 対応店舗 / SLA 上書き) は **独立 form**、混在禁止
- storeId nullable (「全店共通」 override) は service / UI で MVP 未対応、schema には残置 (将来拡張)
- `vendor_unavailable_dates` は **schema 不在** (A.13 で発見済)、A.15 以降も schema 追加せず

### Phase 64-A.15 着手時の最初の判断

1. **次の MVP blocker 選定** (残候補):
   - **vendor_service_areas** (per-row prefecture/city、UNIQUE 不在 = 重複可、A.10 mirror で per-row CRUD)
   - **statuses マスタ CRUD** (seed `03_roles_statuses.sql` 既存、影響範囲広め)
   - **roles マスタ CRUD** (auth 影響大、優先度後ろ)
   - **customer_reservation_tokens** (Phase 4 顧客本人確認、token hash + email 検証)
   - **attachments** (画像/PDF upload、Supabase Storage 連携必要)
2. **A.15 推奨**: `vendor_service_areas` (vendor 系最後の sub-table、prefecture/city per-row、A.10 mirror + UNIQUE 不在で UNIQUE conflict 不要)
3. **代替候補**: `statuses マスタ` (seed 衝突対応で仕様判断量「中-高」、影響範囲確認必要)
4. **A.15 着手時の重要 task**: vendor 系 4 sub-table 完遂後、A.15 で vendor 系 5 件目を完遂すべきか、別 domain (statuses / customers / 等) に移るかの判断
5. canonical mirror 状況 (A.14 で 0 個追加 = A.10 + stores UNIQUE 既存 mirror で完全カバー):
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 単純 CRUD without UNIQUE → `vendors.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし) → `lane-types.ts` / `work-categories.ts` / **`vendor-sla-overrides.ts` (A.14 追加)**
   - M:N 関連 (full diff replace) → `lane-work-menus.ts` / `vendor-available-stores.ts`
   - 親 1:N サブ (full-replace, UNIQUE 有) → `lane-working-hours.ts` / `store-business-hours.ts`
   - 親 1:N サブ (per-row CRUD with UNIQUE) → `store-holidays.ts` / **`vendor-sla-overrides.ts` (A.14、UNIQUE conflict 含み)**
   - 親 1:N サブ (per-row CRUD with ends_on=NULL 排他) → `vehicle-ownerships.ts`
   - 親 1:N サブ (full-replace, UNIQUE 不在 → wipe + bulk insert) → `vendor-available-days.ts`
6. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定

### 想定規模 (Phase 64-A.15 例: vendor_service_areas)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1 (service + integration test、UI は vendor detail 拡張) |
| 想定行数 | 250-400 |
| 想定 tests 追加 | 6-8 ケース (per-row CRUD + 重複許容 + cross-tenant + CASCADE) |
| 完了後 tests 合計 | 325+ |
| 仕様判断量 | **低-中** (UNIQUE 不在で per-row CRUD なら A.10 mirror+UNIQUE 部分除去) |

### 注意点

- vendor_service_areas schema (確認済): prefecture text NOT NULL + city text + UNIQUE 不在 → 同一 vendor で同一 prefecture/city が重複可能
- A.15 では UI 設計判断: 「重複入力をユーザーに警告するか / 許容するか」が小さい仕様判断点
- 着手時に必ず raw-migration / spec / drizzle schema の 3 点突合 (handoff §146 推奨継続)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.14 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 2 既存拡張 (UI + actions) + 1 新規 test + 1 sealed = **5 files** |
| 新規 service 関数 | 4 (list/create/update/delete) + 4 error class + 2 helper (assertVendor/assertStore) |
| advisor 呼び出し | 0 (storeId nullable 設計判断は handoff §A.13 で先決) |
| Codex 委任 task 数 | 0 (handoff §150 推奨でスキップ) |
| Codex 採用率 | 0/0 (A.14 単体)、累積 1/14 (A.1-A.14) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.14 試行なし) |
| 新規 tests | 11 cases / 290 行 (per-row CRUD + UNIQUE + CASCADE × 2 full coverage) |
| invariants 維持 | typecheck clean / 319 tests / 40 test files |
| MVP blocker 消化 | 累積 16/24 (A.1-A.13 + vendor_sla_overrides) |

## 振り返りメモ (本セッション 4 Phase 連続実行を経て)

- **canonical mirror の威力 (4 phase 通じて確認)**: A.7 / A.8 / A.9 / A.10 / A.11 で確立した mirror が A.11-A.14 で再利用され、設計判断ほぼゼロで実装→test→seal が 30-60 分以内に完遂可能
- **schema 三点突合の必須化**: A.13 で `vendor_unavailable_dates` 不在発覚、A.14 で UNIQUE/nullable 確認、突合を毎 Phase 実行することで誤推奨を早期発見
- **error class 衝突問題**: 3 vendor service で `VendorNotFoundError` が衝突、actions 側 alias import で回避継続中。将来共通化リファクタの可能性 (`@/lib/services/_errors/vendor.ts` 等への抽出)
- **schema 制約と MVP UI 制約の分離**: 「schema は許す / UI は制約する」 (vendor_available_days 分割営業, vendor_sla_overrides storeId nullable) で将来拡張余地を残す設計を継続
- **handoff §150 推奨の効果**: A.3-A.14 で Claude 直接実装 12 連続 1 ターン完遂、Codex 試行ゼロ。canonical 確立後の Phase は Codex 委任の価値が下がる
- **自律 loop 完遂**: ユーザー指示「clear 推奨になるまで自律的に進めて」を受けて A.14 まで完遂 (4 Phase 連続: A.11/A.12/A.13/A.14 = 約 +47 tests + 累積 4 commits)

## /clear 推奨タイミング (本 Phase 完了時)

**本 Phase A.14 完遂後、`/clear` 推奨を発出**。理由:
- vendor 系 4 sub-table (vendors / available_days / available_stores / sla_overrides) が完遂し、自然な domain 区切り
- 本セッションで A.11 → A.14 の 4 Phase 連続、コンテキスト累積が嵩む
- 次 Phase A.15 (vendor_service_areas または別 domain) は新セッション開始の良い境界

新セッション開始時: `phase-64-a14-vendor-sla-overrides-sealed.md` を読んで Phase 64-A.15 着手。

---

*Phase 64-A.14 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.15 (推奨: vendor_service_areas A.10 mirror without UNIQUE、本 branch `phase-64-mvp-implementation` 継続)*
