# Phase 50 入力契約: Phase 49 §1.1 業務優先一覧テーブル sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 49 (前: 48 sealed) |
| 状態 | **sealed** (typecheck clean / 17 test files / 152 tests PASS) |
| 完了日時 | 2026-05-27 |
| 担当 | Claude (scope 確定 + plan + 統合検証 + commit + seal) / Codex (1 委任: T1 service+UI+test 一括) |
| 前 handoff | `phase-48-store-name-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 48 `8976870` から +1, HEAD `2ea28ec`) |

## 達成したこと (Phase 49)

- **§1.1 業務優先一覧テーブル** (副作用 0 / migration 0 / breaking 0)
  - dashboard に 3 sub-section テーブル追加: 未確認業者依頼 / 対応不可 / 遅延案件 (各上位 5 件)
  - 各 row: 案件番号 (Link で `/admin/transport-orders/[id]`) / 業者名 / 通知送信日時 / 業者対応日時
- **service options 拡張**: `listTransportOrdersWithLatestInvitation` に 3 filter 追加 (additive)
  - `vendorResponse?: 'pending' | 'rejected'`
  - `delayedOnly?: boolean` (Phase 44 metric SQL と完全一致: `vendor_response='pending' AND notification_sent_at IS NOT NULL AND notification_sent_at < now() - interval '24 hours'`)
  - `limit?: number`
- **WHERE 句拡張**: 既存 `statusKey` filter pattern (line 831) と同一構造、AND 結合
- **dashboard 既存 3 カード破壊なし**: 下方に section 追加 only
- **`PriorityTable` 内部 component + `formatDateTime` helper**: dashboard page 内で定義 (helper 共通化は別 Phase)
- **integration test 4 件追加**: vendorResponse=pending / vendorResponse=rejected / delayedOnly / limit (既存 list test describe 内、新規 file なし)
- **Codex 委任 T1 (1 件)**: service+UI+test 一括、apply 一発成功、引き取り 0 件 (Phase 48 同パターン継続)

## Claude 側の主要設計判断

1. **adversarial review skip**: Phase 48 同基準 (副作用 0 / migration 0 / breaking 0 / DB CHECK 0)
2. **`delayedOnly` SQL semantic 完全踏襲**: Phase 44 metric SQL (line 876-880) と一字一句一致 → metric カード値と一覧件数が常に整合
3. **3 filter 独立**: `vendorResponse` と `delayedOnly` は AND 結合可、`delayedOnly: true` は内部で `vendor_response='pending'` も付ける (使い手が pending 指定を忘れても安全)
4. **既存 caller 影響なし**: Phase 43 一覧 page は `statusKey` のみ渡し、options 型は optional、既存 invariant 維持
5. **cancelled 除外なし**: Phase 44 metric SQL と整合性維持 (metric カードと一覧の不一致を防ぐ)、cancel 反映は Phase 50+ で metric + list 同時更新
6. **limit 5 件 hard-code**: 「上位表示」要件 (§26.2)、追加 filter / pagination は別 Phase
7. **`PriorityTable` 内部化**: 共通 component 化は別 Phase、現状 1 ファイル内で完結
8. **`formatDateTime` 重複容認**: 一覧 page と dashboard で同実装、helper 共通化は別 Phase (現状 2 箇所、3+ になった時点で共通化検討)

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260526-151756-6f50 | T1 service options 拡張 + dashboard 業務優先 section + integration test 4 件 | applied (修正不要、引き取り 0 件) |

**Codex 出力品質**: Phase 43→44→45→46→47→48→49 で 0→0→0→0→1→2→0→**0** 引き取り。Phase 47 反省ルール (既存 helper 優先 / Number.isNaN / additive only) を **2 連続 0 件達成**、定着確認。

**Codex sandbox 状況**: Phase 41 既知 Windows 制約継続 (`spawn setup refresh` で Node spawn 不可)、apply_patch 経路は 5 file まで安定。検証は Claude 側に集約。

## Phase 41-49 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-15 | Phase 31-A〜46 | 39-46 | (前 sealed.md 参照) |
| 16 | Phase 16-B 以降 cancel action 不在 | 47 | §1.5 cancel action (副作用 5 系統) |
| 17 | Phase 47 持ち越し regression 防止 | 47 | `expectMetricNumber` 内 `Number.isNaN` 利用 |
| 18 | Phase 46 持ち越し store ID 直表示 | 48 | §1.5 store name 表示 (JOIN x3) |
| **19** | Phase 44 持ち越し 業務優先一覧 | **49** | §1.1 業務優先一覧テーブル (3 カテゴリ x 5 件) |

## 残課題 / Phase 50 todo

### MVP blocker (本番動作前に必須整備、Phase 47 から継続)

- **MVP blocker 1**: production status seed 経路 (`createCompanyWithDefaults` 未実装) — **Phase 50 候補 (要 advisor 再判断)**
- **MVP blocker 2**: 関連 reservation cancel 遷移 — reservation service 自体未実装
- **MVP blocker 3**: Worker 側 `transport_order.cancelled` event handler — outbox row 1 件作成までで停止 (本番依存で wake-up 待機)
- **MVP blocker 4**: `status_history.change_type` column 追加 migration

### 一般 todo (Phase 47-48 から継続)

- §1.5 残 action: 業者変更 / 希望日時変更 / 次候補打診 / 手動切替 / 招待 revoke / token URL 再発行 (vendor_change は副作用ありで wake-up 待機)
- §1.5 招待管理ビュー単独 page
- §1.8 last_error PII redaction (cancel.reason も対象)
- §1.8 拡張: notification_deliveries / requeue_count / 担当者割当 / エスカレーション / Slack
- §1.8 表示文言整備
- §1.1 拡張: requested_pickup_at 系の遅延 / 期間フィルタ / グラフ表示 / cancelled status 除外判定
- §1.4 店間整備依頼 admin UI (大規模、service 先行)
- §1.2 ピット予約カレンダー (FullCalendar)
- 本番デプロイ前の Supabase URL Configuration 更新
- `probe-invite-link.ts` CI 組み込み
- vendor 側 E2E 拡張 (callback 込み)
- spec/data-model.md に admin_vendor_invitations 定義追加
- branch merge `phase-42-t4-test-coverage` → `phase-26-ci-verify`
- headquarters_admin role 分離検討
- `expectMetricNumber` 重複疑い (既存 `expectNumber` と機能重複、後続精査)
- `formatDateTime` 共通化 (一覧 page + dashboard、3 箇所目登場時)
- `PriorityTable` 共通 component 化 (再利用が出た時点で検討)

## Phase 50 入力契約

### 推奨される次 Phase スコープ (advisor 再判断対象)

**handoff 順 #5**: production status seed 経路 `createCompanyWithDefaults` (MVP blocker 1 解消)

**要 advisor 再判断 (Phase 49 sealed 直後、疲労蓄積を判定)**:
- GO: 実装着手 (service 新規 1 関数、migration なし、ただし production code path で慎重に)
- NO-GO: plan-only で seal、起床まで待機

**判定基準**:
- typecheck/test 失敗継続 → NO-GO
- コンテキスト累積で誤判定リスク高 → NO-GO
- scope crisp かつ副作用 0 確信 → GO

### 参照すべきファイル

- 本 handoff (`phase-49-priority-list-sealed.md`)
- `phase-48-store-name-sealed.md` (前 Phase)
- `phase-49-priority-list-plan.md` (Phase 49 plan)
- `src/lib/services/transport-orders.ts`
  - `listTransportOrdersWithLatestInvitation` (Phase 48-49 拡張済)
  - `getAdminDashboardMetrics` (Phase 44)
  - `cancelTransportOrder` (Phase 47、CancelStatusSeedMissingError throw する production path)
- `src/lib/services/companies.ts` (もし存在すれば、Phase 50 で `createCompanyWithDefaults` 追加先候補)
- `src/app/admin/dashboard/page.tsx` (Phase 49 で業務優先 section 追加)
- `tests/_helpers/seed-transport-statuses.ts` (Phase 47 で cancelled status seed 追加、production seed は別 helper)

### 絶対に壊してはいけないもの (invariants)

- 既修正 19 bug/機能すべてに retrogression なし
- typecheck clean / 17 test files / 152 tests PASS
- CI E2E 7/7 PASS (Phase 50 で CI 確認時に維持)
- 既存 invariants: `AdminDashboardMetrics` (P44) / `TransportOrderListItem` (P43/P48) / `FailedNotificationListItem` + `requeueFailedNotification` (P45) / `TransportOrderDetail` + `getTransportOrderDetail` (P46/P48)
- server action 内 `getAdminUser()` 再認証必須 (P45 W5)
- companyId はサーバー側 admin user から取得 (URL/searchParams 不可)
- **`listTransportOrdersWithLatestInvitation` options 3 filter** (Phase 49 確定): `vendorResponse` / `delayedOnly` / `limit` の semantic は metric SQL と一致、削除/変更禁止
- **`delayedOnly` semantic = Phase 44 metric SQL 完全一致** (P49 確定): `vendor_response='pending' AND notification_sent_at IS NOT NULL AND notification_sent_at < now() - interval '24 hours'`
- **dashboard 既存 3 metric カード** (P44 確定) + **業務優先 section** (P49 追加): 削除禁止、追加 only
- **`cancelTransportOrder` semantic / outbox payload schema** (Phase 47 確定)
- **`respondToTransportOrder` + `respondToSpotInvitation` terminal guard** (Phase 47 確定)
- **`TransportOrderDetail.version: number`** (Phase 47 確定)
- **`TransportOrderListItem` / `TransportOrderDetail` の pickupStoreName / deliveryStoreName / returnStoreName** (Phase 48 確定)
- **stores LEFT JOIN alias `ps` / `ds` / `rs`** (Phase 48 確定)
- **`stores.deleted_at` 条件付けない pattern** (Phase 48 確定)

### 注意点・コンテキスト

- branch: `phase-42-t4-test-coverage` (Phase 49 commit `2ea28ec`、Phase 48 `8976870` から +1)
- Phase 49 変更ファイル: 3 modify + 1 new = 4 files
  - `src/lib/services/transport-orders.ts` (+12 -2)
  - `src/app/admin/dashboard/page.tsx` (+126 -1)
  - `tests/integration/services/transport-orders.integration.test.ts` (+78)
  - `phase-handoff/phase-49-priority-list-plan.md` (new)
- Codex 委任 1 件 (T1 一括)、apply 一発成功、引き取り 0 件 (2 連続 0 件)
- adversarial review skip (副作用 0 / migration 0 / breaking 0 / DB CHECK 0)
- Phase 50 advisor 再判断要 (production code path、疲労判定)

## Codex ledger refs

- del-20260526-151756-6f50 (T1 service+dashboard+test 一括)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 49 commit 数 | 1 (`2ea28ec`) |
| 変更ファイル | 3 M + 1 A = 4 files |
| 修正済 latent bug / 機能追加 | 1 (#19 業務優先一覧 — 累積 19) |
| advisor 呼び出し | 0 (Phase 48 advisor 助言で Phase 49 scope は事前確定済) |
| Codex 委任 task 数 | 1 (T1 一括) |
| Codex sandbox-blocked | 0/1 (apply_patch 経路安定) |
| Codex exec stdin hang | 0 件 |
| Claude 側修正 (Codex 出力) | **0** (Phase 47 反省ルール 100% 遵守、2 連続 0 件達成) |
| test files | 17 (変化なし、新規 file 不要、既存 file への assertion 追加) |
| integration + unit test 件数 | 148 → **152** (+4) |
| 新規 service 関数 | 0 (既存 1 関数の options + WHERE 拡張) |
| 既存 service 関数修正 | 1 (`listTransportOrdersWithLatestInvitation` options 拡張) |
| 新規 error class | 0 |
| 新規 server action | 0 |
| MVP blocker 解消 | 0 (Phase 49 は UX 改善、MVP blocker 直接解消なし) |

## 振り返りメモ

- **Phase 47 反省ルールが完全定着**: 2 連続 Codex 引き取り 0 件、委任プロンプトに **具体列挙** する pattern が効果的。Phase 50+ も継続
- **`delayedOnly` SQL は metric SQL のコピペ**: 「semantic 固定」を委任プロンプトで明示することで Codex が SQL を一字一句コピーした。metric と list の不整合リスクを 0 にした
- **dashboard UI の漸進拡張**: 既存 3 カード破壊禁止 → 下に追加 only → Phase 50+ でも同 pattern 継続。dashboard は機能追加のたびに section 増える前提で設計
- **`PriorityTable` / `formatDateTime` の内部化判断**: 1 ファイル内で完結 (再利用が出るまで共通化しない) は YAGNI 原則。3 箇所目登場で共通化検討
- **scope 軽微 Phase の連続実装が安定**: Phase 48 (副作用 0) + Phase 49 (副作用 0) で疲労蓄積少ない、Phase 50 advisor 再判断で production code path に着手可否を判定

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-27 (Phase 49 完了、累積 19 機能追加 + §1.1 業務優先一覧テーブル、副作用 0、Codex 引き取り 0 件 2 連続)*
