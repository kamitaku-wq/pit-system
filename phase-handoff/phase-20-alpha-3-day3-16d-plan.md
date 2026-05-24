# Phase 20: Sprint α-3 Day 3 / 16-D Vendor Portal Frontend Plan v2

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 20 |
| 状態 | planning (v2, Codex adversarial review 不能のため Claude が recon ベースで巻取り) |
| 前 Phase | phase-19-alpha-3-day2-16c.md (sealed, commit 075f64f) |
| 担当 | Claude (planning + integration + review) / Codex (実装委任 `--profile-v2 frontend`、Windows sandbox 失敗時は Claude 巻取り) |
| DoD (spec 由来) | vendor user ログイン → `/vendor/requests` 一覧 + 詳細 → accept/reject submit が DB に反映 |
| 採用 recon | `phase-20-supabase-setup-recon.md` (116 行) |
| 棄却 review | del-20260524-140727-4911 (sandbox-blocked、override 記録済) |

## v1 → v2 変更要旨

| # | 課題 | v1 | v2 |
|---|---|---|---|
| P0a | route group が URL に出ない | `/vendor/requests` を `(vendor-portal)/requests/` で実装と誤記 | `(vendor-portal)/vendor/requests/` 構造に変更 |
| P0b | production auth context 伝播 | `db.execute()` で RLS auto と誤記 | `withAuthenticatedDb()` helper 必須経由 |
| P0c | vendor onboarding 不存在 | 言及なし | dev/staging seed script のみ。admin invitation UI は 16-E/β 繰越 |
| P0d | error class instanceof prototype 切れ | instanceof 前提 | error.code 文字列 mapping に切替、5 error class に `code` プロパティ追加 |
| P1 | middleware.ts 不在 | 計画あり | matcher 厳密化 `/vendor/:path*`、session refresh + redirect |
| P1 | integration test | unit ベース | withAuthenticatedDb 経由の integration test 3 件追加 |

## 1. スコープ確定 (v2)

### 1.1 含むもの (16-D)

- Supabase auth client (server / browser) + middleware.ts (新規 scaffold)
- `withAuthenticatedDb(authUserId, fn)` helper (transaction-local SET LOCAL ROLE authenticated + request.jwt.claims)
- `(vendor-portal)` route group + 専用 layout (VendorShell)
- `/vendor/login` page (email + password)
- `/vendor/requests` 一覧 page (pending のみ)
- `/vendor/requests/[id]` 詳細 page
- accept/reject server action (`respondToTransportOrder` を `withAuthenticatedDb` 内で呼出)
- 5 error class への `code` プロパティ追加 + UI mapping
- UI 二重 submit 対策 (`useFormStatus` + pending disable)
- dev/staging 用 vendor seed script (auth.users + vendor_users.auth_user_id 紐付け)

### 1.2 scope outside (16-E or β 繰越)

- admin 側 vendor user invitation UI/API → 16-E
- 全 invitation reject 時の order 終端 → 16-E
- spot invitation (vendor_id NULL) flow → 16-E
- 通知 inbox `vendor_portal_inbox` (spec §4.0) → β
- E2E test (Playwright) → 16-E
- visual regression → 16-E
- 履歴 tab (accepted/rejected 表示) → β

## 2. ファイル構成 (v2)

### 2.1 新規ファイル

| パス | 役割 | 想定行数 |
|---|---|---|
| `src/lib/supabase/server.ts` | server component / server action 用 (cookies 経由) | ~35 |
| `src/lib/supabase/browser.ts` | client component 用 | ~15 |
| `src/lib/db/with-auth.ts` | `withAuthenticatedDb(authUserId, fn)` helper | ~50 |
| `src/middleware.ts` | session refresh + `/vendor/:path*` gate | ~60 |
| `src/app/(vendor-portal)/layout.tsx` | VendorShell ラッパー (auth gate は middleware に集約) | ~20 |
| `src/app/(vendor-portal)/vendor/login/page.tsx` | login form | ~60 |
| `src/app/(vendor-portal)/vendor/login/actions.ts` | signInWithPassword | ~35 |
| `src/app/(vendor-portal)/vendor/requests/page.tsx` | 一覧 (withAuthenticatedDb 経由 RLS) | ~85 |
| `src/app/(vendor-portal)/vendor/requests/[id]/page.tsx` | 詳細 | ~75 |
| `src/app/(vendor-portal)/vendor/requests/[id]/actions.ts` | accept/reject server action | ~90 |
| `src/components/vendor-portal/vendor-shell.tsx` | sidebar + header + logout | ~50 |
| `src/components/vendor-portal/request-list-item.tsx` | 一覧 item | ~40 |
| `src/components/vendor-portal/respond-form.tsx` | accept/reject + reason + useFormStatus | ~80 |
| `scripts/seed-vendor-dev.ts` | dev/staging 用 vendor user seed (auth.users + vendor_users) | ~80 |

