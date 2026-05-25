# Phase 34 入力契約: Phase 31-B sealed (admin vendor invitation UI + schema)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 34 (前: 31-B sealed) |
| 状態 | Phase 31-B sealed / Phase 31 (admin invite UI 全体) B 完了、C 未着手 |
| 完了日時 | 2026-05-25 |
| 担当 | Claude (resume + S1 migration + S3 admin client + S5 callback 設計) / Codex (S2 schema + S4 service + S5 callback 実装 + S6-8 UI + S9 unit + S10 integration+docs) / planner agent (plan) |
| 前 handoff | `phase-32-phase-31-a-foundation-sealed.md` |
| Plan | `phase-33-phase-31-b-plan.md` |
| 主要 commit | (Phase 31-B commit pending) |

## 達成したこと (Phase 31-B)

- **新規 table**: `admin_vendor_invitations` (id/company_id/vendor_id/invited_by_user_id/vendor_user_id/email/name/role/status/token_hash/expires_at/sent_at/accepted_at/created_at/updated_at)
- **migration**: `post/0010_admin_vendor_invitations.sql` + RLS tenant_isolation + UNIQUE partial index (pending) + updated_at trigger 適用済
- **Drizzle schema**: `src/lib/db/schema/admin_vendor_invitations.ts` (`adminVendorInvitations`, type `AdminVendorInvitation` / `NewAdminVendorInvitation`)
- **service**: `createAdminVendorInvitation(db, supabaseAdmin, adminUser, input)` で vendor 確認 → 重複チェック → auth.admin.findUser / inviteUserByEmail → TX 内で vendor_users + admin_vendor_invitations + notification_outbox INSERT → 失敗時に新規 auth user 削除補償
- **3 Error クラス**: `AdminVendorInvitationDuplicateError` / `AdminVendorInvitationCrossTenantError` / `AdminVendorInvitationAuthError`
- **accept callback**: `(vendor-portal)/vendor/admin-invite-callback/route.ts` で exchangeCodeForSession → vendor_users.is_active=true + lastLoginAt + admin_vendor_invitations.status='accepted'
- **invite UI**: `(admin)/vendors/invite/{page.tsx, form.tsx, actions.ts}` (Server Component + Client Form + Server Action、shadcn は使わず素の form 要素)
- **vendors page 改修**: `(admin)/vendors/page.tsx` に「業者を招待」ボタンと `invited=ok` query での成功メッセージ
- **共通 helper**: `src/lib/supabase/admin.ts` の `getConfiguredSupabaseAdmin()` (onboard-action.ts のインライン版を抽出)
- **unit tests**: `tests/unit/lib/services/admin-vendor-invitations.test.ts` 4 ケース (happy / cross-tenant / duplicate / auth failure)
- **integration test**: `tests/integration/tenant-isolation.test.ts` に admin_vendor_invitations cross-tenant 0 行ケース 1 追加
- **ADR-0010 補項**: `spec/CLAUDE.md:138-140` に admin invite 3 path 追記

## Claude 側の主要設計判断

1. **planner agent で plan 作成 → 8 設計判断確定**: テーブル schema / migration 配置 (post/0010 厳守、handoff invariant) / service signature / service_role 共通化 (admin.ts) / callback (vendor-portal) group 配置 / RLS tenant_isolation / invite form UI / エラー処理
2. **Codex 委任を 5 task に分割**: S2 schema、S4 service (250 行)、S5 callback (52 行、auth boundary)、S6-8 UI (3 ファイルまとめ、依存密)、S9 unit tests、S10 integration+ADR
3. **S5 callback の hook block 経験**: 1 回 override (auth-callback boundary HIGH stake) → 2 回目で escalation 発動 → 委任に切替え。hook の意図に従い盲従しなかった
4. **commit 戦略**: Plan では 5 commit に分割推奨だったが、Phase 31-A と整合させ Phase 31-B も 1 commit に集約

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260525-125640-d874 | S2: Drizzle schema | applied (tsc clean) |
| del-20260525-130422-5ff7 | S4: service 関数 + 3 Error | applied (tsc clean、Claude 側で verify) |
| del-20260525-131036-c25f | S5: callback route | applied (tsc clean、Claude 側で verify) |
| del-20260525-131506-d041 | S6-S8: UI 3 ファイル + page 改修 | applied (Codex 側 tsc clean + vitest 91 PASS 確認) |
| del-20260525-? (S9) | S9: 4 unit tests | applied (Claude 側で確認、4 PASS) |
| del-20260525-132317-3f69 | S10: tenant-isolation + ADR-0010 | applied (Claude 側で確認、1 PASS) |

