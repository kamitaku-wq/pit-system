# Phase 36 入力契約: Phase 31-C sealed (vendors list + resend/revoke + audit trigger)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 36 (前: 31-C sealed) |
| 状態 | Phase 31-C sealed / Phase 31 (admin invite lifecycle) C 完了、D 未着手 |
| 完了日時 | 2026-05-25 |
| 担当 | Claude (resume + planner + Codex adversarial + advisor + S1 migration + 全 S レビュー) / Codex (S2 service + S3 actions + S4 list helper + S5 UI + S6 unit + S7 integration+ADR) |
| 前 handoff | `phase-35-phase-31-c-plan.md` (plan)、`phase-34-phase-31-b-sealed.md` (前 Phase 完了) |
| 主要 commit | (Phase 31-C commit pending) |

## 達成したこと (Phase 31-C)

- **post/0011 migration**: 4 ステップ (index 拡張 / `last_resent_at` 追加 / `redact_audit_payload` admin_vendor_invitations branch / `trg_audit_admin_vendor_invitations`) を 1 ファイルに統合、適用済 (`Completed: 1 applied, 8 skipped`)
- **Drizzle schema**: `lastResentAt` 列追加 + `pendingUnique` index WHERE を `status IN ('pending','sent')` に拡張
- **service 拡張**: 3 新規 Error (NotFound/InvalidState/ResendTooEarly) + `resendAdminVendorInvitation` (60s rate limit + vendor_users 経由で auth_user_id 取得し O(n) listUsers 回避) + `revokeAdminVendorInvitation` (accept 状態分岐 + NULL safe TX)
- **server actions**: `(admin)/vendors/actions.ts` 新規 (`resendInvitationAction` + `revokeInvitationAction`、zod uuid validation + 5 種類 Error message + redirect)
- **list helper**: `admin-vendors.ts` 新規 (`getVendorsWithInvitationStatus`、LEFT JOIN LATERAL + CASE 優先順位で canonical `latest_invitation_status` 正規化、N+1 なし)
- **vendors page**: `page.tsx` を 36 → 238 行に刷新、素 HTML table + Tailwind (shadcn 不使用)、6 status badge、resend/revoke 行アクション、3 種類 success banner
- **audit trigger**: `trg_audit_admin_vendor_invitations` AFTER INSERT/UPDATE/DELETE 動作、email `x***@domain` + name `テ***` マスク確認済 (integration test)
- **ADR-0010 補項**: post を `redact_audit_payload` の唯一 source of truth とする運用を明記
- **テスト**: vitest **96 → 109 PASS** (+13、unit +11 + integration +2)

## Claude 側の主要設計判断

1. **planner + Codex adversarial + advisor 三層レビュー**: planner で plan 確定 → Codex で 4 critical 検出 → advisor で「C2 verify が discriminating constraint」と判定 → C2 を 4 ファイル Read で verify (`db:apply-raw:post` は post のみ、`CREATE OR REPLACE` 前例 3 件、`23_record_audit_log.sql` の 9-trigger pattern) → plan を 8 → 11 設計判断に拡張
2. **2 phase 分割**: 6 項目を 31-C (list+resend+revoke+audit) と 31-D (expire+E2E+補追) に分割し、commit を 1 個に保つ
3. **C1 Codex 過大評価補正**: dev DB に重複なし + test fixture grep 確認済で `CONCURRENTLY` YAGNI、RAISE NOTICE 警告のみで失敗させない
4. **C2 post を SoT**: alpha-1-public 18 base 定義は base、admin_vendor_invitations branch は post/0011 のみで実装。db:setup の post-last 順序が安全性担保
5. **C3 resend で listUsers 呼ばない**: invitation 行から vendor_user_id 経由で auth_user_id 取得することで `findAuthUserByEmail` O(n) を回避
6. **C4 latest_status 正規化**: SQL の `LEFT JOIN LATERAL` + `CASE WHEN status='pending' THEN 1 ...` で各 vendor 最新 1 行に絞る
7. **D-10 NULL safe revoke**: vendor_user_id IS NULL でも UPDATE 0 行 OK、エラーにせず status='revoked' 進行
8. **S1 hook block escalation 経験**: 1 回 override → 2 回目 escalation で Codex 委任に切替。Codex が `$$` を `2119427` に誤置換した出力を Claude が Edit で修復 (reject 記録、 PL/pgSQL dollar-quoting bug)

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260525-143814-529f | S1: migration (Codex 出力 corrupt → reject、Edit で修復) | rejected → Claude fix |
| del-20260525-144245-623d | S2: service + Drizzle schema | applied (typecheck clean) |
| del-20260525-144753-d63b | S3: server actions | applied (typecheck clean) |
| del-20260525-144811-02c3 | S4: list helper | applied (LATERAL JOIN raw SQL) |
| del-20260525-144818-?  (S5 acf1872758b8fff0b) | S5: page.tsx 本格 list | applied (238 行) |
| del-20260525-?  (S6) | S6: 11 unit tests | applied (15 PASS) |
| del-20260525-?  (S7) | S7: integration + ADR | applied (2 integration test + spec/CLAUDE.md +2 行) |

