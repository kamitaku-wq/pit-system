# Phase 64-C.3 vendor portal 完了系 — sealed handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-C.3 (vendor portal 完了系 / L2-11 予定入力 + L2-12 完了報告, α 必須) |
| 種別 | implementation (raw-migration: 完了 RPC) |
| Branch | `phase-64-mvp-implementation` |
| 前提 | C.0/C.1/C.2 sealed + CI green |
| 設計文脈 | `phase-64-c3-vendor-completion-design.md` (調査・設計確定の唯一文脈源) |
| 次タスク | **C.4** (fallback 3 種 / L3-3·L3-4·L3-5) |

## 実装したこと

業者マイページで accept 済案件の **予定入力 (L2-11)** と **完了報告 (L2-12)** を可能にした。

| ファイル | 内容 |
|---|---|
| `src/lib/db/raw-migrations/post/0030_complete_transport_order_rpc.sql` (新規) | SECURITY DEFINER RPC `complete_transport_order(p_invitation_id, p_picked_up_at, p_delivered_at, p_returned_at)`。認可三重突合 (current_vendor_user_id + current_vendor_id = order.vendor_id = invitation.vendor_id) → accepted→completed + 実績時刻セット + status_history append。並行二重完了は `WHERE status_id=<accepted>` ガードで 0 行→55P03。REVOKE EXECUTE FROM PUBLIC,anon |
| `src/lib/services/transport-orders.ts` | `completeTransportOrder` (RPC 呼び出し + error 正規化: P0001→StatusTransition / 42501→VendorAuth / 55P03→Concurrent / P0002[not seeded]→StatusSeedMissing / P0002[他]→NotCompletable) + `scheduleTransportOrder` (vendor session 直接 UPDATE scheduled_*, accepted-status 相関サブクエリガード) |
| `src/app/(vendor-portal)/vendor/requests/[id]/actions.ts` | `scheduleAction` / `completeAction` (withAuthenticatedDb + error→redirect) |
| `src/app/(vendor-portal)/vendor/requests/[id]/page.tsx` | query 拡張 (statusKey/scheduled_*/picked_up 等) + RespondForm を pending 限定 + accepted で ScheduleForm/CompleteForm 描画 + completed 表示 + 成功/エラーバナー |
| `src/components/vendor-portal/schedule-form.tsx` / `complete-form.tsx` (新規) | 予定/完了フォーム (datetime-local, RespondForm スタイル踏襲) |
| `tests/integration/services/transport-orders.integration.test.ts` | Phase 64-C.3 describe: 完了成功 / schedule 成功 / 未accept拒否 / **wrong-vendor 42501** / schedule pending 拒否 |

### 設計判断 (advisor C.3 確定)

- **完了は RPC 必須**: vendor session は `transport_order_status_history` を INSERT 不可 (RLS WITH CHECK `company_id=current_user_company_id()` が vendor で NULL)。history を残すため (accept/cancel と整合) SECURITY DEFINER RPC が必須。
- **L2-11 は vendor 直接 UPDATE**: scheduled_* は vendor column GRANT 内 + status_history 不要 → RPC 不要。
- **grant 除去 / 店舗通知 outbox は C.3 から decouple** (advisor): 下記 follow-up。

## gate (raw-migration, 発火条件 #1)

- **advisor 3 回** (C.3 設計確定含む) + **workflow `wf_e3448476-b4b`** (3 frame, 確定 MEDIUM 1 + LOW 4) + **Codex 異モデル** (BLOCK 1 + WARN 7 + INFO 1)。

### 反映した指摘

| 出所 | sev | 指摘 | 対応 |
|---|---|---|---|
| WF/Codex | LOW/WARN | REVOKE EXECUTE FROM PUBLIC,anon 欠如 | **追加** (0028 同方針) |
| WF | LOW | COALESCE NULL クリア不可が未記載 | **コメント追記** |
| Codex | WARN | P0001 (invalid transition) 未正規化 | **StatusTransitionError マップ追加** |
| Codex | WARN | seed 欠落が not_completable に埋没 | **P0002[not seeded]→StatusSeedMissingError 分岐** |
| Codex | WARN | scheduleTransportOrder が order status 未確認 | **accepted-status 相関サブクエリガード追加** |
| WF (MED)/Codex | MED/WARN | wrong-vendor 42501 path 未テスト | **test 追加** (VendorAuthError) |
| WF/Codex | LOW/WARN | schedule 負例不足 | **pending 拒否 test 追加** (InvitationNotAcceptedError) |

### 対応せず (defer / 既存 / 別 follow-up)

