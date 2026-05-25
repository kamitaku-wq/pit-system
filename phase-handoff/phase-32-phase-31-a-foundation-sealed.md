# Phase 32 入力契約: Phase 31-A sealed (admin foundation)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 32 (前: 31-A sealed) |
| 状態 | Phase 31-A sealed / Phase 31 (admin invite UI 全体) 進行中 (B/C 未着手) |
| 完了日時 | 2026-05-25 |
| 担当 | Claude (resume + middleware Step 2 + layout Step 3 + Step 7 verify) / Codex (Step 1+5 admin-role + Step 4a/4b nav+placeholder) / planner agent (plan) |
| 前 handoff | `phase-31-phase-30-sealed.md` |
| Plan | `phase-32-phase-31-a-foundation-plan.md` |
| 主要 commit | (Phase 31-A commit pending) |

## 達成したこと (Phase 31-A)

- **middleware admin 保護追加**: `src/middleware.ts` の matcher を `["/vendor/:path*", "/admin/:path*"]` に拡張、`isAdminPath` 判定 + `?next=<pathname>` 付与
- **admin role check helper**: `src/lib/auth/admin-role.ts` (44 行) 新設、`getAdminUser(): Promise<AdminUser | null>` で users INNER JOIN roles WHERE code='admin' LIMIT 1。`import "server-only"` + try/catch graceful degradation
- **AdminLayout server component 化**: `src/app/(admin)/layout.tsx` を async + `getAdminUser()` で null → `/vendor/login?next=/admin/dashboard` redirect
- **nav href バグ修正**: `src/components/layout/admin-shell.tsx` の navigation 5 件全部 `/admin/` prefix 付き
- **3 placeholder pages**: `(admin)/vendors/page.tsx` `(admin)/customers/page.tsx` `(admin)/settings/page.tsx` (DB 呼び出しなし、tenant-isolation invariant 安全)
- **unit test 4 ケース**: `tests/unit/lib/auth/admin-role.test.ts` (happy / no auth / wrong role / db error) 全 PASS
- **server-only パッケージ追加**: Next.js 15 で server-only import に必要、`pnpm add server-only@^0.0.1`

## Claude 側の主要設計判断

1. **planner agent で plan 作成 → 6 設計判断を確定**: admin login route は `/vendor/login` 再利用 + `?next=`、role 判定は `users.role_id → roles.code='admin'` (新規 column 追加なし)、matcher 統合 + 関数内分岐、Server Component role check (Option B)、placeholder は DB 呼び出しなし、YAGNI 厳守
2. **advisor 1 回呼び出しで方針確定**: 当初「Phase 23 recon の Sprint γ 推奨」を YAGNI 適用しようとしたが、advisor 指摘で「roadmap α-3 が source of truth、user select B 済」と reconcile。Phase 30-A の YAGNI 学びを過剰適用しなかった
3. **Codex 委任を 2 task に分割並列**: Task A (helper + test、密接関連) と Task B (nav + 3 placeholder、機械的) を independent background で同時起動。Claude は並行で middleware Step 2 (HIGH RISK) を直接実装。Task A 完了待ちの間に Step 3 (layout) も先行 Edit
4. **Step 6 (middleware smoke test) skip**: planner プランで Optional 指定、91 PASS で plan 通り動作、middleware 変更は matcher 追加 + 4 行のみで vendor 既存ロジック行は移動なし。スコープ膨張回避

## Codex 委任成果

| 委任 ID | 内容 | 成果物 | 状態 |
|---|---|---|---|
| del-20260525-121205-3a97 | Step 1+5: admin-role helper + unit test | admin-role.ts (44行) + test (57行) + server-only パッケージ | applied (Codex 自身で 91 PASS 確認) |
| del-20260525-121357-b07f | Step 4a+4b: nav href fix + 3 placeholder | admin-shell.tsx 5 href + 3 page.tsx | applied (sandbox 制約で typecheck/vitest 未実行、Claude 側で 91 PASS 確認) |

