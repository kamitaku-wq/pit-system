# Phase 64-A.18 入力契約: Phase 64-A.17 status_transitions sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.17 (前: 64-A.16 statuses sealed) |
| 状態 | **sealed** (status_transitions マスタ CRUD per-row with UNIQUE + from=NULL 許容 + 自己参照許容 + admin UI list/new/detail + integration tests / 347 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §66 推奨に従い statuses canonical 流用、15 連続 1 ターン完遂継続、Codex 試行スキップ) |
| 前 handoff | `phase-64-a16-statuses-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |
| **/clear 推奨** | **本 Phase 完了後、statuses → status_transitions で同 domain 内完了、A.18 で次 domain (roles/permissions or customer_reservation_tokens) 着手の自然な境界、`/clear` 推奨を発出** |

## 達成したこと (Phase 64-A.17)

- 1 ファイル新規 service (`status-transitions.ts` 約 220 行、statuses mirror + leftJoin で from/to status name 取得)
- 4 ファイル新規 UI (`admin/status-transitions/page.tsx` / `new/page.tsx` / `new/actions.ts` / `[id]/page.tsx` / `[id]/actions.ts`)
- 1 ファイル新規 integration test (8 cases: create with from=NULL / list with leftJoin + cross-tenant / statusType filter / fromStatusId=null filter / update toStatusId+triggersNotification / hard-delete + cross-tenant / UNIQUE 衝突 + 自己参照許容 / Zod statusType + toStatusId UUID invalid)
- 既存 schema / RLS / raw-migration 変更 **0** (drizzle schema 既存 `status_transitions.ts` をそのまま利用)
- 既存 status 系 service (`statuses.ts` 等) 挙動変更 **0**、admin-shell ナビ追加 **0** (settings ハブ経由想定)
- typecheck clean (tsc --noEmit 通過、無出力)
- **347 tests PASS** (339 + 新規 8、43 test files、handoff 想定 346+ クリア)

## Claude 側の主要設計判断

1. **三点突合で drift 確認**: spec §3.8 / raw-migration `03_roles_statuses.sql` / drizzle `status_transitions.ts` 全て一致 (UUID PK + companyId + statusType + fromStatusId nullable FK + toStatusId NOT NULL FK + UNIQUE(company,type,from,to))。drift なし
2. **statuses canonical 完全流用**: per-row CRUD with UNIQUE wrap (StatusTransitionConflictError) pattern を mirror。FK 違反 wrap は子テーブルなしのため不要
3. **fromStatusId=NULL (初期遷移) 許容**: schema が nullable のため、`null` を受け付ける。UI で「(初期遷移 / NULL)」option として表現。フィルタも `fromStatusId: null` を明示指定可能 (`sql\`IS NULL\``)
4. **自己参照 (from=to) 許容**: DB 制約なし → service 層も判断なし。UI でも warn なし (test で許容を明示検証)
5. **leftJoin で from/to status name 取得**: `aliasedTable(statuses, "from_status")` / `"to_status"` の 2 alias で list / detail に name + key を含めて返却。statuses FK 違反 wrap で参照中の削除は防がれるため leftJoin の片側 null は実質「fromStatusId が NULL の初期遷移」のみ
6. **UI 並び (statusType, createdAt desc)**: statuses (statusType, displayOrder, createdAt desc) と統一感、status_transitions に displayOrder 列なしのため createdAt で代替
7. **UI 編集での種別変更不可方針**: detail 編集 form では `statusType` を hidden + 詳細情報パネルでのみ表示。変更したい場合は削除→新規作成。理由: statusType 変更で from/to 候補が変わる UX 複雑性回避 (spec 上は schema 変更可能だが UI 制約で吸収)
8. **error class StatusTransitionConflictError は status-transitions.ts 内定義**: 名前衝突なし、actions alias import 不要

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.17 status_transitions マスタ | **Claude 自実装 (handoff §150 推奨 + 15 連続 1 ターン完遂継続)** |

→ A.17 も Codex 試行ゼロで Claude 完遂。block override 記録 6 件 (service + UI 3 + actions 2 + test)。

## Phase 64-A.18 入力契約 (新セッションで使用)

### 参照すべきファイル