## 主要ファイル (Phase 31-C reference)

- `src/lib/services/admin-vendor-invitations.ts` — service 関数本体、31-C で resend / revoke 用に拡張
- `src/lib/db/schema/admin_vendor_invitations.ts` — status enum (pending/sent/accepted/expired/revoked) を 31-C で活用
- `src/app/(admin)/vendors/invite/actions.ts` — server action のパターン (resend/revoke も同 path 内)
- `src/app/(admin)/vendors/page.tsx` — 31-C で本格 list 実装 (invited=ok 表示は維持)
- `src/lib/supabase/admin.ts` — 共通 helper、31-C 以降で再利用
- `src/app/(vendor-portal)/vendor/admin-invite-callback/route.ts` — accept callback、token_hash 厳格化を 31-C で検討
- `phase-handoff/phase-33-phase-31-b-plan.md` — 設計判断 8 点と実装 step 詳細

## データモデル変更

- 新規 table: `admin_vendor_invitations` (post/0010_*.sql 適用済)
- RLS: tenant_isolation (admin 専用)、vendor portal user は current_user_company_id()=NULL で 0 行
- 既存 table 変更なし

## API 契約

- 公開 API シグネチャ変更なし (respondToInvitation / respondToSpotInvitation / respondToTransportOrder 不変)
- 新規 service: `createAdminVendorInvitation(db, supabaseAdmin, adminUser, input): Promise<CreateAdminVendorInvitationResult>` (server-only)
- 新規 server action: `inviteVendorAction(prevState, formData): Promise<InviteVendorFormState>` (useActionState 用)
- 新規 callback: `GET /vendor/admin-invite-callback?code=<code>` → redirect

## テスト・QA 状況

- vitest: **96 PASS / 0 FAIL** (前 91 + S9 4 + S10 1) ✓
- typecheck (`pnpm tsc --noEmit`): clean ✓
- CI E2E: Phase 31-B も未走 (Phase 31-A と一緒に push で確認予定)
- 手動 verify (dev server): **未実施** (Phase 31-A 同様、PR push で本番相当動作確認)
- migration: `pnpm db:apply-raw:post` で 0010 適用済 (`Completed: 1 applied, 7 skipped`)

## 既知の懸念・TODO (Phase 31-C スコープ候補)

- **Phase 31-C 着手項目**:
  - `(admin)/vendors/page.tsx` 本格 list 実装 (vendors SELECT + 招待状況 join)
  - admin_vendor_invitations の resend (新規 token 発行 + auth.admin.inviteUserByEmail 再送 + status='sent' 維持)
  - revoke (status='revoked' UPDATE + auth.admin.deleteUser? 検討)
  - 期限切れ自動 expire (cron で expires_at < now() AND status='pending' → 'expired')
  - 監査ログ (audit_logs INSERT、ADR-0009)
  - E2E (admin invite → vendor accept → /vendor/requests 到達)
- **token_hash の用途未定**: 現状 service は token_hash を埋めていない (auth invite link の token は Supabase 側が管理)。31-C で「admin が token を保持してリンク再生成する」要件が出たら埋める
- **Phase 31-A 追補 (未着手)**:
  - `?next=` 完全実装 (login server action 側の next 消費)
  - doc fix: `spec/data-model.md` §3.4 `roles.key` → `roles.code`、`headquarters_admin` → `admin` 表記
- **vendor portal cross-portal 500 bug** (pre-existing): `users` テーブルユーザーが `/vendor/requests` → vendor_users 0 行 → 500

## Phase 34 入力契約

### 前提として動くべき機能
- admin が `/admin/vendors/invite` フォームから vendor を招待できる (auth.admin.inviteUserByEmail で実 invitation 送信)
- vendor が招待リンクから accept → `/vendor/requests` に到達、vendor_users.is_active=true
- admin_vendor_invitations table が tenant_isolation で守られている (96 PASS 維持)
- vitest 96 PASS / typecheck clean

