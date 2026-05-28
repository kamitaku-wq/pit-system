# Phase 64-A.5 入力契約: Phase 64-A.4 stores sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.4 (前: 64-A.3 customers sealed) |
| 状態 | **sealed** (stores CRUD + admin UI + integration tests / 210 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §76 推奨に従い直接実装、Codex 試行スキップ) |
| 前 handoff | `phase-64-a3-customers-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |

## 達成したこと (Phase 64-A.4)

- 7 ファイル新規 (service / page x3 / actions x2 / integration test): 約 650 行
- 既存 schema / RLS / raw-migration / 既存 service すべて変更 **0** (禁止ファイル群 untouched)
- typecheck clean (一発通過、エラー 0)
- **210 tests PASS** (204 + 新規 6 ケース、目標 208+ 超過達成)
- canonical pattern (`customers.ts`) を mirror、UNIQUE 制約 (company_id, code) と isActive boolean を追加対応
- admin sidebar (`admin-shell.tsx`) は変更なし (canonical A.1-A.3 と一貫)

## Phase 64-A.4 で実装したファイル

| path | 行数 | 種別 |
|---|---|---|
| `src/lib/services/stores.ts` | 199 | service (zod / CRUD / list / getById / StoreCodeConflictError) |
| `src/app/admin/stores/page.tsx` | 174 | list page (server component, q + isActive filter) |
| `src/app/admin/stores/new/page.tsx` | 75 | 新規作成 form (isActive select 含む) |
| `src/app/admin/stores/new/actions.ts` | 47 | `createStoreAction` (boolean form value 対応) |
| `src/app/admin/stores/[id]/page.tsx` | 138 | 詳細・編集 (isActive 状態表示) |
| `src/app/admin/stores/[id]/actions.ts` | 59 | update / delete (soft) actions |
| `tests/integration/services/stores.integration.test.ts` | 198 | 6 cases (CRUD + tenant + q + UNIQUE conflict) |

## Claude 側の主要設計判断

1. **Claude 直接実装 (Codex 試行スキップ)**: handoff §76 で「A.4 でも再試行価値は低い見込み、Claude 直接実装デフォルトで OK」と推奨されており、ユーザー確認の上スキップ。block override 記録 7 件 (本 Phase 全 Write が観測対象)
2. **`StoreCodeConflictError` カスタムエラー**: UNIQUE (company_id, code) 違反時の postgres エラーコード `23505` を service 層で検出し、専用エラー型に変換。actions 層では catch せず Next.js error boundary に委譲 (canonical pattern 維持、redirect 例外を try/catch で潰さない)
3. **savepoint で UNIQUE 違反を隔離**: integration test の duplicate code 検証では outer transaction が abort されるため `outerTx.transaction(savepoint => createStore(...))` でラップ。同一 outer transaction 内で別 company の許容ケースも続けて検証可能
4. **isActive boolean filter**: list page に `?isActive=active|inactive` 絞り込みを追加。customers と異なる stores 固有の UX 要素 (有効/無効の運用判断が頻発するため)
5. **soft delete 採用**: `stores.deletedAt` 列が schema / raw-migration 双方に存在、許可された判断 §soft delete に従い hard delete でなく `updated_at + deleted_at セット` で実装
6. **list の検索**: `q` 単一パラメータで name / code / address / phone を ILIKE 部分一致 (customers と同パターン)
7. **detail と list で同列**: stores は notes 等の長文列がないため `selectListColumns` のみで detail も賄える (customers は notes 用に detail 列分離していたが stores は不要)

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.4 stores CRUD | **Claude 自実装 (handoff §76 推奨 + ユーザー確認)** |

→ A.4 も Codex 試行ゼロで Claude 完遂。block override 記録 7 件 (本 Phase 全 Write が観測対象)。

## Phase 64-A.5 入力契約

### 参照すべきファイル

- 本 handoff (`phase-64-a4-stores-sealed.md`)
- `phase-64-a3-customers-sealed.md` (A.3 canonical CRUD)
- `phase-64-a2-vehicles-sealed.md` (A.2 transferOwnership pattern)
- `phase-64-a1-service-tickets-sealed.md` (A.1 canonical pattern)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- `src/lib/services/stores.ts` / `customers.ts` / `vehicles.ts` / `service-tickets.ts` (canonical mirror 元)
- 残 MVP blocker は Phase 63 step2 §C 残 20 件 (整備伝票 + 車両 + 顧客 + 店舗 = 4 件消化済)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1/A.2/A.3/A.4 機能すべてに retrogression なし
- typecheck clean / 27 test files / **210 tests PASS**
- CI E2E 7/7 PASS
- 既存 invariants 全件 (Phase 43-63a / 64-A.1/A.2/A.3 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- vehicle_ownerships の isPrimary 排他 / ends_on 自動更新 trigger は **依然 DB 未実装**、A.5 でも trigger 追加禁止

### Phase 64-A.5 着手時の最初の判断

1. **次の MVP blocker 選定**: Phase 63 step2 §C 24 件のうち消化済 4 件、次の候補:
   - **work_categories / work_menus CRUD** (整備作業マスタ系、階層構造あり)
   - **statuses マスタ CRUD** (表示順 / 色コード等の追加列の可能性)
   - **lane_types / lanes CRUD** (店舗紐付けのある二階層、stores 既実装なので統合可)
2. **Codex 委任の再試行**: A.2 で 3 連続 sandbox-blocked、A.3/A.4 はスキップ。A.5 でも再試行価値は低い見込み、Claude 直接実装デフォルトで OK
3. canonical mirror:
   - 単純 CRUD → `customers.ts` (joined なし) or `stores.ts` (UNIQUE 制約 + isActive あり)
   - 階層 / 親子関係あり → `vehicles.ts` (vehicle_ownerships 同伴 transferOwnership) を参考
4. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定
5. spec ドリフト (data-model.md §3.x §6.x) は次の MVP blocker でも個別に確認、drizzle + raw-migration を真の源として参照

### 想定規模 (Phase 64-A.5 例: work_categories + work_menus CRUD)

| 指標 | 値 |
|---|---|
| 新規ファイル | 7-14 (2 マスタ統合か単独か判断次第) |
| 想定行数 | 400-1000 (単独 stores 同等 ～ 階層 2 つで倍) |
| 想定 tests 追加 | 5-10 ケース (CRUD x2 + 階層 FK + 親削除挙動) |
| 完了後 tests 合計 | 215+ |
| 仕様判断量 | 中 (階層構造があれば親削除時の子挙動を判断、それ以外は低) |

### 注意点

- work_categories と work_menus は FK で繋がる (menus → categories)、親 soft delete 時の子の扱いを設計判断
- statuses は seed が既に存在する可能性 (raw-migration `03_roles_statuses.sql`)、CRUD で seed 衝突しないよう code UNIQUE 検証必要
- UNIQUE 制約のある列 (code 等) は stores.ts pattern (StoreCodeConflictError) を mirror
- savepoint pattern (`outerTx.transaction(savepoint => ...)`) は UNIQUE conflict test の標準形として A.5 でも適用

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.4 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 7 新規 (service / UI / test) + 1 (本 sealed) = 8 files |
| 新規 service 関数 | 5 (`createStore` / `updateStore` / `deleteStore` / `listStores` / `getStoreById`) + 1 error class (`StoreCodeConflictError`) |
| advisor 呼び出し | 0 (canonical mirror が明確、判断保留点なし) |
| Codex 委任 task 数 | 0 (handoff §76 推奨 + ユーザー確認でスキップ) |
| Codex 採用率 | 0/0 (A.4 単体)、累積 1/4 (A.1-A.4) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3/A.4 試行なし) |
| 新規 tests | 6 cases / 198 行 (CRUD 4 + q filter 1 + UNIQUE conflict 1) |
| invariants 維持 | typecheck clean / 210 tests / E2E 7/7 |
| MVP blocker 消化 | 累積 4/24 (service_tickets + vehicles + customers + stores) |

## 振り返りメモ

- **canonical CRUD pattern の安定化**: A.1-A.4 で 4 つの単純 CRUD を書き、`zod input / normalizeNullable / selectListColumns / soft delete via and(eq, isNull(deletedAt))` が完全に定型化。次以降はファイル名と列差分だけで作業可能
- **UNIQUE 制約処理の確立**: `StoreCodeConflictError` + postgres code 23505 検出 + savepoint test の 3 点セットで UNIQUE 違反 CRUD の標準パターンを確立。今後 code 列を持つマスタ (statuses 等) で再利用
- **isActive boolean filter**: stores 固有の有効/無効切替を list filter に組み込み。UX 拡張が canonical CRUD の枠を破らない形でできた (filter 引数追加 + select option 追加のみ)
- **handoff §76 推奨の効果**: A.3 と同様、Claude 直接実装で 1 ターン完遂。canonical mirror が確立した MVP CRUD では Claude 直接実装が圧倒的に高効率 (A.5 以降も同方針継続が妥当)

---

*Phase 64-A.4 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.5 (候補: work_categories+menus / statuses / lane_types+lanes、本 branch `phase-64-mvp-implementation` 継続)*
