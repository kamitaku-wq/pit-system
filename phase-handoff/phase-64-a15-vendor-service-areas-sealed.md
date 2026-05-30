# Phase 64-A.16 入力契約: Phase 64-A.15 vendor_service_areas sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.15 (前: 64-A.14 vendor_sla_overrides sealed) |
| 状態 | **sealed** (vendor_service_areas per-row CRUD without UNIQUE + vendor detail エリア section + integration tests / 329 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §150 推奨に従い直接実装、Codex 試行スキップ継続、新セッション 1 ターン完遂) |
| 前 handoff | `phase-64-a14-vendor-sla-overrides-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |
| **/clear 推奨** | **本 Phase 完了後、vendor 系 5 sub-table 全完遂で自然な domain 区切り、`/clear` 推奨を発出** |

## 達成したこと (Phase 64-A.15)

- 1 ファイル新規 (service `vendor-service-areas.ts` 約 147 行、A.10/A.14 mirror without UNIQUE conflict)
- 既存 UI 拡張: `vendors/[id]/page.tsx` (+55 行、「対応エリア」 section: 一覧 + 追加 form + 更新/削除 inline form)、`actions.ts` (+67 行、create/update/delete 3 actions)
- integration test 1 ファイル新規 (10 cases: prefecture+city / prefecture only / 順序 / 重複許容 / cross-tenant vendor / update independent + clear / not-found / hard-delete cross-tenant / vendor CASCADE / Zod 空白拒否)
- 既存 schema / RLS / raw-migration 変更 **0** (drizzle schema 既存 `vendor_service_areas.ts` をそのまま利用)
- 既存 vendor 系 service (`vendors.ts` / `vendor-available-days.ts` / `vendor-available-stores.ts` / `vendor-sla-overrides.ts`) 挙動変更 **0**
- typecheck clean (tsc --noEmit 通過、無出力)
- **329 tests PASS** (319 + 新規 10、41 test files、handoff 想定 325+ クリア)

## Claude 側の主要設計判断

1. **三点突合で spec drift 検出**: spec §7.3 は旧構造 `area_code text NOT NULL` + `PK(vendor_id, area_code)` だが、raw-migration / drizzle は `prefecture text NOT NULL + city text` + UNIQUE 不在 + id PK で canonical 化済。実装は **raw-migration + drizzle 基準** (handoff §A.14 §100 既定方針継続)
2. **UNIQUE 不在 → 重複登録許容**: 同一 vendor で同一 prefecture/city の重複を許容、UI 警告も実装しない (現実運用で「複数エリア区分け」「重複入力エラー」より「ユーザー裁量」を優先、handoff §103 推奨)
3. **city nullable = 都道府県全域**: city 未指定/空文字を `null` に正規化、Zod `cityField` に transform で集約 (UI 側で「市区町村を空欄にすると都道府県全域」と明示)
4. **prefecture text 上限 50 / city text 上限 100**: 都道府県名最長「神奈川県」(4)/「鹿児島県」(4) 程度だが旧字・別表記 (ヶ/が) 余裕で 50、政令市市区町村は最長 10 文字程度 + 余裕で 100
5. **hard delete**: schema に deletedAt 列なし → vendor_sla_overrides / lane-types / work-categories と同パターン
6. **error class 衝突対応継続**: `VendorNotFoundError` が 4 vendor service で重複定義 (available-days/stores/sla-overrides/service-areas)。actions 側で `VendorNotFoundForAreasError` alias import で identifier 衝突回避継続
7. **UI section 配置**: 既存 sections (基本情報 / 対応曜日 / 対応店舗 / SLA 上書き) の **「削除」 section 直前** に「対応エリア」を追加。地理的範囲系 (対応店舗/対応エリア) を隣接させ、契約系 (SLA) と分離

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.15 vendor-service-areas | **Claude 自実装 (handoff §150 推奨 + 13 連続 1 ターン完遂継続)** |

→ A.15 も Codex 試行ゼロで Claude 完遂。block override 記録 5 件 (service + UI + actions + test + handoff)。

## Phase 64-A.16 入力契約 (新セッションで使用)

### 参照すべきファイル

- 本 handoff (`phase-64-a15-vendor-service-areas-sealed.md`)
- `phase-64-a14-vendor-sla-overrides-sealed.md` (前 vendor 系 canonical)
- `src/lib/services/vendor-service-areas.ts` (per-row CRUD without UNIQUE canonical、UNIQUE 不在版 A.10 mirror)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker 累積 **17/24** (A.15 で vendor_service_areas 消化、vendor 系 5 件 = vendors / available_days / available_stores / sla_overrides / service_areas **完全完遂**)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.15 機能すべてに retrogression なし
- typecheck clean / 41 test files / **329 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.15 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- `vendor_service_areas` schema は UNIQUE 不在 + city nullable + CASCADE のまま不変
- vendor detail page の 5 section (基本情報 / 対応曜日 / 対応店舗 / SLA 上書き / 対応エリア) は **独立 form**、混在禁止
- prefecture/city 重複は service / UI で許容、UNIQUE 制約を追加しない (将来 schema 変更なしポリシー)
- spec §7.3 area_code 旧構造はそのまま放置 (実装は raw-migration + drizzle canonical、spec 更新は別 Phase で実施)

### Phase 64-A.16 着手時の最初の判断

1. **次の MVP blocker 選定** (残候補):
   - **statuses マスタ CRUD** (seed `03_roles_statuses.sql` 既存、seed 衝突対応で仕様判断量「中-高」、影響範囲広い)
   - **roles マスタ CRUD** (auth 影響大、優先度後ろ)
   - **customer_reservation_tokens** (Phase 4 顧客本人確認、token hash + email 検証、新規 schema 確認必要)
   - **attachments** (画像/PDF upload、Supabase Storage 連携必要、外部依存)
   - **vendor_service_capabilities** (もし schema 存在すれば、業者対応依頼種別マスタ。要 schema 確認)
2. **A.16 推奨**: `vendor_service_capabilities` schema 存在確認 → 存在すれば vendor 系 6 件目で **canonical mirror 最終活用**、不在なら `statuses マスタ CRUD` (alpha-core scope の seed-backed master、影響範囲調査が肝)
3. **代替候補**: `customer_reservation_tokens` (Phase 4 着手の先駆け、token hash 設計が仕様判断「高」)
4. **A.16 着手時の重要 task**: vendor 系 5 件完全完遂後、次 domain (statuses / customers / attachments) への移行判断
5. canonical mirror 状況 (A.15 で UNIQUE 不在版を追加 = 7 種類カバー):
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 単純 CRUD without UNIQUE → `vendors.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし) → `lane-types.ts` / `work-categories.ts` / `vendor-sla-overrides.ts` / **`vendor-service-areas.ts` (A.15 追加)**
   - M:N 関連 (full diff replace) → `lane-work-menus.ts` / `vendor-available-stores.ts`
   - 親 1:N サブ (full-replace, UNIQUE 有) → `lane-working-hours.ts` / `store-business-hours.ts`
   - 親 1:N サブ (per-row CRUD with UNIQUE) → `store-holidays.ts` / `vendor-sla-overrides.ts`
   - 親 1:N サブ (per-row CRUD with ends_on=NULL 排他) → `vehicle-ownerships.ts`
   - 親 1:N サブ (full-replace, UNIQUE 不在 → wipe + bulk insert) → `vendor-available-days.ts`
   - **親 1:N サブ (per-row CRUD without UNIQUE, 重複許容) → `vendor-service-areas.ts` (A.15 新規 canonical)**
6. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定

### 想定規模 (Phase 64-A.16 例: statuses マスタ CRUD)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1-2 (service + integration test、UI は admin/statuses/page.tsx 新規) |
| 想定行数 | 300-500 |
| 想定 tests 追加 | 6-10 ケース (per-row CRUD + seed 衝突 + cross-tenant) |
| 完了後 tests 合計 | 335+ |
| 仕様判断量 | **中-高** (seed 既存 + status_transitions trigger 影響範囲確認必須) |

### 注意点

- vendor_service_capabilities schema 存在確認: `Glob src/lib/db/schema/*service_capab*` または raw-migration `09_vendors.sql` 全文確認
- statuses マスタは seed `03_roles_statuses.sql` で初期データ投入済 → CRUD で seed 行を編集/削除可能にすべきか要判断
- spec §7.3 area_code drift は別 Phase (spec 更新 Phase) で対応、A.15 では spec を変更しない
- A.15 で vendor 系完了。Phase 64-B (customers / attachments / 等) への切替も検討候補
- 着手時に必ず raw-migration / spec / drizzle schema の 3 点突合 (handoff §146 推奨継続)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.15 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 2 既存拡張 (UI + actions) + 1 新規 test + 1 sealed = **5 files** |
| 新規 service 関数 | 4 (list/create/update/delete) + 2 error class + 1 helper (assertVendor) |
| advisor 呼び出し | 0 (canonical mirror 確立済で設計判断ゼロ) |
| Codex 委任 task 数 | 0 (handoff §150 推奨でスキップ) |
| Codex 採用率 | 0/0 (A.15 単体)、累積 1/15 (A.1-A.15) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.15 試行なし) |
| 新規 tests | 10 cases / 269 行 (per-row CRUD + 重複許容 + cross-tenant + CASCADE full coverage) |
| invariants 維持 | typecheck clean / 329 tests / 41 test files |
| MVP blocker 消化 | 累積 17/24 (A.1-A.14 + vendor_service_areas) |