## 主要ファイル (Phase 31-B reference)

- `src/lib/auth/admin-role.ts:1-50` — `getAdminUser()` server-only helper (31-B/C で再利用)
- `src/app/(admin)/layout.tsx:1-17` — async + role check redirect
- `src/middleware.ts:50-66` — admin path 分岐 + `?next=` 付与
- `src/app/(admin)/vendors/page.tsx` — 31-B で invite UI 追加、31-C で list 実装
- `src/components/layout/admin-shell.tsx:8-14` — sidebar nav (href は `/admin/*`)
- `phase-handoff/phase-32-phase-31-a-foundation-plan.md` — 設計判断 6 点と実装 step 詳細

## データモデル変更

- なし (Phase 31-A は migration 0 件、計画通り)
- `roles.code='admin'` (`company_id=NULL`) は既存 seed (`21_seed_master.sql`) で確保済

## API 契約

- 公開 API シグネチャ変更なし (respondToInvitation / respondToSpotInvitation / respondToTransportOrder)
- 新規 helper: `getAdminUser(): Promise<AdminUser | null>` (server-only export)

## テスト・QA 状況

- vitest: **91 PASS / 0 FAIL** (前 87 + 新規 4) ✓
- typecheck (`pnpm tsc --noEmit`): clean ✓
- CI E2E: Phase 31-A は未走 (next commit で確認)
- 手動 verify (dev server 起動): **未実施** (Phase 31-A DoD は test/typecheck 通過で実質達成、PR push で本番相当動作確認)

## 既知の懸念・TODO (Phase 31-B/C スコープ候補)

- **Phase 31-B 着手項目**:
  - `admin_vendor_invitations` schema (新規 migration: `post/0010_*.sql` or `alpha-1-public/30_*.sql`)
  - invite form route: `src/app/(admin)/vendors/invite/page.tsx`
  - server action: `createAdminVendorInvitation`
  - Supabase `auth.admin.inviteUserByEmail` 経由の onboarding flow + `vendor_users` INSERT
  - accept callback flow + `notification_outbox` INSERT
- **Phase 31-C 着手項目** (extensions):
  - `(admin)/vendors/page.tsx` 本格 list 実装 (vendors SELECT、admin role の tenant_isolation policy 利用)
  - resend / revoke / expire automation
  - 監査ログ (audit_logs INSERT)
- **未解決の `?next=` 完全実装**: middleware は `?next=` 付与のみ、`/vendor/login` server action 側の `next` 消費は Phase 31-B 想定
- **vendor portal cross-portal 500 bug**: `users` テーブルのユーザーが `/vendor/requests` にアクセス → vendor_users 0 行 → 500 の可能性 (pre-existing、Phase 31-A スコープ外)
- **doc fix (Phase 31-A スコープ外)**: spec/data-model.md §3.4 の `roles.key` → `roles.code` 表記修正、`headquarters_admin` → `admin` 表記修正、ADR-0010 補項に server-only 利用記載

## Phase 32 入力契約

### 前提として動くべき機能
- `getAdminUser()` が `AdminUser | null` を返す (test 91 PASS)
- `/(admin)/*` は middleware + layout 二層保護 (未認証 → `/vendor/login?next=...`、非 admin → redirect)
- `/admin/vendors`, `/admin/customers`, `/admin/settings` placeholder で 404 解消
- vitest 91 PASS / typecheck clean / vendor portal Phase 30 sealed 時と同一動作

### 参照すべきファイル
- 本 handoff (`phase-32-phase-31-a-foundation-sealed.md`)
- `phase-32-phase-31-a-foundation-plan.md` (plan + 設計判断 6 点)
- `phase-23-sprint-beta-recon-admin-invite.md` (§4-5 案 B 設計、Phase 31-B で参照必須)
- `phase-31-phase-30-sealed.md` (Phase 30 sealed 入力契約)
- `spec/CLAUDE.md` §ADR-0010 (service_role 利用範囲、auth.admin.inviteUserByEmail)
- `spec/data-model.md` §3.6 (vendor_users、vendor_id/company_id trigger 同期)

