# Phase 63 Step 4 Plan: Phase 64+ 実装優先順位 + Phase 分割

## メタ

| 項目 | 値 |
|---|---|
| Phase 番号 | 63 (step 4 plan) |
| 状態 | plan (step 2 残作業 16 件 + step 3 staging 構築 を Phase 64+ に分割) |
| 作成日時 | 2026-05-27 |
| 前 step | `phase-63-step2-implementation-state.md` + `phase-63-step3-staging-setup-plan.md` |
| Branch | `phase-42-t4-test-coverage` 継続 (Phase 64 以降は別ブランチ推奨) |

## §1 設計原則

1. **依存上流から着手**: 整備伝票 / 車両 → 店間整備予約 → 業者通知ループ → 業者対応 → 完了報告 → fallback
2. **業者ループ縦切り MVP 維持**: alpha-core スコープ (transport_orders 中核) を逸脱しない
3. **マスター seed は trigger > UI**: 5/31 第一次納品では会社 1 社のみ運用、CRUD UI なしで seed + SQL 直接投入で代替可能
4. **Codex 委任率最大化**: CRUD ボイラープレートは Codex 委任、TX 設計 / 業務ロジック / RPC は Claude 中心
5. **E2E vs integration の使い分け**: 業者ループは E2E (vendor-portal-loop.spec.ts 拡張)、管理 CRUD は integration (action level)

## §2 Phase 64-A: 整備伝票・車両ベース層 (上流, alpha α 必須)

**スコープ**: service_tickets + vehicles + vehicle_ownerships の admin UI + service action

| 項目 | 実装内容 | Codex 委任? |
|---|---|---|
| L2-1 整備伝票作成 (手動 + 既存検索) | `src/app/admin/service-tickets/{page,new,[id]}/` + `src/lib/services/service-tickets.ts` | YES (CRUD ボイラープレート) |
| L2-2 車両情報作成 + 所有履歴 | `src/app/admin/vehicles/{page,new,[id]}/` + `src/lib/services/vehicles.ts` + `vehicle_ownerships` INSERT | YES (同上) |

**想定規模**: 8-12 files / 400-600 行 / commit 数 3-5
**依存**: なし (schema は既存)
**ブロッカー**: なし

## §3 Phase 64-B: 店間整備予約 + 業者通知ループ縦切り (中核, alpha α 必須)

**スコープ**: reservation INSERT + TX atomic + 移動 4 パターン分岐 + tow_required 自動

| 項目 | 実装内容 | Codex 委任? |
|---|---|---|
| L2-3 店間整備予約 (inter_store) | `transport-orders.ts:createTransportOrderWithNotification` に reservation + service_ticket 連動 | NO (TX 設計、Claude 中心) |
| L2-5 (残) TX 内 reservation + service_ticket atomic | 同上 | NO |
| L2-6 移動 4 パターン分岐 (one_way/round_trip/pickup_only/three_point) | `transport-orders.ts` の入力 schema 強化 + パターン別検証 | 部分 YES (schema 部分は Codex) |
| L2-7 can_drive=false → tow_required 自動 | service 入口で自動セット | YES (10 行未満、Codex でも Claude でも可) |

**想定規模**: 5 files / 300-500 行 / commit 数 3-4
**依存**: Phase 64-A (service_tickets が前提)
**ブロッカー**: TX 内で reservation + service_ticket + transport_order + outbox の 4 テーブル atomic INSERT は spec §17 順序確認要

## §4 Phase 64-C: 業者ループ閉鎖 (下流, alpha α 必須)

**スコープ**: 業者対応の残ロジック (予定入力 / 完了報告 / 確定モード manual / fallback 4 種)