新規合計 ~775 行。

### 2.2 既存変更

- `src/lib/services/transport-orders.ts`: 5 error class に `static readonly code` 追加 (~+15 行)
  - `InvitationNotPendingError.code = 'INVITATION_NOT_PENDING'`
  - `VendorAuthError.code = 'VENDOR_AUTH_ERROR'`
  - `StatusTransitionError.code = 'STATUS_TRANSITION_ERROR'`
  - `ConcurrentTransportOrderResponseError.code = 'CONCURRENT_RESPONSE'`
  - `InvalidResponseValueError.code = 'INVALID_RESPONSE_VALUE'`
  - StatusSeedMissingError も含める想定 (`STATUS_SEED_MISSING`)
- `tests/integration/services/transport-orders.integration.test.ts`: withAuthenticatedDb 経由 3 件追加 (~+60 行)
  - 未認証 server action → VendorAuthError
  - 別 vendor からの respondToTransportOrder → VendorAuthError
  - 正常 vendor の RPC 完走 (現行テストの拡張)

既存変更合計 ~+75 行。

### 2.3 不要 / 取下げ

- v1 にあった `src/app/(vendor-portal)/vendor-login/` 配置 → `(vendor-portal)/vendor/login/` に統合
- v1 の `actions.ts` 単独配置は `(vendor-portal)/vendor/login/actions.ts` および `(vendor-portal)/vendor/requests/[id]/actions.ts` に分割

## 3. 設計判断ポイント (v2 確定版)

### 3.1 認証経路

- **採用**: Supabase email + password (`signInWithPassword`) + cookie session via `@supabase/ssr`
- `vendor_users.auth_user_id = auth.uid()` で vendor user 解決 (`current_vendor_id()` helper、既存)
- 未認証 redirect は middleware.ts で先回り

### 3.2 production auth context 伝播 (P0b 解消)

