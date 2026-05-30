# Phase 64-A.22 入力契約: Phase 64-A.21 customer_reservation_tokens sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.21 (前: 64-A.20 notification_rules sealed) |
| 状態 | **sealed** (customer_reservation_tokens use-case service: issueToken / verifyAndConsumeToken / revokeToken / listTokens / getTokenById + atomic UPDATE + admin list/detail UI + 11 integration tests / 384 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (advisor §76 で方針確定後実装、19 連続 1 ターン完遂継続、Codex 試行スキップ) |
| 前 handoff | `phase-64-a20-notification-rules-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |
| **/clear 推奨** | **本 Phase 完了後、A.22 で Phase 4 顧客本人確認の use-case 系を仕上げ、残 MVP blocker 1 件 (attachments) の境界、`/clear` 推奨を発出** |

## 達成したこと (Phase 64-A.21)

- 1 ファイル新規 service (`customer-reservation-tokens.ts` 約 285 行、use-case service: `issueToken` / `verifyAndConsumeToken` / `revokeToken` / `listTokens` / `getTokenById` + 2 error class)
- 3 ファイル新規 UI (`admin/customer-reservation-tokens/page.tsx` 一覧 / `[id]/page.tsx` 詳細 / `[id]/actions.ts` revoke action)。**new ページは作成せず** (token 発行は将来の予約フロー連動 server-side flow から呼ぶため)
- 1 ファイル新規 integration test (11 cases: issue happy + raw token 1 回限り返却 + DB は hash のみ / TokenReservationNotFoundError (cross-tenant reservation) / verify+consume happy + 2 回目 used / verify expired (expires_at 過去更新) / verify not_found / revoke + 二度目 false + verify revoked / cross-tenant verify not_found + 元 company で消費可能 / list status フィルタ 4 種 + includeRevoked + cross-tenant 除外 / getTokenById cross-tenant null + token_hash 不公開 / Zod 4 種 (ttl 0 / ttl 過大 / 非 UUID / 空 rawToken) / hash 一意性 + 同一予約に複数 token 発行)
- 既存 schema / RLS / raw-migration 変更 **0** (drizzle schema 既存 `customer_reservation_tokens.ts` をそのまま利用、spec drift 既知のため DB を真実採用)
- 既存 service / admin-shell ナビ変更 **0** (settings ハブ経由想定)
- typecheck clean (tsc --noEmit 通過、exit=0)
- **384 tests PASS** (373 + 新規 11、47 test files、handoff §102 想定 379+ クリア)

## Claude 側の主要設計判断

1. **spec/DDL drift: DB 真実採用** (permissions A.19 前例同型)
   - spec/data-model.md §3.7 は `customer_id NOT NULL` + `purpose text NOT NULL CHECK IN ('view','modify','cancel')` を記載
   - 実 DDL (`alpha-1-public/11_reservations.sql`) と drizzle schema は `customer_id nullable + ON DELETE SET NULL` + **no purpose** + `used_at` + `updated_at` + `deleted_at` (soft delete) + UNIQUE(token_hash) + RLS tenant_isolation + trg_set_updated_at trigger
   - 判断: DB を真実採用、spec §3.7 改定は別 phase。今 phase は drizzle schema をそのまま利用
2. **master CRUD ではなく use-case service**: `issueToken` / `verifyAndConsumeToken` / `revokeToken` の 3 関数が主、`listTokens` / `getTokenById` は admin 診断補助。**`new` ページなし** (token 発行は将来の予約発行 server-side flow から呼ぶ想定)
3. **verify+consume を atomic に実装**: 1 文の `UPDATE customer_reservation_tokens SET used_at = now() WHERE token_hash = $1 AND company_id = $2 AND used_at IS NULL AND deleted_at IS NULL AND expires_at > now() RETURNING *`。0 行返却時のみ別 SELECT で reason 区別 (`not_found` / `expired` / `used` / `revoked`)。並列リクエストでの二重使用を DB レベルで防止
4. **token hash 方式**: `crypto.randomBytes(32)` = 256 bit エントロピー → `sha256` hex 64 chars hash。**生 token は `issueToken` の戻り値で 1 回だけ返却**、DB には hash のみ保存 (test で確認)。spec/data-model.md §3.7 ヘッダ "SHA-256 hash" と整合
5. **MVP は single-use 固定**: spec §3.7 注釈 "view 用途は multi-use 想定" は `purpose` 列が実装されていないため保留。view/modify/cancel 統合運用、必要時に列追加
6. **rate limit なし**: MVP 後ろ送り、256 bit エントロピー前提
7. **service_role 経路は今 phase で作らない**: spec §14.5 の "顧客 Server Action から service_role 経由" は Phase 4 顧客 UI 統合時に別関数追加。今 phase は全て company-scoped (admin 経路のみ)
8. **reservation ownership 検証**: `issueToken` で `reservations.companyId = ctx.companyId` を SELECT で先に検証、不正な reservationId を弾く (`TokenReservationNotFoundError`)
9. **VerifyAndConsumeResult discriminated union**: `{ ok: true; reason: "ok"; token } | { ok: false; reason: "not_found" | "expired" | "used" | "revoked" }`。admin 診断・Phase 4 顧客 UI 双方で reason 別 UX を実現可能
10. **list status フィルタ 4 種**: `active` (used_at IS NULL AND deleted_at IS NULL AND expires_at > now()) / `used` (used_at IS NOT NULL) / `expired` (used_at IS NULL AND deleted_at IS NULL AND expires_at <= now()) / `revoked` (deleted_at IS NOT NULL)。`includeRevoked` 既定 false で revoked 行を default で除外

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.21 customer_reservation_tokens use-case | **Claude 自実装 (advisor で方針確定後実装、19 連続 1 ターン完遂継続)** |

→ A.21 も Codex 試行ゼロで Claude 完遂。block override 記録 4 件 (service + UI 2 + actions + test)。

## Phase 64-A.22 入力契約 (新セッションで使用)

### 参照すべきファイル

- 本 handoff (`phase-64-a21-customer-reservation-tokens-sealed.md`)
- `phase-64-a20-notification-rules-sealed.md` (notification_rules canonical: 複合 UNIQUE + Zod enum)
- `src/lib/services/customer-reservation-tokens.ts` (atomic verify+consume + token hash 方式 + use-case 関数設計の新 canonical)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker 累積 **23/24** (A.21 で customer_reservation_tokens 消化、残り 1 件 = attachments)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.21 機能すべてに retrogression なし
- typecheck clean / 47 test files / **384 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.20 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- `customer_reservation_tokens` schema は UUID PK + companyId NOT NULL + reservationId NOT NULL (CASCADE) + customerId nullable (SET NULL) + token_hash NOT NULL UNIQUE + expires_at NOT NULL + used_at nullable + soft delete (deleted_at) + RLS tenant_isolation + trg_set_updated_at trigger のまま不変
- token 生値は `issueToken` 戻り値で 1 回のみ返却、DB 保存しない (sha256 hash のみ)
- verify+consume は **必ず 1 文 UPDATE + RETURNING で atomic** に保持 (race condition 防止)
- single-use 固定 (purpose 列実装まで)

### Phase 64-A.22 着手時の最初の判断

1. **次の MVP blocker 候補** (残 1 件 = attachments):
   - **attachments** (画像/PDF upload、Supabase Storage 連携必要、外部依存、仕様判断量「高」)
   - 代替: 既存 use-case の整理・テスト追加・spec drift 解消 phase (TokenizedReservationFlow / Phase 4 顧客 server action skeleton 等)
2. **A.22 推奨**: `attachments` (残 MVP blocker 1 件で master/use-case 系完遂、Phase 4 統合段階に踏み込む節目)
3. **A.22 着手時の重要 task**:
   - attachments: spec §10 確認 / DDL 状態確認 / Supabase Storage bucket 設計 / signed URL 方式 / mime_type 制限 / file size 上限 / 親 entity との multi FK (transport_order / service_ticket / reservation のどれ) / soft delete vs hard delete の 4 点を最初に整理
   - **Storage 外部依存ありで local test 困難** (mock 設計が主軸) — service の DB 部分のみテスト、Storage 部分は contract test or integration test を Phase 4 統合時に補完
4. canonical mirror 状況 (A.21 で 13 種類カバー、use-case 系の最初):
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 単純 CRUD without UNIQUE → `vendors.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし、FK SET NULL or 子なし) → `lane-types.ts` / `work-categories.ts` / `vendor-sla-overrides.ts` / `vendor-service-areas.ts`
   - hard delete + FK 違反 wrap (子テーブル参照中) → `statuses.ts`
   - hard delete + leftJoin で関連 name 取得 + nullable FK 許容 → `status-transitions.ts`
   - hard delete + 二重ガード (is_system + companyId NULL) + system seed 行のクロステナント可視性 → `roles.ts`
   - hard delete + 親 role ownership 検証 + leftJoin で role 名取得 + system seed の可視性 (操作不可) → `permissions.ts`
   - hard delete + 複合 UNIQUE(4 列) + Zod enum 値域強制 + nullable optional int refine → `notification-rules.ts`
   - M:N 関連 (full diff replace) → `lane-work-menus.ts` / `vendor-available-stores.ts`
   - 親 1:N サブ (full-replace, UNIQUE 有) → `lane-working-hours.ts` / `store-business-hours.ts`
   - 親 1:N サブ (per-row CRUD with UNIQUE) → `store-holidays.ts` / `vendor-sla-overrides.ts`
   - 親 1:N サブ (per-row CRUD with ends_on=NULL 排他) → `vehicle-ownerships.ts`
   - 親 1:N サブ (full-replace, UNIQUE 不在 → wipe + bulk insert) → `vendor-available-days.ts`
   - 親 1:N サブ (per-row CRUD without UNIQUE, 重複許容) → `vendor-service-areas.ts`
   - **use-case service (issue / verify+consume atomic + hash + soft delete + status filters + reservation ownership 検証) → `customer-reservation-tokens.ts` (A.21 新規 canonical)**
5. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定

### 想定規模 (Phase 64-A.22 例: attachments)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1 service + 1 test + (UI 0-3) + (Storage helper 0-1) = 2-6 files |
| 想定行数 | 350-600 |
| 想定 tests 追加 | 6-10 ケース (upload metadata 登録 / list by parent / delete / Zod / cross-tenant / soft delete / mime_type 制限 / size 上限。Storage 連携 mock 必要) |
| 完了後 tests 合計 | 390+ |
| 仕様判断量 | **高** (Storage 外部依存 / mime_type 値域 / size 上限 / 親 entity polymorphic / signed URL TTL の仕様確定が必要) |

### 注意点

- attachments は Storage 外部依存ありで仕様判断量「高」、Codex 委任前に Claude が仕様を確定させる (handoff §2.0)
- Storage mock 設計が主軸、DB 部分のみテスト → contract test で Storage 連携は Phase 4 統合時に補完
- spec §10 (attachments) / raw-migration `16_attachments.sql` / drizzle schema の 3 点突合継続 (handoff §146 推奨)
- 残 MVP blocker 1 件で MVP master/use-case 系は実質完了、A.22 以降は Phase 4 統合に踏み込む節目
- customer_reservation_tokens の Phase 4 統合では **service_role 経由 verify 関数** を別途追加 (今 phase は company-scoped のみ)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.21 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 3 新規 UI (list page + [id]/page + [id]/actions) + 1 新規 test + 1 sealed = **6 files** |
| 新規 service 関数 | 5 (issueToken / verifyAndConsumeToken / revokeToken / listTokens / getTokenById) + 2 error class (TokenReservationNotFoundError / TokenHashCollisionError) + 2 helper (generateRawToken / hashToken / selectListColumns / isUniqueViolation) |
| advisor 呼び出し | 1 (use-case service の 4 点 (drift 解決 / use-case 設計 / atomic verify / MVP 制約) を確定するため) |
| Codex 委任 task 数 | 0 (advisor で方針確定後、Claude 自実装) |
| Codex 採用率 | 0/0 (A.21 単体)、累積 1/21 (A.1-A.21) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.21 試行なし) |
| 新規 tests | 11 cases / 約 320 行 (issue happy + raw token + DB hash 確認 / cross-tenant reservation / verify+consume atomic / expired / not_found / revoked / cross-tenant verify / list 4 status filters / getTokenById / Zod 4 種 / hash 一意性) |
| invariants 維持 | typecheck clean / 384 tests / 47 test files |
| MVP blocker 消化 | 累積 23/24 (A.1-A.20 + customer_reservation_tokens) |

