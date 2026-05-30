# Phase 64-C.4.1 再割当コア — 実装設計メモ (advisor 諮問用)

## 状態 (2026-05-30)
- C.4.0 完了・seal (commit 808b072)。post/0033 = rejected stall + rejected→requested + close 是正。
- 次 = C.4.1 reassignTransportOrderVendor (fallback/manual 統合) + reopenOrderForResolicit helper。

## 確定済みパターン (canonical 参照)
- **cancelTransportOrder** (transport-orders.ts:415) = パターンB の canonical。
  `database.transaction` + `tx.execute(sql\`\`)` 生SQL。IF MATCH version (`WHERE version=expectedVersion`)、
  0 行時 pre-UPDATE snapshot で原因区別 (Concurrent/Terminal/NotFound)、status_history、
  change_logs (requires_notification=false)、invitation revoke、outbox INSERT、idempotency_key。
- **createTransportOrderWithNotification** (:65) = membership 検証 (vendor_company_memberships
  isEnabled+deletedAt) + status_history + invitation + outbox。
- change_logs composite FK = (changed_by_user_id, company_id) → users(id, company_id)。admin user は同 company。
- admin action = `db` (service_role client.ts) + getAdminUser() (companyId/userId)。

## C.4.1 設計 (reassignTransportOrderVendor)

### Input (Zod strict)
```
{ transportOrderId: uuid, expectedVersion: int>=0, newVendorId: uuid,
  mode: 'fallback'|'manual', selectionReasonNote?: string<=1000,
  consideredVendorIds?: uuid[], reason?: string<=1000 }
```

### mode 別タグ (vendor_selection_logs + change_logs)
- fallback (L3-3 次候補打診): change_type=`rejected_reassigned`, selection_method=`fallback`,
  selection_reason=`vendor_unavailable`
- manual (L3-5 手動切替): change_type=`vendor_changed`, selection_method=`manual`,
  selection_reason=`manual_preference`

### tx 手順 (パターンB)
1. requested status id 取得 (再オープン先)。なければ StatusSeedMissingError。
2. order load (version, vendor_id, status_id, status_key, deleted_at, confirmation_mode) + company scope。
   deleted_at で NotFound。
3. **真 terminal ガード**: status_key IN ('completed','cancelled') → TerminalStatusError (再割当不可)。
   rejected は stall ゆえ許可。accepted/requested も許可 (手動切替は応答前でも可)。
4. newVendorId の active membership 検証 (createTransportOrder と同) → VendorMembershipError。
5. **reopenOrderForResolicit helper** 呼出 (下記)。
6. vendor_selection_logs INSERT。
7. change_logs INSERT (change_type per mode, before/after snapshot {vendor_id, status_key, version},
   requires_notification=false, changed_by_user_id=userId)。
8. outbox INSERT: event_type=`transport_order.invitation.sent`, target_type='vendor',
   target_id=newVendorId, idempotency_key=`to:{orderId}:invite:{newInvitationId}`。
9. Returns { transportOrderId, newVersion, newVendorId, newInvitationId, attemptSeq,
   notificationOutboxId, idempotencyKey }。

### reopenOrderForResolicit helper (tx 内)
1. 旧 pending/accepted invitation を revoked に (cancel と同)。
2. attempt_seq = COALESCE(MAX(attempt_seq for order), 0) + 1。
   transport_order_vendor_attempts INSERT (vendor_id=newVendorId, attempt_seq, requested_at=now(),
   response='pending')。**注**: requested_at NOT NULL。
3. 新 transport_order_invitations INSERT (vendor_id=newVendorId, invited_by_user_id=userId,
   response='pending')。**UNIQUE(transport_order_id, vendor_id) WHERE vendor_id IS NOT NULL** に注意:
   同 order に同 vendor の既存 invitation (revoked 含む) があると衝突する。
   → **要検討 (下記 OPEN-1)**。
4. transport_orders UPDATE (IF MATCH version):
   - vendor_id=newVendorId
   - status: status_key='rejected' のとき status_id=requested (rejected→requested 遷移)。
     既に 'requested' なら status_id 据置 (自己遷移 trigger 回避)。
   - scalar リセット: vendor_response='pending' (NOT NULL DEFAULT 'pending' ゆえ NULL 不可 = plan 修正),
     vendor_response_at=NULL, scheduled_pickup_at/delivery_at/return_at=NULL,
     store_confirmed_at=NULL, store_confirmed_by_user_id=NULL, version=version+1, updated_at=now()
   - **vendor_rejection_reason=NULL** もリセット (前 attempt の理由が残らないよう)。
