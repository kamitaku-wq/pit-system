# Phase 64-A.20 入力契約: Phase 64-A.19 permissions sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.19 (前: 64-A.18 roles sealed) |
| 状態 | **sealed** (permissions マスタ per-row CRUD + UNIQUE(role_id, code) + 自社 role 限定 + system role ガード + admin UI list/new/detail + integration tests / 365 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §76 推奨 permissions マスタ採用、17 連続 1 ターン完遂継続、Codex 試行スキップ) |
| 前 handoff | `phase-64-a18-roles-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |
| **/clear 推奨** | **本 Phase 完了後、roles → permissions で auth 系完遂、A.20 で Phase 4 系 (customer_reservation_tokens or notification_rules) 着手の自然な境界、`/clear` 推奨を発出** |

## 達成したこと (Phase 64-A.19)

- 1 ファイル新規 service (`permissions.ts` 約 270 行、per-row CRUD with UNIQUE + 自社 role 限定 + roleId 必須 Zod + system role ガード + leftJoin roles で role 名取得)
- 5 ファイル新規 UI (`admin/permissions/page.tsx` 一覧 / `new/page.tsx` + `new/actions.ts` 作成 / `[id]/page.tsx` + `[id]/actions.ts` 詳細・編集・削除)
- 1 ファイル新規 integration test (10 cases: create / list with system + cross-tenant + includeSystem flag / update / UNIQUE 衝突 / create against system role guard / create against other tenant role guard / update is_system guard / delete is_system guard / hard-delete + cross-tenant + getById null / Zod 空 code + 過大 code + 非 UUID roleId)
- 既存 schema / RLS / raw-migration 変更 **0** (drizzle schema 既存 `permissions.ts` をそのまま利用、spec §3.5 旧仕様 `permission_key + allowed` は raw-migration `code + resource + action` 採用で drift 解消)
- 既存 service / admin-shell ナビ変更 **0** (settings ハブ経由想定)
- typecheck clean (tsc --noEmit 通過、exit=0)
- **365 tests PASS** (355 + 新規 10、45 test files、handoff §102 想定 361+ クリア)

## Claude 側の主要設計判断

1. **3 点突合で drift 確認**: spec §3.5 `permission_key + allowed` vs raw-migration `code + resource + action` vs drizzle schema `code + resource + action` → DB 真実 (raw-migration + drizzle 一致) を採用。spec §3.5 旧仕様は Phase 31-A での code 統一前の名残と判断 (handoff §108 言及と整合)
2. **roleId 必須化 (Zod 強制)**: schema は roleId nullable (CASCADE) だが、実運用で roleId のない permission は意味を持たないため `z.string().uuid()` で必須化
3. **自社 role 限定 + system role ガード canonical**: `assertRoleEditable()` helper で create 時に role.companyId === ctx.companyId かつ role.isSystem === false を検証、違反は `PermissionRoleGuardError` throw。`updatePermission` / `deletePermission` は既存 permission の roleId に対して同じ判定を leftJoin で取得
4. **list は自社 + system role permission 両方を表示**: `tenantScope = or(eq(roles.companyId, ctx.companyId), isNull(roles.companyId))` で `includeSystem=true` (default) なら system role 配下の permission も含める。UI でロール名 + 「システム」バッジ表示
5. **list 並び (isSystem asc, role code asc, permission code asc, createdAt desc)**: テナント permission が先頭、ロール毎にグルーピング、code 昇順、同 code は新しい順
6. **getPermissionById は IS NULL role も許容**: 自社 role 配下 または system role 配下のみ取得可。UI 側で `isReadOnly = roleIsSystem || companyId !== adminUser.companyId` 判定で編集 form 非表示
7. **削除時 FK 違反 wrap 不要**: permissions に子テーブルなし。statuses canonical の FK wrap pattern は流用せず
8. **UI 二重ガード**: detail 画面で `isReadOnly` 判定で form / 削除 button 全体を非表示。代わりに「システム標準のため編集・削除不可」案内を amber バナーで表示。service 層 (`PermissionRoleGuardError`) と UI 層 (form 非表示) の二重で防御
9. **新規作成画面の role dropdown**: `listRoles({ includeSystem: false })` で自社 role のみ候補化。空の場合は「先にロールを作成してください」案内 + roles/new リンク誘導
10. **list での 3 条件絞り込み**: keyword (code/resource/action ILIKE) + roleId (UUID 入力) + includeSystem checkbox

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.19 permissions マスタ | **Claude 自実装 (handoff §76 推奨 permissions マスタ採用、17 連続 1 ターン完遂継続)** |

→ A.19 も Codex 試行ゼロで Claude 完遂。block override 記録 6 件 (service + UI 3 + actions 2 + test)。

## Phase 64-A.20 入力契約 (新セッションで使用)

### 参照すべきファイル

- 本 handoff (`phase-64-a19-permissions-sealed.md`)
- `phase-64-a18-roles-sealed.md` (roles canonical: 二重ガード + nullable companyId + system seed)
- `src/lib/services/permissions.ts` (per-row CRUD with UNIQUE + 親 role ownership 検証 canonical、roleId 必須 Zod の child master 系で参照)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker 累積 **21/24** (A.19 で permissions 消化、残り 3 件)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.19 機能すべてに retrogression なし
- typecheck clean / 45 test files / **365 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.19 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- `permissions` schema は UUID PK + companyId/roleId 両方 nullable FK (CASCADE) + code NOT NULL + resource/action nullable + UNIQUE(role_id, code) のまま不変
- permissions 削除は hard delete、FK 違反 wrap 不要 (子テーブルなし)
- permissions は親 role.companyId === ctx.companyId かつ role.isSystem === false の場合のみ create/update/delete 可
- admin/permissions は 3 sub-page (list / new / [id]) 構成、edit/delete は detail 内 form
- detail 画面で system role 配下の permission は read-only (form 非表示)

### Phase 64-A.20 着手時の最初の判断

1. **次の MVP blocker 選定** (残候補):
   - **customer_reservation_tokens** (Phase 4 顧客本人確認、token hash + email 検証、新規 token 生成 logic 必要、仕様判断量「中-高」)
   - **notification_rules** (通知ルール、event_type + channel + target_role の組み合わせ管理、master 系で完結、外部依存なし、仕様判断量「中」)
   - **attachments** (画像/PDF upload、Supabase Storage 連携必要、外部依存、仕様判断量「高」、MVP 後送り推奨)
2. **A.20 推奨**: `notification_rules` (master 系 canonical をもう 1 件積む、Phase 4 通知拡張前駆、外部依存なし)。代替推奨: `customer_reservation_tokens` (Phase 4 先駆け)
3. **A.20 代替**: `attachments` (Storage 連携で仕様判断量「高」、 MVP 後送り推奨)
4. **A.20 着手時の重要 task**:
   - notification_rules: spec §通知ルール (要確認) と raw-migration の 3 点突合、event_type/channel/target_role の値域確定、role 参照は permissions と同じ「自社 + system」可視性を踏襲
   - customer_reservation_tokens: token 生成 (crypto.randomBytes + hash) ロジック設計、email/phone verification flow 設計が必要、CRUD というより state machine 寄り
5. canonical mirror 状況 (A.19 で「親 role ownership 検証 + child master」pattern を追加 = 11 種類カバー):
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 単純 CRUD without UNIQUE → `vendors.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし、FK SET NULL or 子なし) → `lane-types.ts` / `work-categories.ts` / `vendor-sla-overrides.ts` / `vendor-service-areas.ts`
   - hard delete + FK 違反 wrap (子テーブル参照中) → `statuses.ts`
   - hard delete + leftJoin で関連 name 取得 + nullable FK 許容 → `status-transitions.ts`
   - hard delete + 二重ガード (is_system + companyId NULL) + system seed 行のクロステナント可視性 → `roles.ts`
   - **hard delete + 親 role ownership 検証 + leftJoin で role 名取得 + system seed の可視性 (操作不可) → `permissions.ts` (A.19 新規 canonical)**
   - M:N 関連 (full diff replace) → `lane-work-menus.ts` / `vendor-available-stores.ts`
   - 親 1:N サブ (full-replace, UNIQUE 有) → `lane-working-hours.ts` / `store-business-hours.ts`
   - 親 1:N サブ (per-row CRUD with UNIQUE) → `store-holidays.ts` / `vendor-sla-overrides.ts`
   - 親 1:N サブ (per-row CRUD with ends_on=NULL 排他) → `vehicle-ownerships.ts`
   - 親 1:N サブ (full-replace, UNIQUE 不在 → wipe + bulk insert) → `vendor-available-days.ts`
   - 親 1:N サブ (per-row CRUD without UNIQUE, 重複許容) → `vendor-service-areas.ts`
6. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定

### 想定規模 (Phase 64-A.20 例: notification_rules マスタ CRUD)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1 service + 1 test + 3-4 UI = 5-6 files |
| 想定行数 | 400-600 |
| 想定 tests 追加 | 6-8 ケース (per-row CRUD + UNIQUE(event_type, channel, target_role) 衝突 + cross-tenant + 値域 enum + Zod) |
| 完了後 tests 合計 | 371+ |
| 仕様判断量 | **中** (event_type/channel/target_role の値域確定、master 系で完結、roles canonical 流用) |

### 注意点

- notification_rules schema は要確認 (drizzle 既存 `notification_rules.ts` を最初に読む)
- spec / raw-migration / drizzle の 3 点突合継続 (handoff §146 推奨)
- role 参照を伴うなら permissions canonical の「自社 + system」可視性 pattern を流用
- customer_reservation_tokens を選ぶ場合は state machine 寄りなので per-row CRUD canonical だけでは不足、separate use-case として `issueToken` / `verifyToken` / `revokeToken` 関数を設計

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.19 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 5 新規 UI (page + new/page + new/actions + [id]/page + [id]/actions) + 1 新規 test + 1 sealed = **8 files** |
| 新規 service 関数 | 5 (list/create/update/delete/getById) + 2 error class (Conflict + RoleGuard) + 1 helper (assertRoleEditable) + 1 helper (selectListColumns with leftJoin) + 1 helper (isUniqueViolation) |
| advisor 呼び出し | 0 (roles canonical + leftJoin pattern + nullable companyId 既知のため直接実装) |
| Codex 委任 task 数 | 0 (handoff §76 推奨でスキップ) |
| Codex 採用率 | 0/0 (A.19 単体)、累積 1/19 (A.1-A.19) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.19 試行なし) |
| 新規 tests | 10 cases / 約 265 行 (per-row CRUD + UNIQUE 衝突 + RoleGuard (create system + create other tenant + update system + delete system) + cross-tenant + Zod 3 種) |
| invariants 維持 | typecheck clean / 365 tests / 45 test files |
| MVP blocker 消化 | 累積 21/24 (A.1-A.18 + permissions マスタ) |