```ts
// src/lib/db/with-auth.ts (概念)
export async function withAuthenticatedDb<T>(
  authUserId: string,
  fn: (tx: DrizzleTx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL ROLE authenticated`);
    await tx.execute(sql`
      SELECT set_config('request.jwt.claims',
        ${JSON.stringify({ sub: authUserId, role: 'authenticated' })},
        true)
    `);
    return fn(tx);
  });
}
```

全 vendor server action は以下のパターン:
1. `const supabase = await createServerClient()`
2. `const { data: { user } } = await supabase.auth.getUser()` (失敗時 redirect)
3. `await withAuthenticatedDb(user.id, async (tx) => respondToTransportOrder(tx, ...))`

### 3.3 error code mapping (P0d 解消)

```ts
// transport-orders.ts (既存 5 error class 改変)
export class InvitationNotPendingError extends Error {
  static readonly code = 'INVITATION_NOT_PENDING';
  readonly code = InvitationNotPendingError.code;
}
```

server action 側で:
```ts
try {
  await withAuthenticatedDb(user.id, (tx) => respondToTransportOrder(tx, input));
} catch (e) {
  const code = (e as { code?: string }).code;
  switch (code) {
    case InvitationNotPendingError.code: return { uiMessage: '他のユーザーが既に応答済みです' };
    case VendorAuthError.code: redirect('/vendor/login');
    // ...
  }
}
```

既存 Phase 19 integration tests の `instanceof` チェックは同 process 内なので動作維持 (invariant 不破)。

### 3.4 一覧クエリ

- `withAuthenticatedDb` 内で Drizzle クエリ実行 → RLS が `current_vendor_id()` 経由で自動フィルタ
- pending のみ表示 (`response = 'pending'`)、ORDER BY `created_at DESC` LIMIT 50

### 3.5 UI 二重 submit

- `useFormStatus()` で pending → submit button disabled + spinner
- server 側冪等性は RPC P0002 (InvitationNotPendingError) で確保済、UI は disable のみ

### 3.6 vendor onboarding (P0c)

- `scripts/seed-vendor-dev.ts`: dev/staging で 2-3 件の vendor user を auth.users + vendor_users.auth_user_id で seed
  - email/password を `.env.local` に依存しない固定値 (例: `vendor-dev1@example.com` / `vendor-dev-pass-001`)
  - admin SDK (`supabase.auth.admin.createUser`) 経由 (`service_role` key を使う、`SUPABASE_SERVICE_ROLE_KEY` は `.env.example:15` 既存)
- production の vendor 招待 admin UI は **16-E or β 繰越**
- README 追記 (~+10 行) で seed 実行手順を記述

### 3.7 middleware.ts

- matcher: `/vendor/:path*` (login page 含む) と `/vendor/requests/:path*` 別系統
- session refresh パターン (`@supabase/ssr` の updateSession)
- 未認証 + `/vendor/login` 以外 → `/vendor/login` redirect
- 認証済 + `/vendor/login` → `/vendor/requests` redirect (オプション、v2 では実装)

## 4. テスト戦略 (v2)

- **新規 integration test 3 件**: `withAuthenticatedDb` 経由
  - 正常 vendor の respondToTransportOrder
  - 未認証 (`set_config` なし) → VendorAuthError raise
  - 別 vendor からの response → VendorAuthError raise (Phase 19 既存テストとの差別化)
- **既存 63 tests**: 全 PASS 維持 (regression なし)
  - error class instanceof は同 process 内テストで動作維持
- **E2E**: scope outside (16-E)

## 5. 実装手順 (Codex 委任順 + Claude fallback)

各タスクは `codex exec --profile-v2 frontend --skip-git-repo-check` 経由で委任。**Windows sandbox 失敗時は Claude 巻取り、ledger に sandbox-blocked override 記録**。

1. **委任 #1**: 5 error class への `code` プロパティ追加 + integration test 3 件 (~75 行 修正)
2. **委任 #2**: `withAuthenticatedDb` helper + Supabase ssr client (server/browser) + middleware.ts (~160 行)
3. **委任 #3**: `(vendor-portal)/layout.tsx` + VendorShell + login page + login actions (~165 行)
4. **委任 #4**: 一覧 page + RequestListItem + 詳細 page (~200 行)
5. **委任 #5**: respond-form + accept/reject server action (~170 行)
6. **委任 #6**: `scripts/seed-vendor-dev.ts` + README 追記 (~90 行)
7. **Claude**: typecheck + test 確認 (`pnpm typecheck` / `pnpm test`)、phase-20 seal

各委任は `--effort high` 強制。委任後 Claude が差分レビュー + テスト実行 + 統合判断。

## 6. リスク (v2)

- **R1**: `withAuthenticatedDb` の transaction 抜け穴 — RPC 呼出が transaction 外に出ると auth context 喪失。helper 内で完結する設計
- **R2**: middleware が Next.js 15.5 で動くか確認 (現行 next 15.5.18、`@supabase/ssr` 0.5.2 は対応見込)
- **R3**: session cookie race condition — login 直後の redirect で session 未確定の場合 → middleware の updateSession で吸収
- **R4**: Codex Windows sandbox 失敗 (R-H-002) — 委任失敗時 Claude 巻取り運用、ledger に override 記録
- **R5**: seed script を production で誤実行するリスク → script 先頭で `NODE_ENV !== 'production'` 強制 + 警告メッセージ

## 7. DoD チェックリスト (16-D sealed 条件)

- [ ] `withAuthenticatedDb` helper が transaction 内で SET LOCAL ROLE + claims 設定
- [ ] dev/staging で seed 後 vendor user が email + password で login 可能
- [ ] `/vendor/requests` で自社宛 pending invitation のみ表示 (RLS 経由)
- [ ] 詳細 page で transport_order 内容表示
- [ ] accept → status `accepted` 遷移 + 他 vendor invitation revoke (RPC 経路)
- [ ] reject + reason → invitation `rejected` 更新
- [ ] 5 error class が `code` プロパティ経由で UI message に正しく mapping
- [ ] 未認証で `/vendor/requests` access → `/vendor/login` redirect (middleware)
- [ ] `pnpm typecheck` PASS、`pnpm test` 63 → 66 (新規 +3 integration test)
- [ ] phase-20 sealed handoff 書き出し

## 8. 16-E 入力契約 (先取り)

- vendor portal 全画面動作前提 (login + 一覧 + 詳細 + accept/reject)
- `withAuthenticatedDb` helper 動作前提
- E2E (Playwright) を `tests/e2e/vendor-portal-loop.spec.ts` で実装
- 全 reject 時の order 終端 `closeTransportOrderOnAllRejected` service 追加
- admin 側 vendor user invitation UI/API 追加
- spot invitation flow (`respond_to_spot_invitation` RPC + UI) 追加
- staging smoke (Resend 疎通 + 実 DB) 実行

## 9. 16-D で確立する invariants (16-E 以降破壊禁止)

- `withAuthenticatedDb(authUserId, fn)` シグネチャ
- 5 error class の `code` プロパティ名 (`INVITATION_NOT_PENDING` 等)
- `(vendor-portal)/vendor/` 配下のファイル配置
- middleware.ts の matcher と redirect 経路
- seed script の email/password 仕様 (test 依存)

---

*Plan v2 確定: Claude (2026-05-24 Phase 20)。Codex adversarial review が Windows sandbox 失敗のため、recon ファイル (`phase-20-supabase-setup-recon.md`) + Claude 自己 review で v1 → v2 化。実装に進む。*