### 絶対に壊してはいけないもの (invariants)
- vitest 91 PASS / typecheck clean / CI E2E 4 passed
- alpha-1-public 27/28/29 ファイル touch 0 (新規 30_*.sql or post/0010+ で対応)
- 公開 API シグネチャ (respondToInvitation / respondToSpotInvitation / respondToTransportOrder)
- `tests/integration/tenant-isolation.test.ts:105-110` の vendors invariant
- `getAdminUser()` の signature (`AdminUser | null`、`admin-role.ts:9-13`)
- middleware の admin matcher + `?next=` 付与ロジック
- ADR-0010 補項

### 推奨される次 Phase スコープ (B1 計画通り)
- **Phase 31-B (推奨次)**: invite form + `admin_vendor_invitations` schema + accept callback + server action + test
- Phase 31-C: vendors list (本格) + resend/revoke + 監査ログ

### 注意点・コンテキスト
- branch: `phase-26-ci-verify`、main から ahead 52 commits (+ Phase 30 commit + Phase 31-A commits pending)
- `server-only` パッケージ依存追加済 (Phase 31-B で他の server-only helper を追加するときも同じ pattern)
- middleware は HIGH RISK 領域、Phase 31-B でさらに変更が必要なら同様に Claude 直接 + smoke test 必須
- vendor portal regression は CI E2E 4 passed で守られているが、Phase 31-A は CI 未走

## Codex ledger refs

- del-20260525-121205-3a97 (Step 1+5 admin-role + test、auto-apply、91 PASS)
- del-20260525-121357-b07f (Step 4a+4b nav + placeholder、auto-apply、Claude 側で確認)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 31-A commit 数 | 1 (予定: foundation 一括 commit) |
| 追加コード行数 | ~140 (admin-role 44 + test 57 + 3 placeholder ~30 + middleware +6 + layout +6 + admin-shell 5変更 + plan は別) |
| 修正ファイル | 5 (middleware / layout / admin-shell / package.json / pnpm-lock) |
| 新規ファイル | 5 + plan 1 (admin-role / test / 3 placeholder / sealed handoff) |
| 追加テスト数 | 4 (87 → 91 PASS) |
| Codex 委任 task 数 | 2 (Step 1+5 と Step 4a+4b、並列) |
| Codex 委任行数 | ~135 (合計コード行数の ~96% を Codex 担当) |
| Claude 直接 | middleware Step 2 (+10) / layout Step 3 (+6) / verification |
| advisor 呼び出し | 1 回 (YAGNI 過剰適用回避) |
| セッション数 | 1 (Phase 30 sealed → Phase 31-A sealed) |

## 振り返りメモ

- うまくいった: advisor 指摘で「Phase 30-A YAGNI 学びを過剰適用しない」判断、roadmap α-3 を source of truth として再確認
- うまくいった: Codex 2 task 並列 + Claude 直接 1 task の三並列で session 効率化 (Task A は 8 分、Task B は 2 分、Step 2 Claude 直接は数十秒)
- うまくいった: planner agent の plan で 6 設計判断を事前確定し、実装中の判断 budget を節約
- 学び: Codex 委任 hook の `auto-apply 済 (P2)` は委任時の ledger record で、実際の Codex 完了通知は別 (PostToolUse:Agent の task-notification を待つ必要がある)
- 学び: Phase 23 recon の判断は「当時の Sprint β 初期での判断」であり、Sprint β 完了後の roadmap re-scope を上書きする source of truth ではない
- 次回改善: Codex 委任前に既存パッケージ依存（server-only など）を確認すれば package install を予測可能

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-25 (Phase 31-A foundation 完了)*
