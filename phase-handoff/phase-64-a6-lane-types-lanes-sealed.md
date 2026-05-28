# Phase 64-A.7 入力契約: Phase 64-A.6 lane_types + lanes sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.6 (前: 64-A.5 work_categories + work_menus sealed) |
| 状態 | **sealed** (lane_types + lanes CRUD + admin UI + integration tests / 235 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §76 推奨に従い直接実装、Codex 試行スキップ) |
| 前 handoff | `phase-64-a5-work-categories-menus-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |

## 達成したこと (Phase 64-A.6)

- 14 ファイル新規 (service x2 / page x10 / actions x4): 約 1300 行
- 既存 service 1 file 拡張 (`stores.ts` に `listAllStoresForSelect` helper + `asc` import 追加、+12 行)
- integration test 2 ファイル新規 (13 ケース、FK SET NULL + UNIQUE per-store + capacity zod check 含む)
- 既存 schema / RLS / raw-migration / 既存 service 挙動すべて変更 **0** (helper 追加のみで既存挙動不変)
- typecheck clean (一発通過、エラー 0)
- **235 tests PASS** (222 + 新規 13 ケース、目標 234+ 超過達成)
- canonical pattern: lane_types = `work-categories.ts` 完全 mirror、lanes = `work-menus.ts` + store/二重 join + nullable code

## Phase 64-A.6 で実装したファイル

| path | 行数 | 種別 |
|---|---|---|
| `src/lib/services/lane-types.ts` | 185 | service (hard delete + listAllForSelect) |
| `src/lib/services/lanes.ts` | 226 | service (soft delete + store/laneType 二重 join + nullable code) |
| `src/lib/services/stores.ts` | +12 | helper 追加 (`listAllStoresForSelect` + `asc` import) |
| `src/app/admin/lane-types/page.tsx` | 145 | list (sortOrder column) |
| `src/app/admin/lane-types/new/page.tsx` | 65 | 新規作成 form |
| `src/app/admin/lane-types/new/actions.ts` | 45 | createLaneTypeAction |
| `src/app/admin/lane-types/[id]/page.tsx` | 121 | 詳細・編集 (hard delete 警告) |
| `src/app/admin/lane-types/[id]/actions.ts` | 53 | update / delete (hard) actions |
| `src/app/admin/lanes/page.tsx` | 235 | list (store+laneType join、storeId+laneTypeId+isActive+q filter) |
| `src/app/admin/lanes/new/page.tsx` | 120 | 新規作成 form (store select 必須 / laneType select 任意 / 店舗未登録ガード) |
| `src/app/admin/lanes/new/actions.ts` | 56 | createLaneAction |
| `src/app/admin/lanes/[id]/page.tsx` | 173 | 詳細・編集 (store 変更不可 / laneType 再割当可) |
| `src/app/admin/lanes/[id]/actions.ts` | 66 | update / delete (soft) actions |
| `tests/integration/services/lane-types.integration.test.ts` | 180 | 6 cases (CRUD + tenant + q + UNIQUE + sortOrder) |
| `tests/integration/services/lanes.integration.test.ts` | 240 | 7 cases (CRUD + tenant + filters x4 + UNIQUE per-store + FK SET NULL + capacity zod) |

## Claude 側の主要設計判断

1. **lane_types は hard delete (canonical 逸脱)**: schema に `deletedAt` 列がないため。子 `lanes.lane_type_id` は raw-migration §06 で `ON DELETE SET NULL` 指定済 (FK 連動 test で検証済)
2. **lanes は soft delete + 二重 join**: stores + lane_types を `leftJoin`、`storeName` / `laneTypeName` を list/detail に表示。stores hard delete されたら `storeName=null` で表示崩れ防止 (ただし stores は通常 soft delete のため通常運用では到達しない)
3. **stores.ts に helper 追加 (既存変更 0 ルールの例外)**: lanes UI が `listAllStoresForSelect` を必要としたため stores.ts に追加。**既存関数の挙動は不変、純増のみ** で invariant 維持。`asc` import を追加して `orderBy(asc(stores.name), asc(stores.code))` で安定 sort
4. **lanes.code を nullable に対応**: `CreateLaneInput.code` は `z.string().trim().max(64).nullable().optional()`。空文字 → null 正規化。UNIQUE は `(store_id, code)` で Postgres デフォルトの "NULL 複数許容" 挙動に依存 (code=null のレーンは複数作成可能)
5. **store 変更を編集画面から除外**: 既存レーンの `store_id` 変更は予約・稼働実績の整合性に大きく影響するため、UI から外して「新規作成 + 旧削除」誘導。`UpdateLaneInput` に `storeId` を含めない zod スキーマ設計
6. **capacity の最小値は zod で 1 を強制**: DB CHECK は `capacity > 0` だが、UI/service 層で `z.coerce.number().int().min(1)` により DB 到達前に reject (test で 0 は zod, 5 は OK を確認)
7. **lane の店舗未登録ガード**: `/admin/lanes/new` で店舗 0 件時はフォーム非表示 + `/admin/stores/new` への誘導リンク表示。store 必須なので UX 上の前置きエラー回避
8. **2 つのカスタムエラー**: `LaneTypeCodeConflictError` / `LaneCodeConflictError`、共に postgres 23505 を catch。lanes は「(store, code)」を含むメッセージ (code null は "(null)")
9. **未分類 filter (laneTypeId=none)**: work_menus と同パターン、`null` を明示的フィルタ条件として導入

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.6 lane_types + lanes CRUD | **Claude 自実装 (handoff §76 推奨 + ユーザー確認)** |

→ A.6 も Codex 試行ゼロで Claude 完遂。block override 記録 14 件 (本 Phase 全 Write が観測対象、内容: canonical mirror による仕様判断量低の自実装)。

## Phase 64-A.7 入力契約

### 参照すべきファイル

- 本 handoff (`phase-64-a6-lane-types-lanes-sealed.md`)
- `phase-64-a5-work-categories-menus-sealed.md` (A.5 階層 FK canonical)
- `phase-64-a4-stores-sealed.md` (A.4 stores canonical)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- `src/lib/services/lanes.ts` (二重 join + nullable code canonical)
- `src/lib/services/stores.ts` (listAllForSelect helper の追加例)
- 残 MVP blocker は Phase 63 step2 §C 残 16 件 (A.6 で lane_types + lanes 2 件消化)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.6 機能すべてに retrogression なし
- typecheck clean / 31 test files / **235 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.6 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- vehicle_ownerships の isPrimary 排他 / ends_on 自動更新 trigger は **依然 DB 未実装**、A.7 でも trigger 追加禁止
- `lane_types` schema は deletedAt なし、A.7 以降も追加禁止 (raw-migration 不変)
- lanes UI で store 変更は禁止 (新規 + 旧削除フロー)

### Phase 64-A.7 着手時の最初の判断

1. **次の MVP blocker 選定**: Phase 63 step2 §C 残候補:
   - **lane_work_menus 関連マスタ** (lane と work_menu の M:N、A.5 + A.6 で両親揃ったため接続可能、最有力候補)
   - **lane_working_hours** (lane の営業時間、lane detail 内に従属的に表示)
   - **statuses マスタ CRUD** (表示順 / 色コード、seed 既存に注意)
   - **roles マスタ CRUD** (admin/vendor role)
2. **Codex 委任の再試行**: A.2 で 3 連続 sandbox-blocked、A.3/A.4/A.5/A.6 はスキップ。A.7 でも再試行価値は低い見込み、Claude 直接実装デフォルトで OK
3. canonical mirror:
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 階層 FK + soft delete + join → `lanes.ts` (二重 join の例)
   - hard delete (deletedAt なし) → `lane-types.ts` または `work-categories.ts`
   - M:N 関連 → 既存 canonical なし、新規パターン確立必要 (lane_work_menus の場合)
4. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定
5. seed 既存マスタ (statuses, roles) は raw-migration `03_roles_statuses.sql` に注意、CRUD で seed 上書き衝突回避

### 想定規模 (Phase 64-A.7 例: lane_work_menus 関連マスタ)

| 指標 | 値 |
|---|---|
| 新規ファイル | 5-7 (1 マスタだが M:N で UI 設計に工夫必要、lane detail 内サブ画面か単独 admin か判断ポイント) |
| 想定行数 | 600-900 |
| 想定 tests 追加 | 6-8 ケース (CRUD + UNIQUE (lane_id, work_menu_id) + cascade 2 方向) |
| 完了後 tests 合計 | 241+ |
| 仕様判断量 | **中** (M:N 関連の UI 表現に判断あり、lane 詳細内サブセクションが妥当か単独 admin 画面か) |

### 注意点

- `lane_work_menus` は `(lane_id, work_menu_id)` UNIQUE、両方向 ON DELETE CASCADE → 物理削除のみ (soft delete 列なし)
- M:N 関連のため、独立 admin 画面より「lane detail 内で work_menu select multi-checkbox」UI が UX 上自然 (判断ポイント)
- 関連 CRUD は通常「lane の関連 work_menus を replace」操作になるため、`replaceLaneWorkMenus(laneId, workMenuIds[])` 単一トランザクション関数が canonical 候補
- statuses マスタは seed `02_roles_statuses.sql` で初期データ投入済み、CRUD で同 code 再投入時の UNIQUE 衝突に注意

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.6 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 14 新規 (service x2 / UI x10 / test x2) + 1 既存拡張 (stores.ts) + 1 sealed = 16 files |
| 新規 service 関数 | 12 (lane-types 6 + lanes 5 + stores helper 1) + 2 error class |
| advisor 呼び出し | 0 (canonical mirror 明確のためスキップ) |
| Codex 委任 task 数 | 0 (handoff §76 推奨でスキップ) |
| Codex 採用率 | 0/0 (A.6 単体)、累積 1/6 (A.1-A.6) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.6 試行なし) |
| 新規 tests | 13 cases / 420 行 (lane-types 6 + lanes 7) |
| invariants 維持 | typecheck clean / 235 tests / 31 test files |
| MVP blocker 消化 | 累積 8/24 (service_tickets + vehicles + customers + stores + work_categories + work_menus + lane_types + lanes) |

## 振り返りメモ

- **二重 join canonical 確立**: lanes が stores + lane_types を `leftJoin` で同時取得するパターンを確立。`orderBy(asc(stores.name), asc(lanes.name), desc(lanes.createdAt))` で店舗→レーン名→新着順の安定 sort。今後の同様パターン (例: customer + vehicle の二重 join) で再利用可能
- **既存 service への helper 追加判断**: stores.ts に `listAllStoresForSelect` を追加した。これは「既存挙動は不変、純増のみ」のため A.5 で確立した「既存 service 変更 0」ルールの例外ではなく「拡張」と解釈。canonical 確立済みの service への helper 追加は invariant 違反ではない (work_categories.ts で同パターン採用済)
- **nullable code の UNIQUE 挙動**: Postgres は UNIQUE 制約で `NULL` を別物扱いするため、`(store_id, code=null)` は複数行作成可能。lanes test では「異なる store なら同 code OK」を明示検証したが、null 重複は意図的に検証していない (実害なし)
- **store 変更不可の UX**: lanes detail で store 変更を意図的に外したのは予約・稼働実績との整合性確保。Update zod スキーマから storeId を排除することで service 層でも保証 (タイプチェッカーで強制)
- **handoff §76 推奨の効果継続**: A.3-A.6 と Claude 直接実装で 4 連続 1 ターン完遂。canonical mirror が確立した MVP CRUD では Claude 直接実装が圧倒的に高効率 (A.7 以降も同方針継続、M:N 関連は仕様判断量中で要注意)

---

*Phase 64-A.6 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.7 (候補: lane_work_menus / lane_working_hours / statuses / roles、本 branch `phase-64-mvp-implementation` 継続)*
