# Codex Adversarial Review — Phase 31-D Plan

> *Note: Codex sandbox 書き込み失敗のため、Claude が transcript + 自前の verify 結果から再構成。Codex ledger: del-20260525-162400-1c11 (auto-applied → 採用)。*

## Verdict

**approve_with_changes** — 3 Critical / 4 High を plan 修正で対応すれば実装着手可能。reject_and_rewrite は不要 (基本設計は妥当)。

## Critical Issues (must fix before implementation)

### C1. middleware で `/vendor/admin-invite-callback` が exempt されていない (Phase 31-B regression)

- 場所: `src/middleware.ts:52` `isInvitationPath = pathname.startsWith("/vendor/invitations/")`
- 問題: callback path は exempt されない → 未認証ユーザーが招待リンクを開くと L55-63 で `/vendor/login` にリダイレクトされる
- 影響: **本番ですでに admin invite 全件壊れている**。Phase 31-B 「手動 verify 未実施」のため未検出
- Fix: L52 と L55 の条件に `pathname === "/vendor/admin-invite-callback"` を追加 (またはコールバック判定変数を新設)
- 対応 step: **S0 追加** (Phase 31-D scope に組み込む)

### C2. admin role の `company_id IS NULL` (global) のため seed lookup 誤り

- 場所: `src/lib/db/raw-migrations/alpha-1-public/21_seed_master.sql:22-30`
- 確認内容: `INSERT INTO roles (company_id, code, name, is_system) VALUES (NULL, 'admin', 'Administrator', true), ...` → admin/manager/advisor/technician/dispatcher/viewer すべて `company_id=NULL` (system roles)
- `getAdminUser()` 確認: `src/lib/auth/admin-role.ts:33-34` `innerJoin(roles, eq(users.roleId, roles.id))` + `where(and(eq(users.id, user.id), eq(roles.code, "admin")))` → users.role_id が global admin role id を指していれば OK、company_id 制約なし
- 元 plan D-5: `WHERE code='admin' AND company_id=companyId` ❌
- 正解: `WHERE code='admin' AND company_id IS NULL`

### C3. E2E generateLink で `redirectTo` 省略 → 本番動作と乖離

- 場所: `src/lib/services/admin-vendor-invitations.ts:150-151, 282-284`
- 確認: production は `inviteUserByEmail(email, { redirectTo: getCallbackUrl() })` を 2 ヶ所で呼ぶ
- 元 plan D-6: `generateLink({ type: 'invite', email })` ❌ (`redirectTo` 省略)
- 正解: `generateLink({ type: 'invite', email, options: { redirectTo: callbackUrl } })`
- 補足: `getCallbackUrl()` は `admin-vendor-invitations.ts:85-88` 内の private function (`server-only` 込)、E2E spec から import 不可。E2E では URL を inline で組み立てる: `` `${baseURL}/vendor/admin-invite-callback` ``

## High Issues (should fix)

### H1. audit trigger location は post/0011 (alpha-1-public ではない)

- 場所: `src/lib/db/raw-migrations/post/0011_phase31c_fixup_and_audit_trigger.sql`
- D-1 の検証としては正しい (`23_record_audit_log.sql` の `actor_kind='system'` デフォルトは alpha-1-public 側) が、trigger 自体は post 配下にある。plan 文中で参照する場合は post/0011 と明示

### H2. unit test mock では NULL-safe SQL の検証不可

- 元 plan: vitest unit (`vi.mock('@/lib/db/client')`) で 3 ケース
- 問題: mock の `db.update` は SQL を実行しないので `isNotNull(expiresAt)` の WHERE 句が実 PostgreSQL で動くかは未検証
- Fix: `tenant-isolation.test.ts` の integration test ケースを **必須化** (オプション → 必須)。expiresAt NULL 行を seed → `runExpireOnce(db)` → NULL 行は status 不変を assert

### H3. Drizzle DB 型エイリアス `typeof db`

- 元 plan: `runExpireOnce(database: typeof db)`
- 注意: Drizzle の type は internal generic を多用するため、`typeof db` を関数引数にすると型推論で重くなる可能性。実装時は素直に書いて typecheck で問題出なければそのまま、出たら `type DB = typeof db` を `client.ts` から export

### H4. callback は status='sent' のみ accept

- Phase 31-B callback route 内で `status='sent' → 'accepted'` の UPDATE になっているはず (要確認)
- seed → invitation 行が `status='sent'` で生成されることを assert する必要あり (current implementation で確認済)

## Medium / Suggestions

- E2E spec の `seedAdminE2E` 出力 email と company name は `randomUUID()` suffix で一意化 (parallel CI 衝突回避)
- test 4 (受諾済み badge 確認) は optional のまま — test 3 で `/vendor/requests` 到達できれば accept は成立、badge は admin-vendors.ts の `latest_invitation_status` 正規化に依存するので CSS/HTML テキストアサーション

## Verifications performed

- `src/middleware.ts` (L1-77 全行) — C1 確認
- `src/lib/db/raw-migrations/alpha-1-public/21_seed_master.sql` (L1-30) — C2 確認
- `src/lib/services/admin-vendor-invitations.ts` (L85-88, L150-151, L282-284) — C3 + getCallbackUrl 確認
- `src/lib/auth/admin-role.ts` (L1-51 全行) — C2 lookup ロジック確認
- `src/app/(vendor-portal)/vendor/admin-invite-callback/route.ts` 存在確認 (Glob)
- `phase-handoff/phase-34-phase-31-b-sealed.md` callback 言及確認

## Adversarial questions raised — answers

- **Concurrency (bulk UPDATE without `FOR UPDATE SKIP LOCKED`)**: 問題なし。bulk UPDATE は atomic、再実行で `pending`/`sent` 行が 0 になるので idempotent。`FOR UPDATE SKIP LOCKED` は OUTBOX-style worker queue 用で expirer には不要
- **Idempotency (retry double-fire audit logs)**: 問題なし。同じ理由。UPDATE は status='sent' → 'expired' 1 回のみ trigger 発火、retry 時は対象 0 行で trigger 不発
- **Schedule jitter**: 問題なし。Inngest 自体に queue があるため cron 起動と実行は分離
- **E2E flakiness (generateLink one-time URL)**: 軽微。test 内で `generateLink` を呼ぶ → そのまま `page.goto()` する単純フロー、URL 消費は test 完結まで 1 回
- **Test isolation (parallel runs collision)**: 要対応 — Medium で `randomUUID()` suffix を要件化
- **Scope creep**: 1 ファイル (`middleware.ts`) 追加が必要、ただし「Phase 31-B regression fix」として正当化可能 — C1 採用で対応
- **YAGNI (test 4 badge)**: optional 維持で OK

---

*Reviewed by Codex (gpt-5.5) / Reconstructed by Claude after sandbox write failure / 2026-05-26*