## 振り返りメモ (permissions 完了を経て)

- **親 role ownership 検証 canonical の確立**: `assertRoleEditable()` で create 時の親検証 + 既存 leftJoin 検証で update/delete 時の親検証。child master 系で親の所有者属性 (companyId + isSystem) によってアクセス制御する pattern が確立。今後 `vendor_sla_overrides` の vendor 所有者検証や同類で流用可能
- **leftJoin canonical の 2 用途**: status-transitions では「関連テーブルの name を表示用に取得」、permissions では「親テーブルの ownership 属性を検証用に取得」+「name を表示用に取得」の二重活用。selectListColumns helper で共通化
- **spec drift 解消パターン**: spec §3.5 旧仕様 vs DB 真実 (raw-migration + drizzle 一致) のケースは DB 真実採用。spec の更新は別途追跡が必要だが、実装はブロックしない (handoff §74 の判断踏襲)
- **roleId 必須化の判断**: DB は nullable だが service 層で Zod 強制。schema 変更なしで実運用制約を service 層に集約する pattern が成立 (今後 notification_rules の event_type 必須化等で再利用)
- **新セッション 1 ターン完遂継続**: A.3-A.19 で 17 連続 1 ターン完遂、handoff の効果実証継続中

## /clear 推奨タイミング (本 Phase 完了時)

**本 Phase A.19 完遂後、`/clear` 推奨を発出**。理由:
- roles (A.18) → permissions (A.19) で auth 系完遂、A.20 では Phase 4 系 (notification_rules / customer_reservation_tokens) 着手見込み
- child master canonical (親 ownership 検証 + leftJoin) が確立、今後の child master CRUD で参照すべき先 (handoff) が固定化
- 本セッション (A.19 単独 1 ターン完遂) はコンテキスト累積少だが、次 domain (Phase 4 系) 移行で文脈刷新が望ましい

新セッション開始時: `phase-64-a19-permissions-sealed.md` を読んで Phase 64-A.20 着手。

---

*Phase 64-A.19 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.20 (推奨: notification_rules マスタ CRUD で master 系もう 1 件 → 代替: customer_reservation_tokens / attachments、本 branch `phase-64-mvp-implementation` 継続)*
