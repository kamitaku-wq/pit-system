# Phase 35 計画: Phase 31-C plan (admin vendor invitation list + resend/revoke + audit)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 35 (Phase 31-C plan、実装は次セッション or 同セッション) |
| 状態 | planning (planner+Codex adversarial+advisor 三層レビュー反映済、ユーザー最終承認待ち) |
| 前 handoff | `phase-34-phase-31-b-sealed.md` |
| 担当 | Claude (resume + planner + Codex adversarial + advisor + verify Read) |
| Review verdict | Codex: approve_with_changes (4 critical) / advisor: C2 先 verify → 完了 (post を source of truth、前例 3 件確認) |

## スコープ分割 (重要: 31-C / 31-D に 2 分割推奨)

| Phase | 内容 | commit |
|---|---|---|
| **31-C** | duplicate-check fix + vendors list + resend + revoke + audit trigger (post/0011) | 1 |
| **31-D** | expire Inngest cron + admin seed + E2E + Phase 31-A 追補 (?next=, doc fix) | 1 |

理由: 6 項目全てを 1 commit に詰めると Phase 31-B (~610 行) を超える。E2E は admin seed 構築を伴う独立単位。expire cron も Inngest 新規 function という独立切り出し可能単位。

## Phase 31-C 設計判断 11 点 (Codex+advisor review 反映)

1. **D-1 duplicate-check 修正** (pre-existing 31-B inconsistency): `ensureNoPendingDuplicate` WHERE を `status IN ('pending','sent')` に変更。partial unique index も post/0011 で同条件に。**migration 内に `DROP INDEX IF EXISTS` + 重複検出 `RAISE NOTICE` (失敗させず警告のみ) を実装** (C1 反映、test fixtures に sent 重複なし grep 確認済み)。棄却: pending で INSERT 後 sent 遷移 (transaction 再設計コスト高)、CONCURRENTLY (本番不在 YAGNI)
2. **D-2 post/0011 構造**: 1 ファイルに ①index 置き換え ②`redact_audit_payload` `CREATE OR REPLACE` で admin_vendor_invitations ブランチ追加 (email→`x***@domain`、name→`***`) ③`trg_audit_admin_vendor_invitations` AFTER INSERT/UPDATE/DELETE trigger (`DROP TRIGGER IF EXISTS` 冪等)。**運用ルール**: `db:apply-raw:post` は post のみ・`db:setup` でも post が最後 → **post を `redact_audit_payload` の唯一の source of truth とする** (C2 verify 済、前例 post/0002/0006/0008 で `CREATE OR REPLACE` 3 件、`23_record_audit_log.sql` の 9-table trigger pattern 踏襲)。棄却: service 内 audit INSERT (resend/revoke/expire 全経路に手を入れる必要)
3. **D-3 resend 実装**: `resendAdminVendorInvitation(db, supabaseAdmin, adminUser, invitationId)` — SELECT → `inviteUserByEmail` 再呼び出し → `UPDATE sent_at=now(), last_resent_at=now()`。**`last_resent_at timestamptz` を schema (D-7) と post/0011 ALTER TABLE で追加** + service 層で **60 秒 rate limit** (`last_resent_at + 60s > now()` なら `AdminVendorInvitationResendTooEarlyError`)。token_hash は NULL のまま (Supabase 側 link 管理、YAGNI)。`findAuthUserByEmail` は resend では呼ばない (既存 invitation 行に vendor_user_id がある → vendor_users から auth_user_id 取得)
4. **D-4 revoke 実装** (accept 前後分岐): `revokeAdminVendorInvitation` — invitation SELECT で `status` 確認 → `status IN ('pending','sent')` なら `vendor_users.is_active=false` + invitation `status='revoked'`、`status='accepted'` なら **service 内で許可しない** (`AdminVendorInvitationInvalidStateError`、UI で「accept 済みは revoke 不可」案内)。`auth.admin.deleteUser` は **どの状態でも呼ばない** (不可逆、他 company 共有可能性)。session 強制失効は将来 Phase
5. **D-5 vendors list canonical state** (C4 反映): helper の SQL 内で `latest_invitation_status` + `latest_invitation_sent_at` に正規化。`row_number() OVER (PARTITION BY vendor_id ORDER BY CASE WHEN status='pending' THEN 1 WHEN status='sent' THEN 2 WHEN status='accepted' THEN 3 WHEN status='expired' THEN 4 WHEN status='revoked' THEN 5 END, sent_at DESC NULLS LAST) = 1` で 1 行に絞る subquery。UI は派生カラム読むだけ
6. **D-6 server action 配置**: `(admin)/vendors/actions.ts` 新規作成 (resend/revoke)。`invite/actions.ts` は変更しない (招待送信と管理操作を分離)
7. **D-7 schema 変更**: `admin_vendor_invitations.last_resent_at timestamptz NULL` 追加。Drizzle schema と migration を同期。check constraint (status enum) は migration 側
8. **D-8 ADR-0010 補項 update**: `vendors/actions.ts` 追記 + `redact_audit_payload` source of truth 明示 (post を SoT、alpha の同名関数は base 定義として扱う)
9. **D-9 vendor_users 1:1 仮定** (advisor 指摘 3): 「1 auth user = 1 vendor_users row (per company)」を post/0011 コメント + ADR-0010 補項に明記。将来 1:N 拡張時は本仮定を見直す
10. **D-10 revoke の NULL safe** (advisor 指摘 2): `vendor_user_id IS NULL` (auth invite 成功 + TX rollback で vendor_users 行が無いエッジケース) は UPDATE 0 行返却で OK (エラーにせず invitation status='revoked' のみ実行)
11. **D-11 audit trigger smoke test** (advisor missing 1 反映): integration test 1 ケース追加で「INSERT 後 audit_logs に email マスク済み行が記録される」を assert (DB trigger 動作確認)