- **★ Codex BLOCK (Axis 3) = vendor 直接 status_id UPDATE で RPC/history 迂回**: C.1 でも BLOCK 指摘された **同一の既存バイパス** (status_id が vendor column GRANT 内)。advisor が C.1+C.3 設計で「**low-harm (self-inflicted・own order・RLS scoped・audit_logs は記録) ゆえ decouple、別 hardening migration へ。再 litigate するな**」と裁定済。**Codex が C.1/C.3 で計 2 回 BLOCK 指摘 → follow-up #1 に格上げ**。C.3 blocker としない (advisor 裁定優先)。
- 55P03 並行二重完了 test (flaky・race 窓狭・accept RPC と構造同一) → defer。
- vendor_users.auth_user_id 一意制約欠如 (current_vendor_id の LIMIT 1 曖昧, 既存・respond も同型) → follow-up。
- test が SET ROLE authenticated を通らない (既存 harness 限定, setAuthUid で RPC auth は検証) → 別 harness 改善。
- RPC 戻り値 Zod parse (INFO, respond も同型) → skip。

### Codex sandbox-block

UI 実装を Codex 委任したが **Windows sandbox が apply_patch を read-only で拒否** (companion 既知制約, codex-collaboration §2.5)。git 実体で UI 未作成を確認 → **Claude が §2.5 fallback で直接実装** (schedule-form/complete-form/page.tsx)。

## follow-up (decoupled, 別 phase)

1. **★★ status_id grant 除去 (security hardening, Codex BLOCK×2)**: vendor の column GRANT から `status_id`(+`version`) を除去し status 遷移を RPC-only にしてバイパス封鎖。完了 RPC 導入後は vendor の直接 status_id 書込フローが無い (grep 確認済) ため安全に除去可能。独立した focused migration + 「除去後に vendor 直接 status UPDATE が拒否される」test で実施。**Codex が C.1/C.3 で 2 回 BLOCK 指摘した最優先 hardening**。
2. **店舗向け完了通知 (outbox)**: dispatcher が payload.to/subject/html を直接送る契約だが transport 通知 (cancel/confirm/completed) は構造化 payload で email 未レンダリング = 実送信されない既存ギャップ + store_user target_id 解決未確立。完了通知 email + dispatcher payload 契約は cancel/confirm と共通の cross-cutting 改修。`to:{id}:completed:v{ver}` key は §15.6 予約済。現状 store は admin UI で完了を確認可。
3. requests/page.tsx の accepted 案件一覧フィルタ拡張 (minor, 未実装)。
4. C.0/C.1/C.2 由来 follow-up (0023 REVOKE / triggers_notification 系統監査 / _raw_migrations basename / L3-6+L2-3 / 0013 comment) 継続。

## 検証状態

- ローカル: `tsc --noEmit` 緑 / unit 79/79 緑 / prettier 緑。
- CI gate: `db:setup` (post/0030 適用) + `test:integration` (完了/schedule/wrong-vendor/pending の新 test + 既存 accept fixture 再利用)。

## invariants (維持)

- `24_vendor_rpcs.sql` touch せず (完了は新 RPC post/0030)。
- accept (respond RPC) と完了 (complete RPC) の history は changed_by_user_id=NULL で整合。
- C.1 auto-confirm trigger は completed 遷移で no-op (status='accepted' のみ反応)。
- enforce_status_transition が accepted→completed (C.0 seed) を最終検証。
- A.21-A.34 + C.0/C.1/C.2 invariants 維持。

## 次セッション (C.4) の手順

1. 本 handoff + C-plan + C.0-C.2 handoff を読む。
2. **C.4 = fallback 3 種** (C.0 後着手可・C.3 と独立): L3-3 次候補打診 (nextVendorAttempt: vendor_attempts.attempt_seq++ + 新 invitation outbox `to:{id}:invite:{newInvId}`) / L3-4 希望日時変更再依頼 (rescheduleAndRenotify: change_logs[datetime_changed] + outbox `to:{id}:changed:{clid}`) / L3-5 手動切替 (switchVendorManual: vendor_selection_logs + status='cancelled' or 再依頼)。判断量 中〜高。canonical: cancelTransportOrder パターン B (service_role db, raw SQL tx, change_logs requires_notification=false, idempotency 構造化)。
3. store admin action ゆえ service_role `db` 経路 (C.2 と同, ADR-0010)。

*Phase 64-C.3 sealed / Generated by Claude 2026-05-30 / 完了 RPC (post/0030) + L2-11 直接 UPDATE + UI / gate: advisor×3 + workflow + Codex / Codex BLOCK (grant bypass) は advisor 裁定で decouple→follow-up#1 格上げ / 次: C.4*
