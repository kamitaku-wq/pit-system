# Phase 64-B 店間整備予約作成 (陸送依頼作成フロー) — SEALED (2026-05-30)

## 完了状況: Phase 64-B 完了

業者ループの**入口**を実装。これまで `createTransportOrderWithNotification` の caller が test のみで
「店舗が陸送依頼を作る」本番導線が欠落し、業者ループ全体が閉じていなかった問題を解消。

| サブ | 内容 | 状態 | commit |
|---|---|---|---|
| B-1 | service に attempts INSERT (attempt_seq=1, spec §14.3) | ✅ green | b1f8e3c |
| B-2/3/4 | 陸送依頼作成 UI (transport-orders/new) + 移動パターン検証 + unit test | ✅ green | ed3f9c1 |
| B-sec | cross-tenant 参照注入封鎖 (A.22 canonical) | ✅ green | 9c8f2a1 |
| seal | handoff + Codex adversarial review | ⏳ Codex 結果反映待ち | — |

branch: `phase-64b-inter-store-reservation` (main = 7a52c35 から分岐)。

## 実装内容

### B-1: attempts INSERT (createTransportOrderWithNotification 拡張)
- TX に `transport_order_vendor_attempts` INSERT (attempt_seq=1, requested_at=now(), response='pending')。
- spec §14.3「予約確定時 1TX で … attempts に試行レコード (attempt_seq=1)」充足。
- C.4 fallback (reopenOrderForResolicit) は MAX+1 連番ゆえ整合 (初回 1 → 再打診 2,3...)。
- result type に attemptId 追加 (additive)。

### B-2: 陸送依頼作成 UI
- `src/app/admin/transport-orders/new/{page.tsx, actions.ts}` 新規。
- 整備伝票 / 車両 / 業者 (active membership) / 店舗 / 移動パターン / 希望日時 / 自走可否 / 備考を選択。
- action: getAdminUser → validateMovementPattern → createTransportOrderWithNotification → 詳細へ redirect。
- orderNumber 自動採番 (TO-{uuid})、can_drive=false → tow_required=true 自動 (spec §14.2)。
- 一覧ページに「新規依頼を作成」ボタン追加。

### B-3: 移動パターン検証 (src/lib/transport/movement-pattern.ts)
- validateMovementPattern 純粋関数 (DB movement_pattern_check と同条件を app 層で先行検証)。
- one_way: pickup+delivery / round_trip,three_point: 3店舗 (three_point は相異) / pickup_only: pickup のみ。
- "use server" ファイルは純粋関数 export 不可ゆえ別モジュール化 → unit test 可能。

### B-sec: cross-tenant 参照注入封鎖 (自己発見 + A.22 canonical)
- createTransportOrderWithNotification が認証済み admin POST から到達可能になり、他社の
  serviceTicketId/vehicleId/storeId 注入が可能な cross-tenant 穴があった (FK は同 company を保証しない)。
- service TX 内で ticket/vehicle/store の company 所有を SELECT 検証 → CrossTenantReferenceError。

## test
- integration (transport-orders.integration.test.ts): attempts attempt_seq=1 検証 + cross-tenant 注入 2 件
  (他社 serviceTicketId/vehicleId → CrossTenantReferenceError)。
- unit (transport-movement-pattern.test.ts): 移動 4 パターン × 必須/禁止/相異 = 20+ ケース。
- 全 transport integration 7 ファイル green + unit green + next build 成功 (/admin/transport-orders/new 生成) + tsc 0。

## スコープ外 (別サブタスク)
- **reservations フル atomic 連動 (spec §14.3 完全形)**: 薄い縦切りでは既存 service_ticket/vehicle を選ぶ
  形にし、reservations + service_tickets を 1TX 新規生成する 7 テーブル atomic は別 phase (64-B-full)。
  → α 版で「店間移動ありの予約を 1 画面で予約+依頼同時作成」が要件なら追加実装が必要。現状は
  整備伝票・車両を先に作り、陸送依頼で参照する 2 段運用。
- 業者選択 UI フィルタ (エリア/店舗/曜日, L2-8) = Phase 64-E。
- 移動パターン別の動的フォーム出し分け (現状は全 store フィールド表示 + 検証)。

## 残課題 / seal 前
1. Codex adversarial review (background) の結果反映。
2. CI green 確認 → PR。

## α 版進捗への影響
業者ループ (入口 B → 通知 → 業者対応 C → 完了/フォールバック C.4) が **end-to-end で閉じた**。
ただし spec §14.3 のフル atomic (予約+依頼同時) は薄い縦切りでは未達 (2 段運用)。
production deploy (Phase 65: migration/seed/App URL) は引き続き未消化。

## process メモ
- 本 phase は commit を tsc+build+test green 目視確認後に単独実行 (前セッションの赤 commit 反省を遵守)。
- cross-tenant 穴は実装中に自己発見 (adversarial gate 発火条件 #5 該当) し A.22 canonical で対応。
