# Phase 64-C.3 vendor portal 完了系 — 実装設計 (design, 未実装)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-C.3 (vendor portal 完了系 / L2-11 予定入力 + L2-12 完了報告, α 必須) |
| 種別 | **design** (次セッションで実装)。本書は調査結果 + 確定設計を保持する唯一文脈源 |
| Branch | `phase-64-mvp-implementation` 継続 |
| 前提 | C.0/C.1/C.2 sealed + CI green (d2bc17f / 632e0b3 / e23d6c4) |
| 想定種別 | **raw-migration** (完了 RPC) → adversarial gate 該当 |
| checkpoint 理由 | C.0-C.2 を thorough に完了後、security 関連 grant 変更を含む大型 raw-migration を fresh context + full rigor で実装するため [2026-05-30 自律判断] |

## 調査で確定した load-bearing な事実

1. **vendor portal は `withAuthenticatedDb(user.id, ...)` = vendor session (service_role でない)** で動く (`src/app/(vendor-portal)/vendor/requests/[id]/actions.ts:46`)。accept/reject は `respond_to_transport_order` RPC (SECURITY DEFINER) 経由。
2. **vendor は notification_outbox を直接 INSERT 不可**。outbox RLS は `WITH CHECK (company_id = current_user_company_id())` (`19_rls_policies.sql:299-302`)。`current_user_company_id()` は `public.users WHERE id=auth.uid()` を引く (`18_helper_functions.sql:9-22`) が、vendor は `users` でなく `vendor_users` ゆえ **NULL を返す** → company_id=NULL は never true。**∴ 完了通知 (店舗向け outbox) を伴う L2-12 は SECURITY DEFINER RPC が必須** (respond_to_transport_order と同型)。
3. **vendor の column GRANT UPDATE** (`19_rls_policies.sql:348-361`) に含まれる列: vendor_response(_at), vendor_rejection_reason, **scheduled_pickup/delivery/return_at**, **picked_up/delivered/returned_at**, **status_id**, version, updated_at。→ L2-11 の scheduled_* は vendor 直接 UPDATE 可能。
4. **transport status `completed` + `accepted→completed` 遷移は C.0 で seed 済** (`triggers_notification=true`)。enforce_status_transition は transport_orders の BEFORE UPDATE OF status_id で検証 (20_triggers.sql:255)。
5. **C.1 auto-confirm trigger** は `status='accepted'` のみ反応 (completed には無反応)。
6. spec requirements.md:179-184 / 488-489: 業者は引取/搬入/返却の**予定日時入力** (L2-11) + **完了報告** (L2-12)。§566: 完了報告後も店舗が「ステータス差戻し」可能 (将来、C.3 core 外)。§553: 進捗未更新アラート cron (C scope 外)。

## 確定設計

### L2-11 予定入力 (scheduleAction) — TS-only, 低リスク

- vendor portal の scheduleAction が `withAuthenticatedDb` 経由で transport_orders の scheduled_pickup_at / scheduled_delivery_at / scheduled_return_at を UPDATE (3 列とも vendor GRANT 内)。
- 楽観排他 (version IF MATCH) + vendor_portal_update RLS (vendor_id=current_vendor_id()) で自社案件のみ。
- 店舗通知は **任意** (plan §15.6 表で「店舗通知, 任意」)。MVP では outbox なしで可 (通知が要るなら L2-12 と同じく RPC 経由が必要 — vendor は outbox 直接書けないため)。→ **MVP は通知なしの直接 UPDATE を推奨**、通知は後日。
- service: `src/lib/services/` に scheduleTransportOrder 的関数 or vendor action 内で完結。idempotency_key (通知する場合) は `to:{id}:scheduled:v{ver}` (§C 計画の修正3、未 seed なので使うなら §15.6 追記)。

### L2-12 完了報告 (completeAction) — SECURITY DEFINER RPC, raw-migration

