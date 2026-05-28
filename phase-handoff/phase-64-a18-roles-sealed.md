# Phase 64-A.19 入力契約: Phase 64-A.18 roles sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.18 (前: 64-A.17 status_transitions sealed) |
| 状態 | **sealed** (roles マスタ per-row CRUD + UNIQUE(company_id, code) + is_system + company_id IS NULL ガード + admin UI list/new/detail + integration tests / 355 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §74 推奨 roles マスタ採用、16 連続 1 ターン完遂継続、Codex 試行スキップ) |
| 前 handoff | `phase-64-a17-status-transitions-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |
| **/clear 推奨** | **本 Phase 完了後、status 系 → auth 系 (roles) で domain 移行完了、A.19 で permissions or customer_reservation_tokens 着手の自然な境界、`/clear` 推奨を発出** |

## 達成したこと (Phase 64-A.18)

- 1 ファイル新規 service (`roles.ts` 約 215 行、per-row CRUD with UNIQUE + is_system/company_id IS NULL 両方でガード)
- 4 ファイル新規 UI (`admin/roles/page.tsx` / `new/page.tsx` / `new/actions.ts` / `[id]/page.tsx` / `[id]/actions.ts`)
- 1 ファイル新規 integration test (8 cases: create / list with system + cross-tenant + includeSystem flag / update normal / UNIQUE 衝突 / update is_system ガード / delete is_system ガード / hard-delete + cross-tenant + getById null / Zod 空 code + name 上限超過)
- 既存 schema / RLS / raw-migration 変更 **0** (drizzle schema 既存 `roles.ts` をそのまま利用)
- 既存 role 参照 service (`admin-role.ts` 等) 挙動変更 **0**、admin-shell ナビ追加 **0** (settings ハブ経由想定)
- typecheck clean (tsc --noEmit 通過、無出力)
- **355 tests PASS** (347 + 新規 8、44 test files、handoff 想定 354+ クリア)

## Claude 側の主要設計判断

1. **3 点突合で drift 確認**: spec §3.4 / raw-migration `03_roles_statuses.sql` / drizzle `roles.ts` ≒ 一致 (drizzle / raw-migration に `is_system` あり、spec §3.4 表には未記載だが RLS 補足で「company_id IS NULL のシステム標準は UPDATE/DELETE 禁止」と機能要件あり → `is_system` フラグで実装可能)
2. **roles 単体で実装、permissions は A.19 以降**: spec §3.5 と raw-migration の permissions に命名 drift (`permission_key + allowed` vs `code + resource + action`) があり別途審議が必要。handoff §74 「分離 1 ファイル / 合体 2 ファイル」のうち分離選択
3. **二重ガード (is_system + company_id IS NULL) 採用**: spec RLS 補足は company_id IS NULL ガードのみだが、drizzle/raw-migration の is_system フラグも併用。テナント内に seed 配置されるパターン (companyId 設定 + is_system=true) も将来想定して両方でガード
4. **list での system role 表示制御**: デフォルト `includeSystem=true` で company_id IS NULL の system role を全 tenant に表示 (spec §3.4 RLS 補足準拠)。UI で「システム標準も含める」チェックボックスで OFF 可能
5. **list 並び (isSystem asc, code asc, createdAt desc)**: system role が先頭、tenant role はコード昇順、同コードは新しい順。マスタ閲覧で system role を一覧の上に集約
6. **getRoleById は IS NULL も許容**: 自社 role か system role (company_id IS NULL) のみ取得可。詳細閲覧で system role の中身も確認できるが、UI 側で編集/削除フォームを表示しない (read-only 表示のみ)
7. **削除時 FK 違反 wrap 不要**: permissions=CASCADE / users.role_id=SET NULL / user_store_memberships.role_id=SET NULL のため、roles 削除で FK 違反 (23503) は起こらない。statuses canonical の FK wrap pattern は流用せず
8. **UI 二重ガード**: detail 画面で `isReadOnly = role.isSystem || role.companyId === null` を判定し、編集 form / 削除 button 全体を非表示。代わりに「システム標準のため編集・削除不可」案内を amber バナーで表示。service 層 guard と UI 層 guard の二重で防御
9. **list での種別バッジ**: 「システム」(amber bg) / 「テナント」(gray text) で視認性確保。種別 col を最左に配置

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.18 roles マスタ | **Claude 自実装 (handoff §150 推奨 + 16 連続 1 ターン完遂継続)** |

→ A.18 も Codex 試行ゼロで Claude 完遂。block override 記録 6 件 (service + UI 3 + actions 2 + test)。

## Phase 64-A.19 入力契約 (新セッションで使用)

### 参照すべきファイル

- 本 handoff (`phase-64-a18-roles-sealed.md`)
- `phase-64-a17-status-transitions-sealed.md` (status 系 canonical: per-row CRUD + UNIQUE + leftJoin + nullable FK)
- `src/lib/services/roles.ts` (per-row CRUD with UNIQUE + 二重ガード canonical、system seed 行 + companyId NULL を扱う master 系で参照)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker 累積 **20/24** (A.18 で roles 消化、残り 4 件)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.18 機能すべてに retrogression なし
- typecheck clean / 44 test files / **355 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.18 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- `roles` schema は UUID PK + companyId nullable FK + code/name NOT NULL + description nullable + is_system NOT NULL + UNIQUE(company_id, code) のまま不変
- roles 削除は hard delete、FK 違反 wrap 不要 (CASCADE/SET NULL のため)
- roles の system 行 (is_system=true OR company_id IS NULL) は service + UI 両層でガード
- admin/roles は 3 sub-page (list / new / [id]) 構成、edit/delete は detail 内 form
- detail 画面で system role は read-only (form 非表示)

### Phase 64-A.19 着手時の最初の判断

1. **次の MVP blocker 選定** (残候補):
   - **permissions マスタ CRUD** (roles 子、UNIQUE(role_id, code)、spec drift 解消必要 = `permission_key + allowed` vs `code + resource + action`)
   - **customer_reservation_tokens** (Phase 4 顧客本人確認、token hash + email 検証、新規 token 生成 logic 必要)
   - **attachments** (画像/PDF upload、Supabase Storage 連携必要、外部依存)
   - **notification_rules** (通知ルール、event_type + channel + target_role の組み合わせ管理)
2. **A.19 推奨**: `permissions マスタ CRUD` (roles 子で auth 系完遂、ただし spec drift 解消が前提)。代替推奨: `notification_rules` (Phase 4 通知拡張前駆、master 系で完結、外部依存なし)
3. **A.19 代替**: `customer_reservation_tokens` (Phase 4 先駆け、token 生成 logic 必要 = 仕様判断量「中-高」) または `attachments` (Storage 連携で仕様判断量「高」、 MVP 後送り推奨)
4. **A.19 着手時の重要 task**: permissions を選ぶ場合、spec §3.5 と raw-migration の column 差を確認し、どちらに従うか確定 (raw-migration が DB の真実なので `code + resource + action` 採用が筋)
5. canonical mirror 状況 (A.18 で「二重ガード + nullable companyId」pattern を追加 = 10 種類カバー):
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 単純 CRUD without UNIQUE → `vendors.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし、FK SET NULL or 子なし) → `lane-types.ts` / `work-categories.ts` / `vendor-sla-overrides.ts` / `vendor-service-areas.ts`
   - hard delete + FK 違反 wrap (子テーブル参照中) → `statuses.ts`
   - hard delete + leftJoin で関連 name 取得 + nullable FK 許容 → `status-transitions.ts`
   - **hard delete + 二重ガード (is_system + companyId NULL) + system seed 行のクロステナント可視性 → `roles.ts` (A.18 新規 canonical)**
   - M:N 関連 (full diff replace) → `lane-work-menus.ts` / `vendor-available-stores.ts`
   - 親 1:N サブ (full-replace, UNIQUE 有) → `lane-working-hours.ts` / `store-business-hours.ts`
   - 親 1:N サブ (per-row CRUD with UNIQUE) → `store-holidays.ts` / `vendor-sla-overrides.ts`
   - 親 1:N サブ (per-row CRUD with ends_on=NULL 排他) → `vehicle-ownerships.ts`
   - 親 1:N サブ (full-replace, UNIQUE 不在 → wipe + bulk insert) → `vendor-available-days.ts`
   - 親 1:N サブ (per-row CRUD without UNIQUE, 重複許容) → `vendor-service-areas.ts`
6. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定

### 想定規模 (Phase 64-A.19 例: permissions マスタ CRUD)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1 service + 1 test + 3-4 UI = 5-6 files |
| 想定行数 | 400-600 |
| 想定 tests 追加 | 6-8 ケース (per-row CRUD + UNIQUE(role,code) 衝突 + cross-tenant + roleId FK 整合 (roles 削除で CASCADE 連鎖確認) + Zod) |
| 完了後 tests 合計 | 361+ |
| 仕様判断量 | **中** (spec §3.5 `permission_key + allowed` と DB `code + resource + action` の選択判断必要、roles 子なので role 選択 UI 必要、roleId 必須 vs nullable 確認) |

### 注意点

- permissions schema は `companyId nullable` (CASCADE) + `roleId nullable` (CASCADE)、両方 NULL 許容だが実運用は roleId 必須が筋。service 層で NOT NULL 強制を Zod でかける選択肢あり
- raw-migration `code + resource + action` 採用が DB 真実、spec §3.5 旧仕様 `permission_key + allowed` は v2 以前の名残と思われる (Phase 31-A で code 統一済みと spec §3.4 末尾に明記)
- system role の permissions (company_id IS NULL) も同様にガード必要 → roles canonical の二重ガード pattern を流用
- 着手時に必ず raw-migration / spec / drizzle schema の 3 点突合 (handoff §146 推奨継続)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.18 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 4 新規 UI (page + new/page + new/actions + [id]/page + [id]/actions) + 1 新規 test + 1 sealed = **7 files** |
| 新規 service 関数 | 5 (list/create/update/delete/getById) + 2 error class (Conflict + SystemGuard) + 1 helper (isUnique) + 二重ガード canonical |
| advisor 呼び出し | 0 (statuses canonical + nullable companyId/leftJoin pattern 既知のため直接実装) |
| Codex 委任 task 数 | 0 (handoff §150 推奨でスキップ) |
| Codex 採用率 | 0/0 (A.18 単体)、累積 1/18 (A.1-A.18) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.18 試行なし) |
| 新規 tests | 8 cases / 約 220 行 (per-row CRUD + UNIQUE 衝突 + 二重ガード (update/delete それぞれ) + cross-tenant + system 可視性 + Zod) |
| invariants 維持 | typecheck clean / 355 tests / 44 test files |
| MVP blocker 消化 | 累積 20/24 (A.1-A.17 + roles マスタ) |