## 実装ステップ S1-S7 (Codex+advisor 反映)

| # | 内容 | 担当 | 行数 | 依存 |
|---|---|---|---|---|
| S1 | post/0011 migration: (a) DROP+CREATE UNIQUE INDEX `WHERE status IN ('pending','sent')` + 重複検出 RAISE NOTICE / (b) `ALTER TABLE admin_vendor_invitations ADD COLUMN last_resent_at timestamptz` / (c) `CREATE OR REPLACE redact_audit_payload` admin_vendor_invitations branch (email/name mask) / (d) `trg_audit_admin_vendor_invitations` AFTER I/U/D | **Claude** (HIGH stake migration) | ~80 | なし |
| S2 | service 拡張: resend (60s rate limit) / revoke (accept 状態分岐, NULL safe) + duplicate-check 修正 + 3 新規 Error (NotFound/InvalidState/ResendTooEarly) + Drizzle schema に `lastResentAt` 追加 | **Codex** | ~100 | S1 後 |
| S3 | server actions (resend/revoke) `(admin)/vendors/actions.ts` | **Codex** | ~60 | S2 後 |
| S4 | vendors list helper `src/lib/services/admin-vendors.ts` — `getVendorsWithInvitationStatus(db, companyId)` w/ canonical `latest_invitation_status` 正規化 (row_number+CASE 優先順位) | **Codex** | ~60 | S2 後並列可 |
| S5 | vendors page 本格 list + resend/revoke UI (shadcn 不使用、既存 form.tsx パターン踏襲、accept 状態は revoke ボタン非表示) | **Codex** | ~90 | S3+S4 後 |
| S6 | unit tests: resend (happy/not-found/wrong-state/too-early/cross-tenant) 5 + revoke (happy/accepted-state/not-found/cross-tenant/vendor_user NULL) 5 | **Codex** | ~140 | S2 後並列可 |
| S7 | integration: tenant-isolation +1 + audit_logs smoke test +1 + ADR-0010 補項 update | **Codex** | ~50 | 任意 |

Claude 直接担当は S1 のみ。S2 以降全て Codex 委任。Phase 31-B の 92% 委任率を踏襲。

## Codex 委任分割 (5 tasks)

- **C1 (S2)**: service 拡張 — admin-vendor-invitations.ts 全文 + schema + D-3/D-4 設計判断を input、`resendAdminVendorInvitation`+`revokeAdminVendorInvitation`+`AdminVendorInvitationNotFoundError`+`AdminVendorInvitationInvalidStateError` を output
- **C2 (S3)**: server actions — 既存 invite/actions.ts パターン + C1 シグネチャ input、新規 `vendors/actions.ts` output
- **C3 (S4)**: vendors list helper — Drizzle schema input、新規 `admin-vendors.ts` (`getVendorsWithInvitationStatus`) output
- **C4 (S5)**: vendors page UI — C2/C3 output + Phase 23 recon §4 状態仕様 input、修正後 page.tsx output、**shadcn 不使用明記**
- **C5 (S6+S7 まとめ)**: tests + ADR — C1 シグネチャ + 既存 test パターン input、unit/integration/spec 3 ファイル output

## テスト追加計画 (Codex+advisor 反映で拡充)

| 種別 | ケース | 件数 | total |
|---|---|---|---|
| unit | resend (happy / not-found / wrong-state / too-early-60s / cross-tenant) | 5 | 101 |
| unit | revoke (happy-pending / happy-sent / accepted-state-error / not-found / cross-tenant / vendor_user NULL) | 6 | 107 |
| integration | audit_logs cross-tenant (admin_vendor_invitations 行) | 1 | 108 |
| integration | audit trigger smoke (admin_vendor_invitations INSERT → audit_logs に email マスク行記録、D-11) | 1 | 109 |
| E2E | (Phase 31-D に defer) | 0 | — |

**vitest 96 → 109 PASS / 0 FAIL が Phase 31-C DoD**

## Migration: post/0011_phase31c_fixup_and_audit_trigger.sql 新規

