# Phase 64-A.10 入力契約: Phase 64-A.9 store_business_hours sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.9 (前: 64-A.8 lane_working_hours sealed) |
| 状態 | **sealed** (store_business_hours service + store detail 営業時間 table (acceptsReservations 込) + integration tests / 262 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §150 推奨に従い直接実装、Codex 試行スキップ) |
| 前 handoff | `phase-64-a8-lane-working-hours-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |

## 達成したこと (Phase 64-A.9)

- 1 ファイル新規 (service `store-business-hours.ts` / 約 145 行)
- 既存 UI 拡張: `src/app/admin/stores/[id]/page.tsx` (+89 行、7 曜日 table + 予約受付 checkbox)、`actions.ts` (+30 行、`replaceStoreBusinessHoursAction`)
- integration test 1 ファイル新規 (10 ケース、CRUD + dedupe + time refine + tenant + CASCADE + soft delete 非対称 + 順序 + acceptsReservations)
- 既存 schema / RLS / raw-migration 変更 **0**
- 既存 service 関数の挙動変更 **0** (純粋追加のみ)
- typecheck clean (tsc --noEmit 通過)
- **262 tests PASS** (252 + 新規 10、目標 257+ 超過)
- canonical 再利用: **per-store full-replace transaction** = A.8 per-lane canonical の直接 mirror (`lane_id` → `store_id` + `acceptsReservations` boolean 追加)

## ⚠ schema drift 状況 (A.8 と同パターン継続)

`spec/data-model.md §3.3` と `raw-migrations/alpha-1-public/05_stores.sql` に齟齬 (A.8 lane_working_hours と同型):

| 観点 | spec §3.3 想定 | raw-migration (実装) |
|---|---|---|
| PK | `(store_id, day_of_week)` 想定可 | `id uuid` |
| UNIQUE | (PK 想定) | **なし** |
| `is_closed` | あり想定可 | **なし** |
| CHECK | (記載なし) | `day_of_week 0-6` + `opens_at < closes_at` |

→ A.8 と同様、raw-migration を真として実装 (raw 不変規律と整合)。
→ UI は 7 行 fixed 営業日 checkbox (休業 = 行なし) で運用、is_closed カラムは追加しない。
→ `accepts_reservations` boolean は schema に存在 (A.8 lane_working_hours にはない)、本 A.9 で UI checkbox + service 入力で対応。

## Phase 64-A.9 で実装したファイル

| path | 行数 | 種別 |
|---|---|---|
| `src/lib/services/store-business-hours.ts` | 145 | service (replace + list + dedupe + time refine + acceptsReservations) |
| `src/app/admin/stores/[id]/page.tsx` | +89 | 「営業時間」セクション追加 (7 曜日 table + 予約受付 col) |
| `src/app/admin/stores/[id]/actions.ts` | +30 | `replaceStoreBusinessHoursAction` 追加 |
| `tests/integration/services/store-business-hours.integration.test.ts` | 274 | 10 cases (A.8 mirror + acceptsReservations) |

独立 admin 画面は作成せず、store detail 内サブセクションで一本化 (A.7/A.8 と同方針)。

## Claude 側の主要設計判断

1. **A.8 canonical 直接 mirror**: per-lane full-replace transaction を per-store に置換、構造変更なし。仕様判断量「低」のため Codex 委任不要
2. **acceptsReservations の zod スキーマ位置**: `HourEntry` に `z.boolean().optional()` で追加、未指定時は service 内で `?? true` で default。schema default も `true` のため二重保険
3. **UI col 配置**: 「曜日 / 営業 / 開始 / 終了 / 予約受付」の 5 col table。予約受付 checkbox は最右に配置 (副次属性)
4. **CASCADE テスト**: stores の inbound FK 確認後、fixture には reservations (RESTRICT) なしのため `DELETE FROM stores` 直接実行で OK。lane の `DELETE FROM lanes` と同型に簡素化
5. **休業日 = 行なし表現**: A.8 と同方針 (schema に is_closed 無し)
6. **time 形式正規化**: A.8 と完全同型 ("HH:MM" → "HH:MM:SS")
7. **tenant 検証 1 段階**: store が companyId に属し deletedAt なし。store_business_hours の companyId は store と同じ必要があり、insert 時に明示
8. **soft delete 非対称テスト保持**: A.8 advisor 指摘の「soft delete では rows 残る」を A.9 でも明示テスト化

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.9 store_business_hours | **Claude 自実装 (handoff §150 推奨 + 6 連続 1 ターン完遂継続)** |

→ A.9 も Codex 試行ゼロで Claude 完遂。block override 記録 3 件 (service + UI + test、内容: canonical 完全 mirror + schema drift 既知パターンの自実装)。

## Phase 64-A.10 入力契約

### 参照すべきファイル

- 本 handoff (`phase-64-a9-store-business-hours-sealed.md`)
- `phase-64-a8-lane-working-hours-sealed.md` (per-lane full-replace canonical の起源)
- `src/lib/services/store-business-hours.ts` (per-store full-replace 完全 mirror 実装)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker は Phase 63 step2 §C 残 13 件 (A.9 で store_business_hours 消化、累積 11/24)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.9 機能すべてに retrogression なし
- typecheck clean / 34 test files / **262 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.9 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- vehicle_ownerships の isPrimary 排他 / ends_on 自動更新 trigger は **依然 DB 未実装**、A.10 でも trigger 追加禁止
- `lane_types` schema は deletedAt なし、A.10 以降も追加禁止 (raw-migration 不変)
- `lane_working_hours` / `store_business_hours` schema は UNIQUE / is_closed なし、A.10 以降も追加禁止 (raw-migration 不変、reconciliation は別 Phase で議論)
- lane_work_menus は「lane detail 内 replace のみ」、独立 admin 画面禁止
- lane_working_hours / store_business_hours は「親 detail 内 7 曜日 table のみ」、独立 admin 画面禁止
- lanes UI で store 変更は禁止 (新規 + 旧削除フロー)

### Phase 64-A.10 着手時の最初の判断

1. **次の MVP blocker 選定**: Phase 63 step2 §C 残候補:
   - **store_holidays** (store detail 内サブ、店舗祝日。UNIQUE(store_id, holiday_date) あり、`is_closed` boolean あり。A.9 とは別パターン: per-date)
   - **statuses マスタ CRUD** (表示順 / 色コード、seed `03_roles_statuses.sql` 既存に注意)
   - **roles マスタ CRUD** (admin/vendor role、auth 影響大、優先度後ろでも可)
   - **vehicle_ownerships CRUD** (vehicles 詳細サブ、isPrimary trigger 未実装注意)
2. **A.10 推奨**: `store_holidays` (本 A.9 と同じ store detail サブで配置でき、ユーザ体験統合がスムーズ。実装パターンは「per-date list + 個別 CRUD」で A.9 の per-day と異なる新 canonical 確立になる可能性大)
3. **Codex 委任の再試行**: A.2 で 3 連続 sandbox-blocked、A.3-A.9 はスキップ。A.10 でも再試行価値は低い見込み、Claude 直接実装デフォルトで OK
4. canonical mirror 状況:
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし) → `lane-types.ts` / `work-categories.ts`
   - M:N 関連 → `lane-work-menus.ts` (A.7 replace transaction)
   - 親 1:N サブ (full-replace, 行集合) → `lane-working-hours.ts` (A.8) / `store-business-hours.ts` (A.9)
   - **親 1:N サブ (per-row CRUD, UNIQUE あり) → store_holidays で新規確立予定**
   - seed 既存マスタ (statuses, roles) は raw-migration `03_roles_statuses.sql` に注意、CRUD で seed 上書き衝突回避
5. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定

### 想定規模 (Phase 64-A.10 例: store_holidays)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1-2 (service + integration test、UI は store detail 拡張) |
| 想定行数 | 350-500 |
| 想定 tests 追加 | 6-8 ケース (per-row CRUD: create + update + delete + UNIQUE 衝突 + tenant + CASCADE + 一覧) |
| 完了後 tests 合計 | 268+ |
| 仕様判断量 | **中** (新 canonical 確立、per-row CRUD with UNIQUE のため A.9 の full-replace と異なる) |

### 注意点

- `store_holidays` schema (05_stores.sql) は UNIQUE(store_id, holiday_date) + is_closed bool あり (A.9 の lane_working_hours / store_business_hours とは drift パターンが異なる)
- A.9 canonical 「per-X full-replace」は A.10 store_holidays には適用不可 (UNIQUE があるため UPSERT or 個別 CRUD が canonical)
- 着手時に必ず raw-migration / spec / drizzle schema の 3 点突合を実施 (handoff §146 推奨継続)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.9 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 2 既存拡張 (UI + actions) + 1 新規 test + 1 sealed = 5 files |
| 新規 service 関数 | 2 (listStoreBusinessHoursByStoreId / replaceStoreBusinessHours) + 2 error class |
| advisor 呼び出し | 0 (A.8 schema drift 既知のため A.9 では同パターンとして即適用) |
| Codex 委任 task 数 | 0 (handoff §150 推奨でスキップ) |
| Codex 採用率 | 0/0 (A.9 単体)、累積 1/9 (A.1-A.9) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.9 試行なし) |
| 新規 tests | 10 cases / 274 行 (A.8 9 cases + acceptsReservations 1 case) |
| invariants 維持 | typecheck clean / 262 tests / 34 test files |
| MVP blocker 消化 | 累積 11/24 (service_tickets + vehicles + customers + stores + work_categories + work_menus + lane_types + lanes + lane_work_menus + lane_working_hours + store_business_hours) |

## 振り返りメモ

- **canonical mirror の威力**: A.8 確立の per-lane full-replace を per-store に直接置換するだけで実装完了。schema 差分 (acceptsReservations 追加) のみが新規判断点、所要時間最短
- **schema drift パターンの再発見**: A.8 で発覚した「raw-migration vs spec の UNIQUE / is_closed 不整合」が store_business_hours でも同様に発生。今後 sub-table 系全般で同パターン想定推奨
- **handoff §150 推奨の効果継続**: A.3-A.9 で Claude 直接実装 7 連続 1 ターン完遂。canonical 確立後の MVP CRUD では Claude 直接実装が圧倒的に高効率
- **CASCADE テストの簡素化**: stores の inbound FK 全 13 件を確認後、fixture が孤立 (reservations 等の RESTRICT 子レコードなし) なら `DELETE FROM stores` 直接で OK。A.8 lane と同型維持
- **acceptsReservations の扱い**: schema default + zod optional + service `?? true` の三重保険。UI checkbox の defaultChecked は既存 row 優先、新規 (existing なし) は true。仕様自然 (休業日に予約受付チェックは無意味)

---

*Phase 64-A.9 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.10 (推奨: store_holidays、本 branch `phase-64-mvp-implementation` 継続)*
