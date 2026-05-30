# Phase 64-A.13 入力契約: Phase 64-A.12 vendors CRUD + vendor_available_days sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.12 (前: 64-A.11 vehicle_ownerships sealed) |
| 状態 | **sealed** (vendors 汎用 CRUD + vendor_available_days full-replace + vendor detail/new pages + integration tests / 300 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §150 推奨に従い直接実装、Codex 試行スキップ継続) |
| 前 handoff | `phase-64-a11-vehicle-ownerships-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |

## 達成したこと (Phase 64-A.12)

- 2 ファイル新規 (service `vendors.ts` 約 200 行 + `vendor-available-days.ts` 約 170 行)
- 3 ファイル新規 (UI: `vendors/new/page.tsx` + `vendors/new/actions.ts` + `vendors/[id]/page.tsx` + `vendors/[id]/actions.ts`)
- 1 ファイル変更 (vendors list page に新規作成 link + 詳細 link 追加)
- 2 integration test 新規 (vendors 6 cases + vendor-available-days 11 cases = 17 ケース合計)
- 既存 schema / RLS / raw-migration 変更 **0**
- 既存 `admin-vendors.ts` (招待管理) 挙動変更 **0**
- typecheck clean (tsc --noEmit 通過)
- **300 tests PASS** (283 + 新規 17、38 test files、handoff 想定 288+ 大幅超過)

## 新たに確立したパターン (canonical 拡張)

### A.4 stores.ts mirror (vendors)

- `code` UNIQUE 不在 (vendors は code 持たず)、`StoreCodeConflictError` mirror 不要
- `notification_method` CHECK enum: `z.enum(["email", "portal", "both"])` で Zod-level 検証
- `isShared` / `priority` / `displayOrder` / `notes` / `version` 追加 column 対応
- それ以外は stores.ts と全 method 同一 (createVendor / updateVendor / deleteVendor / listVendors / getVendorById / listAllVendorsForSelect)

### A.7 lane-work-menus.ts mirror (vendor-available-days)

- M:N replace ではなく **per-vendor 1:N の wipe + bulk insert** で簡素化 (差分計算なし)
- UNIQUE(vendor_id, dayOfWeek) **なし** schema を尊重し、同一 day で複数 time range OK (分割営業対応)
- DB CHECK `(starts_at IS NULL OR ends_at IS NULL OR starts_at < ends_at)` を service 側でも事前検証 → `VendorAvailableDayConstraintError`
- `assertVendorInCompany(tx)` で親 vendor の tenant スコープ + soft delete (deletedAt) 確認

## Phase 64-A.12 で実装したファイル

| path | 行数 | 種別 |
|---|---|---|
| `src/lib/services/vendors.ts` | 200 | service (汎用 CRUD + list + select-list) |
| `src/lib/services/vendor-available-days.ts` | 170 | service (listByVendor / replaceByVendor + 2 error class + time normalize) |
| `src/app/admin/vendors/new/page.tsx` | 100 | 新規作成 form (notification_method enum + isShared toggle) |
| `src/app/admin/vendors/new/actions.ts` | 55 | createVendorAction |
| `src/app/admin/vendors/[id]/page.tsx` | 220 | 詳細 + 編集 + 7曜日 grid + 削除 |
| `src/app/admin/vendors/[id]/actions.ts` | 105 | updateVendorAction / deleteVendorAction / replaceAvailableDaysAction |
| `src/app/admin/vendors/page.tsx` | +10 | 新規作成 link + 業者名 cell に詳細 link |
| `tests/integration/services/vendors.integration.test.ts` | 160 | 6 cases (create / list / update / enum validation / soft-delete / q-search) |
| `tests/integration/services/vendor-available-days.integration.test.ts` | 250 | 11 cases (full-replace + 分割営業 + CHECK + CASCADE + 終日 null + cross-tenant + DB CHECK) |

## Claude 側の主要設計判断

1. **scope 拡張 1 Phase 完結 (ユーザー判断)**: handoff §A.11 想定 (300-450 行) を超え vendor detail page + new page + 汎用 CRUD まで A.12 で完遂。canonical 確立 (A.4 + A.7 mirror) を 1 commit に集約
2. **A.7 mirror の選択 (advisor 否定的判断)**: handoff §A.11 著者は「A.8 lane_working_hours mirror」と推奨したが、schema UNIQUE 不在 + 分割営業対応のため A.7 lane_work_menus に近い wipe + bulk insert を採択
3. **既存 `admin-vendors.ts` (招待管理) は touched せず**: vendors.ts と責務分離 (汎用 CRUD vs 招待 join read)。list page 側で両 service を共存
4. **`notification_method` Zod enum**: DB CHECK に重複するが、service-side 早期失敗で UX 向上 + 型推論可能
5. **MVP UI 制約**: 1 曜日 = 1 time range のみ編集 (page.tsx の form)。schema は分割営業を許すが UI は「将来拡張」と明示。test は分割営業 OK ケースを覆って canonical 保持
6. **time 正規化 (`HH:MM` → `HH:MM:00`)**: PG time デフォルト書式に統一、`<input type="time">` の `HH:MM` 入力を service で吸収
7. **`vendor-available-days` の独立 service**: vendors.ts に統合せず、責務分離 (汎用 CRUD vs 1:N sub-table replace)

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.12 vendors + vendor-available-days + UI | **Claude 自実装 (handoff §150 推奨 + 9 連続 1 ターン完遂継続)** |

→ A.12 も Codex 試行ゼロで Claude 完遂。block override 記録 9 件 (service × 2 + UI × 4 + actions × 2 + test × 2)。最大 1 Phase 行数 (合計約 1300 行) を 1 ターンで完遂。

## Phase 64-A.13 入力契約

### 参照すべきファイル

- 本 handoff (`phase-64-a12-vendors-available-days-sealed.md`)
- `phase-64-a11-vehicle-ownerships-sealed.md` (前 per-row 排他 invariant)
- `src/lib/services/vendors.ts` (汎用 CRUD canonical = A.4 stores mirror)
- `src/lib/services/vendor-available-days.ts` (1:N wipe + bulk insert canonical = A.7 lane_work_menus mirror、UNIQUE 不在用)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker 累積 14/24 (A.12 で vendor 系 + available_days で 2 つ消化、累積 14)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.12 機能すべてに retrogression なし
- typecheck clean / 38 test files / **300 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.12 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- `admin-vendors.ts` (招待管理) の挙動は **不変**
- vendor `notification_method` CHECK enum は `email / portal / both` のみ、A.13 以降も raw-migration 変更禁止
- `vendor_available_days` schema は UNIQUE 不在 + CHECK (`starts_at < ends_at`) のまま不変
- vendor detail page の対応曜日 UI は MVP で 1 day = 1 range 制約、schema は分割営業を許可 (将来 UI 拡張可能)

### Phase 64-A.13 着手時の最初の判断

1. **次の MVP blocker 選定**: Phase 63 step2 §C 残候補:
   - **vendor_unavailable_dates** (vendor 詳細 sub、A.10 store_holidays mirror で per-row CRUD with UNIQUE 想定、vendor detail 拡張)
   - **vendor_service_areas** (vendor 詳細 sub、配送可能エリア、postal_code prefix 想定?)
   - **vendor_available_stores** (vendor × store M:N、A.7 mirror)
   - **vendor_sla_overrides** (vendor × spec sub、deadline 上書き)
   - **statuses マスタ CRUD** (seed 衝突注意、影響範囲広め)
   - **customer_reservation_tokens** (Phase 4 顧客本人確認、token hash + email 検証)
2. **A.13 推奨**: `vendor_unavailable_dates` (A.10 mirror、UNIQUE(vendor_id, unavailable_date) 想定、短期完遂可、A.12 で確立した vendor detail page をそのまま拡張)
3. **代替候補**: `vendor_available_stores` (vendor × store M:N、A.7 lane_work_menus mirror そのまま流用可)
4. **Codex 委任の再試行**: A.2 で 3 連続 sandbox-blocked、A.3-A.12 はスキップ。A.13 でも再試行価値は低い見込み
5. canonical mirror 状況 (A.12 で 0 個追加 = 既存 mirror で完全カバー):
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 単純 CRUD without UNIQUE → `vendors.ts` (A.12 追加)
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし) → `lane-types.ts` / `work-categories.ts`
   - M:N 関連 → `lane-work-menus.ts` (A.7 replace transaction)
   - 親 1:N サブ (full-replace, UNIQUE 有, per-row → 1 行) → `lane-working-hours.ts` (A.8) / `store-business-hours.ts` (A.9)
   - 親 1:N サブ (per-row CRUD with UNIQUE) → `store-holidays.ts` (A.10)
   - 親 1:N サブ (per-row CRUD with ends_on=NULL 排他) → `vehicle-ownerships.ts` (A.11)
   - **親 1:N サブ (full-replace, UNIQUE 不在 → wipe + bulk insert) → `vendor-available-days.ts` (A.12 追加)**
6. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定

### 想定規模 (Phase 64-A.13 例: vendor_unavailable_dates)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1 (service + integration test、UI は vendor detail 拡張) |
| 想定行数 | 250-400 |
| 想定 tests 追加 | 6-10 ケース (per-row CRUD + UNIQUE + tenant + CASCADE + soft delete) |
| 完了後 tests 合計 | 306+ |
| 仕様判断量 | **低-中** (A.10 store_holidays mirror で実装パターン既知) |

### 注意点

- vendor_unavailable_dates schema 三点突合必須: UNIQUE / deletedAt / reason column 等 (A.10 mirror が完全に効くか確認)
- A.12 で確立した vendor detail page (`[id]/page.tsx`) に「対応不可日」セクションを追加する形式が自然
- 着手時に必ず raw-migration / spec / drizzle schema の 3 点突合 (handoff §146 推奨継続)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.12 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 2 新規 service + 4 新規 UI + 1 list 修正 + 2 新規 test + 1 sealed = **10 files** |
| 新規 service 関数 | vendors: 6 (create/update/delete/list/getById/listAllForSelect) + vendor-available-days: 2 (list/replace) + 2 error class + 1 helper |
| advisor 呼び出し | 0 (A.11 で activated 経験あり、A.12 は scope 確認をユーザー直接で済ませた) |
| Codex 委任 task 数 | 0 (handoff §150 推奨でスキップ) |
| Codex 採用率 | 0/0 (A.12 単体)、累積 1/12 (A.1-A.12) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.12 試行なし) |
| 新規 tests | 17 cases (vendors 6 + vendor-available-days 11) / 410 行合計 |
| invariants 維持 | typecheck clean / 300 tests / 38 test files |
| MVP blocker 消化 | 累積 14/24 (A.11 までの 13 + vendors CRUD + vendor_available_days で +1、available_days は vendor 系の sub-table のため 1 件カウント) |

## 振り返りメモ

- **scope 拡張判断の効率**: 「vendor detail page 不在」を schema 突合中に発見し、ユーザーに 3 案提示 → A 採択で 1 Phase 完結。spec 不在領域 (handoff 著者の見落とし) は早期に分岐確認するのが効率的
- **A.7 vs A.8 mirror の選択**: handoff の "A.8 mirror" 推奨を盲信せず、schema UNIQUE 不在 + 分割営業対応の business semantic を確認して A.7 mirror に切替。これで分割営業 (午前/午後分け) の運用要件に応えた
- **UI 制約と schema 余裕の分離**: schema は分割営業 OK、UI は MVP で 1 day = 1 range のみ。test は分割営業 OK ケースを覆って canonical 保持 = 将来 UI 拡張時に schema 変更不要
- **handoff §150 推奨の効果継続**: A.3-A.12 で Claude 直接実装 10 連続 1 ターン完遂。1 Phase あたり 1300 行 + 17 test の最大規模もこなせる
- **block override 9 件**: 例外条件 (user-explicit「進めて」+ scope 確認後の Claude 自実装合意) で許容、すべて 30 行以上のため hook 注意喚起発火

---

*Phase 64-A.12 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.13 (推奨: vendor_unavailable_dates A.10 mirror、本 branch `phase-64-mvp-implementation` 継続)*