## 振り返りメモ (customer_reservation_tokens 完了を経て)

- **use-case service canonical の確立**: master CRUD と異なり、use-case 中心 (`issueToken` / `verifyAndConsumeToken` / `revokeToken`) で 1 service 内に 3 種類の責務を持たせる pattern。Phase 4 attachments / Phase 5 billing 系で再利用可能な設計テンプレ
- **atomic verify+consume の重要性**: SELECT → UPDATE 分離だと並列リクエストで二重使用が通る。1 文 UPDATE + RETURNING で DB レベルの排他を実現、TypeScript 側の transaction lock 不要
- **discriminated union for reason**: `{ ok: true; reason: "ok" } | { ok: false; reason: "..." }` でユーザー UX (admin 診断 + Phase 4 顧客 UI) を統一可能
- **token 生値の 1 回限り返却**: test で `rawToken !== tokenHash` を確認 + DB に hash のみ格納を確認 + `getTokenById` の戻り値に `tokenHash` 不含を確認。3 重防御
- **DB 真実採用 (drift 解消)**: spec §3.7 stale → DB 採用は permissions A.19 と同型 pattern、次の attachments も spec drift があれば同じ判断
- **新セッション 1 ターン完遂継続**: A.3-A.21 で 19 連続 1 ターン完遂、advisor 1 回 + handoff の効果実証継続中
- **use-case 系への移行**: A.21 で master 系 phase が実質完了、A.22 (attachments) で残 1 件、その後 Phase 4 統合 (customer UI / TokenizedReservationFlow / Storage 統合) に進む

## /clear 推奨タイミング (本 Phase 完了時)

**本 Phase A.21 完遂後、`/clear` 推奨を発出**。理由:
- customer_reservation_tokens で use-case service canonical 1 種類目を確立、A.22 では attachments (Storage 外部依存) で性質が再度変わる
- master CRUD 12 種類 + use-case 1 種類が確立、新セッションは canonical 参照と新 pattern (Storage / Phase 4 統合) 設計に集中できる文脈刷新が望ましい
- 本セッション (A.21 単独 1 ターン完遂) はコンテキスト累積少だが、次 domain (Phase 4 統合 = MVP 仕上げ) 移行で刷新推奨

新セッション開始時: `phase-64-a21-customer-reservation-tokens-sealed.md` を読んで Phase 64-A.22 着手。

---

*Phase 64-A.21 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.22 (推奨: attachments で残 MVP blocker 1 件完遂、本 branch `phase-64-mvp-implementation` 継続)*
