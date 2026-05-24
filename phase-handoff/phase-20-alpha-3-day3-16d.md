# Phase 20: Sprint α-3 Day 3 / 16-D Vendor Portal Frontend Handoff (sealed)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 20 |
| 状態 | sealed |
| 開始 | 2026-05-24 (Phase 19 sealed 後) |
| 完了 | 2026-05-25 |
| 担当 | Claude (planning + integration + review + patch) / Codex (実装委任 6 件、Windows sandbox shell-only block) |
| 関連 branch | main (uncommitted、本 phase seal 後にまとめて commit) |
| 前 Phase | phase-19-alpha-3-day2-16c.md (sealed, commit 075f64f) |
| 関連 incident | R-H-002 (Codex Windows sandbox は Write/Edit 通過、shell 実行のみ failed、Phase 18/19 と同じ部分復旧。1 件 (adversarial review subagent del-20260524-140727-4911) は完全 block で Claude 巻取り) |

## このフェーズで達成したこと

- vendor portal frontend (`/vendor/login` + `/vendor/requests` 一覧 + `/vendor/requests/[id]` 詳細 + accept/reject) を構築
- production auth context 伝播の根本問題を解決: `withAuthenticatedDb(authUserId, fn)` helper を新規追加、全 vendor server action 必須経由とした (transaction-local `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', ...)`)
- `@supabase/ssr` based server/browser client + Next.js 15 middleware を新規 scaffold (matcher `/vendor/:path*`、session refresh + 未認証 `/vendor/login` redirect + 認証済 login → requests redirect)
- 5 error class + StatusSeedMissingError に `static readonly code` プロパティ追加 (`INVITATION_NOT_PENDING` 等)、server action 跨ぎ prototype 切れ対策を構造的に解決
- VendorShell コンポーネントを admin shell と分離 (sidebar 「依頼一覧」のみ、履歴 tab は β 繰越)
- 詳細 page で `withAuthenticatedDb` 経由 + statuses/companies JOIN (Claude patch で post-委任補強)
- accept/reject server action で 6 error code → UI message redirect mapping 実装
- dev/staging 用 `scripts/seed-vendor-dev.ts` 追加 (NODE_ENV=production ガード + idempotent admin.createUser + vendor_users.auth_user_id 紐付け)
- integration test +3: 未認証 reject / 別 vendor reject / code property 検証 → 63 → 66 PASS
- `pnpm test` 66/66 PASS / `pnpm typecheck` PASS

## Claude 側の主要設計判断 (Plan v2 確定後)

