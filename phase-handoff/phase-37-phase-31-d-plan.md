# Phase 37 計画: Phase 31-D plan (invitation expirer + admin seed + E2E)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 37 (Phase 31-D plan) |
| 状態 | planning |
| 前 sealed handoff | `phase-handoff/phase-36-phase-31-c-sealed.md` |
| 担当 | Claude (planner + advisor) |
| 前提 | vitest 109 PASS / typecheck clean / post/0011 適用済 / branch `phase-26-ci-verify` |

## スコープ

新規作成 3 ファイル + `src/lib/inngest/client.ts` 1 行追加 + `src/middleware.ts` exempt 1-2 行追加 (Phase 31-B regression fix)。

| # | ファイル | 内容 |
|---|---|---|
| S0 | `src/middleware.ts` | `/vendor/admin-invite-callback` を未認証 exempt に追加 (Phase 31-B 漏れ修正、S3 E2E ブロッカー) |
| S1 | `src/lib/inngest/functions/invitation-expirer.ts` | hourly cron で `expires_at < now() AND status IN ('pending','sent')` を `status='expired'` に UPDATE |
| S2 | `tests/_helpers/seed-admin-e2e.ts` | Playwright 用 admin role user seed / cleanup helper |
| S3 | `tests/e2e/admin-vendor-invite.spec.ts` | admin invite → vendor accept callback → `/vendor/requests` E2E spec |

**scope creep 禁止項目**:
- migration 追加不可 (schema 変更なし、status UPDATE のみ)
- alpha-1-public 27/28/29 ファイル touch 禁止
- Phase 31-A 追補はコミット `6c10065` で完了済み → 対象外
- 公開 API シグネチャ変更禁止 (respondTo* 3 + create/resend/revoke/list の計 6 関数)
- `src/app/api/inngest/route.ts` は変更不要 (`inngestFunctions` 配列経由で自動登録)

**Codex adversarial review 反映**: 3 Critical / 4 High を本 plan で対応済。詳細は `phase-37-codex-adversarial-review.md` 参照。

## 主要設計判断 (8 点)

### D-1 audit trigger actor — cron は 'system' として記録 (verified)

`record_audit_log()` は `v_actor_kind := 'system'` をデフォルト値として宣言し、`IF auth.uid() IS NOT NULL THEN` ブロックの外で INSERT する (`alpha-1-public/23_record_audit_log.sql` L21, L58)。cron 実行時は Supabase session なし (auth.uid() = NULL) → `actor_kind='system'`, `actor_user_id=NULL` で audit_logs に記録される。`SET LOCAL` 等の追加処理は不要。

### D-2 expirer アーキテクチャ — Drizzle db + runExpireOnce 分離

outbox-dispatcher は `postgres()` raw client + `FOR UPDATE SKIP LOCKED` を使うが、expirer は単純な bulk UPDATE で競合制御不要。Drizzle `db` を直接使う。**`runExpireOnce(database: typeof db): Promise<{expired: number}>` を named export** し、Inngest cron handler は `step.run("expire-invitations", () => runExpireOnce(db))` を呼ぶ。Inngest Dev Server なしに vitest から直接テスト可能。

### D-3 Inngest cron schedule と登録

- スケジュール: `{ cron: "0 * * * *" }` (毎時 00 分、hourly)
- 登録: `client.ts` の `inngestFunctions` 配列に `invitationExpirer` を push するのみ。`route.ts` (`serve({ client, functions: inngestFunctions })`) は変更不要。

### D-4 WHERE 条件の NULL safe 処理

`expiresAt` は `timestamptz NULL` (schema 確認済)。Drizzle WHERE: `and(isNotNull(expiresAt), lt(expiresAt, new Date()), inArray(status, ['pending', 'sent']))` で NULL 行を安全に除外。

### D-5 admin seed の roleId — global admin role (company_id IS NULL)

**Codex 指摘修正**: `21_seed_master.sql:24` で admin role は `(NULL, 'admin', ...)` で global 登録。`getAdminUser()` (`src/lib/auth/admin-role.ts:33-34`) は `users.role_id = roles.id` の inner join + `roles.code='admin'` だけで lookup (company_id 制約なし)。seed 時の SELECT は **`WHERE code='admin' AND company_id IS NULL`** が正解。users INSERT 時に `company_id` (テナント) と `role_id` (global admin) は別の意味を持つ点に注意。

### D-6 E2E 招待リンク取得 — generateLink + redirectTo + inline callback URL

