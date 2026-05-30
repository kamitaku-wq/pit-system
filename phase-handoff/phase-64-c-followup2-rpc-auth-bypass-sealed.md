# Phase 64-C follow-up #2 — RPC 認可 bypass fix (post/0006 regression) sealed handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-C follow-up #2 (security hardening / cross-tenant invitation accept bypass 封鎖) |
| 種別 | implementation (raw-migration: SECURITY DEFINER 認可関数の挙動変更) |
| Branch | `phase-64-mvp-implementation` |
| 由来 | follow-up #1 の adversarial gate (Codex) が surface した既存脆弱性。user 判断で C.4 より優先 |
| 前提 | follow-up #1 (post/0031) sealed + commit 済 (9b49548) |
| 次タスク | **C.4** (fallback 3 種 / L3-3·L3-4·L3-5)。+ defer: close_transport_order 認可 (task #4) |

## 実装したこと

`accept_invitation_and_revoke_others` の認可ガードを復元し、任意の authenticated user が他 vendor の pending invitation を `respond_to_transport_order` の accept 経路経由で accept できる cross-tenant auth bypass を封鎖した。

| ファイル | 内容 |
|---|---|
| `src/lib/db/raw-migrations/post/0032_restore_accept_invitation_auth_guard.sql` (新規) | `accept_invitation_and_revoke_others(uuid)` を CREATE OR REPLACE し原版認可ガードを復元: ① spot 招待 (vendor_id IS NULL) を P0002 で弾く ② `current_vendor_user_id()` が active vendor_user かつ招待 vendor に属することを検証 (不一致は 42501)。post/0006 の列 qualify (toi/tro alias) + bound_vendor_user_id セットは維持。加えて `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` (defense-in-depth, BLOCK 2) |
| `tests/integration/db/transport-respond-cross-vendor-auth.integration.test.ts` (新規) | (a) vendor B が vendor A の invitation を respond 経由で accept → 42501 + message "does not belong to invitation vendor" 突合 (b) vendor A が自 invitation を accept → 成功 + accepted/winning (c) catalog: `has_function_privilege('authenticated', helper, 'EXECUTE')`=false |
| `tests/integration/db/transport-order-invitations-fk.integration.test.ts` (修正) | (vii) WARN-2 test を proven 経路へ切替: helper 直接呼出は post/0032 で不可 (guard + EXECUTE 剥奪) ゆえ vendor_user seed + SET LOCAL ROLE authenticated + claims + `respond_to_transport_order` 経由に変更。invited_by_user_id 不変の検証意図は維持 |

### 根本原因 (regression の経緯)

- 原版 (`alpha-1-public/18_helper_functions.sql:182-195`) は accept 前に ①spot 弾き ②vendor user membership 一致を検証していた。
- `post/0006_phase_27_a_rpc_and_rls_fixes.sql` (Phase 27-A) が「ambiguous column reference 修正」として CREATE OR REPLACE した際、列 qualify と引き換えに ①② の認可ガードを**巻き添え削除**した (コメントは column 修正のみ言及 = 事故と確定)。
- `respond_to_transport_order` (24_vendor_rpcs.sql) の accept 経路は helper 呼出前に vendor 認可せず委譲するため (reject 経路のみ認可)、helper のガード脱落がそのまま respond の穴になった。

### 設計判断 (advisor + Codex 確定)

- **24_vendor_rpcs.sql は touch 不可 invariant** ゆえ、respond の accept 経路を塞ぐ修正は respond が呼ぶ helper 側に集約 (helper に guard 復元 → respond 経由 accept が塞がる)。
- **spot flow は無影響**: spot accept は別 RPC `respond_to_spot_invitation` (27_spot_rpc.sql) が独自の email-match 認可で処理し helper を経由しない (27_spot_rpc は「helper を変更するな」と明記)。spot-rejection guard 復元も spot に影響なし。`respond_to_spot_invitation` 自体は email match guard を持ち本 bypass の対象外 (Codex 確認)。
- **prod 呼出元は respond のみ** (grep 確認)。admin/代理 accept は不在 → guard 復元は登録 vendor accept (唯一の正規経路) を壊さない。`current_vendor_user_id()` は `auth.uid()` (request.jwt.claims GUC) を読み、respond の SECURITY DEFINER 跨ぎでも session GUC は保持されるため実呼出元 vendor に解決する。
- **fk テストの proven 経路化** (advisor): 当初「owner + GUC 直接 helper 呼出」を書いたが、claims-only-as-owner での `auth.uid()` 解決はリポジトリに前例ゼロ・ローカル検証不可。CI 往復リスクを避け、tenant-isolation 実証済みの SET LOCAL ROLE + respond 経由に切替。

## gate (raw-migration / 発火条件 #1, #2 相当: SECURITY DEFINER 認可関数の挙動変更)

具体的変更: **post/0032 で `accept_invitation_and_revoke_others` に認可ガード復元 + REVOKE EXECUTE FROM authenticated**。

- **Codex 異モデル adversarial 2 ラウンド** (read-only):
  - ラウンド1 (`del-20260530-000053-ee7e`): bypass を BLOCK 指摘 (post/0006 regression + respond accept 経路無認可)。
  - ラウンド2 (`del-20260530-002426-2d6b`): post/0032 が **accept/hijack 経路を解消したことを確認** (prior BLOCK resolved)。残課題として ① 既存 fk(vii) test が helper 直接呼出で失敗 (BLOCK A) ② close_transport_order 無認可 (BLOCK B) を指摘。
- **advisor 2 ラウンド** (finding 査定/scope 確定 + seal 前 fk テスト経路 de-risk)。

### Codex ラウンド2 指摘の対応

| # | 指摘 | 対応 |
|---|---|---|
| BLOCK A | fk(vii) test が helper を owner 直接呼出 → guard で 42501 失敗 | **修正**: respond 経由 + vendor session に切替 (CI green prerequisite) |
| INFO | respond 経由 accept/hijack 封鎖を確認 / 登録 vendor accept は健在 / spot 無影響 | 設計通り |
| WARN | 負例 test が "ある 42501" しか証明しない | **強化**: message "does not belong to invitation vendor" を突合 (vendor-mismatch 分岐の発火を確定) |
| BLOCK B | close_transport_order 無認可 | **defer** (下記)。user の focused scope 選択 |

## defer (task 化済, 本 phase スコープ外)

- **close_transport_order 認可 (task #4)**: `25_close_transport_order.sql` は SECURITY DEFINER + GRANT EXECUTE to authenticated + 認可ガード無し。任意 authenticated が全 rejected の order を cross-tenant に close 可能。**ただし状態ガード (accepted=0 AND pending=0 AND rejected>0) で benign close に限定・データ漏洩なし → WARN/LOW** (advisor 裁定)。**単純 REVOKE 不可**: reject 経路 (withAuthenticatedDb=authenticated → closeTransportOrderOnAllRejected → close_transport_order) が legit に authenticated で呼ぶため → in-function auth guard 設計が必要。Codex は 2 回 BLOCK 指摘だが advisor WARN 裁定 + user focused scope ゆえ別 hardening task。
- **timestamp grant (picked_*/delivered_*/returned_*)**: follow-up #1 で scope 外明記済 (vestigial, LOW)。同 sweep 候補。

## 検証状態

- ローカル: `tsc --noEmit` 緑 / prettier (新/変更 .ts) 緑。.sql は prettier parser 対象外。unit は本変更 (integration test + migration) に非依存ゆえ 79/79 維持。
- CI gate (e2e.yml): `supabase start` → `pnpm db:setup` (post/0032 適用) → `pnpm test:integration` (新 cross-vendor test + 修正 fk(vii)) → playwright。integration は local Supabase 不可ゆえ CI が gate (A.34 precedent)。
- Codex は read-only review のみ (git status で書込なし確認済)。

## invariants (維持)

- `24_vendor_rpcs.sql` touch せず (guard は helper post/0032)。respond の accept 経路は helper 経由で塞がる。
- spot accept (respond_to_spot_invitation) は無影響。
- 原版 (18_helper_functions) と同じ guard セマンティクス + post/0006 の列 qualify を両立。
- follow-up #1 (post/0031) + A.21-A.34 + C.0-C.3 invariants 維持。

## 次セッションの手順

1. 本 handoff + follow-up #1 handoff + C-plan を読む。
2. **C.4 = fallback 3 種** (L3-3 次候補打診 / L3-4 希望日時変更再依頼 / L3-5 手動切替)。service + admin action、service_role db 経路 (ADR-0010)、canonical = cancelTransportOrder パターン B (raw SQL tx, change_logs requires_notification=false, idempotency 構造化)。判断量 中〜高。
3. defer: close_transport_order 認可 (task #4) は別 hardening task。

*Phase 64-C follow-up #2 sealed / Generated by Claude 2026-05-30 / post/0032 認可ガード復元 (cross-tenant invitation accept bypass 封鎖) / gate: Codex×2 (prior BLOCK resolved) + advisor×2 / fk(vii) を proven 経路へ de-risk / close は defer (task #4) / 次: C.4*
