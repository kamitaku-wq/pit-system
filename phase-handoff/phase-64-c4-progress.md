# Phase 64-C.4 業者対応不可フォールバック — 完了ハンドオフ (SEALED 2026-05-30)

## 完了状況: Lane C 完了 (SEALED)

| サブ | 内容 | 状態 | commit |
|---|---|---|---|
| C.4.0 | 状態モデル補正 (post/0033: rejected stall + rejected→requested + close ambiguous/是正) | ✅ green | b2573ab + 808b072 |
| C.4.1 | reassignTransportOrderVendor (fallback/manual 統合) + reopenOrderForResolicit helper | ✅ green | 51ffe4b + f6fb404 |
| C.4.2 | rescheduleAndRenotifyTransportOrder (L3-4 希望日時変更再依頼) | ✅ green | d7fadbf + 6ea188b |
| C.4.3 | admin actions (nextVendor/switchVendor/reschedule) + UI panel | ✅ green | 30b5d5c |
| seal-fix | outbox idempotency_key 衝突 (再打診/再依頼に attempt_seq 付与) | ✅ green | 028ecbd |
| seal-fix | attempt_seq 並行 INSERT を単一文 + advisory lock で直列化 | ✅ green | 16f12cf |
| seal-fix | close_transport_order cross-tenant 認可ガード | ✅ green | 4cef835 |

## 実装済み service (src/lib/services/transport-orders.ts)

### reassignTransportOrderVendor (C.4.1) — L3-3 次候補打診 / L3-5 手動切替
```
reassignTransportOrderVendor(database, companyId, userId, {
  transportOrderId, expectedVersion, newVendorId,
  mode: 'fallback' | 'manual', selectionReasonNote?, consideredVendorIds?, reason?
}) → { transportOrderId, newVersion, newVendorId, newInvitationId, attemptSeq, notificationOutboxId, idempotencyKey }
```
- rejected stall からのみ (ReassignNotRejectedError)。version 不一致=ConcurrentTransportOrderReassignError。非 active vendor=VendorMembershipError。
- fallback: change_type=rejected_reassigned / method=fallback / reason=vendor_unavailable。
- manual: change_type=vendor_changed / method=manual / reason=manual_preference。

### rescheduleAndRenotifyTransportOrder (C.4.2) — L3-4 希望日時変更再依頼 (同 vendor)
```
rescheduleAndRenotifyTransportOrder(database, companyId, userId, {
  transportOrderId, expectedVersion, requestedPickupAt?, requestedDeliveryAt?, requestedReturnAt?, reason?
}) → { transportOrderId, newVersion, vendorId, newInvitationId, attemptSeq, notificationOutboxId, idempotencyKey }
```
- rejected stall からのみ (RescheduleNotRejectedError)。希望日時最低 1 つ必須 (Zod refine)。vendor 不在=RescheduleNoVendorError。

### 共有 helper reopenOrderForResolicit (private)
旧 pending/accepted invitation revoke (rejected は保全) → attempt_seq 純増 INSERT (単一文+advisory lock) →
invitation upsert (同 vendor 既存行を pending に戻す, UNIQUE 回避) → order UPDATE (status→requested,
vendor 差替, scalar リセット vendor_response='pending', requested_*_at COALESCE) → status_history。

## admin actions + UI (C.4.3)
- `src/app/admin/transport-orders/[id]/actions.ts`: nextVendorAction / switchVendorAction / rescheduleAction。
- `page.tsx`: rejected order に操作パネル。次候補打診 / 別業者手動切替 / 希望日時変更再依頼 / 自社対応(cancel)。
  vendor 候補は active membership から取得。**手動切替 spec 解釈 = 両方出す (ユーザー確定)**:
  「別業者へ手動切替」(C.4.1 manual) + 「自社対応=依頼キャンセル」(既存 cancel、rejected 時は見出し切替)。

## adversarial gate (完了) — Codex BLOCK 2 + WARN 1 全対処

| 指摘 | 重大度 | 対処 | commit |
|---|---|---|---|
| outbox idempotency_key 衝突 (invitation 再利用で初回/過去 outbox と UNIQUE 衝突) | BLOCK | attempt_seq 付与 `to:{O}:invite:{inv}:a{seq}` | 028ecbd |
| close_transport_order cross-tenant (authenticated が他社 order 強制 close/probing) | BLOCK | close 内に認可ガード (vendor は invitation 紐付け検証 / service_role 通過) | 4cef835 |
| attempt_seq 並行 MAX+1 → 23505 露出 | WARN | 単一文 INSERT...SELECT + advisory lock | 16f12cf |

- idempotency_key 衝突は Codex 指摘前に Claude 独立検証で先行発見・修正 (両者一致)。
- cross-tenant close は C.4 が tenant-safe 機能として seal する以上 defer 不可と判断し封鎖。

## 検証 (seal 時点)
- **CI ゲート (e2e.yml = build + test:integration)**: `next build` 成功 (48 ページ生成, /admin/transport-orders/[id] 含む)。tsc クリーン。
- **transport integration 全 11 ファイル 123/123 green**:
  close-authz 3 / reopen 7 / reassign 11 / reschedule 5 / cancel 13 / main 26 / spot / confirm /
  completed-transition / auto-confirm / cross-vendor-auth。
- **新規テストファイル**: transport-rejected-reopen-transition (C.4.0) / transport-orders-reassign (C.4.1) /
  transport-orders-reschedule (C.4.2) / transport-close-authz (seal)。

## 既知 pre-existing flaky (C.4 無関係, 別 phase)
フル integration suite (64 ファイル) を並列実行すると work_categories / lane_types / vendors / rate-limiter の
うち毎回異なる 2 件前後が散発失敗する。検証: ①該当 4 ファイル単独実行は 62/62 green ②transport は一度も
失敗集合に入らない ③victim が実行ごとに回転。原因 = 並列実行時の pooled connection RLS GUC 汚染
(runWithCompanyContext + commit 型 fixture)。C.4 のコードパス (transport / 0033) と無関係。test-isolation
改善は別 phase。CI も main で同 flaky を持つ pre-existing health 課題で C.4 seal の blocker でない。

## process 反省 (次セッション申し送り)
- C.4.0/C.4.1/C.4.2 で計 3 回、test 実行と commit を同一並列バッチに入れたため赤テストのまま commit し、
  直後の fix commit で green 化する事故を起こした。**commit は test green を目視確認後に単独実行する**こと。
- raw-migration の takeover 関数 (close_transport_order, seed_transport_statuses_for_company) は再適用時に
  `_raw_migrations` から該当行 DELETE → re-apply が必要。docs/operations/seed-new-company.md に invariant 記載済。

## spec/docs 反映済
- spec/data-model.md §15.5/§17.1: rejected stall 化 / 遷移 7 / idempotency_key attempt_seq 付与。
- docs/operations/seed-new-company.md: takeover invariant + post-check SQL (5 status/7 transition)。

## 次フェーズ候補
- pre-existing flaky の test-isolation 改善 (withRollback への統一 or per-test connection)。
- 手動切替の「自社対応」を独立エンティティとして実装する場合は別 phase (現状は cancel で代替)。
- triggers_notification flag 駆動 dispatch の本配線 (現状 inert、explicit enqueue と二重送信監査)。