**Codex 指摘修正**: production (`admin-vendor-invitations.ts:150-151, 282-284`) は `inviteUserByEmail(email, { redirectTo: getCallbackUrl() })` を呼ぶ。E2E の `generateLink` も同じ option を渡す: `supabaseAdmin.auth.admin.generateLink({ type: 'invite', email, options: { redirectTo: \`${baseURL}/vendor/admin-invite-callback\` } })`。`getCallbackUrl()` は `server-only` import を含むため E2E から呼べない → URL を inline で組み立てる。実行時の戻り値型は `data?.properties?.action_link` を optional チェック (type guard) でアクセス。

### D-7 E2E admin ログインパス

admin 専用ログインページなし。`/vendor/login` を共用 (middleware が `/admin/*` への未認証アクセスを `/vendor/login?next=/admin/...` にリダイレクト)。E2E では `page.goto('/vendor/login')` → `input#email` / `input#password` / `button` "ログイン" をフィル → submit。

### D-8 cleanup — audit_logs 先削除必須

`trg_audit_admin_vendor_invitations` は DELETE でも audit_logs に再 INSERT する。cleanup 時は `audit_logs WHERE company_id=...` を `companies DELETE` より先に実行 (`seed-vendor-e2e.ts` L244 パターン踏襲)。

## 実装ステップ

### S0: middleware.ts — /vendor/admin-invite-callback exempt (Phase 31-B regression fix)

- **Action**: `src/middleware.ts:52` の `isInvitationPath` 判定の隣に `isAdminInviteCallbackPath = pathname === "/vendor/admin-invite-callback"` を追加し、L55 の `if (!user && !isLoginPath && !isInvitationPath)` 条件に `&& !isAdminInviteCallbackPath` を追加
- **検証**: 未認証 user が `/vendor/admin-invite-callback?code=...` を開いても middleware で redirect されず route handler が走り `exchangeCodeForSession` で session 確立 → `/vendor/requests` へ
- **リスク**: Low (1-2 行変更、auth path だが exempt 範囲は 1 path のみで明示的)
- **Codex 委任**: **Claude 直接** (1-2 行、auth 関連の high stake、責任を Claude に集約)
- **影響**: Phase 31-B 漏れの本番バグ修正。S3 E2E 成立の前提

### S1: invitation-expirer.ts (File: `src/lib/inngest/functions/invitation-expirer.ts`)

- **Action**: `runExpireOnce(database: typeof db): Promise<{expired: number}>` を named export。Drizzle で `adminVendorInvitations` を D-4 WHERE 条件で bulk UPDATE (`set({status:'expired', updatedAt: new Date()})`) → `.returning({id})` → `{expired: rows.length}` 返却。`export const invitationExpirer = inngest.createFunction({id:"invitation-expirer", name:"Invitation Expirer"}, {cron:"0 * * * *"}, async ({step, logger}) => { const result = await step.run("expire-invitations", () => runExpireOnce(db)); logger.info("invitation-expirer completed", result); return result; })` を export。
- **追加変更**: `client.ts` の `inngestFunctions` 配列に `invitationExpirer` を追加 (1 行)
- **vitest unit**: `tests/unit/lib/inngest/functions/invitation-expirer.test.ts` を追加。`vi.mock('@/lib/db/client')` で `db.update` をモック。ケース: 対象行あり → expired 件数、対象行なし → 0、expiresAt=NULL → スキップ
- **リスク**: Low
- **Codex 委任**: `invitation-expirer.ts` 本体は `/codex:rescue --wait --effort high` 委任 (30 行超 policy=max)。`client.ts` +1 行は Claude 直接。unit test は強制委任

### S2: seed-admin-e2e.ts (File: `tests/_helpers/seed-admin-e2e.ts`)

- **Action**: `seedAdminE2E(db, supabaseAdmin): Promise<SeededAdminE2E>` + `cleanupAdminE2E(db, supabaseAdmin, seeded)` を実装。**email/company name は `randomUUID()` suffix で一意化** (parallel CI 衝突回避)。`createUser({email, password, email_confirm:true})` → `companies INSERT` → dynamic `roleId SELECT WHERE code='admin' AND company_id IS NULL` (D-5) → `users INSERT (role_id = global admin id, company_id = seeded company)`。cleanup: `audit_logs WHERE company_id=...` → `users WHERE id=...` → `companies WHERE id=...` → `auth.admin.deleteUser` (D-8)
- **export**: `SeededAdminE2E { authUserId, companyId, userId, email, password }`
- **リスク**: Low
- **Codex 委任**: `tests/_helpers/` 配下 → **強制委任**。`/codex:rescue --wait --effort high`

### S3: admin-vendor-invite.spec.ts (File: `tests/e2e/admin-vendor-invite.spec.ts`)