1. **Codex adversarial review が Windows sandbox 完全 block → Claude 自己 review に切替**: subagent (del-20260524-140727-4911) が `windows sandbox: spawn setup refresh` で filesystem 全 block。recon subagent (del-20260524-140744-ee01) の 116 行 findings が adversarial review より致命的な発見 (auth context 伝播の根本問題) を含んでいたため、recon ベースで Claude が plan v1 → v2 化
2. **production auth context は `withAuthenticatedDb` helper に集中**: 既存 Drizzle が service-role 相当 PG 接続のため `db.execute()` 単独では `auth.uid()` NULL。tx-local `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', ...)` で擬似 JWT context を作る、テスト fixture と同じ方式を本番経路で再利用
3. **`(vendor-portal)` route group は URL に出ない** → `/vendor/requests` 実現のため `(vendor-portal)/vendor/requests/page.tsx` 構造に修正 (Plan v1 P0a)
4. **error class instanceof は server action 跨ぎ prototype 切れリスク** → `static readonly code` 文字列 mapping に切替、Phase 19 既存 export 名は不変
5. **vendor onboarding は dev/staging seed script のみ**: admin invitation UI は 16-E or β 繰越。seed の email/password は固定値で test 依存
6. **layout 内で `/vendor/login` は VendorShell skip**: route group 配下に login 含めるため、未認証時は children のみ return (Codex 委任 #3 が判断、middleware が redirect 責務担当)
7. **委任 #4/#5 page.tsx 上書き衝突 → Claude patch で吸収**: 並列実行で #5 が #4 の `[id]/page.tsx` を上書き (Codex は file 存在チェックなし)。機能的には #5 版で DoD 満たすが、status label + 会社名 JOIN を Claude が小 patch で post-補強
8. **Codex 委任率 ~92%**: 主要新規/編集 7 ファイル / Codex 6 件直作成、Claude patch 4 件 (implicit any 修正 ×2、page.tsx 補強、ledger override 記録)

## Codex 委任成果

| 委任 ID | 内容 | 成果物 | 状態 |
|---|---|---|---|
| del-20260524-140727-4911 | Phase 20 plan v1 adversarial review | Windows sandbox 完全 block で failed | **override (sandbox-blocked)**、Claude 巻取り |
| del-20260524-140744-ee01 | Supabase ssr + Drizzle auth recon | 116 行 findings (致命発見含む) | applied (plan v2 base) |
| del-20260524-142502-b0bc | #1 error class code + integration test +3 | 5 error class + 3 test | applied (implicit any patch 1 件) |
| del-20260524-143226-9d94 | #2 withAuthenticatedDb + supabase ssr + middleware | 4 file 新規 | applied (implicit any patch 2 件) |
| del-20260524-144122-c1a2 | #3 vendor layout + login | 4 file 新規 | applied |
| del-20260524-145105-601c | #4 一覧 + 詳細 page | 3 file 新規 (詳細 page は #5 上書き、一覧+list-item は維持) | applied (部分上書き、Claude post-patch) |
| del-20260524-145135-aeda | #5 respond-form + accept/reject action | 2 file 新規 + 詳細 page 上書き | applied |
| del-20260524-144122-? | #6 seed script + README + package.json | 3 file 修正/新規 | applied |

委任率: ~92% (6 件全 Codex 直作成 + recon 1 件)。Claude は計画 + adversarial review 代替 + 統合判断 + 型注釈 patch + 詳細 page 補強。

## 主要ファイル (next phase reference)

### 新規

- `src/lib/db/with-auth.ts` — `withAuthenticatedDb` helper (50 行)
- `src/lib/supabase/server.ts` — server client factory (~40 行 with type annotations)
- `src/lib/supabase/browser.ts` — browser client (~15 行)
- `src/middleware.ts` — session + `/vendor/:path*` gate (~75 行 with type annotations)
- `src/app/(vendor-portal)/layout.tsx` — auth-aware shell wrap
- `src/app/(vendor-portal)/vendor/login/page.tsx` — login form
- `src/app/(vendor-portal)/vendor/login/actions.ts` — signInAction / logoutAction
- `src/app/(vendor-portal)/vendor/requests/page.tsx` — pending invitation 一覧
- `src/app/(vendor-portal)/vendor/requests/[id]/page.tsx` — 詳細 (Claude patch で statuses + companies JOIN 追加)
- `src/app/(vendor-portal)/vendor/requests/[id]/actions.ts` — respondAction (6 error code mapping)
- `src/components/vendor-portal/vendor-shell.tsx` — sidebar + header + logout
- `src/components/vendor-portal/request-list-item.tsx` — 一覧 item
- `src/components/vendor-portal/respond-form.tsx` — accept/reject + useFormStatus
- `scripts/seed-vendor-dev.ts` — dev/staging seed (NODE_ENV=production ガード)
- `phase-handoff/phase-20-alpha-3-day3-16d-plan.md` — Plan v2 (recon ベース)
- `phase-handoff/phase-20-supabase-setup-recon.md` — Codex recon 出力 (Plan v2 base material)

### 変更

- `src/lib/services/transport-orders.ts` — 6 error class に `static readonly code` 追加
- `tests/integration/services/transport-orders.integration.test.ts` — test +3 (13 → 16 ケース、code property / 未認証 / 別 vendor)
- `package.json` — `"seed:vendor-dev"` script 追加
- `README.md` — Vendor portal local dev seed セクション追加

## データモデル変更

なし (helper / RPC / table 列変更ゼロ)。Drizzle schema 再生成不要。

## API 契約

### withAuthenticatedDb (新規 helper)

```ts
export async function withAuthenticatedDb<T>(
  authUserId: string,
  fn: (tx: DrizzleTx) => Promise<T>,
): Promise<T>
```

transaction 内で `SET LOCAL ROLE authenticated` + `set_config('request.jwt.claims', '{"sub":"...","role":"authenticated"}', true)` を実行してから `fn(tx)` 呼出。tx 内のすべての DB 操作で `auth.uid()` が解決可能。

### respondAction (server action)

`FormData` → Zod parse (`invitationId` / `response` / `reason?`) → supabase user 取得 → `withAuthenticatedDb` 内で `respondToTransportOrder` 呼出 → 6 error code redirect mapping → success 時 `revalidatePath('/vendor/requests')` + redirect

### error code 一覧

- `INVITATION_NOT_PENDING`
- `VENDOR_AUTH_ERROR`
- `STATUS_TRANSITION_ERROR`
- `CONCURRENT_RESPONSE`
- `INVALID_RESPONSE_VALUE`
- `STATUS_SEED_MISSING`

## テスト・QA 状況

- `pnpm test` **66/66 PASS** (Phase 19 63 + Phase 20 +3 新規)
  - integration test 16 ケース (Phase 19 13 + Phase 20 +3 + 既存重複改修)
  - unit test 13 ケース (Phase 19 維持)
- `pnpm typecheck` PASS
- 未検証: production 実 vendor user の login → 一覧 → accept/reject 全経路 (16-E E2E + staging smoke で検証予定)
- 未検証: middleware の session refresh race condition (実環境 cookie 状態依存)
- 未検証: 全 invitation reject 時の transport_order 終端 (16-E `closeTransportOrderOnAllRejected` 予定)

## 既知の懸念・TODO

- [ ] **16-D で抜けた小機能**: 一覧 page の status label 表示 (詳細 page には Claude patch で追加済、一覧は invitation.response のみ表示)
- [ ] **invitation の reject 理由表示**: 詳細 page で `invitations.reason` 表示はまだ未実装 (DB 列はあり、UI 表示は 16-E で追加検討)
- [ ] **vendor portal の i18n / a11y**: aria-label / focus management は最小限、16-E or β で補強
- [ ] **session expired 時の server action 経路**: redirect は実装済だが UX 検証は staging smoke で
- [ ] **全 invitation reject 時の order 終端処理** (Phase 19 から繰越) → 16-E
- [ ] **spot invitation (vendor_id NULL) flow** (Phase 19 から繰越) → 16-E
- [ ] **admin 側 vendor user invitation UI/API** → 16-E or β
- [ ] **Codex Windows sandbox R-H-002**: adversarial review subagent は完全 block (今回 1 件)、その他 6 件は Write/Edit 通過 / shell 失敗の部分復旧。状況不安定、Claude 巻取り運用継続
- [ ] **委任 #4/#5 並列衝突パターン**: 同一ファイルに異なる委任が書き込む可能性のあるタスクは順次実行 or ファイル分離を厳格化

## Phase 16-E 入力契約 (必須)

### 前提として動くべき機能

- `/vendor/login` で seed 済 vendor user が email + password でログイン可能
- `/vendor/requests` で自社宛 pending invitation 一覧 (RLS 経由 auto filter)
- `/vendor/requests/[id]` で詳細 + RespondForm 表示
- accept submit → status `accepted` 遷移 + 他 vendor invitation revoke (RPC 経由)
- reject submit + reason → invitation `rejected` 更新
- `withAuthenticatedDb(authUserId, fn)` helper が transaction-local auth context 設定
- middleware が `/vendor/:path*` で session refresh + 未認証 redirect
- `pnpm test` 66/66 PASS、typecheck PASS

### 参照すべきファイル

- `src/lib/db/with-auth.ts` (16-E E2E test で同 pattern 利用)
- `src/middleware.ts` (E2E test 経路で session cookie 操作)
- `src/app/(vendor-portal)/vendor/requests/[id]/actions.ts` (E2E test 対象)
- `scripts/seed-vendor-dev.ts` (E2E test 前提 seed)
- `phase-handoff/phase-16-vendor-loop-plan.md` lines 100-108 (16-E 仕様)

### 絶対に壊してはいけないもの (invariants)

- `withAuthenticatedDb(authUserId, fn)` シグネチャ
- 6 error class の `code` プロパティ名 (`INVITATION_NOT_PENDING` 等)
- `(vendor-portal)/vendor/` 配下のファイル配置
- middleware.ts matcher `/vendor/:path*`
- seed script の email/password (test 依存): `vendor-dev1@example.com` / `vendor-dev-pass-001`
- `pnpm test` 66/66 維持
- Phase 19 invariants 全継承 (transport-orders.ts API / RPC signature / audit_logs trigger 委譲 等)

### 推奨される次 Phase スコープ (16-E)

- E2E test (Playwright) `tests/e2e/vendor-portal-loop.spec.ts`
  - happy path: seed → login → 一覧 → 詳細 → accept → 一覧再表示で消える
  - RLS 漏洩テスト: 別 vendor user の invitation 詳細 → notFound
  - 二重 submit: form 連打で 1 件のみ 200 / 2 件目 InvitationNotPendingError
- 全 invitation reject 時の `closeTransportOrderOnAllRejected` service 追加
- spot invitation flow (`respond_to_spot_invitation` 別 RPC) 追加
- admin 側 vendor user invitation UI/API (auth.users 作成 + vendor_users.auth_user_id 設定)
- staging smoke: Resend テスト疎通 + 実 DB + 実 vendor user で 16-D 動作確認

### 注意点・コンテキスト

- E2E test は Codex 強制委任 (Plan §3.1 サブエージェント強制ルール)
- staging smoke で発見された問題は次 Phase で修正、本 Phase の sealed handoff は touch しない
- 16-E 完了で Sprint α-3 全体 sealed、β 着手

## Codex ledger refs

- del-20260524-125544-f9af (Phase 19 review、既 ref)
- del-20260524-140727-4911 (Phase 20 review、**override sandbox-blocked**)
- del-20260524-140744-ee01 (recon、applied)
- del-20260524-142502-b0bc (委任 #1 error code + test)
- del-20260524-143226-9d94 (委任 #2 with-auth + ssr + middleware)
- del-20260524-144122-c1a2 (委任 #3 layout + login)
- del-20260524-145105-601c (委任 #4 一覧 + 詳細、部分上書きされた)
- del-20260524-145135-aeda (委任 #5 respond-form + action + 詳細 page 上書き)
- (#6 seed script の ID、上記から別 ID)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 追加コード行数 | +~900 (helper 50 + supabase 55 + middleware 75 + 9 vendor page/component 510 + seed 80 + test +60 + error code 15 + Claude patch ~50) |
| 新規ファイル数 | 14 (vendor portal 9 + helper 1 + supabase 2 + middleware 1 + seed 1) + 3 (plan v2 + recon + seal handoff) |
| 変更ファイル数 | 4 (transport-orders.ts / integration test / package.json / README.md) |
| Codex 委任率 | ~92% (6 主要委任 + 1 recon + 1 review override) |
| pnpm test | 66/66 PASS (Phase 19 63 → +3) |
| pnpm typecheck | PASS |
| Codex sandbox 失敗 | adversarial review 1 件完全 block / 主要委任 6 件は Write/Edit 部分復旧 / shell-only failed |
| Claude 手動 patch | 4 件 (implicit any 修正 2 件 + 詳細 page 補強 1 件 + ledger override 1 件) |
| セッション数 | 1 (Phase 19 → 20 連続) |

## Phase 振り返りメモ

- **うまくいったこと**:
  - Codex adversarial review が sandbox 完全 block でも、並列で投入していた recon subagent が plan v1 → v2 化に十分すぎる情報を提供してくれた (recon の方が adversarial review より致命的発見を含んでいた、結果論的にはどちらか片方で良かった)
  - `withAuthenticatedDb` helper による production auth context の構造化解決。テスト fixture と本番経路で同 pattern を共有でき、認知負荷削減
  - error code 文字列 mapping への切替で server action 跨ぎ prototype 切れリスクを構造的に解消
  - 委任 #1-#3 は順次、#4 と #5 は並列、#6 は #3 と並列実行、で全体時間圧縮
  - Phase 19 invariants 全維持 (transport-orders.ts API / RPC signature / 既存 test 全 PASS)

- **次回改善したいこと**:
  - 委任 #4/#5 並列で同一 page.tsx に書き込む競合発生 (Codex は file 存在チェックなし)。次回からは並列委任の対象ファイルが重複しないか事前に確認、または lock pattern (片方が先に commit してから片方を起動) を採用
  - Codex Windows sandbox 状況不安定 (R-H-002): adversarial review subagent は完全 block、主要委任は部分復旧。委任先で sandbox 失敗時の自動 fallback (Claude 巻取り) を ledger override で記録するパターンは機能した
  - implicit any 系の TS7006/7031 が委任 #1 #2 で各 4-10 件発生。callback 引数に型注釈付与のテンプレを次回委任 prompt で明示 (今回 Claude 後追い patch で吸収)
  - Plan v2 起草を Claude が単独でやったが、recon の発見が plan v1 を覆すほど致命的だった。次回からは「recon → plan 起草 → adversarial review」順序 (recon を planning の前段にする) を検討

---

*Generated by phase-handoff skill / Filled by Claude at Phase 20 seal (2026-05-25)*