| 項目 | 実装内容 | Codex 委任? |
|---|---|---|
| L2-11 (残) 引取/搬入/返却予定入力 (scheduled 列更新) | `vendor/requests/[id]/actions.ts` に scheduleAction 追加 + `vendor_rpcs.sql` 拡張 | 部分 YES |
| L2-12 業者完了報告 | 同 actions.ts に completeAction 追加 + status 遷移 + outbox 通知 | NO (状態遷移 + 通知連動、Claude 中心) |
| L3-7 確定モード auto/manual 分岐 | `24_vendor_rpcs.sql:accept_invitation_*` に分岐ロジック + manual 時の status 'pending_store_confirmation' 投入 | NO (RPC 設計、Claude) |
| L3-8 manual 時 店舗確定ボタン | `admin/transport-orders/[id]/actions.ts:confirmAction` + service `confirmTransportOrder` | NO (IF MATCH + 通知連動、Claude) |
| L3-3 fallback 次候補打診 | service `nextVendorAttempt` (attempt_seq++ + 新 outbox) | NO |
| L3-4 fallback 希望日時変更 → 同業者再依頼 | service `rescheduleAndRenotify` (change_logs INSERT + outbox) | NO |
| L3-5 fallback 手動切替 | service `switchVendorManual` (vendor_selection_logs + transport_order status='cancelled') | NO |
| L3-6 fallback 依頼キャンセル → reservation 連動 | 既存 cancelTransportOrder に reservation status 連動追加 | 部分 YES |

**想定規模**: 6-8 files / 400-600 行 / commit 数 4-6
**依存**: Phase 64-B (transport_order TX 完成が前提)
**ブロッカー**: vendor_rpcs.sql は post-migration、production 適用順序確認要

## §5 Phase 64-D: マスター運用最小 (alpha α 必須、ただし UI 省略可)

**スコープ**: 会社作成自動シード + 5/31 運用必須マスター 4 件

| 項目 | 実装内容 | Codex 委任? | 代替案 (UI 省略) |
|---|---|---|---|
| L1-1 会社作成 → 初期マスター自動シード | `trg_company_seed_masters` trigger + raw migration 投入 | NO (trigger 設計、Claude) | なし、必須 |
| L1-3 店舗 / 営業時間 / 休日 CRUD | admin UI + service | YES | 5/31 段階は seed SQL 直接 + Claude 手動投入で代替可 |
| L1-4 レーン / 稼働時間 / 対応メニュー M2M | admin UI + service | YES | 同上 |
| L1-10 通知ルール編集 | admin UI + service | YES | 同上 (default seed のみで動作) |

**想定規模 (フル実装)**: 8-12 files / 400-600 行 / commit 数 4-6
**想定規模 (UI 省略案)**: 1 file (seed migration) / 100 行 / commit 1
**依存**: なし
**判断ポイント**: 5/31 までの実装余地により Phase 64-D は **trigger seed のみ実装し UI は β-1** が現実的

## §6 Phase 64-E: 業務効率最小 (alpha α 望ましい)

| 項目 | 実装内容 | Codex 委任? |
|---|---|---|
| L1-11 ピット予約カレンダー DB 接続 (DUMMY_EVENTS 撤去) | `admin/calendar/page.tsx` の events を `reservations` クエリに置換 | YES |
| L2-8 業者選択 UI フィルタ (エリア/店舗/曜日) | `admin/transport-orders/new/` の vendor select コンポーネント追加 | YES |
| L3-10 vendor_portal_inbox UI (既読/アーカイブ + 競合モーダル) | `vendor/requests/page.tsx` に inbox section + actions | 部分 YES |

**想定規模**: 3-5 files / 200-300 行 / commit 数 2-3
**依存**: Phase 64-A-D 完了が望ましい (実装パターン継承)

## §7 Phase 65: staging 環境構築 + production 接続

step 3 §3 分業表の S1-S12 を実行。外部設定 (Vercel/Supabase/Inngest/Resend) のユーザー回答が揃ってから着手。

**想定規模**: 4-6 files (vercel.json / deploy.yml / config.toml prod / seed scripts) / 200-300 行 / commit 数 3-5
**依存**: step 3 §1 前提 6 項目 ユーザー回答 + Phase 64-A-D 完了 (deploy 前に MVP 機能完成)

