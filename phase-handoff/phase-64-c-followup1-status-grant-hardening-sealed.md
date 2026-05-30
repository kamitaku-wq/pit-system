# Phase 64-C follow-up #1 — status_id grant 除去 (security hardening) sealed handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-C follow-up #1 (security hardening / vendor status_id 直接 UPDATE バイパス封鎖) |
| 種別 | implementation (raw-migration: column GRANT REVOKE) |
| Branch | `phase-64-mvp-implementation` |
| 前提 | C.0/C.1/C.2/C.3 sealed + CI green。完了 RPC (post/0030) 導入で本 hardening の前提 (authenticated 直書きフロー不在) が成立 |
| 由来 | C.1 + C.3 で Codex adversarial が計 2 回 BLOCK 指摘 → follow-up #1 (★★ 最優先 hardening) に格上げ済 |
| 次タスク | **RPC 認可 bypass fix (新規発見, 下記 §新規発見) → その後 C.4** |

## 実装したこと

vendor (Postgres role `authenticated`) が `transport_orders.status_id` を SECURITY DEFINER RPC を迂回して直接 UPDATE できる column-grant バイパスを封鎖した。

| ファイル | 内容 |
|---|---|
| `src/lib/db/raw-migrations/post/0031_revoke_vendor_transport_status_grant.sql` (新規) | `REVOKE UPDATE (status_id, version) ON public.transport_orders FROM authenticated;` (冪等)。status 遷移を SECURITY DEFINER RPC (respond/complete) / service_role=owner 経路 (cancel/confirm) のみに限定 |
| `tests/integration/db/transport-status-id-grant.integration.test.ts` (新規) | ① `has_column_privilege` catalog assertion (status_id/version=false, scheduled_*/updated_at=true = 過剰除去でない) ② SET LOCAL ROLE authenticated 下の直接 UPDATE が 42501 で拒否 (seed-free: column 権限チェックは RLS 行評価より前に走る) |
| `spec/data-model.md` §14.4 | GRANT block に post/0031 注記 (A.25 drift 規律: 黙って削除せず注記) |

### 設計判断 (advisor 確定)

