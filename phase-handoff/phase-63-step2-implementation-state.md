# Phase 63 Step 2: 業務必須 35 件 実装状態マッピング

## メタ

| 項目 | 値 |
|---|---|
| Phase 番号 | 63 (step 2 中間結果) |
| 状態 | 中間 (step 2 完了、step 3 staging 構築ステップ列挙待ち) |
| 作成日時 | 2026-05-27 |
| 担当 | Claude (統合 + sanity check) + Codex L1 (del-20260527-124548-c42f) + L2 (del-20260527-124613-5fea) + L3 (del-20260527-1248xx) |
| 出力詳細 | `.tmp/phase-63-lane1-master-list.md` / `.tmp/phase-63-lane2-phase2-core.md` / `.tmp/phase-63-lane3-vendor-loop.md` |

## ⚠️ 重大訂正 (Phase 62 sealed §release path 健全度)

Phase 62 sealed の「コード品質: release レディ (緑判定 5 項目 ✓)」は **誤認**。実体は:

- 業務必須 35 件中 **実装済 + E2E 緑** は 約 **3 件 (~9%)**
- 業務必須 35 件中 **実装済 + E2E なし / integration のみ** は 約 **8 件 (~23%)**
- 業務必須 35 件中 **未実装 / schema のみ / UI stub のみ** は 約 **24 件 (~68%)**

5/31 第一次納品 = (a) URL を顧客に渡して業務で使える α 版 の条件に対し、**deployment 環境ゼロだけでなく実装も大きく不足** している。

## 4 区分マッピング

### A) 実装済 + E2E 緑 (3 件)

| # | 項目 | 実装 | E2E |
|---|---|---|---|
| L2-10 | 業者マイページ新規依頼表示 (他社/他業者非表示) | `vendor/requests/page.tsx`, RLS 65 件 | `vendor-portal-loop.spec.ts:L83-140` + `vendor-portal-spot-loop.spec.ts:L90-148` |
| L2-9 | 業者メール送信 (idempotency_key) | `notification_outbox.ts` + dispatcher | `admin-vendor-invite.spec.ts:L112-122` (部分) |
| L1-8 | 業者マスター + vendor_users CRUD | `admin/vendors/` + `admin-vendors.ts` | `admin-vendor-invite.spec.ts:L59-138` |

### B) 実装済 + E2E なし (integration 一部) (8 件)

| # | 項目 | 実装 | テスト |
|---|---|---|---|
| L3-1 | 店舗側: 業者状況確認画面 | `admin/transport-orders/[id]/page.tsx` | integration `transport-orders-detail.integration.test.ts` |
| L3-2 | 状態遷移制約 (DB+app) | DB trigger `20_triggers.sql` + `transport-orders.ts:L266-336` | integration |
| L3-6 | 依頼キャンセル → 通知配信 | `[id]/actions.ts:L9-30` + `transport-orders.ts:L412-670` | integration `transport-orders-cancel` (※ `reservations` 連動更新は未確認) |
| L3-9 | 通知失敗運用画面 | `admin/notifications/page.tsx` + service | integration |
| L1-13 | ダッシュボード優先タスク | `admin/dashboard/page.tsx` + `transport-orders.ts:L824-953` | (Phase 49 sealed で sealed) |
| L2-5 (部分) | TX atomic 生成 (transport_order + history + invitation + outbox) | `transport-orders.ts:L65-194` | integration (※ reservation / service_ticket は範囲外) |
| L2-11 (部分) | 業者対応可否 accept/decline | `vendor/requests/[id]/actions.ts` + `spot-invitations.ts` + `24_vendor_rpcs.sql` | accept 部分のみ |
| L2-6 (部分) | 移動 4 パターン予約 (列定義) | `transport_orders.ts:L16-35` | パターン別分岐 E2E なし |

### C) 未実装 / schema のみ / UI stub のみ (24 件)