- **新 RPC `complete_transport_order(p_transport_order_id uuid, p_picked_up_at, p_delivered_at, p_returned_at, ...)`** を post 新規 migration で作成 (respond_to_transport_order を範とする):
  - SECURITY DEFINER + search_path 固定。
  - 呼び出し vendor が当該 order の vendor (current_vendor_id() 突合 + invitation winning) であることを検証。
  - status を accepted→completed に UPDATE (enforce_status_transition が C.0 seed 済遷移を通す) + picked_up/delivered/returned_at セット + transport_order_status_history INSERT (vendor_complete)。
  - **店舗へ outbox INSERT** (definer 権限): event_type='transport_order.completed', target_type='store_user' (CHECK 許可値), target_id=? (店舗ユーザー or 店舗の解決方法を要設計 — 下記 open #2), idempotency_key=`to:{id}:completed:v{newVersion}` (§15.6 に C.0 で追記済)。
  - GRANT EXECUTE TO authenticated + (RPC は内部で vendor 認可検証)。
- vendor action は `withAuthenticatedDb` で RPC を呼ぶ (respondAction と同型)。

### ★ status_id grant checkpoint の解決 (C.1 から持ち越し)

- 現状 vendor は column GRANT(status_id) で RPC を介さず status_id を直接 UPDATE 可能 (C.1 BLOCK の既存バイパス)。
- **完了 RPC を導入すれば、accept (RPC) も completion (RPC) も SECURITY DEFINER 経由になり、vendor の直接 status_id UPDATE を必要とする正規フローは無くなる**。
- → **推奨: 同じ migration で `status_id` を vendor の GRANT UPDATE から外す** (`19_rls_policies.sql:358` 相当を post migration で `REVOKE UPDATE (status_id) ON transport_orders FROM authenticated` 的に是正)。これで accept/complete バイパスを根本封鎖。
- **着手前の必須検証**: status_id を vendor が直接 UPDATE する正規フローが本当に無いか grep で確認 (respondToInvitation は RPC 経由ゆえ不要のはず)。1 つでもあれば grant 除去は別途検討。
- これは security 変更ゆえ adversarial gate で「grant 除去が既存 vendor フローを壊さないか / バイパス封鎖の完全性」を必ず検証。

## open decisions (実装着手時に確定)

1. **D2 (plan 持ち越し)**: §14.10.1 業者承諾証跡 (同意チェックボックス + IP/UA audit) を C.3 完了報告 form に含めるか。**ユーザー確認推奨** (MVP 必須度)。判断量「中」。含めない場合は将来 phase。
2. **完了通知の target 解決**: target_type='store_user' の target_id をどう解決するか (店舗の代表ユーザー? 依頼作成ユーザー? 店舗全体?)。outbox dispatcher の email 解決ロジック (現状 vendor 向けのみ実装?) を確認要。store_user 向け送信が未実装なら、completion 通知は outbox 停留のみ (dispatcher 拡張は別 phase) になる可能性 — 要確認。
3. **RPC vs trigger**: 完了 outbox を (a) RPC 内で enqueue / (b) status→completed の trigger で enqueue。**(a) RPC 推奨** (status_id grant 除去と整合、completion ロジックを 1 箇所に集約)。(b) trigger は status_id grant を残すため checkpoint を解決しない。
4. **完了の粒度**: 引取/搬入/返却を個別報告 (3 アクション) か一括完了か。spec は個別 (引取完了報告/搬入完了報告/返却完了報告) を示唆するが、status は coarse な completed のみ (C.0 案A)。→ **MVP: timestamp 3 列を completeAction で受け取り (任意入力)、全部 or 一部セット + status=completed**。granular な 3 段階 status は案A で不採用。

## UI (Codex 委任候補)

- vendor portal `requests/[id]/page.tsx` に ScheduleForm (scheduled_* 入力) + CompleteForm (picked_up/delivered/returned_at 入力 + 完了ボタン)。accepted かつ未完了の自社案件に表示。
- accepted 案件一覧フィルタ拡張 (`requests/page.tsx`)。
- UI ボイラープレートは Codex 委任可 (plan §C.3「部分」)。

## 実装順の推奨

1. **着手前**: status_id 直接 UPDATE フローの grep 検証 (checkpoint #️⃣) + open #2 (store_user 通知の dispatcher 対応状況) 確認 + D2 をユーザー確認。
2. L2-11 (scheduleAction, TS-only, 低リスク) を先に。
3. L2-12 RPC (`complete_transport_order`) + status_id grant 除去 を raw-migration として実装 → **adversarial gate (advisor + workflow + Codex)** 必須。
4. UI (Codex 委任) + list filter。
5. integration test (RPC accept→complete 経路 + grant 除去後に vendor 直接 status UPDATE が拒否されること) + CI。

## 完了済みの C シリーズ (参照)

- **C.0** (`phase-64-c0-...-sealed.md`): completed status seed + REVOKE。CI green。
- **C.1** (`phase-64-c1-auto-confirm-sealed.md`): auto 確定 trigger。CI green。status_id grant checkpoint を記録 (本書で解決方針確定)。
- **C.2** (`phase-64-c2-manual-confirm-sealed.md`): manual 確定 service (service_role 経路)。CI green。
- **C.4 (未着手)**: fallback 3 種 (L3-3 次候補打診 / L3-4 希望日時変更再依頼 / L3-5 手動切替)。C.0 後着手可、C.3 と独立。

*Phase 64-C.3 design / Generated by Claude 2026-05-30 / checkpoint after C.2 / 完了 RPC + status_id grant 除去 (checkpoint 解決) / 次セッション: 着手前検証 → L2-11 → L2-12 RPC (gate) → UI → CI*
