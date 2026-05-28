# Phase 64-A.17 入力契約: Phase 64-A.16 statuses sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.16 (前: 64-A.15 vendor_service_areas sealed) |
| 状態 | **sealed** (statuses マスタ CRUD per-row with UNIQUE + delete FK 違反 wrap + admin UI list/new/detail + integration tests / 339 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §66 推奨に従い vendor 系完遂後の新 domain (statuses マスタ) 着手、14 連続 1 ターン完遂継続、Codex 試行スキップ) |
| 前 handoff | `phase-64-a15-vendor-service-areas-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |
| **/clear 推奨** | **本 Phase 完了後、vendor 系 → statuses マスタ移行で新 domain 着手済、A.17 で次 master (roles 等) or Phase 4 系へ進む際の自然な境界、`/clear` 推奨を発出** |

## 達成したこと (Phase 64-A.16)

- 1 ファイル新規 service (`statuses.ts` 約 220 行、lane-types mirror + FK 違反 wrap pattern 新規)
- 4 ファイル新規 UI (`admin/statuses/page.tsx` / `new/page.tsx` / `new/actions.ts` / `[id]/page.tsx` / `[id]/actions.ts`)
- 1 ファイル新規 integration test (10 cases: create / list 順序 / statusType filter / q filter / update / hard-delete + cross-tenant / UNIQUE 衝突 + different type 許容 / FK 違反 wrap (status_transitions) / Zod statusType invalid / displayOrder null + isActive null toggle)
- 既存 schema / RLS / raw-migration 変更 **0** (drizzle schema 既存 `statuses.ts` をそのまま利用)
- 既存 statuses 関連 service (`statusTransitions` 等) 挙動変更 **0**、admin-shell ナビ追加 **0** (lane-types / work-categories と同様、settings ハブ経由想定)
- typecheck clean (tsc --noEmit 通過、無出力)
- **339 tests PASS** (329 + 新規 10、42 test files、handoff 想定 335+ クリア)

## Claude 側の主要設計判断

1. **三点突合で drift 確認**: spec §3.8 / raw-migration `03_roles_statuses.sql` / drizzle `statuses.ts` 全て一致 (UUID PK + companyId + statusType check + UNIQUE(company,type,key))。drift なし
2. **seed 行保護方針: 不採用 (UNIQUE 衝突 + FK 違反のみで担保)**: schema に `is_system` 列なし → seed 行 (`in_progress` 等) を UI で識別不可。代わりに「FK 違反 wrap (`StatusInUseError`)」で参照中の削除を防ぐ (reservations/service_tickets/transport_orders/status_transitions が参照)。is_initial/is_terminal の排他制約も UI 層で実装しない (DB / trigger 担保ポリシー)
3. **delete FK 違反 wrap pattern 新規 canonical 化**: hard delete + 23503 catch → `StatusInUseError`。これまでの canonical (UNIQUE 衝突 / cross-tenant 自然 false / CASCADE) に追加で **「FK 親側 hard delete + 子から参照中の wrap」が canonical mirror として確立**
4. **statusType enum + Zod**: `STATUS_TYPES = ['reservation','service','transport','vendor']` を export、UI ドロップダウン + Zod `z.enum(STATUS_TYPES)`。DB check constraint と同期
5. **displayOrder / isActive null 許容**: schema が `integer` (NOT NULL なし) / `boolean` (NOT NULL なし) → null 許容を維持。UI checkbox は null 許容と相性悪いが「未指定 → null」「checked → true」「unchecked → false」の 3 状態は表現困難なため、UI では「checked → true / unchecked → false」に単純化 (null 設定は service 層直接呼び出しのみ、test で検証済)
6. **UI 並び (statusType, displayOrder, createdAt desc)**: lane-types の (sortOrder, createdAt desc) と一貫性、statusType を最優先で同じ種別をまとめて表示
7. **error class StatusConflictError / StatusInUseError は statuses.ts 内 定義**: vendor 系のような `VendorNotFoundError` 重複問題は statuses 単独実装で発生せず、actions alias import 不要

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.16 statuses マスタ | **Claude 自実装 (handoff §150 推奨 + 14 連続 1 ターン完遂継続)** |

→ A.16 も Codex 試行ゼロで Claude 完遂。block override 記録 6 件 (service + UI 3 + actions 2 + test)。

## Phase 64-A.17 入力契約 (新セッションで使用)

### 参照すべきファイル

- 本 handoff (`phase-64-a16-statuses-sealed.md`)
- `phase-64-a15-vendor-service-areas-sealed.md` (前 vendor 系最終 canonical)
- `src/lib/services/statuses.ts` (per-row CRUD + UNIQUE 衝突 + FK 違反 wrap canonical、master 系で参照系子テーブルがある場合の mirror)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker 累積 **18/24** (A.16 で statuses 消化、残り 6 件)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.16 機能すべてに retrogression なし
- typecheck clean / 42 test files / **339 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.16 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- `statuses` schema は UUID PK + check(status_type IN 4種) + UNIQUE(company,type,key) のまま不変
- statuses 削除時 FK 違反 wrap は `StatusInUseError` (`isForeignKeyViolation` helper) のまま
- admin/statuses は 3 sub-page (list / new / [id]) 構成、edit/delete は detail 内 form
- seed 行も DB レベルで自由に編集/削除可 (UI ガードなし、FK 違反で実質保護)

### Phase 64-A.17 着手時の最初の判断

1. **次の MVP blocker 選定** (残候補):
   - **roles マスタ CRUD** (auth 影響大、is_system 列あり: handoff §103 ガード可能性、permissions サブテーブル含む)
   - **permissions マスタ CRUD** (roles 子、UNIQUE(role_id, code))
   - **customer_reservation_tokens** (Phase 4 顧客本人確認、token hash + email 検証、新規 token 生成 logic 必要)
   - **attachments** (画像/PDF upload、Supabase Storage 連携必要、外部依存)
   - **status_transitions マスタ** (statuses 子、from→to 遷移ルール CRUD、UI で statuses から select)
2. **A.17 推奨**: `status_transitions` マスタ CRUD (statuses の続きで自然、A.16 で確立した canonical を直接活用、影響範囲限定、仕様判断量「中」)
3. **代替候補**: `roles マスタ CRUD` (auth domain 切替、is_system フラグ活用、permissions サブテーブル含めると 2 ファイル) または `customer_reservation_tokens` (Phase 4 先駆け)
4. **A.17 着手時の重要 task**: statuses 完了で master 系の canonical (UNIQUE + FK 違反 wrap) 確立、次の master CRUD は本パターンを最大活用
5. canonical mirror 状況 (A.16 で FK 違反 wrap を追加 = 8 種類カバー):
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 単純 CRUD without UNIQUE → `vendors.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし、FK SET NULL or 子なし) → `lane-types.ts` / `work-categories.ts` / `vendor-sla-overrides.ts` / `vendor-service-areas.ts`
   - **hard delete + FK 違反 wrap (子テーブル参照中) → `statuses.ts` (A.16 新規 canonical)**
   - M:N 関連 (full diff replace) → `lane-work-menus.ts` / `vendor-available-stores.ts`
   - 親 1:N サブ (full-replace, UNIQUE 有) → `lane-working-hours.ts` / `store-business-hours.ts`
   - 親 1:N サブ (per-row CRUD with UNIQUE) → `store-holidays.ts` / `vendor-sla-overrides.ts`
   - 親 1:N サブ (per-row CRUD with ends_on=NULL 排他) → `vehicle-ownerships.ts`
   - 親 1:N サブ (full-replace, UNIQUE 不在 → wipe + bulk insert) → `vendor-available-days.ts`
   - 親 1:N サブ (per-row CRUD without UNIQUE, 重複許容) → `vendor-service-areas.ts`
6. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定

### 想定規模 (Phase 64-A.17 例: status_transitions マスタ CRUD)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1 service + 1 test + 3-4 UI = 5-6 files |
| 想定行数 | 400-600 |
| 想定 tests 追加 | 7-9 ケース (per-row CRUD + UNIQUE(company,type,from,to) 衝突 + cross-tenant + Zod statusType + 自己参照 (from=to) 許容判定) |
| 完了後 tests 合計 | 346+ |
| 仕様判断量 | **中** (statuses canonical 流用 + status_transitions 特有の自己参照判定のみ判断必要) |

### 注意点

- status_transitions は 2 つの statuses への FK (from_status_id nullable, to_status_id NOT NULL)
- statuses 同様 schema には `is_system` 列なし、UNIQUE(company, statusType, fromStatusId, toStatusId)
- UI でドロップダウン (statuses select) を実装する必要あり (listStatuses({ statusType }) で fromOptions/toOptions を絞り込む)
- spec §3.8 確認 (status_transitions の挙動)
- 着手時に必ず raw-migration / spec / drizzle schema の 3 点突合 (handoff §146 推奨継続)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.16 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 4 新規 UI (page + new/page + new/actions + [id]/page + [id]/actions) + 1 新規 test + 1 sealed = **7 files** |
| 新規 service 関数 | 5 (list/create/update/delete/getById) + 2 error class (Conflict/InUse) + 2 helper (isUnique/isFK violation) + 1 const export (STATUS_TYPES) |
| advisor 呼び出し | 0 (canonical mirror 流用 + FK 違反 wrap 新パターンは仕様自明) |
| Codex 委任 task 数 | 0 (handoff §150 推奨でスキップ) |
| Codex 採用率 | 0/0 (A.16 単体)、累積 1/16 (A.1-A.16) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.16 試行なし) |
| 新規 tests | 10 cases / 約 240 行 (per-row CRUD + UNIQUE 衝突 + cross-tenant + FK 違反 wrap + Zod + null toggle) |
| invariants 維持 | typecheck clean / 339 tests / 42 test files |
| MVP blocker 消化 | 累積 18/24 (A.1-A.15 + statuses マスタ) |