- 本 handoff (`phase-64-a17-status-transitions-sealed.md`)
- `phase-64-a16-statuses-sealed.md` (status 系 canonical: per-row CRUD + UNIQUE 衝突 + FK 違反 wrap)
- `src/lib/services/status-transitions.ts` (per-row CRUD with UNIQUE + leftJoin canonical、複数テーブル alias join 必要な master 系で参照)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker 累積 **19/24** (A.17 で status_transitions 消化、残り 5 件)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.17 機能すべてに retrogression なし
- typecheck clean / 43 test files / **347 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.17 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- `status_transitions` schema は UUID PK + statusType text + fromStatusId nullable FK + toStatusId NOT NULL FK + UNIQUE(company,type,from,to) のまま不変
- status_transitions 削除は hard delete、子テーブルなし FK 違反 wrap 不要
- admin/status-transitions は 3 sub-page (list / new / [id]) 構成、edit/delete は detail 内 form
- detail 編集で statusType は変更不可 (削除→新規作成方針)

### Phase 64-A.18 着手時の最初の判断

1. **次の MVP blocker 選定** (残候補):
   - **roles マスタ CRUD** (auth 影響大、is_system 列あり: handoff §103 ガード可能性、permissions サブテーブル含む)
   - **permissions マスタ CRUD** (roles 子、UNIQUE(role_id, code))
   - **customer_reservation_tokens** (Phase 4 顧客本人確認、token hash + email 検証、新規 token 生成 logic 必要)
   - **attachments** (画像/PDF upload、Supabase Storage 連携必要、外部依存)
