# Phase 46 入力契約: Phase 45 §1.8 通知失敗・運用画面 縦切り sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 45 (前: 44 sealed) |
| 状態 | **sealed** (typecheck clean / unit 35 / integration 96 PASS) |
| 完了日時 | 2026-05-26 |
| 担当 | Claude (scope 確定 + adversarial review 統合 + Codex 出力レビュー) / Codex (3 件委任: service / page+action / integration test、+ adversarial review 1 件) |
| 前 handoff | `phase-44-admin-dashboard-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 44 from `b1b2704`) |

## 達成したこと (Phase 45)

- **§1.8 通知失敗・運用画面** を縦切り最小で実装
  - failed outbox 一覧表示 + 手動再送ボタン 1 action
- **service 層拡張**: `src/lib/services/notifications.ts` 新規 74 行
  - `listFailedNotifications(db, companyId)` / `requeueFailedNotification(db, companyId, outboxId)`
- **admin page + server action**: `/admin/notifications` 新規 (page 99 行 + actions 28 行)
- **integration test 3 件追加**: tenant 隔離 / requeue 動作 / cross-tenant 拒否 (全 pass、+1.27s)
- **Codex adversarial review 実施** (BLOCK 2 / WARN 5 / INFO 3 / ALT 2 件指摘 → 設計判断確定)

## Claude 側の主要設計判断

1. **§1.8 を選択**: Phase 44 handoff 推奨順 #1 (outbox 既存 / 手動再送 1 action のみ / 最小縦切り)。spec §1.8 明示済で advisor skip
2. **Codex adversarial review 実施** (handoff の「spec/handoff に答えあり → advisor skip」ルールの例外): spec §1.8 は再送 semantic 不明示 → 第二意見で 2 BLOCK / 5 WARN 抽出、計画改訂
3. **再送 attempts セマンティクス (B 案棄却 → 確定 A 案改訂)**:
   - `attempts=0` リセット + `idempotency_key='re-' || gen_random_uuid()::text` 新生成 (Resend サイレント重複回避)
   - `last_error` は**クリアせず残す** (audit 用、Phase 45+ で notification_deliveries 移行まで残置)
   - `processing_started_at=NULL` + `next_attempt_at=now()` で即 dispatcher pickup 可能化
4. **権限**: 全 admin で OK (現コードに headquarters_admin role 不在、`roles.code='admin'` のみ。新 role 追加は Phase 45+)
5. **server action で getAdminUser() 再認証必須** (Codex W5: RLS は admin 認可境界として不十分、既存 admin/vendors/actions.ts:85-96 と同 pattern)
6. **target 表示 helper**: `event_type` 単独でなく個別 FK (transportOrderId / reservationId / transportOrderInvitationId) で分岐 (Codex W10)
7. **audit trail (requeue_count) は Phase 45+ 持ち越し** (schema migration = scope 拡大回避)

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260526-120719-3013 | adversarial review (BLOCK 2 / WARN 5 / INFO 3 / ALT 2 抽出) | 採用 (B1+B2 BLOCK / W5+W7+W10 WARN を計画反映) |
| del-20260526-123620-34e2 | service 層 `notifications.ts` 74 行 (T1) | applied (修正不要) |
| (T2 / T3 並列実行 ID は ledger 確認可) | T2 page+action 127 行 + T3 integration test 251 行 | applied (修正不要) |

**Codex 出力品質**: Phase 44 同様 **0 件引き取り**。Phase 43 → 44 → 45 で連続 0 件達成。Phase 44 の確立パターン (line 番号明示 + invariant 列挙 + 推測 NG + 既存 read 強制) を維持

## Phase 41-45 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-10 | Phase 31-A/B/C/D + 40 + 41 | 39-42 | (phase-43-sealed.md 参照) |
| 11 | Phase 16-B 以降 UI 不在 | 43 | §1.5 業者通知・回送管理 一覧 UI |
| 12 | Phase 8 以降 Dashboard モック | 44 | §1.1 Dashboard 実データ化 (運用優先 3 指標) |
| **13** | Phase 0 以降 outbox failed UI 不在 | **45** | §1.8 通知失敗・運用画面 縦切り (failed 一覧 + requeue) |

## 残課題 / Phase 46 todo

- **§1.8 拡張**: notification_deliveries 書込み開始 / requeue_count column 追加 / status='cancelled' 変更 / 担当者割当 / エスカレーション / Slack 連携 / 詳細ページ
- **§1.8 表示文言整備**: page.tsx table heading が英語 raw key (`eventType` `attempts` 等) のまま、日本語化が望ましい (Phase 45 機能優先で先送り)
- **§1.5 残機能**: 業者変更 / 希望日時変更 / 次候補打診 / 手動切替 / キャンセル / CSV / 招待 revoke / 通知履歴 / 詳細ページ `[id]` (Phase 43 から継続)
- **§1.1 業務優先一覧テーブル** (Phase 44 から継続、spec §26 line 841 後段)
- **§1.4 店間整備依頼 admin UI**: service_ticket/vehicle service 先行 (大規模)
- **本番デプロイ前の Supabase URL Configuration 更新** (Phase 41 から継続)
- **`probe-invite-link.ts` を CI に組み込むか?** (Phase 41 から継続)
- **vendor 側 E2E 拡張**: callback も叩く E2E (Phase 41 から継続)
- **spec/data-model.md に admin_vendor_invitations 定義追加** (Phase 42 から継続)
- **branch merge**: `phase-42-t4-test-coverage` → `phase-26-ci-verify` 未実施 (Phase 42 から継続)
- **`isNaN` → `Number.isNaN` 置換** (Phase 44 から継続、`transport-orders.ts:541-555`)
- **headquarters_admin role 分離検討** (Phase 45 確定で先送り、§1.8 / §1.9 で本部のみ操作許可なら新 role 必要)

## Phase 46 入力契約

### 推奨される次 Phase スコープ
1. **§1.5 詳細ページ `[id]`** (一覧から自然な遷移、副作用なし、Phase 43-44-45 で UI 系経験豊富)
2. **§1.8 audit trail 強化** (requeue_count column 追加 + notification_deliveries 書込み、schema migration 1 件)
3. **§1.1 業務優先一覧テーブル** (Phase 44 持ち越し、`listTransportOrdersWithLatestInvitation` 再利用 + filter)
4. **§1.8 詳細ページ / cancel action** (failed → cancelled で運用上「諦める」)
5. **§1.5 招待管理ビュー (revoke/再発行)** (副作用あり、admin-vendor-invitations 統合判断要)
6. **§1.4 店間整備依頼 admin UI** (大規模、service 先行)

### 参照すべきファイル
- 本 handoff (`phase-45-notifications-failed-ui-sealed.md`)
- `phase-44-admin-dashboard-sealed.md` (前 Phase)
- `src/lib/services/notifications.ts` (Phase 45 service 全 74 行、Phase 46+ count 系 service の mirror 元)
- `src/app/admin/notifications/page.tsx` (Phase 45 page 99 行、Phase 46+ UI mirror 元)
- `src/app/admin/notifications/actions.ts` (Phase 45 server action 28 行、`getAdminUser()` 再認証 pattern 確定)
- `src/lib/inngest/functions/outbox-dispatcher.ts` (再送 semantic 元情報、Phase 46+ で `notification_deliveries` 書込み追加時に変更必要)
- `~/.claude/rules/common/codex-collaboration.md` §2.5 d (Phase 41 T1 ルール継続有効)

### 絶対に壊してはいけないもの (invariants)
- 既修正 13 bug すべてに retrogression なし
- typecheck clean / unit 35 PASS / integration 96 PASS
- CI E2E 7/7 PASS (Phase 46 で初 CI 確認時に維持)
- `admin_vendor_invitations.status` 遷移ルール (accepted→revoked 禁止)
- `revoked_at` column は schema に追加しない (Phase 42 確定)
- `AdminDashboardMetrics` interface (Phase 44 確定) 破壊禁止
- `TransportOrderListItem` 戻り型 (Phase 43 確定) 破壊禁止
- 遅延 SQL 定義 `vendor_response='pending' AND notification_sent_at < now() - interval '24 hours'` 意味変更禁止
- outbox は createAdminVendorInvitation / createTransportOrderWithNotification 時のみ作成
- companyId はサーバー側 admin user から取得 (URL/searchParams 不可)
- **`FailedNotificationListItem` interface (Phase 45 確定) 破壊禁止** (page + integration test 依存)
- **`requeueFailedNotification` semantic (Phase 45 確定): `status='failed'` のみ requeue 可 / `attempts=0` リセット / `idempotency_key='re-...'` 新生成 / `last_error` 残存 / tenant guard 必須**
- **server action 内で `getAdminUser()` 再認証必須** (RLS だけでは admin 認可境界として不十分、Phase 45 W5)

### 注意点・コンテキスト
- branch: `phase-42-t4-test-coverage` (Phase 44 commit `b1b2704` から +1 commit 予定)
- Phase 45 変更ファイル: 3 files 新規 / 0 modify (純粋 add)
  - `src/lib/services/notifications.ts` (+74 lines)
  - `src/app/admin/notifications/page.tsx` (+99 lines)
  - `src/app/admin/notifications/actions.ts` (+28 lines)
  - `tests/integration/services/notifications.integration.test.ts` (+251 lines)
- Codex adversarial review 戻り値が高品質 (BLOCK 2 件は具体的 code line 引用付き、誤検出なし) → 着手前レビューを設計判断不明確時に積極活用
- Codex subagent 経路 default 化が定着、stdin hang 0 件 / 引き取り 0 件 (Phase 44 → 45 連続)
- `gen_random_uuid()` は PostgreSQL 13+ 標準 (pgcrypto 不要)、Supabase 環境で動作確認済
- PostgreSQL `now()` は transaction 開始時刻に固定。integration test の `nextAttemptAt` 比較は tx 開始時刻 ±数秒 で assert (テストパターン確立)

## Codex ledger refs

- del-20260526-120719-3013 (adversarial review、BLOCK 2 + WARN 5 採用)
- del-20260526-123620-34e2 (service notifications.ts、applied)
- (T2 page+action / T3 integration test 並列 ID は ledger 確認可)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 45 commit 数 | 1 (予定) |
| 変更ファイル | 4 A = 4 files (新規 4、純粋 add) |
| 修正済 latent bug / 機能追加 | 1 (#13 §1.8 通知失敗・運用画面 縦切り — 累積 13) |
| advisor 呼び出し | 0 (spec §1.8 明示済で skip、判断不明確箇所は Codex adversarial review に統合) |
| Codex 委任 task 数 | 4 (adversarial review / service / page+action / integration test) |
| Codex sandbox-blocked 率 | 0/4 (apply_patch 経路で安定、T3 のみ Codex 側 vitest 実行 spawn 失敗 → Claude 側 npx vitest で代替実行 PASS) |
| Codex exec stdin hang | 0 件 (subagent 経路 default 化で回避、Phase 44→45 連続) |
| Claude 側修正 (Codex 出力) | **0** (Phase 43 → 44 → 45 で連続 0 件) |
| integration test 件数 | 93 → 96 (+3: notifications service 3 件) |
| unit test 件数 | 35 (変化なし) |
| 新規 service 関数 | 2 (listFailedNotifications / requeueFailedNotification) |
| 新規 interface | 1 (FailedNotificationListItem) |
| 新規 page | 1 (/admin/notifications) |
| 新規 server action | 1 (requeueFailedNotificationAction) |

## 振り返りメモ

- **adversarial review の効用検証**: Phase 44 で「spec/handoff に答えあり → advisor skip」化したが、Phase 45 は spec §1.8 が再送 semantic 不明示 → Codex adversarial review で BLOCK 2 + WARN 5 抽出、いずれも具体的 code line 引用付きで高品質。**ルール改訂: spec 明示済 → advisor skip / spec 不明示の設計判断含む → Codex adversarial review 必須**
- **Codex 出力品質 0 件引き取り 3 Phase 連続**: Phase 43 (4 件引き取り) → 44 (0 件) → 45 (0 件)。継続要因は Phase 44 確立パターン (line 番号明示 + invariant 列挙 + 推測 NG + 既存 read 強制 + apply_patch only) を維持していること
- **Codex sandbox での vitest 実行不可**: T3 で Codex 側 `npx vitest run` が Windows spawn 制約で失敗。**ルール継続**: Codex 委任時の typecheck / unit / integration test 実行は Claude 側で代替実行。Codex 側で完了通知できなくても sandbox-blocked ではない (apply_patch は通っている)
- **新規 invariant 追加**: `FailedNotificationListItem` + requeue semantic + server action 認証 pattern を invariant 化。Phase 46+ で破壊変更すると page / integration test / 他 admin action が壊れる
- **PostgreSQL `now()` tx 固定 pattern**: integration test で時刻比較 assert する際、tx 開始時刻 ±数秒幅で assert する pattern を確立 (Phase 45 T3 case 2)。Phase 46+ の時刻系 service test で再利用可
- **table heading 日本語化未対応 (軽微指摘)**: page.tsx が `eventType` `attempts` 等の英語 raw key 表示。h1 は日本語なので不整合。Phase 46+ で表示文言整備可 (機能優先で先送り、UI 改善 1 commit)

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-26 (Phase 45 完了、累積 13 機能追加 + §1.8 通知失敗・運用画面 縦切り)*