- **Action**: `test.describe.serial` + beforeAll/afterAll。fixture: `seedAdminE2E` + vendor 行 INSERT (招待対象)。test 1: admin `/vendor/login` でログイン → middleware `?next=` 経由 `/admin/vendors` 到達確認。test 2: "招待する" Link → form fill (vendorId select, email input) → "招待を送信" submit → banner "業者ユーザーへの招待を送信しました。" 確認。test 3: `supabaseAdmin.auth.admin.generateLink({ type:'invite', email, options: { redirectTo: \`${baseURL}/vendor/admin-invite-callback\` } })` → `data?.properties?.action_link` type guard → `page.goto(actionLink)` → `expect(page).toHaveURL(/vendor\/requests/)` で vendor accept 確認 (S0 middleware exempt 前提)。test 4 (optional): admin `/admin/vendors` reload → "受諾済み" badge 確認。
- **リスク**: Medium (generateLink 戻り値型、Supabase バージョン依存)
- **Codex 委任**: `tests/e2e/` 配下 → **強制委任**。`/codex:rescue --wait --effort high`
- **前提**: S0 middleware fix が先に適用されていること

## Codex 委任サマリ

| ステップ | 委任 | 理由 |
|---|---|---|
| S0 `middleware.ts` (1-2 行) | **Claude 直接** | auth path high stake、1-2 行 |
| S1 `invitation-expirer.ts` (~40 行) | `/codex:rescue --wait --effort high` | 30 行超 policy=max |
| S1 unit test | `/codex:rescue --wait --effort high` | `tests/` 強制委任 |
| S1 `client.ts` +1 行 | Claude 直接 | 1 行変更 |
| S1 integration test (tenant-isolation 追加) | `/codex:rescue --wait --effort high` | `tests/` 強制委任、D-4 NULL safe verify 必須 |
| S2 `seed-admin-e2e.ts` | `/codex:rescue --wait --effort high` | `tests/_helpers/` 強制委任 |
| S3 `admin-vendor-invite.spec.ts` | `/codex:rescue --wait --effort high` | `tests/e2e/` 強制委任 |

委任後は Claude が vitest 109 → 110+ PASS + typecheck clean を確認 (品質ガードレール §5.5)。

## Invariants 再確認

- [ ] vitest 109 PASS → 110+ PASS (S1 unit +1〜3、既存 PASS 維持)
- [ ] typecheck clean (`pnpm tsc --noEmit`)
- [ ] `rtk git diff HEAD --name-only` で alpha-1-public 27/28/29 touch 0 確認
- [ ] 公開 API シグネチャ不変 (6 service 関数)
- [ ] `tenant-isolation.test.ts` admin_vendor_invitations invariant PASS 維持
- [ ] post を `redact_audit_payload` SoT 運用維持 (ADR-0010 補項)
- [ ] `getAdminUser()` signature 変更なし / middleware admin matcher + `?next=` 付与 変更なし

## テスト方針

- vitest unit (S1 セット): `invitation-expirer.test.ts` で `runExpireOnce` の 3 ケース (対象あり / 0 行 / NULL スキップ)
- **vitest integration (S1 必須)**: `tenant-isolation.test.ts` に expirer ケース追加 — expiresAt 過去 + status='sent' 行 INSERT + expiresAt=NULL の status='pending' 行 INSERT → `runExpireOnce(db)` → 前者は status='expired'、後者は status 不変、audit_logs に `actor_kind='system'` を assert (Codex H2 指摘で必須化、mock では NULL safe SQL を verify できない)
- E2E (S3): Playwright、CI で実行。env: `PLAYWRIGHT_BASE_URL` / `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`

## commit message 案

```
feat(phase-31-d): admin vendor invitation expirer + admin E2E + middleware fix

- Fix middleware exempt for /vendor/admin-invite-callback (Phase 31-B regression)
- Add invitation-expirer Inngest hourly cron (runExpireOnce named export for vitest)
- Register invitationExpirer in inngestFunctions (client.ts +1 line)
- Add seed-admin-e2e helper (seedAdminE2E / cleanupAdminE2E, randomUUID-suffixed)
- Add admin-vendor-invite E2E spec (admin login → invite → vendor accept)
- Add tenant-isolation expirer integration case (NULL-safe SQL verify)
```

## 未解決の質問

1. **generateLink 戻り値の TypeScript 型**: `supabaseAdmin.auth.admin.generateLink` の返却型に `data.properties?.action_link` が含まれるか strict mode で確認が必要。型エラーになる場合は型ガード追加 or `@supabase/supabase-js` バージョン確認。Codex `--profile-v2 research-docs` で確認委任可。
2. **Inngest Dev Server での expire テスト方針**: `runExpireOnce` を直接 vitest でテストするため CI での Inngest Dev Server 起動は不要。本番 Inngest Cloud との動作確認は staging デプロイ後の手動確認として defer。

---

*Generated by planner agent / Phase 37 Phase 31-D plan / 2026-05-26*