## 主要ファイル (Phase 31-D reference)

- `src/lib/db/raw-migrations/post/0011_phase31c_fixup_and_audit_trigger.sql` — redact_audit_payload SoT
- `src/lib/services/admin-vendor-invitations.ts` — 6 Error + 3 関数 (create/resend/revoke)
- `src/lib/services/admin-vendors.ts` — list helper、Phase 31-D 拡張 (expire 用 cron 関数)対象
- `src/app/(admin)/vendors/actions.ts` — server actions、Phase 31-D で expire admin trigger 追加可
- `src/app/(admin)/vendors/page.tsx` — UI、Phase 31-D で E2E spec ターゲット
- `tests/integration/tenant-isolation.test.ts` — Phase 31-D で expire cron テスト追加
- `phase-handoff/phase-35-phase-31-c-plan.md` — 11 設計判断と実装 step 詳細

## データモデル変更

- 既存 table `admin_vendor_invitations` に `last_resent_at timestamptz NULL` 追加 (post/0011 b)
- partial unique index `admin_vendor_invitations_pending_unique` の WHERE 拡張 (`pending` → `pending,sent`)
- `redact_audit_payload(text, jsonb)` に `admin_vendor_invitations` branch 追加 (CREATE OR REPLACE、post を SoT)
- 新規 trigger: `trg_audit_admin_vendor_invitations` AFTER INSERT/UPDATE/DELETE → `record_audit_log()`

## API 契約

- 公開 API シグネチャ不変 (respondTo* 3 + createAdminVendorInvitation)
- 新規 service: `resendAdminVendorInvitation(db, supabaseAdmin, adminUser, invitationId): Promise<{invitationId, sentAt}>`
- 新規 service: `revokeAdminVendorInvitation(db, adminUser, invitationId): Promise<{invitationId, revoked}>`
- 新規 service: `getVendorsWithInvitationStatus(db, companyId): Promise<VendorWithInvitationStatus[]>`
- 新規 server action: `resendInvitationAction(prev, formData)` / `revokeInvitationAction(prev, formData)`
- 3 新規 Error: `AdminVendorInvitationNotFoundError` / `AdminVendorInvitationInvalidStateError` / `AdminVendorInvitationResendTooEarlyError`

## テスト・QA 状況

- vitest: **109 PASS / 0 FAIL** (前 96 + S6 11 + S7 2) ✓
- typecheck (`pnpm tsc --noEmit`): clean ✓
- CI E2E: Phase 31-A + 31-B + 31-C 統合まだ未走 (Phase 31-D push 時に検証予定)
- 手動 verify (dev server): **未実施** (PR push 統合検証へ defer)
- migration: post/0011 適用済 (`1 applied, 8 skipped`)

## 既知の懸念・TODO (Phase 31-D スコープ)

- **Phase 31-D 着手項目**:
  - `src/lib/inngest/functions/invitation-expirer.ts` 新規 (hourly cron で `expires_at < now() AND status IN ('pending','sent')` → `expired`) + Inngest client 登録
  - `tests/_helpers/seed-admin-e2e.ts` (admin role user seed、playwright 用)
  - `tests/e2e/admin-vendor-invite.spec.ts` (admin invite → vendor accept → /vendor/requests 到達)
  - Phase 31-A 追補 (`?next=` login server action 完全実装 / `spec/data-model.md` §3.4 doc fix: roles.key→code, headquarters_admin→admin)
- **resend で取得した vendor_users.authUserId が未使用** (S2 Codex 出力の軽微残置): inviteUserByEmail は email を引数に取るため auth_user_id 取得は実質確認用。後段リファクタで削除可
- **revoke 後の vendor session 強制失効未実装**: `auth.admin.signOut(userId)` は Phase 31-D 以降検討
- **vendor portal cross-portal 500 bug** (pre-existing): `users` テーブルユーザーが `/vendor/requests` → vendor_users 0 行 → 500

## Phase 36 入力契約

### 前提として動くべき機能
- admin が `/admin/vendors` で vendors list + invitation status (6 種) を確認できる
- resend → `sent_at` + `last_resent_at` 更新、60s 以内再送は `AdminVendorInvitationResendTooEarlyError`
- revoke (pending/sent) → `status='revoked'` + `vendor_users.is_active=false`、accept 後は `AdminVendorInvitationInvalidStateError`
- audit_logs に admin_vendor_invitations の INSERT/UPDATE/DELETE が email/name マスクで記録される
- vitest 109 PASS / typecheck clean