## §8 Phase 66: 5/29 Sprint レビュー対応 + 5/31 判断

- Phase 64 までの実装進捗をユーザーに報告
- 5/29 Sprint レビュー材料 (Phase 62 sealed + 本 Phase 63 + Phase 64 進捗) 整形
- 5/31 第一次納品 GO/SLIP 判断材料提供 (Claude は予測しない、事実列挙のみ)

## §9 全体規模感 (事実列挙、予測なし)

| Phase | files | 想定行数 | commit 数 | Codex 委任率推定 |
|---|---|---|---|---|
| 64-A 整備伝票・車両 | 8-12 | 400-600 | 3-5 | 70% |
| 64-B 店間整備予約 TX | 5 | 300-500 | 3-4 | 30% |
| 64-C 業者ループ閉鎖 | 6-8 | 400-600 | 4-6 | 20% |
| 64-D マスター seed (UI 省略案) | 1 | 100 | 1 | 0% |
| 64-D マスター UI フル実装 | 8-12 | 400-600 | 4-6 | 70% |
| 64-E 業務効率 | 3-5 | 200-300 | 2-3 | 60% |
| 65 staging | 4-6 | 200-300 | 3-5 | 30% |
| **小計 (D UI 省略案)** | **27-37** | **1600-2400** | **16-24** | - |
| **小計 (D フル)** | **34-48** | **1900-2900** | **19-29** | - |

## §10 想定リスク

1. **Phase 64-B TX 設計の複雑度**: reservation + service_ticket + transport_order + outbox の 4 テーブル atomic は spec §17 order に依存。raw migration 順序が崩れると INSERT order error
2. **Phase 64-C fallback 4 種の E2E coverage**: 現状 E2E 7/7 のうち fallback 試験は 0 件。新規 E2E 追加が必要 (E2E 数が 10+ になる可能性)
3. **vendor_portal_inbox UI 競合モーダル**: 楽観排他 OptimisticLockError ハンドリングを vendor 側 + admin 側両方で実装する必要、UI 多層化
4. **時間制約**: 5/31 第一次納品まで本 Phase 63 確定後 残 4 日 (5/27-5/31)。日数 vs 実装規模はユーザー判断 (Claude は予測しない)

## §11 Phase 63 全体 sealed への引継ぎ

Phase 63 step 1-4 完了後、`phase-63-overall-sealed.md` を作成し以下を統合:

- step 1: scope 仕分け (verification-checklist → 業務必須 35 / β 18 / quality gate 41+)
- step 2: 実装率 32% 判明 + 4 区分マッピング 35 件
- step 3: staging 構築 12 ステップ + 分業 (ユーザー回答待ち)
- step 4: Phase 64-66 分割 + 規模感
- Codex 委任 ID 3 件 (L1/L2/L3)
- ユーザー判断記録 (β 移行 18 / α 必須 13 / 推奨判断採用)

## §12 ユーザー判断ポイント (4 件)

1. **Phase 64-D マスター UI 省略案** を採用するか? (5/31 段階は seed + 手動投入のみ、UI 実装は β-1)
2. **Phase 64 全体の着手順序**: A → B → C → D → E の上流から逐次か、A/D 並列、B/C/E 直列か?
3. **Phase 64 ブランチ戦略**: 現在 `phase-42-t4-test-coverage` 継続中、新 feature branch `phase-64-mvp-implementation` 切り出すか?
4. **Phase 64-B TX 設計の advisor 事前レビュー**: 4 テーブル atomic は失敗時の rollback が複雑、着手前に advisor / codex:adversarial-review を挟むか?

## §13 Invariants 維持

- typecheck clean / 23 test files / 188 tests PASS
- CI E2E 7/7 PASS
- Phase 1-31 累積機能・bug fix retrogression なし
- Phase 63 step 4 は plan のみ、実装変更 0

---

*Phase 63 step 4 plan / Generated by Claude 2026-05-27 / Awaiting user judgment on §12 (4 件)*
