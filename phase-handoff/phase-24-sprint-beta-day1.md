# Phase 24 / Sprint β Day 1 sealed: spot invitation MVP (DB + service + onboarding layer)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 24 (Sprint β Day 1) |
| 状態 | **sealed** |
| 前 Phase | 22 (16-E close_transport_order) sealed |
| 次 Phase | 25 (Sprint β Day 2: UI + E2E + CI Branching) |
| 関連 plan | phase-24-sprint-beta-day1-plan.md v2 |

## 達成したこと

- ADR-0010 補項を `spec/CLAUDE.md` に追記（vendor invitation token route で service_role 利用許可）
- migration 26 `26_spot_helper_rls.sql`: `vendor_invited_transport_order_ids` helper と `vendor_select` policy を spot/bound 包含 super-set に拡張（backward-compatible）
- migration 27 `27_spot_rpc.sql`: `respond_to_spot_invitation(uuid,text,text)` RPC 追加（22023/P0002/42501/55P03 error code）
- `src/lib/services/spot-invitations.ts`: `respondToSpotInvitation` + `respondToInvitation` router 実装、既存 6 error class 再利用、reject 経路 `closeTransportOrderOnAllRejected` 連動
- `src/lib/services/spot-onboarding.ts`: `verifyAndOnboardSpotInvitation` 実装、case (a)(c)(d) 分岐、compensating cleanup（vendor_users → auth.users → vendors 逆順）
- `src/app/(vendor-portal)/vendor/invitations/[token]/onboard-action.ts`: server action wrapper（env check + error mapping、ADR-0010 補項境界）
- integration test +12（spot-invitations.integration.test.ts）: **70 → 82 PASS**

## Claude 側の主要設計判断

- α/β は SQL 確定（recon §2/§3/§4）を Codex に転記委任。creative work なし、机上設計は Phase 23 recon で完了済
- γ で `respondToInvitation` router を新規 export（advisor #2 対応）。invitation row の `vendor_id` 有無で分岐、`InvitationNotPendingError` で row 不在を表現
- ε の `verifyAndOnboardSpotInvitation` は drizzle db + Supabase admin の 2 client 構成。RPC は呼ばず onboarding 専用、login wall は Phase 25
- compensating cleanup は best-effort（cleanup 失敗は swallow、原因 error を rethrow）
- batch validation 採用: α-η を全部書き終えてから `pnpm test` で一度に検証（途中検証手戻り回避、advisor 提言）
- typecheck 修正 2 件: ε 末尾 `createdVendorId!` ガード追加 / test ファイルで `ConcurrentTransportOrderResponseError` を `transport-orders` から re-import & mock cast を `unknown` 経由に変更

## Codex 委任成果（ledger ID）

| sub-task | delegation_id | 適用済 |
|---|---|---|
| α (26_spot_helper_rls.sql) | del-20260525-023033-fa46 | ✓ |
| β (27_spot_rpc.sql) | del-20260525-023203-eb95 | ✓ |
| γ (spot-invitations.ts) | del-20260525-023635-7a57 | ✓ |
| ε (spot-onboarding.ts) | del-20260525-024036-6a17 | ✓（typecheck 修正は Claude） |
| δ-server (onboard-action.ts) | del-20260525-024406-7690 | ✓ |
| η (integration test +12) | del-20260525-024703-a2c5 | ✓（typecheck 修正は Claude） |

## 主要ファイル

- `spec/CLAUDE.md:131-137` ADR-0010 補項追記
- `src/lib/db/raw-migrations/alpha-1-public/26_spot_helper_rls.sql:1-60`
- `src/lib/db/raw-migrations/alpha-1-public/27_spot_rpc.sql:1-97`
- `src/lib/services/spot-invitations.ts:1-175`
- `src/lib/services/spot-onboarding.ts:1-322` (size 322 行、Phase 25 で分割検討)
- `src/app/(vendor-portal)/vendor/invitations/[token]/onboard-action.ts:1-76`
- `tests/integration/services/spot-invitations.integration.test.ts:1-835` (size 835 行、Phase 25 で onboarding/RPC 分割検討)