5. status 変更時のみ transport_order_status_history INSERT (from=old, to=requested,
   changed_by_user_id=userId, reason)。
6. close_transport_order の再発火: scalar リセット (vendor_response='pending') + 旧 invitation revoke +
   新 pending invitation により、再オープン後 close は v_pending>0 で発火しない (C.4.0 で検証済)。

## OPEN 論点 (advisor に諮りたい)

### OPEN-1: invitation UNIQUE 衝突 (最重要)
`transport_order_invitations_transport_order_vendor_unique` = UNIQUE(transport_order_id, vendor_id)
WHERE vendor_id IS NOT NULL。同一 order に同 vendor の invitation は 1 行のみ。

- **manual 切替で「元 vendor に戻す」「同 vendor を再選択」は UNIQUE 違反になる**。
- fallback も「以前打診した vendor を再度」だと衝突。
- 案A: helper で「新 invitation INSERT」でなく「同 vendor の既存 invitation があれば response='pending'
  に戻す UPDATE、なければ INSERT」(upsert 的)。ただし attempt_seq との対応が崩れる。
- 案B: newVendorId が現 order.vendor_id と同じ場合を Zod/service で弾く (SameVendorError)。
  「別 vendor への切替」に限定。元 vendor への出戻りは reschedule (C.4.2, 同 vendor 再依頼) で扱う。
- 案C: UNIQUE 制約を考慮し、新 invitation INSERT 前に同 vendor の旧 invitation を物理削除 or
  vendor_id=NULL 化。履歴喪失。
- **Claude 推奨 = 案B**: MVP は「対応不可 → 別 vendor へ」が主用途。同 vendor 再依頼は C.4.2 reschedule
  (希望日時変更 → 同 vendor) が担当。reassign は newVendorId != 現 vendor_id を必須にする。
  これで UNIQUE 衝突は「過去に打診した第三 vendor を再選択」のケースのみ残る → これは稀だが
  起きうる (vendor A→B 打診後 B 不可で A に戻す)。案B でも完全には防げない。
  → 案B + 「同 vendor の既存 invitation を revoke した上で新規 INSERT は UNIQUE で不可」なので、
    **案B かつ helper で『同 (order, newVendor) の既存 invitation を物理的に再利用 (UPDATE で
    response='pending', is_winning_bid=false, responded_at=NULL, invited_by_user_id=userId,
    invited_at=now() に戻す)』** が最も堅牢。新規 INSERT は「その vendor への invitation が
    過去に一度も無い」ときのみ。これを upsert helper にする。

### OPEN-2: attempt_seq と invitation の対応
attempts は (order, attempt_seq) UNIQUE で純増。invitation を再利用 (UPDATE) する場合でも
attempts は毎回新 attempt_seq で INSERT する (試行回数の真の記録)。invitation 1 行が複数 attempt に
対応しうる。これは spec 上問題ないか? (attempts = 打診試行ログ、invitation = 現在の招待状態)。

### OPEN-3: terminal ガードの範囲
完了/キャンセルは不可で確定。'accepted' の order を manual 切替してよいか?
(業者が一度 accept したが店舗判断で別 vendor へ。応答済 invitation を revoke して別 vendor へ。)
→ MVP は許可する方向 (店舗の手動切替権限)。ただし accepted からの「requested 再オープン」は
accepted→requested 遷移が未 seed。**accepted の場合の status 遷移をどうするか** (OPEN)。
- 案: manual 切替は status_key が 'rejected' なら requested 再オープン、'accepted'/'requested' なら
  status 据置で vendor だけ差し替え + scalar リセット。accepted 据置だと「別 vendor が未応答なのに
  accepted」表示の不整合。→ accepted の場合も requested に戻すべきだが遷移未 seed。
  C.4.0 で accepted→requested を seed すべきだったか? (後出し migration が要るか要検討)。

## test 計画
- fallback 再割当: order rejected→requested, 新 invitation+attempt_seq, vendor_selection_log
  method=fallback, 旧 invitation revoked, outbox invite。
- manual 切替: method=manual, change_type=vendor_changed。
- version mismatch → Concurrent。完了 order → Terminal。非 active vendor → Membership。
- attempt_seq インクリメント (2 回連続)。
- 再発火回帰: 再オープン後 close 即再発火しない。
- UNIQUE 再利用: 過去に打診した vendor を再選択しても衝突しない (案B-upsert)。
