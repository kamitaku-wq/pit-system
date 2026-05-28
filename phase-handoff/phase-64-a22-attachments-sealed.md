# Phase 64-A.23 入力契約: Phase 64-A.22 attachments sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.22 (前: 64-A.21 customer_reservation_tokens sealed) |
| 状態 | **sealed** (attachments use-case service: registerAttachment / listAttachments / getAttachmentById / softDeleteAttachment + parent multi-FK + cross-tenant parent 検証 + mime whitelist + size cap + admin list/detail UI + 10 integration tests / 394 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (advisor §2 で 4 論点 (Storage scope / parent FK / mime/size / canonical) + cross-tenant 論点 reconcile 後実装、20 連続 1 ターン完遂継続、Codex 試行スキップ) |
| 前 handoff | `phase-64-a21-customer-reservation-tokens-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |
| **/clear 推奨** | **本 Phase 完了後、A.23 で残 MVP master/use-case 系完遂後の Phase 4 統合 (顧客 server action skeleton / TokenizedReservationFlow / Storage signed URL) に踏み込む節目、`/clear` 推奨を発出** |

## 達成したこと (Phase 64-A.22)

- 1 ファイル新規 service (`attachments.ts` 約 390 行、use-case service: `registerAttachment` / `listAttachments` / `getAttachmentById` / `softDeleteAttachment` + 3 error class + parent ownership helper + Zod schema + mime/size const)
- 3 ファイル新規 UI (`admin/attachments/page.tsx` 一覧 / `[id]/page.tsx` 詳細 / `[id]/actions.ts` softDelete action)。**new ページなし** (upload UI は Phase 4 統合で Supabase Storage 連携後追加)
- 1 ファイル新規 integration test (10 cases: register service_ticket parent + DB row 確認 / register reservation + transport_order parent + nullable fields + byteSize=0 / cross-tenant parent 3 種 AttachmentParentNotFoundError / duplicate storage_bucket+storage_key AttachmentStorageConflictError / list parent filter + count / cross-tenant list/getById 不可視 / softDelete + 二重削除 AttachmentNotFoundError + includeDeleted / cross-tenant softDelete AttachmentNotFoundError / uploadedByUserId filter / Zod 5 種 (mime whitelist 外 / size cap 超 / 非 UUID / 空 fileName / 負 byteSize))
- 既存 schema / RLS / raw-migration 変更 **0** (drizzle schema 既存 `attachments.ts` をそのまま利用、spec drift 既知のため DB を真実採用)
- 既存 service / admin-shell ナビ変更 **0**
- typecheck clean (tsc --noEmit 通過、exit=0)
- **394 tests PASS** (384 + 新規 10、48 test files、handoff §128 想定 390+ クリア)

## Claude 側の主要設計判断

1. **spec/DDL drift: DB 真実採用** (permissions A.19 / customer-reservation-tokens A.21 前例同型、3 連続)
   - spec/data-model.md §12.1 は `entity_type text NOT NULL` + `entity_id uuid NOT NULL` の single polymorphic 設計、`storage_path` / `mime_type` / `size_bytes` カラム名
   - 実 DDL (`alpha-1-public/16_attachments.sql`) と drizzle schema は **multi-FK** (`service_ticket_id` / `reservation_id` / `transport_order_id` 全 nullable, CASCADE) + `storage_bucket` + `storage_key` (UNIQUE) + `content_type` (nullable) + `byte_size` (CHECK >= 0) + `checksum` (nullable) + `uploaded_by_user_id` (SET NULL) + soft delete (`deleted_at`) + `ix_attachments_service_ticket WHERE deleted_at IS NULL` + RLS tenant_isolation + trg_set_updated_at trigger
   - 判断: DB を真実採用、spec §12.1 改定は別 phase。今 phase は drizzle schema をそのまま利用
2. **Storage 統合スコープは DB metadata のみ**: `registerAttachment` は「Storage 側で既に upload 済みの metadata を DB に登録」する責務に限定。signed URL 発行 / upload helper は Phase 4 統合で service_role 経由で別関数追加 (customer-reservation-tokens の Phase 4 統合パターンと同型)
3. **parent FK 制約は Zod refine ではなく enum + discriminator**: DDL に XOR CHECK なし (3 FK 全 nullable)。Zod の `parentType: z.enum(["service_ticket", "reservation", "transport_order"])` + `parentId: uuid` の組み合わせで「正確に 1 つ必須」を強制。`registerAttachment` 内で `parentType` で分岐して該当 FK 列のみ NOT NULL に set、他 2 列は null。raw-migration 変更 0 invariant 維持
4. **mime_type whitelist + size cap は service 層で固定**: spec に具体値なし → MVP デフォルト `ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp", "application/pdf"]` + `MAX_BYTE_SIZE = 10 MiB` を service 内 export const として定義、Phase 4 統合時に見直し対象 (hidden constraint をコメントで明記)。advisor §3 で「Claude 発案」を明示
5. **cross-tenant parent ownership 検証**: A.21 customer-reservation-tokens §37 と同型 pattern。`registerAttachment` 内で `verifyParentOwnership(ctx, parentType, parentId)` を SELECT 先行実行、parentType に応じて `serviceTickets` / `reservations` / `transportOrders` の `companyId = ctx.companyId` を検証。異なる company の親 ID は `AttachmentParentNotFoundError` で弾く。advisor §reconcile で漏れていた論点として追加
6. **soft delete only (今 phase)**: deletedAt セットのみ。Storage 上の実体ファイル削除は Phase 4 統合で別途。二重削除は `AttachmentNotFoundError` (UPDATE WHERE deletedAt IS NULL ... RETURNING で 0 行返却時に throw)
7. **listAttachments は `{ rows, total }` 形式**: customer-reservation-tokens.listTokens canonical pattern 踏襲。countAttachments は不要 (Promise.all で同時取得)。admin UI でも 1 関数で済む
8. **storage_bucket+storage_key UNIQUE 衝突は AttachmentStorageConflictError で wrap**: notification_rules A.20 同型 pattern、`isUniqueViolation` (code 23505) helper を service に持つ
9. **byteSize=0 許容**: DB CHECK `byte_size >= 0` 準拠 (空ファイル登録可)。Zod `min(0)` で同期

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.22 attachments use-case | **Claude 自実装 (advisor で 4 論点 + cross-tenant reconcile 後実装、20 連続 1 ターン完遂継続)** |

→ A.22 も Codex 試行ゼロで Claude 完遂。block override 記録 4 件 (service + UI 2 + test)。advisor 2 回 (初回 4 論点フレーミング + reconcile)。

## Phase 64-A.23 入力契約 (新セッションで使用)

### 参照すべきファイル

- 本 handoff (`phase-64-a22-attachments-sealed.md`)
- `phase-64-a21-customer-reservation-tokens-sealed.md` (use-case service canonical: hash + atomic + Phase 4 統合分離)
- `src/lib/services/attachments.ts` (multi-FK + cross-tenant parent 検証 + mime/size whitelist + `{rows,total}` list の新 canonical)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker 累積 **24/24 = 完了** (A.22 で attachments 消化、master/use-case 系完遂)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.22 機能すべてに retrogression なし
- typecheck clean / 48 test files / **394 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.21 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- `attachments` schema は UUID PK + companyId NOT NULL + 3 parent FK 全 nullable (CASCADE) + uploaded_by_user_id SET NULL + storage_bucket+storage_key UNIQUE + byte_size CHECK >= 0 + soft delete + RLS tenant_isolation + trg_set_updated_at trigger + ix_attachments_service_ticket のまま不変
- mime whitelist (4 種) / MAX_BYTE_SIZE (10 MiB) は MVP デフォルト、Phase 4 統合時に見直し
- parent ownership 検証は cross-tenant 防御の主柱 (RLS は同テナント attachments テーブルのみ防御、parent FK 検証は app 層責務)
- Storage 実体 upload / signed URL 発行は Phase 4 統合まで service には含めない (DB metadata のみ)

### Phase 64-A.23 着手時の最初の判断

1. **MVP master/use-case 系完遂、次は Phase 4 統合**:
   - **Phase 4 統合候補 1**: `TokenizedReservationFlow` (customer-reservation-tokens の Phase 4 統合: service_role 経由 verify 関数 + 顧客 server action skeleton + 顧客 UI の最小 router)
   - **Phase 4 統合候補 2**: `attachments` の Storage 連携 (signed URL 発行関数 + Supabase Storage bucket policy + upload helper)
   - **代替**: spec drift 解消 phase (spec §3.7 customer_reservation_tokens / §12.1 attachments の改訂 + ADR-0011 (use-case service canonical) 起票)
2. **A.23 推奨**: `TokenizedReservationFlow` skeleton (customer 認証 + token verify + 予約閲覧 server action の縦切り) — A.21 で既に DB / service 完成、Phase 4 顧客 UI への接続が次の節目
3. **A.23 着手時の重要 task**:
   - TokenizedReservationFlow: service_role client 設計 (`src/lib/supabase/admin.ts` 流用) / customer route prefix (`/r/[token]/...`) / token verify wrapper (service_role 経由) / 監査ログ (audit_logs に customer event 追加)
   - **顧客側は Supabase Auth user にしない** (spec/CLAUDE.md ADR-0005 顧客本人確認 token table 経由のみ)
   - **service_role 利用境界** に customer-reservation-tokens.verifyAndConsumeToken の wrapper を追加 (ADR-0010 v2.1 に追記)
4. canonical mirror 状況 (A.22 で 14 種類カバー):
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 単純 CRUD without UNIQUE → `vendors.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし、FK SET NULL or 子なし) → `lane-types.ts` / `work-categories.ts` / `vendor-sla-overrides.ts` / `vendor-service-areas.ts`
   - hard delete + FK 違反 wrap (子テーブル参照中) → `statuses.ts`
   - hard delete + leftJoin で関連 name 取得 + nullable FK 許容 → `status-transitions.ts`
   - hard delete + 二重ガード (is_system + companyId NULL) + system seed 行のクロステナント可視性 → `roles.ts`
   - hard delete + 親 role ownership 検証 + leftJoin で role 名取得 + system seed の可視性 → `permissions.ts`
   - hard delete + 複合 UNIQUE(4 列) + Zod enum 値域強制 + nullable optional int refine → `notification-rules.ts`
   - M:N 関連 (full diff replace) → `lane-work-menus.ts` / `vendor-available-stores.ts`
   - 親 1:N サブ (full-replace, UNIQUE 有) → `lane-working-hours.ts` / `store-business-hours.ts`
   - 親 1:N サブ (per-row CRUD with UNIQUE) → `store-holidays.ts` / `vendor-sla-overrides.ts`
   - 親 1:N サブ (per-row CRUD with ends_on=NULL 排他) → `vehicle-ownerships.ts`
   - 親 1:N サブ (full-replace, UNIQUE 不在 → wipe + bulk insert) → `vendor-available-days.ts`
   - 親 1:N サブ (per-row CRUD without UNIQUE, 重複許容) → `vendor-service-areas.ts`
   - **use-case service (atomic verify+consume + hash + soft delete + status filters + reservation ownership 検証) → `customer-reservation-tokens.ts` (A.21 canonical)**
   - **use-case service (multi-FK polymorphic parent + cross-tenant ownership 検証 + UNIQUE 衝突 wrap + soft delete + mime/size whitelist + `{rows,total}` list) → `attachments.ts` (A.22 新規 canonical)**
5. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定
6. **users INSERT pattern**: `auth.users` への先行 INSERT が必要 (FK 違反防止)。`tests/integration/db/transport-order-invitations-fk.integration.test.ts:104` の `outerTx.execute(sql\`INSERT INTO auth.users (id) VALUES (${userId})\`)` pattern を採用 (A.22 fixture で確立)

### 想定規模 (Phase 64-A.23 例: TokenizedReservationFlow skeleton)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1-2 service (service_role wrapper + customer-facing flow) + 1-2 customer route + 1 test = 3-5 files |
| 想定行数 | 250-450 |
| 想定 tests 追加 | 4-7 ケース (token verify + service_role 経路 / 不正 token rejection / consumed token rejection / 顧客 server action authn / cross-tenant 不可視) |
| 完了後 tests 合計 | 398+ |
| 仕様判断量 | **高** (service_role 境界 / 顧客 route 設計 / audit_logs スキーマ / 顧客 UI URL pattern の仕様確定が必要) |

### 注意点

- TokenizedReservationFlow は service_role 利用境界拡張で仕様判断量「高」、Codex 委任前に Claude が仕様を確定させる (handoff §2.0)
- ADR-0010 (service_role 使用範囲) の追記が必要 (customer-reservation-tokens.verifyAndConsumeToken wrapper 追加)
- 顧客 route prefix (`/r/[token]/...` or `/customer/reservations/[token]`) の URL 設計確定
- 監査ログ event_type に "customer_view_reservation" / "customer_modify_reservation" / "customer_cancel_reservation" の 3 種追加
- attachments Storage 連携 (A.23 候補 2) は Supabase Storage bucket policy の RLS 設計が主軸、これも仕様判断量「高」

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.22 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 3 新規 UI (list page + [id]/page + [id]/actions) + 1 新規 test + 1 sealed = **6 files** |
| 新規 service 関数 | 4 (registerAttachment / listAttachments / getAttachmentById / softDeleteAttachment) + 3 error class (AttachmentParentNotFoundError / AttachmentStorageConflictError / AttachmentNotFoundError) + 3 helper (verifyParentOwnership / buildListConditions / selectListColumns / isUniqueViolation / toListItem / toDetail) + 2 const (ALLOWED_MIME_TYPES / MAX_BYTE_SIZE) + 1 const tuple (PARENT_TYPES) |
| advisor 呼び出し | 2 (use-case service の 4 論点 frame + reconcile で cross-tenant parent 検証論点追加) |
| Codex 委任 task 数 | 0 (advisor で方針確定後、Claude 自実装) |
| Codex 採用率 | 0/0 (A.22 単体)、累積 1/22 (A.1-A.22) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.22 試行なし) |
| 新規 tests | 10 cases / 約 681 行 (register 3 種 / cross-tenant parent / duplicate storage / list parent filter + count / cross-tenant list+getById / softDelete + 二重 / cross-tenant softDelete / uploadedBy filter / Zod 5 種) |
| invariants 維持 | typecheck clean / 394 tests / 48 test files |
| MVP blocker 消化 | 累積 **24/24 = 完了** (A.1-A.21 + attachments) |

## 振り返りメモ (attachments 完了を経て)

- **multi-FK polymorphic + cross-tenant 防御 canonical 確立**: 親 entity の type を Zod enum + discriminator で表現、service 層で type 別に該当 FK 列にのみ NOT NULL set + cross-tenant 検証。raw-migration XOR CHECK なしでも app 層で safety 確保。Phase 5 billing / vendor_billings 系の polymorphic 参照で再利用可能な pattern
- **MVP master/use-case 系完遂 (24/24)**: A.1-A.16 master CRUD (16 種) + A.17-A.20 master ハイブリッド (4 種) + A.21-A.22 use-case (2 種) = 22 phase で master/use-case 系完了。次は Phase 4 顧客統合に踏み込む
- **advisor の reconcile 価値**: 初回 4 論点提示後に「cross-tenant parent 検証論点が欠けている」と reconcile で指摘され、A.21 の TokenReservationNotFoundError 同型 pattern を採用。advisor 2 回呼び出しが test の網羅性 (cross-tenant 3 種) に直結
- **auth.users 先行 INSERT pattern の獲得**: users insert は `auth.users` への INSERT が前提 (FK 違反防止)。`tests/integration/db/transport-order-invitations-fk.integration.test.ts:104` pattern を A.22 fixture で確立、次以降の user insert test で再利用
- **Storage 分離設計の堅実さ**: A.21 (customer-reservation-tokens の service_role 分離) と同型で attachments の Storage 統合を Phase 4 へ分離。今 phase の test 困難 (Supabase Storage mock) を回避しつつ、metadata 部分の RLS / cross-tenant 防御は完全テスト
- **新セッション 1 ターン完遂継続**: A.3-A.22 で 20 連続 1 ターン完遂、advisor 1-2 回 + handoff の効果実証継続中
- **listAttachments の `{rows,total}` 統一**: customer-reservation-tokens canonical 倣う方針で countAttachments を削除し Promise.all で同時取得。admin UI が 1 関数で済むことを test 修正コストとトレードオフで採用

## /clear 推奨タイミング (本 Phase 完了時)

**本 Phase A.22 完遂後、`/clear` 推奨を発出**。理由:
- MVP master/use-case 系 24/24 完了、A.23 では Phase 4 顧客統合 (TokenizedReservationFlow / Storage 統合) に進む = ドメイン境界刷新
- 22 連続 1 ターン完遂で累積コンテキスト多 (handoff × 22 + master/use-case canonical の細部記憶)、次フェーズは設計判断軸が変わる (service_role 境界 / 顧客 route 設計 / audit_logs スキーマ) ため文脈刷新が望ましい
- A.23 着手時に必要なのは A.21-A.22 sealed + ADR-0005/0010 + spec §14.5 service_role 経路の 4 件のみ

新セッション開始時: `phase-64-a22-attachments-sealed.md` を読んで Phase 64-A.23 着手 (推奨: TokenizedReservationFlow skeleton)。

---

*Phase 64-A.22 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.23 (推奨: TokenizedReservationFlow skeleton で Phase 4 顧客統合の第一歩、本 branch `phase-64-mvp-implementation` 継続)*