## データモデル変更

- 新規 migrations: 26 / 27（既存 25 ファイル touch なし、`spec/data-model.md §17` 順序遵守）
- DB スキーマ自体は変更なし（既存 `transport_order_invitations` 列で完結）

## API 契約

- `respondToInvitation(db, { invitationId, response, reason? }) → RespondToTransportOrderResult | RespondToSpotInvitationResult`
- `respondToSpotInvitation(db, input) → RespondToSpotInvitationResult` (boundVendorId/boundVendorUserId 追加)
- `verifyAndOnboardSpotInvitation(db, supabaseAdmin, rawToken) → OnboardResult` ({ case: 'new'|'existing', ... })
- `onboardSpotInvitationAction(token) → OnboardActionResult` ({ ok: true, result } | { ok: false, code, message })

## テスト・QA 状況

- `pnpm test`: **82/82 PASS**（70 既存維持 + 12 新規）
- `pnpm tsc --noEmit`: clean
- 新規テストカバレッジ: onboarding 5 / RPC+service 3 / RLS 1 / DB constraint 1 / router 2

## 既知の懸念・TODO（Phase 25 で対応）

- **bound visibility 直接シナリオ未テスト**（advisor 指摘）: RPC accept 後の bound_vendor_id 経由 SELECT は構造的に自明だが直接 test なし。Phase 25 の `/vendor/requests` UI/E2E でカバー
- **`onboardSpotInvitationAction` wrapper 単独テストなし**（advisor 指摘）: env check + error mapping のみで実質ロジックなし。Phase 25 の UI 統合テストで exercise
- **case (b)（既存 auth.users without vendor_user）未対応**: plan v2 で Sprint γ 繰越確定
- **case (c) global unique 設計**: Phase 26 (admin invitation) で再検討
- η ファイル 835 行: Phase 25 で onboarding / RPC を別ファイル分割検討（now: 監視のみ）

## 次 Phase 入力契約（Phase 25）

- 利用可能 API: `respondToInvitation` router / `verifyAndOnboardSpotInvitation` / `onboardSpotInvitationAction`
- 必要 env: `NEXT_PUBLIC_APP_URL`（redirectTo に使用、callback hook 用）
- Phase 25 スコープ:
  - ζ: `actions.ts` で `respondToInvitation` 呼出に統合（既存 `respondAction` を router 経由へ）
  - δ-ui: `/vendor/invitations/[token]/page.tsx` 実装（onboard-action 呼出 + password setup wall）
  - login callback で `vendor_users.is_active=true` flip + `last_login_at` 更新（F10）
  - θ: E2E spec `vendor-portal-spot-loop.spec.ts`（2 ケース: case (a) happy / case (c) cross-tenant）
  - ι: CI workflow + Supabase Branching（raw-migrations 案 B = env 隔離）
- 参照: 本 handoff + plan v2 + phase-23 recon 5 件 + phase-24-adversarial-review

## Invariants 継承

- Phase 19/20/22 invariants 全継承
- 既存 raw-migrations 25 ファイル touch 禁止 → 守られた（新規 26/27 のみ）
- `respondToTransportOrder` / `withAuthenticatedDb` / `closeTransportOrderOnAllRejected` 不変 → 守られた
- ADR-0010 service_role 境界 → ADR-0010 補項で onboarding route のみ拡張
- pnpm test 増加のみ → 70 → 82（+12）

## 主要メトリクス

- Codex 委任率: 6/7 sub-task（86%）。ADR-0010 補項追記のみ Claude 直
- typecheck 修正は Claude（2 件、合計 ~10 行）
- 累計セッション時間: ~50 分（実装+検証含む）
- batch validation により中間 pnpm test 実行 0 回、最終 1 回で 82/82 PASS