### 参照すべきファイル
- 本 handoff (`phase-36-phase-31-c-sealed.md`)
- `phase-35-phase-31-c-plan.md` (plan + 11 設計判断 + Codex+advisor review history)
- `phase-34-phase-31-b-sealed.md` (Phase 31-B foundation)
- `phase-23-sprint-beta-recon-admin-invite.md` §4-5 (案 B 設計 source of truth)
- `spec/CLAUDE.md:131-142` (ADR-0010 補項、Phase 31-C 拡張済)
- `src/lib/services/admin-vendor-invitations.ts` (Phase 31-D で expire 関数追加対象)
- `src/lib/services/admin-vendors.ts` (Phase 31-D で list 拡張対象)

### 絶対に壊してはいけないもの (invariants)
- vitest 109 PASS / typecheck clean
- alpha-1-public 27/28/29 ファイル touch 0 (新規は post/0012+)
- 公開 API シグネチャ (respondTo* 3 + createAdminVendorInvitation + resend/revoke/list 新規 3)
- `tests/integration/tenant-isolation.test.ts` の admin_vendor_invitations + audit_logs invariant
- post を `redact_audit_payload` の SoT とする運用 (ADR-0010 補項)
- `getAdminUser()` signature / middleware admin matcher + `?next=` 付与

### 推奨される次 Phase スコープ
- **Phase 31-D (推奨次)**: Inngest expire cron + admin seed + E2E + Phase 31-A 追補
- または: CI E2E push で Phase 31-A + 31-B + 31-C を統合検証 (Phase 31-D 前)

### 注意点・コンテキスト
- branch: `phase-26-ci-verify`、Phase 31-B commit `f38503d` の上に Phase 31-C 1 commit を積む予定
- post を SoT とする運用は `db:setup` の `pre → alpha → drizzle → post` 順序が前提
- S1 で Codex が PL/pgSQL `$$` を `2119427` に誤置換した bug は Edit で修復済、Codex への migration 委任は今後注意 (raw SQL の dollar-quoting に弱い)
- Phase 31-C Codex 委任率 ~88% (Claude 直接: S1 migration の修復のみ、他全 Codex)

## Codex ledger refs

- del-20260525-143814-529f (S1 corrupt, rejected)
- del-20260525-144245-623d (S2 service)
- del-20260525-144753-d63b (S3 actions)
- del-20260525-144811-02c3 (S4 list helper)
- (S5/S6/S7 del-id 未通知だが完了通知あり)
- override: blk-mplb7y4p-jdpk (S1 1 回目, Claude continue) / blk-mplb8y2i-swb0 (S1 2 回目 escalation, Codex 委任に切替)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 31-C commit 数 | 1 予定 |
| 追加コード行数 | ~705 (migration 140 + schema +1 + service +146 + actions 133 + list helper 121 + UI 238 → 列同期で実数 ~700) |
| 新規ファイル | 4 (migration / actions / list helper / 本 handoff) + plan |
| 修正ファイル | 6 (schema / service / page / tenant-isolation test / unit test / spec CLAUDE.md) |
| 追加テスト数 | 13 (96 → 109 PASS、unit 11 + integration 2) |
| Codex 委任 task 数 | 7 (うち S1 reject、6 accept) |
| Codex 委任行数 | ~620 (~88%) |
| Claude 直接 | S1 migration の Edit 修復 (2 箇所 $$) |
| advisor 呼び出し | 1 回 (Codex review 後の reconcile) |
| Codex adversarial review | 1 回 (approve_with_changes、4 critical) |
| planner agent | 1 回 (plan 作成、後に Codex+advisor で +3 設計判断) |
| セッション数 | 1 (Phase 31-B sealed → Phase 31-C sealed) |

## 振り返りメモ

- うまくいった: planner → Codex adversarial → advisor の三層レビューで Phase 31-B より steel-manned な plan に
- うまくいった: C2 を「設計修正前に事実確認」と advisor が判定、無駄な書き直しを回避
- うまくいった: S3/S4/S6/S7 を 4 並列 background 起動、Claude は待ち時間最小
- 課題: S1 migration を Codex 委任した際、PL/pgSQL `$$` dollar-quoting が `2119427` に誤置換 → Edit で 2 箇所修復。次回 migration 委任時は Codex に dollar-quoting 保持の明示指示が必要
- 課題: Codex の sandbox で `pnpm` 起動失敗が頻発 (S4/S5/S6/S7 で typecheck/test 未実施報告)、Claude 側で都度 verify が必要
- 学び: Phase 31-B 92% → Phase 31-C 88% 委任率を維持。policy=max で攻めモード継続成功
- 学び: phase-handoff 200 行制約は良いが、ledger/codex 委任 ID 多いと圧迫。本 handoff は ~165 行に収まり OK

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-25 (Phase 31-C vendor invitation list+resend+revoke+audit 完了)*