### 参照すべきファイル
- 本 handoff (`phase-34-phase-31-b-sealed.md`)
- `phase-33-phase-31-b-plan.md` (plan + 設計判断 8 点)
- `phase-32-phase-31-a-foundation-sealed.md` (Phase 31-A foundation)
- `phase-23-sprint-beta-recon-admin-invite.md` §4-5 (案 B 設計 source of truth)
- `spec/CLAUDE.md:131-140` (ADR-0010 補項、Phase 31-B 拡張済)
- `src/lib/services/admin-vendor-invitations.ts` (resend/revoke 拡張対象)

### 絶対に壊してはいけないもの (invariants)
- vitest 96 PASS / typecheck clean
- alpha-1-public 27/28/29 ファイル touch 0 (新規は post/0011+ または専用)
- 公開 API シグネチャ (respondToInvitation 系 3 つ + createAdminVendorInvitation)
- `tests/integration/tenant-isolation.test.ts` の admin_vendor_invitations + vendors invariant
- `getAdminUser()` signature (`src/lib/auth/admin-role.ts:9-13`)
- middleware admin matcher + `?next=` 付与 (`src/middleware.ts:50-66`)
- ADR-0010 補項 (拡張のみ可、縮小禁止)

### 推奨される次 Phase スコープ
- **Phase 31-C (推奨次)**: vendors list 本格 + resend/revoke + expire automation + 監査ログ + E2E
- または: Phase 31-A 追補 (`?next=` / doc fix) を先に消化
- または: CI E2E push で Phase 31-A + 31-B を統合検証

### 注意点・コンテキスト
- branch: `phase-26-ci-verify`、Phase 31-A commit `0242f1a` の上に Phase 31-B 1 commit を積む予定
- `auth.admin.inviteUserByEmail` の idempotency は `findAuthUserByEmail` 事前チェックで担保
- callback route は service_role バイパスではなく drizzle db client (postgres role) で RLS bypass (ADR-0010 補項)
- hook block で 5 step が委任に切り替わった (S2/S4/S5/S6-8/S9/S10)、Phase 31-B の Codex 委任率は約 92% (Claude 直接は S1 migration / S3 admin client のみ)

## Codex ledger refs

- del-20260525-125640-d874 (S2 schema)
- del-20260525-130422-5ff7 (S4 service)
- del-20260525-131036-c25f (S5 callback)
- del-20260525-131506-d041 (S6-S8 UI)
- (S9 unit del-id 未通知)
- del-20260525-132317-3f69 (S10 integration+ADR)
- override: blk-mpl8452f-a6ru (S5 callback auth boundary、結局 2 回目 block で escalation → 委任)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 31-B commit 数 | 1 予定 |
| 追加コード行数 | ~610 (migration 60 + schema 55 + admin client 20 + service 250 + callback 52 + UI 4ファイル ~170) |
| 新規ファイル | 9 (+ plan + handoff) |
| 修正ファイル | 4 (schema/index / vendors page / spec/CLAUDE.md / tenant-isolation) |
| 追加テスト数 | 5 (91 → 96 PASS、unit 4 + integration 1) |
| Codex 委任 task 数 | 6 |
| Codex 委任行数 | ~560 (~92%) |
| Claude 直接 | S1 migration (60) + S3 admin client (20) + S5 callback の override 試行 (途中失敗) |
| advisor 呼び出し | 0 回 |
| planner agent | 1 回 (plan 作成) |
| セッション数 | 1 (Phase 31-A sealed → Phase 31-B sealed) |

## 振り返りメモ

- うまくいった: planner agent で 8 設計判断を事前確定、実装中の判断 budget 節約
- うまくいった: S6-S8 を 1 task でまとめて UI 周りの文脈を Codex 内で共有、依存衝突回避
- うまくいった: S9+S10 を background で並列起動、Claude は待ち時間を最小化
- 課題: S5 callback で hook override → escalation で委任に切替。最初から委任の方が効率的だった
- 課題: migration を書いた後 DB へ適用 (`pnpm db:apply-raw:post`) を最後の integration test 実行まで忘れていた。次回は migration 書いたら即座に apply
- 学び: Phase 31-A handoff invariant (post/0010+) を遵守したことで alpha-1-public touch 0 維持できた
- 学び: Codex 委任率 ~92% は Phase 31-A の 96% と同水準、policy=max が機能している

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-25 (Phase 31-B vendor invitation 完了)*