**Phase 1 マスター CRUD (10 件中 9 件 未実装)**:
- L1-1 会社作成 → 初期マスター自動シード (trigger / seed 関数なし)
- L1-2 社内ユーザー Supabase Auth 招待 + ロール割当 (path なし)
- L1-3 店舗 / 営業時間 / 休日 CRUD (schema のみ)
- L1-4 レーン / 稼働時間 / 対応メニュー M2M CRUD (schema のみ)
- L1-5 作業カテゴリ / メニュー CRUD (schema のみ)
- L1-6 予約枠設定編集 (schema のみ)
- L1-7 ステータス + 状態遷移ルール編集 (schema のみ)
- L1-9 業者 対応エリア / 店舗 / 曜日 M2M 設定 (schema のみ)
- L1-10 通知ルール編集 (schema のみ)

**Phase 3 一覧 (3 件中 2 件 未実装)**:
- L1-11 ピット予約カレンダー (日・週) — FullCalendar 組込済だが **DUMMY_EVENTS で DB 未接続**
- L1-12 店舗別 / レーン別 / 作業種別表示切替 (未実装)

**Phase 2 中核 (12 件中 8 件 未実装または schema のみ)**:
- L2-1 整備伝票作成 (UI / service action なし、schema のみ)
- L2-2 車両情報作成 + 所有履歴 (UI / service action なし、schema のみ)
- L2-3 店間整備予約作成 (inter_store 分岐ロジックなし、schema のみ)
- L2-4 作業メニュー → 標準時間 + バッファ自動反映 (自動反映ロジックなし)
- L2-7 走行可否 false → tow_required 自動 (CHECK 制約のみ、service 自動セットなし)
- L2-8 業者選択 UI フィルタ (エリア/店舗/曜日) (フィルタ UI なし、schema のみ)
- L2-11 (残) 引取/搬入/返却予定入力 (scheduled 列更新 action なし)
- L2-12 業者完了報告 (action / service なし、列定義 + UPDATE grant のみ)

**Phase 2 業者ループ (10 件中 5 件 未実装 / 部分)**:
- L3-3 対応不可フォールバック: 次候補打診 (推定不可、service action なし)
- L3-4 対応不可フォールバック: 希望日時変更 → 同業者再依頼 (推定不可)
- L3-5 対応不可フォールバック: 手動切替 (推定不可)
- L3-7 確定モード auto/manual (schema のみ、accept RPC に分岐なし、store_confirmed_at 更新なし)
- L3-8 manual 時 店舗確定ボタン (server action 推定不可、schema/FK のみ)
- L3-10 (部分) vendor_portal_inbox 未読/既読/アーカイブ UI + 楽観排他競合 UI (worker と列はあり、画面 UI なし)

### D) production-only gap (検出 0 件 / step 3 で再評価)

step 2 の段階で「実装はあるが production 環境で初検証」と区分された項目は確認できず。staging 環境構築 (step 3) と D 区分の精度は step 3 で再評価。

## §3 Claude sanity check (Codex 補強)

L1/L2/L3 結果を Claude 自身で再確認:

- ✓ `src/app/admin/` 配下 page.tsx: calendar / customers / settings / vendors / vendors/invite / notifications / transport-orders / dashboard のみ。**service-tickets / vehicles / stores / lanes / work-categories / work-menus / staff-users 配下なし** → L1 結果と整合
- ✓ `src/app/(vendor-portal)/vendor/requests/[id]/actions.ts` = `respondAction` (accept/reject) のみ。**完了報告 / 予定入力 action なし** → L2-11 (残) / L2-12 結果と整合
- ✓ `src/app/admin/settings/` = page.tsx 1 ファイルのみ、各種マスター設定の sub route なし → L1 残 9 件未実装の裏付け
- (未確認) L3 推定不可項目 (対応不可 fallback 3 種 + manual store_confirmed_at action) は Codex grep ベース。実際にどこかにある可能性は残るが、admin/transport-orders/[id]/actions.ts は cancel + respond のみのはずで、確度は高い

## §4 5/31 第一次納品成立可能性 (事実列挙のみ)