## 振り返りメモ (vendor 系 5 件完遂を経て)

- **canonical mirror 完全活用**: A.10/A.14 mirror から UNIQUE conflict 処理だけ除去で実装完了、設計判断はほぼゼロ (10-15 分で実装→test→typecheck→329 PASS まで完遂)
- **三点突合の継続的価値**: A.15 でも spec §7.3 area_code 旧構造の drift を発見、raw-migration + drizzle canonical 化を再確認。spec 更新は別 Phase で対応する切り分けが定着
- **vendor 系 5 件で得た知見**: per-row CRUD with/without UNIQUE / M:N replace / full-replace + UNIQUE / per-row + ends_on 排他 / per-row without UNIQUE の 5 パターン × 4 ファイル = 20 件の canonical mirror 蓄積
- **error class 衝突問題の長期化**: 4 vendor service で `VendorNotFoundError` 衝突、actions alias import で回避中。Phase 65 以降のリファクタ候補 (`@/lib/services/_errors/vendor.ts` 抽出) を温存
- **handoff §150 推奨の効果 (13 連続 1 ターン完遂)**: A.3-A.15 で Claude 直接実装、Codex 試行ゼロ。canonical 確立後は Codex 委任の価値が下がる傾向継続
- **新セッション 1 ターン完遂**: `/clear` 直後の新セッションで A.15 を 1 ターン (resume → 三点突合 → 実装 → test → seal) で完遂、handoff の効果実証

## /clear 推奨タイミング (本 Phase 完了時)

**本 Phase A.15 完遂後、`/clear` 推奨を発出**。理由:
- vendor 系 5 sub-table 完全完遂 (vendors + available_days + available_stores + sla_overrides + service_areas) で **自然な domain 区切り**
- 次 Phase A.16 は **新 domain (statuses マスタ / customers / 等)** に移る可能性が高く、新セッション開始の良い境界
- vendor 系 canonical mirror が確立し、今後 vendor 系で参照すべき先 (handoff) が固定化
- 本セッションは A.15 単独 (1 ターン完遂) でコンテキスト累積少だが、新 domain 移行で文脈刷新が望ましい

新セッション開始時: `phase-64-a15-vendor-service-areas-sealed.md` を読んで Phase 64-A.16 着手。

---

*Phase 64-A.15 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.16 (推奨: vendor_service_capabilities schema 確認 → 存在すれば vendor 系 6 件目、不在なら statuses マスタ CRUD、本 branch `phase-64-mvp-implementation` 継続)*
