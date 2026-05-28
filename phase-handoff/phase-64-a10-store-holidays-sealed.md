# Phase 64-A.11 入力契約: Phase 64-A.10 store_holidays sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.10 (前: 64-A.9 store_business_hours sealed) |
| 状態 | **sealed** (store_holidays service + store detail 祝日 section + integration tests / 272 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §150 推奨に従い直接実装、Codex 試行スキップ) |
| 前 handoff | `phase-64-a9-store-business-hours-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |

## 達成したこと (Phase 64-A.10)

- 1 ファイル新規 (service `store-holidays.ts` / 約 200 行)
- 既存 UI 拡張: `src/app/admin/stores/[id]/page.tsx` (+102 行、休業日 section + 追加 form + 一覧 table)、`actions.ts` (+50 行、create / update / delete 3 action)
- integration test 1 ファイル新規 (10 ケース、create + update + delete + UNIQUE + tenant + CASCADE + soft delete + 並び順 + 日付範囲 + isClosed)
- 既存 schema / RLS / raw-migration 変更 **0**
- 既存 service 関数の挙動変更 **0** (純粋追加のみ)
- typecheck clean (tsc --noEmit 通過)
- **272 tests PASS** (262 + 新規 10、目標 268+ 超過)
- canonical 新規確立: **per-row CRUD with UNIQUE conflict handling** (A.7-A.9 の replace pattern と異なる新パターン)

## 新 canonical: per-row CRUD with UNIQUE conflict

- A.7 (M:N replace) / A.8 (per-lane full-replace) / A.9 (per-store full-replace) と異なり、
  本 A.10 は **UNIQUE(store_id, holiday_date) があるため per-row 個別 CRUD** を採用
- 同パターンが使える将来 sub-table: `vehicle_ownerships` (vehicle_id + UNIQUE 想定?)、`store_specific_settings` 系
- 設計要素:
  - `assertStoreInCompany()` で親 tenant 検証 (insert 時)
  - 23505 catch → `StoreHolidayConflictError` (stores の `StoreCodeConflictError` mirror)
  - `StoreHolidayNotFoundError` (update 0 row catch)
  - hard delete (schema に deletedAt なし、master 系と異なり個別レコード性質)
  - `listStoreHolidaysByStoreId(storeId, { fromDate?, toDate? }, ctx)` で optional date range

## Phase 64-A.10 で実装したファイル

| path | 行数 | 種別 |
|---|---|---|
| `src/lib/services/store-holidays.ts` | 200 | service (list / create / update / delete + UNIQUE conflict + tenant 検証) |
| `src/app/admin/stores/[id]/page.tsx` | +102 | 「休業日」section: 追加 form + 一覧 table + 削除ボタン |
| `src/app/admin/stores/[id]/actions.ts` | +50 | createStoreHolidayAction / updateStoreHolidayAction / deleteStoreHolidayAction |
| `tests/integration/services/store-holidays.integration.test.ts` | 257 | 10 cases (per-row CRUD canonical full coverage) |

独立 admin 画面は作成せず、store detail 内サブセクションで一本化 (A.7-A.9 と同方針)。

## Claude 側の主要設計判断

1. **per-row CRUD canonical 新規確立**: UNIQUE(store_id, holiday_date) + is_closed bool の schema を尊重し、A.8/A.9 の full-replace ではなく per-row CRUD で実装。日付ごとに個別意味があるため自然
2. **list 「今日以降」default**: UI 側で `fromDate: today` を渡し、過去履歴は省略表示。MVP 時点で過去履歴一覧は不要
3. **UNIQUE conflict handling**: stores `StoreCodeConflictError` を mirror した `StoreHolidayConflictError`、create / update 両経路で 23505 catch
4. **削除 = hard delete**: schema に deletedAt なし、また holiday 一件削除は意味的にも soft delete 不要 (再追加で復元可)
5. **編集 UI 簡素化**: page.tsx では create + delete のみ提供、update action は actions.ts に export 済 (将来 inline edit 用)。MVP では削除→再追加運用で OK
6. **`isClosed` checkbox 追加 form default=true**: 「祝日 = 通常休業」が業務上多数派、checkbox 外し時のみ「特別営業日」扱い
7. **date 型は string ("YYYY-MM-DD") で扱う**: drizzle date mode default = string、PG date 互換、 `<input type="date">` と直接互換
8. **CASCADE テスト簡素化**: A.9 と同パターン (`DELETE FROM stores` で reservations 未生成 fixture では成功、soft delete 非対称も明示)

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.10 store_holidays | **Claude 自実装 (handoff §150 推奨 + 7 連続 1 ターン完遂継続)** |

→ A.10 も Codex 試行ゼロで Claude 完遂。block override 記録 4 件 (service + UI + actions + test、内容: 新 canonical 確立 + per-row CRUD 設計判断含む自実装)。

## Phase 64-A.11 入力契約

### 参照すべきファイル

- 本 handoff (`phase-64-a10-store-holidays-sealed.md`)
- `phase-64-a9-store-business-hours-sealed.md` (前 store detail サブの起源)
- `src/lib/services/store-holidays.ts` (per-row CRUD canonical 確立、UNIQUE conflict 対応)
- `src/lib/services/stores.ts` (UNIQUE conflict 元 canonical `StoreCodeConflictError`)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker は Phase 63 step2 §C 残 12 件 (A.10 で store_holidays 消化、累積 12/24)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.10 機能すべてに retrogression なし
- typecheck clean / 35 test files / **272 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.10 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- vehicle_ownerships の isPrimary 排他 / ends_on 自動更新 trigger は **依然 DB 未実装**、A.11 でも trigger 追加禁止
- `lane_types` schema は deletedAt なし、A.11 以降も追加禁止 (raw-migration 不変)
- `lane_working_hours` / `store_business_hours` schema は UNIQUE / is_closed なし、A.11 以降も追加禁止 (raw-migration 不変)
- `store_holidays` schema は UNIQUE(store_id, holiday_date) + is_closed あり、A.11 以降も raw-migration 変更禁止
- lane_work_menus は「lane detail 内 replace のみ」、独立 admin 画面禁止
- lane_working_hours / store_business_hours / store_holidays は「親 detail 内サブのみ」、独立 admin 画面禁止
- lanes UI で store 変更は禁止 (新規 + 旧削除フロー)

### Phase 64-A.11 着手時の最初の判断

1. **次の MVP blocker 選定**: Phase 63 step2 §C 残候補:
   - **statuses マスタ CRUD** (表示順 / 色コード、seed `03_roles_statuses.sql` 既存に注意、影響範囲広め)
   - **roles マスタ CRUD** (admin/vendor role、auth 影響大、優先度後ろでも可)
   - **vehicle_ownerships CRUD** (vehicles 詳細サブ、isPrimary trigger 未実装注意 — service 側で排他制御要)
   - **vendor_available_days / vendor_unavailable_dates** (vendor 詳細サブ、A.8/A.10 mirror で実装可能)
2. **A.11 推奨**: `vehicle_ownerships` (per-vehicle 1:N、UNIQUE なしの想定だが is_primary boolean による排他制御が新 canonical 候補。schema 確認必須)
3. **代替候補**: `vendor_available_days` (週次 schedule = A.8 mirror) なら短期完遂可能、`statuses マスタ` は seed 衝突対応で仕様判断量「中-高」
4. **Codex 委任の再試行**: A.2 で 3 連続 sandbox-blocked、A.3-A.10 はスキップ。A.11 でも再試行価値は低い見込み、Claude 直接実装デフォルトで OK
5. canonical mirror 状況 (A.10 で 1 つ追加):
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし) → `lane-types.ts` / `work-categories.ts`
   - M:N 関連 → `lane-work-menus.ts` (A.7 replace transaction)
   - 親 1:N サブ (full-replace, 行集合) → `lane-working-hours.ts` (A.8) / `store-business-hours.ts` (A.9)
   - **親 1:N サブ (per-row CRUD with UNIQUE) → `store-holidays.ts` (A.10 で確立)**
   - seed 既存マスタ (statuses, roles) は raw-migration `03_roles_statuses.sql` に注意、CRUD で seed 上書き衝突回避
6. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定

### 想定規模 (Phase 64-A.11 例: vehicle_ownerships)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1-2 (service + integration test、UI は vehicle detail 拡張) |
| 想定行数 | 350-500 |
| 想定 tests 追加 | 7-10 ケース (per-row CRUD + isPrimary 排他 + ends_on 自動更新 + tenant + CASCADE) |
| 完了後 tests 合計 | 279+ |
| 仕様判断量 | **中-高** (isPrimary trigger 未実装のため service 側で排他制御要、新 canonical 候補) |

### 注意点

- `vehicle_ownerships` の isPrimary トリガー (DB 側で「同 vehicle に isPrimary=true は 1 件のみ + 旧 primary の ends_on 自動更新」) は **未実装**。service 側でトランザクション内排他制御が必要、handoff §A.9 §88 で何度も確認済の制約
- A.10 canonical 「per-row CRUD with UNIQUE」は vehicle_ownerships に直接は使えない (UNIQUE なし + isPrimary 排他という新 dimension)
- 着手時に必ず raw-migration / spec / drizzle schema の 3 点突合を実施 (handoff §146 推奨継続)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.10 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 2 既存拡張 (UI + actions) + 1 新規 test + 1 sealed = 5 files |
| 新規 service 関数 | 4 (list / create / update / delete) + 3 error class + 1 helper |
| advisor 呼び出し | 0 (schema 三点突合で確信、新 canonical だが判断点明確) |
| Codex 委任 task 数 | 0 (handoff §150 推奨でスキップ) |
| Codex 採用率 | 0/0 (A.10 単体)、累積 1/10 (A.1-A.10) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.10 試行なし) |
| 新規 tests | 10 cases / 257 行 (per-row CRUD canonical full coverage) |
| invariants 維持 | typecheck clean / 272 tests / 35 test files |
| MVP blocker 消化 | 累積 12/24 (service_tickets + vehicles + customers + stores + work_categories + work_menus + lane_types + lanes + lane_work_menus + lane_working_hours + store_business_hours + store_holidays) |

## 振り返りメモ

- **新 canonical 確立の効率**: per-row CRUD with UNIQUE conflict は `stores.ts` の UNIQUE 衝突パターンを mirror しつつ、親 tenant 検証 helper (`assertStoreInCompany`) を新規追加。今後の sub-table 系で再利用可能
- **schema 三点突合の威力**: raw-migration / drizzle / spec の 3 点を着手時に確認することで設計判断が即決。A.8 の drift 発見が予防にも作用
- **UNIQUE conflict 2 経路 catch**: create 時の conflict と update での date 変更時 conflict、両経路を test で覆い、stores canonical と同等品質を確保
- **「今日以降」default の運用判断**: 過去履歴の管理は MVP 範囲外、UI 既定で `fromDate: today` を渡すことで一覧の UX を運用に合わせた
- **handoff §150 推奨の効果継続**: A.3-A.10 で Claude 直接実装 8 連続 1 ターン完遂。canonical 拡張時 (新パターン確立含む) でも Claude 直接実装が高効率
- **update action の dead-export**: page.tsx で未使用だが将来 inline edit 用に actions.ts に export 残置。typecheck/eslint 通過済、削除は future need 判定後

---

*Phase 64-A.10 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.11 (推奨: vehicle_ownerships または vendor_available_days、本 branch `phase-64-mvp-implementation` 継続)*