「業務で使える α 版」成立に必要な業務必須 35 件のうち:

- 即提供可能: 3 件 (A)
- 動作確認後提供可能 (E2E 整備が β-1 に許される前提): +8 件 = 11 件 (32%)
- **未実装で新規実装が必要: 24 件 (68%)**

24 件のうち優先度別 (alpha-core 業者ループ縦切り視点):
- **業者ループ閉鎖必須 (alpha α 必須)**: 整備伝票作成 / 店間整備予約作成 (inter_store) / 業者完了報告 / 業者予定入力 / 対応不可 fallback 4 種 / 確定モード manual の店舗確定ボタン = **9 件**
- **マスター運用必須 (alpha α 必須)**: 会社作成自動シード / 店舗 CRUD / レーン CRUD / 通知ルール = **4 件**
- **業務効率必須 (alpha α 望ましい)**: カレンダー DB 接続 / 業者選択 UI フィルタ / TX 内 reservation+service_ticket atomic = **3 件**
- **業務任意 (β-1 可)**: 社内ユーザー招待 / 作業カテゴリ・メニュー CRUD / 予約枠設定編集 / ステータス編集 / 業者 M2M 設定 / 表示切替フィルタ / 自動反映 / can_drive → tow_required 自動 = **8 件**

**alpha α 必須 = 13 件 + α 望ましい 3 件 = 16 件** の新規実装が 5/31 までに必要 (deployment 環境構築と並行)。

## §5 Phase 63 残ステップ

- **step 3 (次)**: staging 環境構築のステップ列挙 + ユーザー作業 (Vercel/Supabase project 作成) との分業確定
- **step 4**: 残作業の優先順位確定 → Phase 64 以降の実装着手 plan に分割

## §6 ユーザー判断ポイント (3 件)

1. **5/31 第一次納品の現実性**: alpha α 必須 13 件 + 望ましい 3 件 + deployment 構築 = 大量の新規実装。スケジュール調整を 5/29 Sprint レビューで議題化するか?
2. **β-1 (6/2-) scope への移行候補 8 件**: 上記「業務任意」に分類した項目を β-1 に押すことに同意するか?
3. **§4 「業者ループ閉鎖必須 9 件」の優先度**: 整備伝票作成・店間整備予約作成は最上流で、これがないと業者通知ループ全体が成立しない。Phase 64 から実装着手する場合の最優先候補で良いか?

## §7 Invariants 維持

- typecheck clean / 23 test files / 188 tests PASS
- CI E2E 7/7 PASS
- RLS policy 65 件 + helper function 5 件
- outbox dispatcher + inbox worker + invitationExpirer 稼働
- Phase 1-31 累積機能・bug fix retrogression なし
- Phase 63 step 2 は調査のみ、実装変更 0

## §8 Codex 委任結果メトリクス

| Lane | task | 結果 | scope 外変更 |
|---|---|---|---|
| L1 a0ec86d7 | Phase 1 マスター 10 + Phase 3 一覧 3 | 完了 / 13 件全項目記載 / `.tmp/phase-63-lane1-master-list.md` 書込成功 | 0 |
| L2 acb43cb2 | Phase 2 中核 12 | 完了 / 12 件全項目記載 / sandbox 制約で apply_patch 失敗 (Claude 側で `.tmp/phase-63-lane2-phase2-core.md` に保存) | 0 |
| L3 ab98653e | Phase 2 業者ループ + UI 補強 10 | 完了 / 10 件全項目記載 (6 項目「推定不可」) / sandbox 制約で apply_patch 失敗 (Claude 側で `.tmp/phase-63-lane3-vendor-loop.md` に保存) | 0 |

**採用率**: 3/3 (Phase 62 の L3 出力空 issue は再発せず、具体的調査項目明示が有効)
**sandbox-blocked**: 2/3 で apply_patch denied (L2/L3) — 報告内容自体は復元可能、override 不要

---

*Phase 63 step 2 中間 / Generated by Claude 2026-05-27 / Awaiting user review on §6 (3 件), then step 3*
