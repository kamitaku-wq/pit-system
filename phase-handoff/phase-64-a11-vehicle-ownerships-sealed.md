# Phase 64-A.12 入力契約: Phase 64-A.11 vehicle_ownerships per-row CRUD sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.11 (前: 64-A.10 store_holidays sealed) |
| 状態 | **sealed** (vehicle-ownerships per-row CRUD + UI inline edit/delete + integration tests / 283 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §150 推奨に従い直接実装、Codex 試行スキップ継続) |
| 前 handoff | `phase-64-a10-store-holidays-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |

## 達成したこと (Phase 64-A.11)

- 1 ファイル新規 (service `vehicle-ownerships.ts` / 約 135 行)
- 既存 UI 拡張: `src/app/admin/vehicles/[id]/page.tsx` (+33 行、各 ownership 行に inline 編集 form + 削除ボタン)、`actions.ts` (+50 行、updateOwnershipAction + deleteOwnershipAction)
- integration test 1 ファイル新規 (11 ケース、per-row update + ends_on=NULL 排他 + DB CHECK constraint + soft delete + CASCADE + tenant + strict schema)
- 既存 schema / RLS / raw-migration 変更 **0**
- 既存 `vehicles.ts` の `transferOwnership` / `listOwnershipsByVehicle` 挙動変更 **0** (純粋追加のみ)
- typecheck clean (tsc --noEmit 通過)
- **283 tests PASS** (272 + 新規 11、36 test files、目標 279+ 超過)

## 採用したモデル (advisor 助言反映、ユーザー判断)

- **scope A 採用**: 「ends_on=NULL ベース 1人現所有モデル」を維持し、個別 ownership の update / soft delete を追加
- **却下した scope B**: schema 本来意図 (N人同時所有 + isPrimary 排他 = co-ownership) は spec 確認必須かつ既存 transferOwnership 意味変更を伴うため Phase 64-A.11 では棄却
- 理由: MVP 進行優先、既存 UI 譲渡フロー意味維持、advisor の指摘 (handoff §97 推奨は schema 未確定領域への踏込で仕様判断量「高」)

## Phase 64-A.11 で実装したファイル

| path | 行数 | 種別 |
|---|---|---|
| `src/lib/services/vehicle-ownerships.ts` | 135 | service (updateVehicleOwnership / deleteVehicleOwnership + 2 error class + ends_on=NULL 排他 invariant) |
| `src/app/admin/vehicles/[id]/page.tsx` | +33 | 各 ownership 行に inline 編集 form + 削除ボタン |
| `src/app/admin/vehicles/[id]/actions.ts` | +50 | updateOwnershipAction / deleteOwnershipAction |
| `tests/integration/services/vehicle-ownerships.integration.test.ts` | 290 | 11 cases (per-row CRUD + 排他 + CHECK + soft delete + CASCADE + tenant + strict) |

`vehicles.ts` の `transferOwnership` / `listOwnershipsByVehicle` は touched せず保留。`vehicle-ownerships.ts` は per-row 操作のみを担当 (canonical 分離)。

## Claude 側の主要設計判断

1. **ends_on=NULL 1件のみ invariant を service 側 transaction で防衛**: DB CHECK / trigger は未実装、`updateVehicleOwnership` 内で `tx.select(... WHERE ne(id, self) AND endsOn IS NULL)` で他の active を検出
2. **CHECK (starts_on <= ends_on) は service + DB 両層で防衛**: DB 制約は raw insert で発火するが、service 側でも明示的に検証して `VehicleOwnershipConstraintError` で UX 用に変換
3. **soft delete 採用** (`deletedAt` 列あり): hard delete でなく master 系と同方針、誤削除回復可
4. **`vehicle-ownerships.ts` を独立 service として新設**: 既存 `vehicles.ts` の transferOwnership は co-locate 維持。新ファイルは per-row CRUD のみ責務
5. **UI inline 編集**: 各 ownership 行に startsOn / endsOn / isPrimary の編集 form + 削除ボタン埋め込み (toggle/collapse なし、シンプル fixed form)
6. **`UpdateInput` strict + endsOn nullable**: `"endsOn" in parsed` で「未指定」と「null 指定」を区別、null 指定で再 active 化可能
7. **advisor 助言で scope を最小化**: handoff §97 推奨「is_primary 排他 canonical」は schema 本来意図だが既存 transferOwnership と矛盾、ユーザー判断で棄却

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.11 vehicle-ownerships | **Claude 自実装 (handoff §150 推奨 + 8 連続 1 ターン完遂継続)** |

→ A.11 も Codex 試行ゼロで Claude 完遂。block override 記録 3 件 (service + actions + test)。

## Phase 64-A.12 入力契約

### 参照すべきファイル

- 本 handoff (`phase-64-a11-vehicle-ownerships-sealed.md`)
- `phase-64-a10-store-holidays-sealed.md` (前 per-row CRUD canonical 起源)
- `src/lib/services/vehicle-ownerships.ts` (ends_on=NULL 排他 invariant の新 canonical)
- `src/lib/services/vehicles.ts` (transferOwnership 既存、本 phase で touched せず)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker 累積 13/24 (A.11 で vehicle_ownerships 消化)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.11 機能すべてに retrogression なし
- typecheck clean / 36 test files / **283 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.11 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- `vehicles.ts` の `transferOwnership` / `listOwnershipsByVehicle` 挙動は **不変** (ends_on=NULL 排他モデル維持)
- `vehicle_ownerships` schema は CHECK + isPrimary boolean + deletedAt あり、A.12 以降も raw-migration 変更禁止
- vehicle detail ページ「所有履歴」 section の譲渡 form 意味は不変 (既存 transferOwnership 経由)
- co-ownership (N人同時所有 + isPrimary 排他) は **Phase 64-A.11 では実装せず**、将来要件として残置

### Phase 64-A.12 着手時の最初の判断

1. **次の MVP blocker 選定**: Phase 63 step2 §C 残候補:
   - **vendor_available_days** (vendor 詳細サブ、A.8 lane_working_hours mirror で週次 schedule full-replace、短期完遂可)
   - **vendor_unavailable_dates** (vendor 詳細サブ、A.10 store_holidays mirror で per-row CRUD with UNIQUE)
   - **statuses マスタ CRUD** (seed `03_roles_statuses.sql` 既存に注意、影響範囲広め)
   - **roles マスタ CRUD** (auth 影響大、優先度後ろ)
2. **A.12 推奨**: `vendor_available_days` (A.8 mirror で実装パターン確立済、短期完遂可、仕様判断量「低-中」)
3. **代替候補**: `vendor_unavailable_dates` (A.10 store_holidays mirror、こちらも短期完遂可)
4. **Codex 委任の再試行**: A.2 で 3 連続 sandbox-blocked、A.3-A.11 はスキップ。A.12 でも再試行価値は低い見込み、Claude 直接実装デフォルトで OK
5. canonical mirror 状況 (A.11 で 1 つ追加):
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし) → `lane-types.ts` / `work-categories.ts`
   - M:N 関連 → `lane-work-menus.ts` (A.7 replace transaction)
   - 親 1:N サブ (full-replace, 行集合) → `lane-working-hours.ts` (A.8) / `store-business-hours.ts` (A.9)
   - 親 1:N サブ (per-row CRUD with UNIQUE) → `store-holidays.ts` (A.10)
   - **親 1:N サブ (per-row CRUD with ends_on=NULL 排他 invariant) → `vehicle-ownerships.ts` (A.11 で確立)**
6. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定

### 想定規模 (Phase 64-A.12 例: vendor_available_days)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1-2 (service + integration test、UI は vendor detail 拡張) |
| 想定行数 | 300-450 |
| 想定 tests 追加 | 5-8 ケース (full-replace + 重複 day + tenant + CASCADE + soft delete) |
| 完了後 tests 合計 | 288+ |
| 仕様判断量 | **低-中** (A.8 mirror で実装パターン既知) |

### 注意点

- vendor 詳細 page の場所と既存 UI 構造を着手時に確認 (`src/app/admin/vendors/[id]/page.tsx` 想定)
- `vendor_available_days` schema 確認: weekday (0-6) + UNIQUE(vendor_id, weekday) + 営業時間 columns あれば A.8 mirror、UNIQUE なしなら A.7 M:N pattern
- 着手時に必ず raw-migration / spec / drizzle schema の 3 点突合を実施 (handoff §146 推奨継続)
- A.11 で確立した「ends_on=NULL 排他 invariant」は単一テーブルの "active row" 制約だが、vendor 系では恐らく不要 (週次 weekday 別、time 別の異なる排他形態)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.11 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 2 既存拡張 (UI + actions) + 1 新規 test + 1 sealed = 5 files |
| 新規 service 関数 | 2 (update / delete) + 2 error class + 1 helper |
| advisor 呼び出し | 1 (scope 判断、A 案採択の根拠固め) |
| Codex 委任 task 数 | 0 (handoff §150 推奨でスキップ) |
| Codex 採用率 | 0/0 (A.11 単体)、累積 1/11 (A.1-A.11) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.11 試行なし) |
| 新規 tests | 11 cases / 290 行 (per-row CRUD + 排他 invariant full coverage) |
| invariants 維持 | typecheck clean / 283 tests / 36 test files |
| MVP blocker 消化 | 累積 13/24 (A.1-A.10 + vehicle_ownerships) |

## 振り返りメモ

- **advisor 助言の威力**: handoff §97 推奨「is_primary 排他 canonical」を盲信せず advisor で「既に transferOwnership で排他済み + schema 本来意図は co-ownership」と気づけた。scope 判断はユーザー側 (仕様判断量「高」) に正しく escalate
- **scope 縮小の判断**: 既存実装と既存 spec のズレ (`since` / `until` 表記 vs 実 schema) があったが、MVP 進行を優先して既存挙動維持 + 個別 CRUD 追加に縮減
- **service 分離の判断**: vehicles.ts に transferOwnership を残し、vehicle-ownerships.ts に per-row CRUD を独立。canonical も別系統 (transferOwnership = 譲渡業務、vehicle-ownerships = 個別行修正)
- **ends_on=NULL 排他 invariant の service 側実装**: DB trigger 未実装でも transaction 内 SELECT + ne() で安全に防衛できる。今後 UNIQUE PARTIAL INDEX (`WHERE ends_on IS NULL`) で DB 化する path も残る
- **handoff §150 推奨の効果継続**: A.3-A.11 で Claude 直接実装 9 連続 1 ターン完遂。advisor 介在も含めて 1 ターン内完結

---

*Phase 64-A.11 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.12 (推奨: vendor_available_days A.8 mirror または vendor_unavailable_dates A.10 mirror、本 branch `phase-64-mvp-implementation` 継続)*
