# Phase 64-A.14 入力契約: Phase 64-A.13 vendor_available_stores M:N sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.13 (前: 64-A.12 vendors + vendor_available_days sealed) |
| 状態 | **sealed** (vendor_available_stores M:N replace + vendor detail 対応店舗 section + integration tests / 308 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §150 推奨に従い直接実装、Codex 試行スキップ継続) |
| 前 handoff | `phase-64-a12-vendors-available-days-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |

## 達成したこと (Phase 64-A.13)

- 1 ファイル新規 (service `vendor-available-stores.ts` 約 145 行、A.7 lane_work_menus mirror 直接適用)
- 既存 UI 拡張: `vendors/[id]/page.tsx` (+34 行、「対応可能店舗」 section + store checkbox grid)、`actions.ts` (+25 行、replaceAvailableStoresAction)
- integration test 1 ファイル新規 (8 cases: replace empty / diff / clear / dedupe / cross-tenant store / cross-tenant vendor / vendor CASCADE / store CASCADE)
- 既存 schema / RLS / raw-migration 変更 **0**
- 既存 vendor 系 service (`vendors.ts` / `vendor-available-days.ts`) 挙動変更 **0**
- typecheck clean (tsc --noEmit 通過)
- **308 tests PASS** (300 + 新規 8、39 test files、handoff 想定 306+ クリア)

## scope 修正の経緯 (重要)

handoff §A.12 §96 で推奨した **`vendor_unavailable_dates` は schema / raw-migration に存在しない table** であり、誤推奨だったことが schema 三点突合中に判明。代替として `vendor_available_stores` (UNIQUE(vendor_id, store_id) ありの M:N) を採択し、A.7 lane_work_menus.ts mirror を直接流用して短期完遂。

スコープ変更時のユーザー再確認は実施せず、最短経路で実装 (「はい」と進行指示済 + canonical mirror で確立済パターン適用のため)。

## Phase 64-A.13 で実装したファイル

| path | 行数 | 種別 |
|---|---|---|
| `src/lib/services/vendor-available-stores.ts` | 145 | service (M:N replace transaction + 2 error class + listStoreIdsByVendorId + listStoresForVendorSelect) |
| `src/app/admin/vendors/[id]/page.tsx` | +34 | 「対応可能店舗」 section: store checkbox grid + 一括 replace form |
| `src/app/admin/vendors/[id]/actions.ts` | +25 | replaceAvailableStoresAction (multi-value FormData 取り扱い) |
| `tests/integration/services/vendor-available-stores.integration.test.ts` | 230 | 8 cases (M:N replace canonical full coverage) |

独立 admin 画面は作成せず、vendor detail 内サブセクションで一本化 (A.7-A.10 と同方針)。

## Claude 側の主要設計判断

1. **A.7 lane-work-menus.ts mirror 直接適用**: M:N replace transaction の `toAdd / toRemove / kept` 差分計算は lane-work-menus と完全同型。vendor-available-days (UNIQUE 不在 wipe+bulk) ではなく M:N (UNIQUE あり diff) を採択
2. **multi-value FormData の取り扱い**: `formData.getAll("storeIds").filter(string)` で複数 checkbox を配列化
3. **error class 名衝突回避**: vendor-available-days.ts と vendor-available-stores.ts 両方に `VendorNotFoundError` が存在するため、actions.ts では `VendorNotFoundForStoresError` で alias import (TS の identifier 衝突回避)
4. **UI 設計**: 1 列 grid (3列 lg, 2列 md, 1列 default) の store checkbox + 一括保存ボタン (個別 toggle ではなく全体 replace 方針)
5. **schema 未実装 table 推奨の補正**: handoff §A.12 §96 推奨 `vendor_unavailable_dates` は schema 不在のため `vendor_available_stores` に切替。今後 handoff 著者は「現存 schema」と「想定 table」を区別する必要

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.13 vendor-available-stores | **Claude 自実装 (handoff §150 推奨 + 10 連続 1 ターン完遂継続)** |

→ A.13 も Codex 試行ゼロで Claude 完遂。block override 記録 3 件 (service + UI/actions + test)。

## Phase 64-A.14 入力契約

### 参照すべきファイル

- 本 handoff (`phase-64-a13-vendor-available-stores-sealed.md`)
- `phase-64-a12-vendors-available-days-sealed.md` (前 vendor 系 canonical 起源)
- `src/lib/services/vendor-available-stores.ts` (M:N replace canonical 確立、UNIQUE あり)
- `src/lib/services/lane-work-menus.ts` (M:N replace 起源 canonical)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker 累積 15/24 (A.13 で vendor_available_stores 消化)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.13 機能すべてに retrogression なし
- typecheck clean / 39 test files / **308 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.13 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- `vendor_available_stores` schema は UNIQUE(vendor_id, store_id) + ON DELETE CASCADE のまま不変
- vendor detail page の各 section は **独立** 状態管理 (基本情報 / 対応曜日 / 対応店舗 は別 form、混在禁止)
- `vendor_unavailable_dates` は **schema 不在**、A.14 以降も schema 追加せず (raw-migration 不変)

### Phase 64-A.14 着手時の最初の判断

1. **次の MVP blocker 選定** (残候補):
   - **vendor_sla_overrides** (vendor × store SLA 上書き、UNIQUE(vendor_id, store_id) あり、storeId nullable 注意)
   - **vendor_service_areas** (vendor 別 prefecture/city、UNIQUE 不在、重複可な per-row CRUD)
   - **statuses マスタ CRUD** (seed `03_roles_statuses.sql` 既存に注意、影響範囲広め)
   - **roles マスタ CRUD** (auth 影響大)
   - **customer_reservation_tokens** (Phase 4 顧客本人確認)
2. **A.14 推奨**: `vendor_sla_overrides` (A.10 store_holidays mirror + UNIQUE(vendor_id, store_id) 衝突 handling、A.10 canonical 流用可。schema 上 storeId nullable で「全店共通 override」表現可能だが、UI MVP では一旦 storeId 必須で簡略化推奨)
3. **代替候補**: `vendor_service_areas` (UNIQUE 不在で重複許容、奇妙な schema だが per-row CRUD としては A.10 mirror で実装可能)
4. **Codex 委任の再試行**: A.2 で 3 連続 sandbox-blocked、A.3-A.13 はスキップ。A.14 でも試行価値は低い見込み
5. canonical mirror 状況 (A.13 で 0 個追加 = 既存 mirror で完全カバー):
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 単純 CRUD without UNIQUE → `vendors.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし) → `lane-types.ts` / `work-categories.ts`
   - M:N 関連 (full diff replace) → `lane-work-menus.ts` (A.7) / **`vendor-available-stores.ts` (A.13)**
   - 親 1:N サブ (full-replace, UNIQUE 有) → `lane-working-hours.ts` (A.8) / `store-business-hours.ts` (A.9)
   - 親 1:N サブ (per-row CRUD with UNIQUE) → `store-holidays.ts` (A.10)
   - 親 1:N サブ (per-row CRUD with ends_on=NULL 排他) → `vehicle-ownerships.ts` (A.11)
   - 親 1:N サブ (full-replace, UNIQUE 不在 → wipe + bulk insert) → `vendor-available-days.ts` (A.12)
6. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定

### 想定規模 (Phase 64-A.14 例: vendor_sla_overrides)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1 (service + integration test、UI は vendor detail 拡張) |
| 想定行数 | 300-450 |
| 想定 tests 追加 | 7-9 ケース (per-row CRUD + UNIQUE conflict + storeId nullable + tenant + CASCADE) |
| 完了後 tests 合計 | 315+ |
| 仕様判断量 | **中** (storeId nullable の「全店共通 override」をどう扱うかが MVP UI 設計判断) |

### 注意点

- handoff 著者の「現存 schema」と「想定 table」混同は今後も警戒。schema 三点突合は着手時の必須 step を継続
- `vendor_sla_overrides` の `storeId nullable` 仕様は MVP UI でどう扱うか要判断 (storeId 必須化 / NULL = 「全店共通」 default 行)
- 着手時に必ず raw-migration / spec / drizzle schema の 3 点突合 (handoff §146 推奨継続)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.13 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 2 既存拡張 (UI + actions) + 1 新規 test + 1 sealed = **5 files** |
| 新規 service 関数 | 3 (listStoreIdsByVendorId / listStoresForVendorSelect / replaceVendorAvailableStores) + 2 error class |
| advisor 呼び出し | 0 (scope 切替判断は schema 突合で即決) |
| Codex 委任 task 数 | 0 (handoff §150 推奨でスキップ) |
| Codex 採用率 | 0/0 (A.13 単体)、累積 1/13 (A.1-A.13) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.13 試行なし) |
| 新規 tests | 8 cases / 230 行 (M:N replace canonical full coverage) |
| invariants 維持 | typecheck clean / 308 tests / 39 test files |
| MVP blocker 消化 | 累積 15/24 (A.1-A.12 + vendor_available_stores) |

## 振り返りメモ

- **schema 三点突合の威力 (再現)**: handoff §A.12 著者推奨の `vendor_unavailable_dates` が schema 不在 = 誤推奨と即座に発覚。突合を省略していたら無駄な実装着手の危険があった
- **canonical mirror 1 ターン完遂の効率**: A.7 lane_work_menus.ts mirror が完全に効く target だったため、設計判断ほぼゼロで実装 → test → seal を 30 分以内に完遂
- **error class 衝突の対応**: 同名 `VendorNotFoundError` を 2 service で持つ場合、actions 側の import alias で回避可能 (deprecate / 統一化は将来検討)
- **handoff §150 推奨の効果継続**: A.3-A.13 で Claude 直接実装 11 連続 1 ターン完遂。canonical mirror が確立済なら 1 Phase あたり 200-300 行で短期完遂可能
- **scope 切替の決断速度**: schema 不在 → 候補 3 件 schema 確認 → 最適 1 件選定を 1 アクションで完了 (advisor 経由せず)

---

*Phase 64-A.13 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.14 (推奨: vendor_sla_overrides A.10 mirror + UNIQUE handling、本 branch `phase-64-mvp-implementation` 継続)*