- **scope = status_id + version** (follow-up #1 の明示スコープ準拠)。version を含める根拠: `NEW.version` を書く trigger は皆無 (grep 確認済) + schedule は version 非更新 → authenticated 直書き経路なし。
- **picked_up_at/delivered_at/returned_at/vendor_response* は除外** (authenticated 直書きされない vestigial grant。complete RPC/vendor_response セマンティクスに触れるため別 sweep)。Codex も WARN/LOW で defer 妥当と同意。
- **正規 status 書込経路は全て無傷**: respond/complete = SECURITY DEFINER RPC (owner 実行)、cancel/confirm = service_role=owner (`db` client.ts, SET LOCAL ROLE せず)、schedule = scheduled_*/updated_at のみ。auto-confirm trigger (post/0029, definer) も owner 実行 UPDATE で発火。
- **テスト seed-free 化** (advisor): column-privilege denial は ExecCheckRTPerms で RLS 行評価より前に発火 → 0 行マッチでも 42501。重い fixture/tx abort 取り回し不要。正例 (scheduled_pickup_at 成功) は audit trigger の authenticated 経路 CI 未検証リスクを避け catalog assertion で代替。

## gate (raw-migration / 発火条件 #1: column GRANT REVOKE)

具体的変更: **post/0031 で `REVOKE UPDATE (status_id, version) ON transport_orders FROM authenticated`**。

- **advisor 2 回** (着手前 設計レビュー + 実装後 Codex finding 査定/scope 確定)。
- **Codex 異モデル adversarial** (read-only, `del-20260530-000053-ee7e`): post/0031 自体は「正しい・冪等・適用順正・**直接 column-grant BLOCK は解消**」と確認。

### Codex finding の査定結果

| # | 指摘 | 査定 | 対応 |
|---|---|---|---|
| post/0031 | column grant REVOKE 正当性 | **正・BLOCK 解消確認** | 本 phase で完了 |
| BLOCK 3 | respond_to_transport_order accept 経路が他 vendor の invitation を accept 可能 | **確定 (cross-tenant auth hole, UUID-gated)** | **新規 follow-up (下記)**。#1 と別 concern ゆえ非束ね (advisor 構造判断) |
| BLOCK 2 | accept_invitation_and_revoke_others 直接呼出で認可スキップ | **確定 (BLOCK 3 と同根)** | 同上 |
| BLOCK 1 | close_transport_order 無認可 | **WARN 降格** | 状態ガード (全 rejected 時のみ benign close) で実害限定。defense-in-depth follow-up |
| WARN | picked_*/delivered_*/returned_* 直書き可 | **LOW・defer** | post/0031 で scope 外明記済 |

## ★ 新規発見 (adversarial gate が surface した既存脆弱性、#1 とは別 concern)

**RPC 認可 bypass (post/0006 の Phase 27 regression)** — 本 hardening と同テーマ (vendor の RPC 認可迂回) かつ原 status_id bypass より境界が広い。**次タスク候補**。

- **根本原因**: `post/0006_phase_27_a_rpc_and_rls_fixes.sql:12-74` が `accept_invitation_and_revoke_others` を「ambiguous column 修正」と称して CREATE OR REPLACE した際、原版 (`18_helper_functions.sql:182-195`) にあった**認可ガード (`current_vendor_user_id()` + 招待 vendor との membership 一致チェック) を巻き添え削除**。コメントは column 修正のみ言及 → 事故と確定。
- **影響経路**: `respond_to_transport_order` (24_vendor_rpcs.sql) の **accept 経路は helper 呼出前に vendor 認可せず** helper に委譲 (reject 経路のみ `current_vendor_user_id()`+vendor 一致を確認)。GRANT EXECUTE が authenticated ゆえ、任意の authenticated user が `respond_to_transport_order('<他 vendor の pending invitation uuid>','accepted')` で他 vendor の invitation を accept でき、競合 invitation を revoke + order.vendor_id を奪取できる。
- **重大度 = 広いが UUID-gated** (advisor): 実 exploit には他 vendor の pending invitation UUID が必要。`transport_order_invitations` の `vendor_select` RLS が vendor B に vendor A の invitation を列挙させないため trivially exploitable ではない。即時緊急ではないが boundary は原 bypass (RLS で自社案件限定) より広い。
- **prod 呼出元の確定**: helper の prod caller は `respond_to_transport_order` のみ (grep 確認)。spot accept は別 RPC `respond_to_spot_invitation` (27_spot_rpc.sql) を使い helper を通らない (27_spot_rpc は「helper を変更するな」と明記) → **原版ガード復元は登録 vendor accept (唯一の prod 経路) を壊さない**。admin/代理 accept は不在。
- **修正方針 (次タスクで実装)**: focused 別 migration `post/0032` で ① `accept_invitation_and_revoke_others` に原版認可ガードを復元 (post/0006 の column qualify は維持) → BLOCK 3 封鎖、② `REVOKE EXECUTE ON FUNCTION accept_invitation_and_revoke_others FROM authenticated` (respond は SECURITY DEFINER=owner 実行ゆえ呼べる) → BLOCK 2 defense-in-depth。raw-migration かつ SECURITY DEFINER 認可関数の書換ゆえ専用 adversarial gate (Codex + advisor) 必須。+ test: 他 vendor invitation の accept が 42501 で拒否 / 自 vendor accept は成功。
- BLOCK 1 (close_transport_order 無認可) と timestamp WARN は同 migration or 別 minor follow-up で defense-in-depth として処理。

## 検証状態

- ローカル: `tsc --noEmit` 緑 / unit 79/79 緑 / prettier (新 .ts) 緑。.sql は prettier parser 対象外、spec .md は既存同様 hand-formatted (HEAD も非 prettier)。
- CI gate (e2e.yml): `supabase start` → `pnpm db:setup` (post/0031 適用) → `pnpm test:integration` (新 grant test) → playwright。integration は local Supabase 不可ゆえ CI が gate (A.34 precedent)。
- Codex は read-only review のみ (git status で書込なし確認済、completion hook の "auto-apply" は誤報)。

## invariants (維持)

- `24_vendor_rpcs.sql` touch せず (REVOKE は post/0031)。
- status 遷移は SECURITY DEFINER RPC / owner 経路のみ (本 hardening の主目的)。enforce_status_transition + auto-confirm trigger は owner 実行で従来通り発火。
- vendor 予定入力 (scheduleTransportOrder) は scheduled_*/updated_at で従来通り動作 (catalog で grant 温存確認)。
- A.21-A.34 + C.0-C.3 invariants 維持。

## 次セッションの手順

1. 本 handoff を読む。
2. **RPC 認可 bypass fix** (上記 §新規発見) を実装 — ユーザーが C.4 より優先と判断した場合。`post/0032` で guard 復元 + REVOKE EXECUTE + test + 専用 adversarial gate。spot flow を壊さないこと (helper 非経由を確認済だが test で守る)。
3. その後 **C.4 fallback 3 種** (L3-3/L3-4/L3-5)。

*Phase 64-C follow-up #1 sealed / Generated by Claude 2026-05-30 / post/0031 column-grant hardening (status_id+version REVOKE) / gate: advisor×2 + Codex / 直接 bypass 解消確認 / 新規発見: RPC 認可 bypass (post/0006 regression) を次タスクに切り出し*
