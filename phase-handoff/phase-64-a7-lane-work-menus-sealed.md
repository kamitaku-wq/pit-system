# Phase 64-A.8 入力契約: Phase 64-A.7 lane_work_menus sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.7 (前: 64-A.6 lane_types + lanes sealed) |
| 状態 | **sealed** (lane_work_menus service + lane detail サブセクション + integration tests / 243 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §95 推奨に従い直接実装、Codex 試行スキップ) |
| 前 handoff | `phase-64-a6-lane-types-lanes-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |

## 達成したこと (Phase 64-A.7)

- 1 ファイル新規 (service `lane-work-menus.ts` / 約 140 行)
- 既存 UI 拡張: `src/app/admin/lanes/[id]/page.tsx` (+90 行、カテゴリ別 multi-checkbox UI)、`actions.ts` (+18 行、replaceLaneWorkMenusAction)
- integration test 1 ファイル新規 (8 ケース、CRUD + tenant + UNIQUE + CASCADE 2 方向 + listSelect)
- 既存 schema / RLS / raw-migration 変更 **0**
- 既存 service 関数の挙動変更 **0** (純粋追加のみ)
- typecheck clean (Set<string> 明示注釈で TS2345/TS2769 を修正、最終一発通過)
- **243 tests PASS** (235 + 新規 8 ケース、目標 241+ 超過達成)
- canonical pattern: **M:N replace transaction** = 新規パターン確立 (`replaceLaneWorkMenus` = tenant 検証 + diff 計算 + transaction delete/insert)

## Phase 64-A.7 で実装したファイル

| path | 行数 | 種別 |
|---|---|---|
| `src/lib/services/lane-work-menus.ts` | 140 | service (M:N replace + listSelect + listIds) |
| `src/app/admin/lanes/[id]/page.tsx` | +90 | 「対応作業メニュー」セクション追加 (カテゴリ別 multi-checkbox) |
| `src/app/admin/lanes/[id]/actions.ts` | +18 | `replaceLaneWorkMenusAction` 追加 |
| `tests/integration/services/lane-work-menus.integration.test.ts` | 290 | 8 cases |

独立 admin 画面は作成せず、lane detail 内サブセクションで一本化 (handoff §117 推奨どおり)。

## Claude 側の主要設計判断

1. **M:N replace パターン採用**: 個別 add/remove API ではなく `replaceLaneWorkMenus(laneId, workMenuIds[])` 一括差し替え。チェックボックス UI 保存と相性が良く、トランザクション境界が明確。diff (add/remove/kept) を返してログ可能
2. **tenant 検証 2 段階**: ① lane が companyId に属するか (LaneNotFoundError) ② 渡された workMenuId 群が全て companyId 内の active menu か (WorkMenuNotInCompanyError)。M:N 中間テーブルの companyId は両親と一致する必要があるため事前検証
3. **soft delete メニューは select から除外**: `listWorkMenusForLaneSelect` は `isNull(workMenus.deletedAt)` で active のみ返却。既に紐付け済みの soft-deleted menu は detail の `currentMenuIdSet` に残るが select に出てこないため、保存時に自動で外れる挙動 (意図通り、UI に「無効」表示は不要)
4. **CASCADE は raw delete のみ発火**: `deleteLane` / `deleteWorkMenu` は soft delete (deletedAt set) のため CASCADE 不発火、関連レコード残存。test では `outerTx.execute(sql\`DELETE FROM ...\`)` で hard delete を発火させ CASCADE を検証 (soft delete でも残存することを明示)
5. **UI はカテゴリ別グルーピング**: `groupMenusByCategory` でカテゴリ昇順 + 未分類は最後、各グループ内は menu 名昇順。fieldset/legend でアクセシビリティ確保
6. **dedupe 入力**: `Array.from(new Set(parsed.workMenuIds))` で重複 ID を排除。フォームの multi-select で重複は来ないはずだが防御的に
7. **savepoint パターン**: outer transaction 内で nested `tx.transaction()` を呼ぶと postgres-js は SAVEPOINT を発行。test の `withRollback` + service の internal transaction が正しくスタックする (`outerTx → service tx (savepoint) → expected throw`)
8. **TS 型注釈の明示**: drizzle の戻り値は generic で TS が `unknown` に推論する場合があり、Set<string> / Array<{workMenuId:string}> を明示して TS2345/TS2769 を回避

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.7 lane_work_menus | **Claude 自実装 (handoff §95 推奨 + ユーザー確認)** |

→ A.7 も Codex 試行ゼロで Claude 完遂。block override 記録 3 件 (service + UI 2 箇所、内容: M:N canonical 新規確立による仕様判断量低-中の自実装)。

## Phase 64-A.8 入力契約

### 参照すべきファイル

- 本 handoff (`phase-64-a7-lane-work-menus-sealed.md`)
- `phase-64-a6-lane-types-lanes-sealed.md` (A.6 lane canonical)
- `src/lib/services/lane-work-menus.ts` (M:N replace canonical)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker は Phase 63 step2 §C 残 15 件 (A.7 で lane_work_menus 消化、累積 9/24)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.7 機能すべてに retrogression なし
- typecheck clean / 32 test files / **243 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.7 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- vehicle_ownerships の isPrimary 排他 / ends_on 自動更新 trigger は **依然 DB 未実装**、A.8 でも trigger 追加禁止
- `lane_types` schema は deletedAt なし、A.8 以降も追加禁止 (raw-migration 不変)
- lane_work_menus の M:N は「lane detail 内で replace」のみ、独立 admin 画面は作成禁止
- lanes UI で store 変更は禁止 (新規 + 旧削除フロー)

### Phase 64-A.8 着手時の最初の判断

1. **次の MVP blocker 選定**: Phase 63 step2 §C 残候補:
   - **lane_working_hours** (lane の営業時間、lane detail 内に従属的に表示、A.7 と類似 UI 配置)
   - **statuses マスタ CRUD** (表示順 / 色コード、seed 既存に注意)
   - **roles マスタ CRUD** (admin/vendor role、auth 影響大)
   - **store_business_hours / store_holidays** (store detail 内サブ、優先度中)
2. **Codex 委任の再試行**: A.2 で 3 連続 sandbox-blocked、A.3-A.7 はスキップ。A.8 でも再試行価値は低い見込み、Claude 直接実装デフォルトで OK
3. canonical mirror:
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし) → `lane-types.ts` または `work-categories.ts`
   - **M:N 関連 → `lane-work-menus.ts` (A.7 で確立、replace transaction pattern)**
   - 親 1:N サブ (順序 + 曜日) → 新規パターン確立必要 (lane_working_hours / store_business_hours)
4. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定
5. seed 既存マスタ (statuses, roles) は raw-migration `03_roles_statuses.sql` に注意、CRUD で seed 上書き衝突回避

### 想定規模 (Phase 64-A.8 例: lane_working_hours)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1-2 (service + integration test、UI は lane detail 拡張) |
| 想定行数 | 400-600 |
| 想定 tests 追加 | 5-7 ケース (CRUD + UNIQUE (lane, day_of_week) + tenant + cascade) |
| 完了後 tests 合計 | 248+ |
| 仕様判断量 | **低-中** (順序付き 1:N、曜日 enum / start_at/end_at validation あり) |

### 注意点

- `lane_working_hours` は `(lane_id, day_of_week)` UNIQUE、ON DELETE CASCADE → 物理削除のみ (soft delete 列なし想定、要 schema 確認)
- A.7 の `replaceLaneWorkMenus` パターンを継承可能だが、行ごとに start_at/end_at が異なるため「全行差し替え」より「曜日ごと upsert」が UX 自然 (要判断)
- 表現 UI: lane detail 内に「営業時間」セクション → 曜日 7 行の table (start_at / end_at / is_closed トグル)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.7 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 2 既存拡張 (UI + actions) + 1 新規 test + 1 sealed = 5 files |
| 新規 service 関数 | 3 (listWorkMenuIdsByLaneId / listWorkMenusForLaneSelect / replaceLaneWorkMenus) + 2 error class |
| advisor 呼び出し | 0 (canonical 新規確立だが UI 判断は事前にユーザー確認済) |
| Codex 委任 task 数 | 0 (handoff §95 推奨でスキップ) |
| Codex 採用率 | 0/0 (A.7 単体)、累積 1/7 (A.1-A.7) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.7 試行なし) |
| 新規 tests | 8 cases / 290 行 |
| invariants 維持 | typecheck clean / 243 tests / 32 test files |
| MVP blocker 消化 | 累積 9/24 (service_tickets + vehicles + customers + stores + work_categories + work_menus + lane_types + lanes + lane_work_menus) |

## 振り返りメモ

- **M:N replace canonical 確立**: `replaceLaneWorkMenus` で tenant 2 段検証 + diff 計算 + transaction delete/insert のパターン確立。今後の同様 M:N (例: lane_work_menus 以外で必要なら status_transitions 等) で再利用可能
- **soft vs hard delete の CASCADE 挙動を test で明示**: deletedAt set は CASCADE 発火しない (FK 制約は実レコード削除のみ反応)。raw `DELETE FROM lanes WHERE id = ...` でのみ発火することを test で明示し、運用上の罠を回避
- **UI カテゴリグルーピング**: `groupMenusByCategory` は work_menus.ts と同じ category 軸でグルーピング。fieldset/legend で a11y を確保、grid layout は sm:cols-2 / lg:cols-3 でレスポンシブ
- **drizzle 戻り値の TS 型注釈**: drizzle の select は generic 推論で TS が unknown を返す場合あり、`as Array<{...}>` キャスト + `Set<string>` 明示でコンパイル通過。今後の M:N / select 関連 service で同パターン適用予定
- **handoff §95 推奨の効果継続**: A.3-A.7 と Claude 直接実装で 5 連続 1 ターン完遂。canonical mirror 確立済の MVP CRUD では Claude 直接実装が圧倒的に高効率 (A.8 以降も同方針継続)

---

*Phase 64-A.7 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.8 (候補: lane_working_hours / statuses / roles / store_business_hours、本 branch `phase-64-mvp-implementation` 継続)*