## 振り返りメモ (roles 完了を経て)

- **二重ガード pattern の canonical 化**: `is_system=true` flag と `companyId IS NULL` の両方で system 行を判定する pattern を確立。permissions / system_settings 系で system seed 行が混在する master でほぼそのまま流用可能
- **service 層と UI 層の二重防御**: roles では service 層 (`updateRole` 冒頭で existing 取得 → isSystem 検査) と UI 層 (`isReadOnly` 判定で form 全体非表示) の両方で守る。permissions のように UI が複雑な master でも同じ方針推奨
- **3 点突合継続**: spec §3.4 表に `is_system` 未記載だが RLS 補足に機能要件あり → drizzle/raw-migration の `is_system` 採用と判断。今後の master 系でも spec 表だけでなく RLS/補足/trigger 定義まで確認するべき
- **list の system role 可視性**: `includeSystem=true` で全 tenant 表示、`false` で自社のみ表示。UI でチェックボックス制御。後で system role を一覧から消したい場合のフックを早期に確保
- **新セッション 1 ターン完遂継続**: A.3-A.18 で 16 連続 1 ターン完遂、handoff の効果実証継続中

## /clear 推奨タイミング (本 Phase 完了時)

**本 Phase A.18 完遂後、`/clear` 推奨を発出**。理由:
- status 系 (A.16-A.17) → auth 系 (roles) で domain 移行完了、A.19 では permissions サブ or Phase 4 系着手見込み
- master 系 canonical (二重ガード + nullable companyId) が確立、今後 master CRUD で参照すべき先 (handoff) が固定化
- 本セッション (A.18 単独 1 ターン完遂) はコンテキスト累積少だが、次 domain (permissions or Phase 4) 移行で文脈刷新が望ましい

新セッション開始時: `phase-64-a18-roles-sealed.md` を読んで Phase 64-A.19 着手。

---

*Phase 64-A.18 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.19 (推奨: permissions マスタ CRUD で spec drift 解消 → 代替: notification_rules / customer_reservation_tokens、本 branch `phase-64-mvp-implementation` 継続)*