2. **A.18 推奨**: `roles マスタ CRUD` (status 系完了で次 domain (auth) 移行が自然、is_system 列でガード実装含み仕様判断量「中」、permissions と分離する場合は 1 ファイル、合体する場合は 2 ファイル)
3. **代替候補**: `customer_reservation_tokens` (Phase 4 先駆け、token 生成 logic 必要 = 仕様判断量「中-高」) または `permissions マスタ単独` (roles 子、UNIQUE(role_id, code))
4. **A.18 着手時の重要 task**: is_system フラグでの seed 行ガード判断 (statuses では schema に is_system なし → FK 違反 wrap のみで担保、roles は is_system あり → UI でガード可能)
5. canonical mirror 状況 (A.17 で leftJoin pattern を追加 = 9 種類カバー):
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 単純 CRUD without UNIQUE → `vendors.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし、FK SET NULL or 子なし) → `lane-types.ts` / `work-categories.ts` / `vendor-sla-overrides.ts` / `vendor-service-areas.ts`
   - hard delete + FK 違反 wrap (子テーブル参照中) → `statuses.ts`
   - **hard delete + leftJoin で関連 name 取得 + nullable FK 許容 → `status-transitions.ts` (A.17 新規 canonical)**
   - M:N 関連 (full diff replace) → `lane-work-menus.ts` / `vendor-available-stores.ts`
   - 親 1:N サブ (full-replace, UNIQUE 有) → `lane-working-hours.ts` / `store-business-hours.ts`
   - 親 1:N サブ (per-row CRUD with UNIQUE) → `store-holidays.ts` / `vendor-sla-overrides.ts`
   - 親 1:N サブ (per-row CRUD with ends_on=NULL 排他) → `vehicle-ownerships.ts`
   - 親 1:N サブ (full-replace, UNIQUE 不在 → wipe + bulk insert) → `vendor-available-days.ts`
   - 親 1:N サブ (per-row CRUD without UNIQUE, 重複許容) → `vendor-service-areas.ts`
6. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定

### 想定規模 (Phase 64-A.18 例: roles マスタ CRUD)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1 service + 1 test + 3-4 UI = 5-6 files |
| 想定行数 | 450-650 |
| 想定 tests 追加 | 7-9 ケース (per-row CRUD + UNIQUE(company,code) 衝突 + cross-tenant + is_system seed ガード判定 + 削除時 FK 違反 wrap (permissions / users から参照) + Zod) |
| 完了後 tests 合計 | 354+ |
| 仕様判断量 | **中** (is_system フラグでの UI ガード仕様 + permissions サブテーブル含めるか判断必要) |

### 注意点

- roles schema は `company_id NULL 許容` (グローバル seed 行用、`ON DELETE CASCADE`)。company_id IS NULL の行は全 tenant 共通の system role で UI で識別可能 → ガード実装可
- is_system フラグも seed 行のマーカー (company_id null + is_system true) → UI で「編集/削除不可」表示
- permissions は roles.id への FK ON DELETE CASCADE 持ち、role 削除で連鎖削除 → FK 違反 wrap 不要 (cascade)
- ただし、users.role_id (Phase 4 で実装予定) からの参照は別途確認、現状 users.role_id がなければ FK 違反は起こらない
- 着手時に必ず raw-migration / spec / drizzle schema の 3 点突合 (handoff §146 推奨継続)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.17 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 4 新規 UI (page + new/page + new/actions + [id]/page + [id]/actions) + 1 新規 test + 1 sealed = **7 files** |
| 新規 service 関数 | 5 (list/create/update/delete/getById) + 1 error class (Conflict) + 1 helper (isUnique) + leftJoin canonical |
| advisor 呼び出し | 0 (statuses canonical 直接流用 + leftJoin pattern は drizzle aliasedTable で自明) |
| Codex 委任 task 数 | 0 (handoff §150 推奨でスキップ) |
| Codex 採用率 | 0/0 (A.17 単体)、累積 1/17 (A.1-A.17) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.17 試行なし) |
| 新規 tests | 8 cases / 約 220 行 (per-row CRUD + UNIQUE 衝突 + 自己参照許容 + leftJoin name 取得 + cross-tenant + Zod) |
| invariants 維持 | typecheck clean / 347 tests / 43 test files |
| MVP blocker 消化 | 累積 19/24 (A.1-A.16 + status_transitions マスタ) |

## 振り返りメモ (status_transitions 完了を経て)

- **leftJoin pattern の canonical 化**: `aliasedTable(statuses, "from_status")` / `"to_status"` の 2 alias で複数 FK 先の name を 1 query で取得。今後の master 系で関連テーブルの label を表示したい場合 (例: `lanes` → `lane_types` の type name 表示、`vendor_sla_overrides` → `customers` の name 表示等) に再利用可能
- **status 系 domain 完遂の手応え**: statuses (A.16) + status_transitions (A.17) で 2 ファイル新規 service。A.16 で確立した canonical を A.17 でほぼそのまま流用、A.17 で新規追加した設計判断は leftJoin と「自己参照許容」「from=NULL 許容」「statusType 編集不可」のみ。同 domain 連続実装はコストが顕著に下がる
- **三点突合の継続的価値**: A.17 で spec / raw-migration / drizzle 3 点突合 → drift なし (A.16 同様 statuses 系は spec 整合)。今後の master CRUD でも 3 点突合は handoff §146 推奨で継続
- **fromStatusId nullable + UNIQUE の挙動確認**: Postgres デフォルトでは NULL は UNIQUE 衝突を起こさない (`NULL ≠ NULL`) ため、`from=NULL, to=X` の行は複数挿入可能。テスト 4 (filter fromStatusId=null) で 1 件のみ挿入し挙動確認、衝突テスト 7 では `from=X, to=Y` の重複のみ検証 (NULL 重複は未検証だが schema 仕様通り)
- **新セッション 1 ターン完遂継続**: A.3-A.17 で 15 連続 1 ターン完遂、handoff の効果実証継続中

## /clear 推奨タイミング (本 Phase 完了時)

**本 Phase A.17 完遂後、`/clear` 推奨を発出**。理由:
- statuses (A.16) → status_transitions (A.17) で status 系 domain 完遂、A.18 では auth (roles/permissions) or Phase 4 系着手見込み
- master 系 canonical (leftJoin pattern) が確立、今後 master CRUD で参照すべき先 (handoff) が固定化
- 本セッション (A.17 単独 1 ターン完遂) はコンテキスト累積少だが、次 domain (auth) 移行で文脈刷新が望ましい

新セッション開始時: `phase-64-a17-status-transitions-sealed.md` を読んで Phase 64-A.18 着手。

---

*Phase 64-A.17 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.18 (推奨: roles マスタ CRUD で is_system フラグガード追加 → 代替: customer_reservation_tokens or permissions 単独、本 branch `phase-64-mvp-implementation` 継続)*