## 振り返りメモ (statuses 完了を経て)

- **FK 違反 wrap pattern の canonical 化**: hard delete + 23503 catch を `statuses.ts` で確立。今後の master 系 (roles / permissions / status_transitions / その他親テーブル) で再利用可能。これまでの vendor 系で多用された UNIQUE 衝突 (23505) との 2 大エラーパターンが揃った
- **三点突合の継続的価値**: A.16 で spec / raw-migration / drizzle 3 点突合 → drift なし (vendor_service_areas と異なり statuses は spec 整合)。今後の master CRUD でも 3 点突合は handoff §146 推奨で継続
- **seed 行ガードを実装しない判断の妥当性**: handoff §103 で「seed 削除可否」が論点だったが、FK 違反 wrap で実質的に system status (reservations から参照される行) は削除不能となり、UI ガード実装不要。`is_system` 列が schema にないことを逆手にとって最小実装でカバー
- **vendor 系完遂後の新 domain 着手の手応え**: vendor 系 5 件で蓄積した canonical mirror (10 パターン) が statuses でも直接活用、設計判断は FK 違反 wrap pattern のみ追加。新 domain 移行のコスト低下を実証
- **新セッション 1 ターン完遂継続**: A.3-A.16 で 14 連続 1 ターン完遂、handoff の効果実証継続中

## /clear 推奨タイミング (本 Phase 完了時)

**本 Phase A.16 完遂後、`/clear` 推奨を発出**。理由:
- vendor 系 (A.12-A.15) → statuses マスタ (A.16) で domain 切替済、A.17 では status_transitions or roles マスタ等、別 master/domain 着手見込み
- master 系 canonical (FK 違反 wrap) が確立、今後 master CRUD で参照すべき先 (handoff) が固定化
- 本セッション (A.16 単独 1 ターン完遂) はコンテキスト累積少だが、次 domain 移行で文脈刷新が望ましい

新セッション開始時: `phase-64-a16-statuses-sealed.md` を読んで Phase 64-A.17 着手。

---

*Phase 64-A.16 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.17 (推奨: status_transitions マスタ CRUD で statuses canonical 流用 → 代替: roles マスタ or customer_reservation_tokens、本 branch `phase-64-mvp-implementation` 継続)*
