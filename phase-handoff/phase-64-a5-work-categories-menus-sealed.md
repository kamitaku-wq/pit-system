# Phase 64-A.6 入力契約: Phase 64-A.5 work_categories + work_menus sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.5 (前: 64-A.4 stores sealed) |
| 状態 | **sealed** (work_categories + work_menus CRUD + admin UI + integration tests / 222 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §76 推奨に従い直接実装、Codex 試行スキップ) |
| 前 handoff | `phase-64-a4-stores-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |

## 達成したこと (Phase 64-A.5)

- 12 ファイル新規 (service x2 / page x6 / actions x4): 約 1150 行
- integration test 2 ファイル新規 (12 ケース、FK SET NULL 検証含む)
- 既存 schema / RLS / raw-migration / 既存 service すべて変更 **0** (禁止ファイル群 untouched)
- typecheck clean (一発通過、エラー 0)
- **222 tests PASS** (210 + 新規 12 ケース、目標 215+ 超過達成)
- canonical pattern (`stores.ts`) を mirror、階層 FK + hard delete / soft delete 混在対応

## Phase 64-A.5 で実装したファイル

| path | 行数 | 種別 |
|---|---|---|
| `src/lib/services/work-categories.ts` | 178 | service (hard delete、listAllForSelect helper) |
| `src/lib/services/work-menus.ts` | 199 | service (soft delete、category join、FK 連動) |
| `src/app/admin/work-categories/page.tsx` | 158 | list (sortOrder column) |
| `src/app/admin/work-categories/new/page.tsx` | 66 | 新規作成 form |
| `src/app/admin/work-categories/new/actions.ts` | 45 | createWorkCategoryAction |
| `src/app/admin/work-categories/[id]/page.tsx` | 121 | 詳細・編集 (hard delete 警告) |
| `src/app/admin/work-categories/[id]/actions.ts` | 53 | update / delete (hard) actions |
| `src/app/admin/work-menus/page.tsx` | 207 | list (category 名 join、q+isActive+category filter) |
| `src/app/admin/work-menus/new/page.tsx` | 92 | 新規作成 form (category select) |
| `src/app/admin/work-menus/new/actions.ts` | 53 | createWorkMenuAction |
| `src/app/admin/work-menus/[id]/page.tsx` | 159 | 詳細・編集 (category 表示 + 再割当) |
| `src/app/admin/work-menus/[id]/actions.ts` | 65 | update / delete (soft) actions |
| `tests/integration/services/work-categories.integration.test.ts` | 174 | 6 cases (CRUD + tenant + q + UNIQUE + sortOrder) |
| `tests/integration/services/work-menus.integration.test.ts` | 213 | 6 cases (CRUD + tenant + filter x3 + UNIQUE + FK SET NULL) |

## Claude 側の主要設計判断

1. **work_categories は hard delete (canonical 逸脱)**: schema に `deletedAt` 列がないため soft delete 不可。`deleteWorkCategory` は実 DELETE。子 `work_menus.work_category_id` は raw-migration §06 で `ON DELETE SET NULL` 指定済のため自動で NULL 化 (FK 連動テストで検証済)
2. **work_menus は canonical soft delete**: `deletedAt` 列ありで stores と同パターン
3. **`listAllWorkCategoriesForSelect` helper**: work-menus の new/detail form と list filter で必要な「全カテゴリ select 用」リスト取得関数を service 層に追加。soft delete 条件不要 (categories に deletedAt なし)、sortOrder + code で安定 sort
4. **FK SET NULL の UI 表現**: 親 hard delete 後の menu は `workCategoryName=null` で「未分類」表示。list の category filter に "未分類" 専用選択肢 (`workCategoryId=none` → null 絞り込み) を追加
5. **`UPDATE workMenus.workCategoryId` の partial 判定**: `"workCategoryId" in parsed` で undefined と null を区別 (null は明示的に未分類化、undefined は touch しない)
6. **数値入力の zod coerce**: form の string を `z.coerce.number().int()` で受ける。`positiveInt` (1-1440 minutes)、`nonNegativeInt` (0-100,000,000 yen) で CHECK 制約と整合
7. **2 つのカスタムエラー**: `WorkCategoryCodeConflictError` / `WorkMenuCodeConflictError`、共に postgres 23505 を catch して raise。stores と同一パターン

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.5 work_categories + work_menus CRUD | **Claude 自実装 (handoff §76 推奨 + ユーザー確認)** |

→ A.5 も Codex 試行ゼロで Claude 完遂。block override 記録 12 件 (本 Phase 全 Write が観測対象、内容: 仕様判断量明示時の自実装)。

## Phase 64-A.6 入力契約

### 参照すべきファイル

- 本 handoff (`phase-64-a5-work-categories-menus-sealed.md`)
- `phase-64-a4-stores-sealed.md` (A.4 canonical CRUD)
- `phase-64-a3-customers-sealed.md` (A.3 canonical CRUD)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- `src/lib/services/work-categories.ts` (hard delete + listAllForSelect helper の canonical)
- `src/lib/services/work-menus.ts` (階層 FK + soft delete + join の canonical)
- 残 MVP blocker は Phase 63 step2 §C 残 18 件 (A.5 で work_categories + work_menus 2 件消化)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1/A.2/A.3/A.4/A.5 機能すべてに retrogression なし
- typecheck clean / 29 test files / **222 tests PASS**
- CI E2E 7/7 PASS
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.5 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- vehicle_ownerships の isPrimary 排他 / ends_on 自動更新 trigger は **依然 DB 未実装**、A.6 でも trigger 追加禁止
- `work_categories` は schema に deletedAt なし → A.6 以降も deletedAt 追加禁止 (raw-migration 変更しない)

### Phase 64-A.6 着手時の最初の判断

1. **次の MVP blocker 選定**: Phase 63 step2 §C 18 件のうち残候補:
   - **statuses マスタ CRUD** (表示順 / 色コード等、seed 既存に注意)
   - **lane_types + lanes CRUD** (店舗紐付け二階層、stores 既実装で統合可)
   - **lane_work_menus** (lane と work_menu の関連マスタ、A.5 で work_menus 完成のため接続可能)
2. **Codex 委任の再試行**: A.2 で 3 連続 sandbox-blocked、A.3/A.4/A.5 はスキップ。A.6 でも再試行価値は低い見込み、Claude 直接実装デフォルトで OK
3. canonical mirror:
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 階層 / FK 関連あり → `work-menus.ts` (FK SET NULL + join select) を参考
   - hard delete (deletedAt なし) → `work-categories.ts`
4. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定
5. seed 既存マスタ (statuses 等) は raw-migration `03_roles_statuses.sql` に注意、CRUD で衝突回避

### 想定規模 (Phase 64-A.6 例: lane_types + lanes CRUD)

| 指標 | 値 |
|---|---|
| 新規ファイル | 12-14 (2 マスタ、lane は store FK 紐付け) |
| 想定行数 | 1000-1300 (work_menus と同等、二階層) |
| 想定 tests 追加 | 10-12 ケース (CRUD x2 + FK + store join + lane_working_hours 連動) |
| 完了後 tests 合計 | 232+ |
| 仕様判断量 | 中 (lane の store_id FK + lane_working_hours 関連の扱い) |

### 注意点

- lanes は `store_id NOT NULL REFERENCES stores(id) ON DELETE CASCADE` → 親 store soft delete (deletedAt) では cascade されない (実 DELETE 時のみ)。テストで明示挙動確認推奨
- lane_working_hours は lane CRUD と分離してもよいが、A.6 では lanes detail で営業時間表示のみで mvp 通過可
- statuses は code UNIQUE 検証、seed 既存と衝突しないよう test fixture で別 company 利用

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.5 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 12 新規 (service x2 / UI x10) + 2 (test) + 1 (本 sealed) = 15 files |
| 新規 service 関数 | 11 (categories 5 + menus 5 + listAllForSelect) + 2 error class |
| advisor 呼び出し | 1 (seal 直前、確認用) |
| Codex 委任 task 数 | 0 (handoff §76 推奨 + ユーザー確認でスキップ) |
| Codex 採用率 | 0/0 (A.5 単体)、累積 1/5 (A.1-A.5) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3/A.4/A.5 試行なし) |
| 新規 tests | 12 cases / 387 行 (CRUD x10 + UNIQUE x2 + FK SET NULL x1 + sortOrder/filter x3 合算) |
| invariants 維持 | typecheck clean / 222 tests / E2E 7/7 |
| MVP blocker 消化 | 累積 6/24 (service_tickets + vehicles + customers + stores + work_categories + work_menus) |

## 振り返りメモ

- **階層 FK の canonical 確立**: `work_categories` (hard delete) → `work_menus` (FK SET NULL + soft delete) の 2 階層パターンを確立。今後 statuses / lane_types など類似の親子マスタで再利用可能
- **listAllForSelect helper**: form select 用の軽量取得を service 層に切り出し、UI と service の責務分離維持。次の階層マスタ (lane_types) でも同パターン適用予定
- **hard delete vs soft delete 混在**: 同 Phase 内で削除戦略が異なるマスタを扱った初例。schema 由来 (deletedAt 列の有無) で機械的に決まるため設計判断量は低い。「`deletedAt` 列があれば soft、なければ hard」が canonical 化
- **FK SET NULL の DB 連動検証**: integration test で実 DB cascade 挙動を検証する重要パターン。drizzle ORM の `references({ onDelete: "set null" })` と raw-migration の挙動が一致することを確認できた (今後の階層 FK 系で必須テスト)
- **handoff §76 推奨の効果継続**: A.3/A.4 と同様、Claude 直接実装で 1 ターン完遂。canonical mirror が確立した MVP CRUD では Claude 直接実装が圧倒的に高効率 (A.6 以降も同方針継続が妥当)

---

*Phase 64-A.5 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.6 (候補: lane_types+lanes / statuses / lane_work_menus、本 branch `phase-64-mvp-implementation` 継続)*