```sql
-- (a) duplicate-check 拡張 (D-1)
DO $$ BEGIN
  PERFORM 1 FROM admin_vendor_invitations
    WHERE status IN ('pending','sent')
    GROUP BY company_id, vendor_id, lower(email), status
    HAVING count(*) > 1
    LIMIT 1;
  IF FOUND THEN RAISE NOTICE 'duplicate pending/sent invitations exist'; END IF;
END $$;
DROP INDEX IF EXISTS admin_vendor_invitations_pending_unique;
CREATE UNIQUE INDEX admin_vendor_invitations_pending_unique
  ON admin_vendor_invitations (company_id, vendor_id, lower(email))
  WHERE status IN ('pending','sent');

-- (b) last_resent_at 追加 (D-7)
ALTER TABLE admin_vendor_invitations ADD COLUMN IF NOT EXISTS last_resent_at timestamptz;

-- (c) redact_audit_payload 拡張 (D-2、post を SoT)
CREATE OR REPLACE FUNCTION public.redact_audit_payload(p_entity text, p_data jsonb)
  RETURNS jsonb ... -- 既存 5 entity + ELSIF p_entity='admin_vendor_invitations' THEN email/name mask

-- (d) audit trigger (23_record_audit_log.sql パターン踏襲)
DROP TRIGGER IF EXISTS trg_audit_admin_vendor_invitations ON admin_vendor_invitations;
CREATE TRIGGER trg_audit_admin_vendor_invitations AFTER INSERT OR UPDATE OR DELETE
  ON admin_vendor_invitations FOR EACH ROW EXECUTE FUNCTION public.record_audit_log();
```

適用: `pnpm db:apply-raw:post` (0011 のみ実行)。**alpha-1-public 27/28/29 touch 0 維持**、post を `redact_audit_payload` の唯一の source of truth とする運用を D-8 で ADR-0010 補項に明文化。

## 完了判定 (Phase 31-C sealed 条件)

1. vitest **≥109 PASS / 0 FAIL**、typecheck clean
2. post/0011 DB 適用済み (`Completed: 1 applied, N skipped`)
3. admin が `/admin/vendors` で list + `latest_invitation_status` を確認できる
4. resend → `sent_at` + `last_resent_at` 更新、60s 以内再送で `AdminVendorInvitationResendTooEarlyError`
5. revoke (pending/sent) → `status='revoked'` + `vendor_users.is_active=false`、accept 後は `AdminVendorInvitationInvalidStateError`
6. `audit_logs` に admin_vendor_invitations INSERT/UPDATE が記録 (email `x***@domain` マスク確認)
7. alpha-1-public touch 0 / 公開 API シグネチャ不変 (respondTo* 3 + createAdminVendorInvitation)
8. ADR-0010 補項に `vendors/actions.ts` 追記 + post を `redact_audit_payload` SoT として明示

## 想定リスク (Codex+advisor 反映)

- **R1 (Medium→Low) partial index 置き換え**: dev DB に `sent` 重複行は grep で確認済み無し (test fixture も)。RAISE NOTICE 警告のみで失敗させず、運用上は安全
- **R2 (Medium) revoke 後 vendor session 継続**: `is_active=false` でも有効 session は middleware まで残る。仕様許容 (Phase 23 recon §3)、`auth.admin.signOut(userId)` は将来 Phase
- **R3 (Low) Codex が shadcn 依存追加**: C4/C5 input に「shadcn 不使用、`invite/form.tsx` パターン踏襲」明記 + Claude レビュー
- **R4 (Low) `findAuthUserByEmail` の O(n) 全件 paginate**: resend では呼ばない設計 (invitation 行から vendor_user 経由で auth_user_id 取得)。create flow で呼ぶのは Phase 31-B 既存挙動を維持。将来 user 数が増えたら専用 API 検討 (現状 dev/初期 production は低リスク)

## Phase 31-D 繰越項目

- `invitation-expirer.ts` (hourly cron で `expires_at < now() AND status IN ('pending','sent')` → `expired`) + Inngest client 登録
- `tests/_helpers/seed-admin-e2e.ts` (admin role user seed)
- `tests/e2e/admin-vendor-invite.spec.ts` (admin invite → vendor accept → /vendor/requests)
- Phase 31-A 追補 (`?next=` 完全実装 / `spec/data-model.md` §3.4 doc fix: roles.key→code, headquarters_admin→admin)

## 主要ファイル (Phase 31-C で新規/変更)

- 新規 migration: `src/lib/db/raw-migrations/post/0011_phase31c_fixup_and_audit_trigger.sql`
- 拡張 service: `src/lib/services/admin-vendor-invitations.ts`
- 新規 service: `src/lib/services/admin-vendors.ts`
- 新規 server actions: `src/app/(admin)/vendors/actions.ts`
- 本格 list page: `src/app/(admin)/vendors/page.tsx`
- 追加 unit tests: `tests/unit/lib/services/admin-vendor-invitations.test.ts`
- integration test: `tests/integration/tenant-isolation.test.ts`
- ADR 更新: `spec/CLAUDE.md`

---

*Generated by planner agent / phase-handoff skill — Phase 31-C 着手前 plan*
