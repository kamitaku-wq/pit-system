# Phase 47 入力契約: Phase 46 §1.5 業者通知・回送管理 詳細ページ `[id]` sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 46 (前: 45 sealed) |
| 状態 | **sealed** (typecheck clean / unit 35 / integration 101 PASS) |
| 完了日時 | 2026-05-26 |
| 担当 | Claude (scope 確定 + adversarial review 統合 + Codex 出力レビュー + Number.isNaN 修正) / Codex (4 件委任: adversarial review / service / page / integration test) |
| 前 handoff | `phase-45-notifications-failed-ui-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 45 from `3d4c46f`) |

## 達成したこと (Phase 46)

- **§1.5 詳細ページ `[id]`** を副作用なし表示専念で実装
  - 詳細情報 / 招待一覧 / 通知履歴 の 3 section
  - 一覧 page 案件番号 cell からの遷移
- **service 層拡張**: `src/lib/services/transport-orders.ts` (591 → 838 行、+247)
  - `getTransportOrderDetail(db, companyId, id)` 新規、3 query (sequential + child Promise.all)
  - 3 interface 新規: `TransportOrderDetail` / `TransportOrderInvitationItem` / `TransportOrderNotificationItem`
- **admin page**: `/admin/transport-orders/[id]` 新規 (page 318 行)
- **list page modify**: 案件番号 cell に `<Link>` (+8/-2 lines)
- **integration test 5 件追加** (詳細取得 / cross-tenant / non-existent / empty / soft-delete、+346 行、全 pass)
- **Codex adversarial review 実施** (BLOCK 3 / WARN 5 / INFO 2 / ALT 2 抽出 → 計画改訂)
- **`isNaN` → `Number.isNaN` 1 件修正** (新規追加 expectNumber 内、Phase 45 持ち越し item の regression 防止)

## Claude 側の主要設計判断

1. **§1.5 詳細ページを選択**: Phase 45 handoff 推奨順 #1。一覧から自然な遷移、副作用なし、UI 系 4 Phase 連続経験
2. **scope crisp 化**: action 0 件 (業者変更 / 希望日時変更 / 次候補打診 / 手動切替 / キャンセル / 招待 revoke 全て OUT) → 0 件引き取り維持
3. **Codex adversarial review 実施** (spec §1.5 明示は表示項目のみ、page 構成・data 取得は不明示 → 設計判断含むため Phase 45 改訂ルール「spec 不明示 → adversarial review 必須」適用)
4. **3 query strategy (A1 採用)**: detail を先に fetch → null なら child skip、本体取得後に child 2 query Promise.all
5. **B1 UUID guard**: `z.string().uuid().safeParse(params.id)` で page 側 guard、DB に malformed UUID 渡さず 500 防止
6. **B2 soft-delete filter**: detail query で `t.deleted_at IS NULL` 強制
7. **B3 invitation vendorId nullable**: spot 業者 (`invitee_email` のみ) を破壊しないため `vendorId: string | null`、page 表示は `vendorName ?? inviteeName ?? inviteeEmail ?? "（スポット業者）"`
8. **W1 子 query 多層 tenant guard**: invitations + notifications 両 query に `company_id = ${companyId}` 必須
9. **W2 outbox status enum 正規**: `pending / processing / sent / failed / cancelled` (`sending` は旧誤記)
10. **W3 部分採用 (PII redaction 先送り)**: Phase 45 §1.8 と同パターン raw `last_error` 表示で当面継続、redaction は Phase 47+ §1.8 共通課題
11. **W4 invitation_id 経由通知も拾う**: outbox は 3 種類 FK 持ち、`transport_order_id` だけだと invitation 経由通知漏れ → OR + sub-SELECT で網羅
12. **I2 invitation tie-breaker `id DESC`**: 同一 `invited_at` での順序確定
13. **A2 jsonb_agg 棄却**: scope 拡大、A1 で snapshot 一貫性は実害なし
14. **store name JOIN 不採用**: 詳細では store ID のみ表示、name JOIN は Phase 47+ 拡張

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260526-132530-9921 | adversarial review (BLOCK 3 / WARN 5 / INFO 2 / ALT 2 抽出) | 採用 (BLOCK 全採用 / WARN W3 部分採用・他全採用 / INFO 全採用 / ALT A1 採用・A2 棄却) |
| del-20260526-133614-77e4 | T1 service `getTransportOrderDetail` +247 行 | applied (Claude 側 1 件修正: `isNaN` → `Number.isNaN`) |
| (T2 page / T3 integration test 並列 ID は ledger 確認可) | T2 page 318 行 + list page modify / T3 integration test 346 行 | applied (修正不要) |

**Codex 出力品質**: Phase 43→44→45 連続 0 件引き取りに対し、Phase 46 は **1 件引き取り** (`isNaN` → `Number.isNaN` 新規導入の regression 防止)。Codex 委任プロンプトに「Phase 45 持ち越し item」が明記されてなかったための見落とし → Phase 47+ では委任プロンプトに「直近 handoff の持ち越し item を読み込んで regression 回避」を明記

## Phase 41-46 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-13 | Phase 31-A〜45 (累積) | 39-45 | (phase-45-sealed.md 参照) |
| **14** | Phase 16-B 以降 詳細ページ不在 | **46** | §1.5 詳細ページ `[id]` 縦切り (表示専念、副作用なし) |
| **15** | Phase 45 持ち越し regression 防止 | **46** | service `expectNumber` 内 `Number.isNaN` 利用 (新規 isNaN 導入回避) |

## 残課題 / Phase 47 todo

- **§1.5 action 群実装** (Phase 46 の OUT 全部): 業者変更 / 希望日時変更 / 次候補打診 / 手動切替 / キャンセル / 招待 revoke / token URL 再発行
- **§1.5 store name JOIN** (詳細で店舗名表示、Phase 46 は store ID のみ)
- **§1.5 招待管理ビュー単独 page** (複数業者打診時の一覧)
- **§1.8 last_error PII redaction** (詳細 page + Phase 45 §1.8 一覧 page 共通課題、phone/email/VIN マスキング)
- **§1.8 拡張**: notification_deliveries 書込み開始 / requeue_count column 追加 / status='cancelled' 変更 / 担当者割当 / エスカレーション / Slack 連携 / 詳細ページ
- **§1.8 表示文言整備** (page.tsx table heading 英語 raw key)
- **§1.1 業務優先一覧テーブル** (Phase 44 持ち越し)
- **§1.4 店間整備依頼 admin UI** (大規模、service 先行)
- **本番デプロイ前の Supabase URL Configuration 更新** (Phase 41 から継続)
- **`probe-invite-link.ts` を CI に組み込むか?** (Phase 41 から継続)
- **vendor 側 E2E 拡張**: callback も叩く E2E (Phase 41 から継続)
- **spec/data-model.md に admin_vendor_invitations 定義追加** (Phase 42 から継続)
- **branch merge**: `phase-42-t4-test-coverage` → `phase-26-ci-verify` 未実施 (Phase 42 から継続)
- **headquarters_admin role 分離検討** (Phase 45 から継続)

## Phase 47 入力契約

### 推奨される次 Phase スコープ
1. **§1.5 cancel action** (副作用 1 件のみ、詳細 page 経由、status='closed' へ遷移、Phase 46 page 拡張で最小スコープ)
2. **§1.5 vendor_change action** (副作用、業者変更で再通知 outbox + 既存 invitation revoke)
3. **§1.1 業務優先一覧テーブル** (Phase 44 から継続、`listTransportOrdersWithLatestInvitation` 再利用 + filter)
4. **§1.8 audit trail 強化** (requeue_count column 追加 + notification_deliveries 書込み、schema migration 1 件)
5. **§1.5 store name 表示** (詳細 page + 一覧 page の store ID → name 表示、軽微)
6. **§1.5 招待管理ビュー単独 page** (招待 revoke 含む、副作用あり)

### 参照すべきファイル
- 本 handoff (`phase-46-transport-order-detail-sealed.md`)
- `phase-45-notifications-failed-ui-sealed.md` (前 Phase)
- `src/lib/services/transport-orders.ts` lines 593-838 (Phase 46 追加 247 行、Phase 47+ action 関数 mirror 元)
- `src/app/admin/transport-orders/[id]/page.tsx` (Phase 46 detail page 318 行、action 拡張時の base)
- `src/app/admin/notifications/actions.ts` (Phase 45 server action 28 行、`getAdminUser()` 再認証 pattern)
- `src/lib/inngest/functions/outbox-dispatcher.ts` (再送 semantic 元情報)
- `~/.claude/rules/common/codex-collaboration.md` §2.5 d (Phase 41 T1 ルール継続有効)

### 絶対に壊してはいけないもの (invariants)
- 既修正 15 bug すべてに retrogression なし
- typecheck clean / unit 35 PASS / integration 101 PASS
- CI E2E 7/7 PASS (Phase 47 で初 CI 確認時に維持)
- `AdminDashboardMetrics` interface (Phase 44 確定) 破壊禁止
- `TransportOrderListItem` 戻り型 (Phase 43 確定) 破壊禁止
- `FailedNotificationListItem` interface (Phase 45 確定) 破壊禁止
- `requeueFailedNotification` semantic (Phase 45 確定) 破壊禁止
- server action 内で `getAdminUser()` 再認証必須 (Phase 45 W5)
- 遅延 SQL 定義 `vendor_response='pending' AND notification_sent_at < now() - interval '24 hours'` 意味変更禁止
- outbox は createAdminVendorInvitation / createTransportOrderWithNotification 時のみ作成
- companyId はサーバー側 admin user から取得 (URL/searchParams 不可)
- **`TransportOrderDetail` interface (Phase 46 確定) 破壊禁止** (page + integration test 依存)
- **`TransportOrderInvitationItem.vendorId` は nullable** (spot 業者 invitee_email 経路を破壊しない)
- **`getTransportOrderDetail` semantic (Phase 46 確定)**:
  - detail null → child skip (sequential)
  - 子 query にも `company_id = ${companyId}` tenant guard 必須
  - notification は invitation_id 経由分も拾う (OR + sub-SELECT)
  - soft-delete (`deleted_at IS NOT NULL`) は null 扱い

### 注意点・コンテキスト
- branch: `phase-42-t4-test-coverage` (Phase 45 commit `3d4c46f` から +1 commit 予定)
- Phase 46 変更ファイル: 1 modify (service) / 1 modify (list page) / 2 new (detail page + integration test)
  - `src/lib/services/transport-orders.ts` (+247 lines)
  - `src/app/admin/transport-orders/page.tsx` (+8/-2 lines、Link import + cell wrap のみ)
  - `src/app/admin/transport-orders/[id]/page.tsx` (+318 lines、new)
  - `tests/integration/services/transport-orders-detail.integration.test.ts` (+346 lines、new)
- Codex adversarial review 4 度目、Phase 45 同水準の密度 (BLOCK 3 vs Phase 45 BLOCK 2)
- Codex sandbox vitest 実行不可継続 (T1/T2/T3 全件で Claude 側 `npm run test:all` 代替実行)
- Phase 46 で Codex 引き取り 1 件発生 (`isNaN` → `Number.isNaN`)、Phase 47+ で委任プロンプトに「直近 handoff 持ち越し item を読み込め」を追加して回避

## Codex ledger refs

- del-20260526-132530-9921 (adversarial review、BLOCK 3 + WARN 5 採用)
- del-20260526-133614-77e4 (service getTransportOrderDetail、applied + Claude 側 isNaN 修正)
- (T2 page / T3 integration test 並列 ID は ledger 確認可)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 46 commit 数 | 1 (予定) |
| 変更ファイル | 2 M + 2 A = 4 files |
| 修正済 latent bug / 機能追加 | 2 (#14 §1.5 詳細ページ / #15 Number.isNaN regression 防止 — 累積 15) |
| advisor 呼び出し | 1 (Phase 46 着手前方向性確認、Codex adversarial review と併用) |
| Codex 委任 task 数 | 4 (adversarial review / service / page / integration test) |
| Codex sandbox-blocked 率 | 0/4 (apply_patch 経路で安定、vitest は Codex 側で実行せず Claude 側で `npm run test:all`) |
| Codex exec stdin hang | 0 件 (subagent 経路 default 化で回避) |
| Claude 側修正 (Codex 出力) | **1** (`isNaN` → `Number.isNaN`、Phase 45 持ち越し regression 防止) |
| integration test 件数 | 96 → 101 (+5: getTransportOrderDetail 5 件) |
| unit test 件数 | 35 (変化なし) |
| 新規 service 関数 | 1 (getTransportOrderDetail) |
| 新規 interface | 3 (TransportOrderDetail / TransportOrderInvitationItem / TransportOrderNotificationItem) |
| 新規 page | 1 (/admin/transport-orders/[id]) |
| 一覧 page modify | +8/-2 lines (Link import + 案件番号 cell wrap) |
| 新規 server action | 0 (副作用なし表示専念) |

## 振り返りメモ

- **adversarial review 4 連続実施**: Phase 45 改訂ルール「spec 不明示 → review 必須」が機能。BLOCK 3 (UUID malformed / soft-delete / vendorId nullable) は本番で 500 / data leak / breakage 直結級、Codex を挟まなければ実装後 fix で hot patch だった
- **Codex 0 件引き取り連続 streak 終了 (3→4 Phase 目)**: 1 件引き取り (`isNaN` → `Number.isNaN`) は Phase 45 持ち越し item の見落とし。**ルール改訂: Codex 委任プロンプトに「直近 handoff の残課題 / 持ち越し item を読み込み、新規コードで regression させない」を追加**
- **scope crisp 化の効果**: IN/OUT 表を計画書面に明示することで action 0 件 + 拡張 0 件を貫徹。Phase 46 size = service +247 / page +318 / test +346 = 約 920 行と前 Phase 比やや大きいが、scope 拡大なし
- **3 query 戦略 (A1 採用)**: cross-tenant attack で child query が走るのを防ぐため detail を先に fetch。security best practice として Phase 47+ 全 detail 系 service で踏襲
- **invitation_id 経由通知 (W4)**: outbox FK が 3 種 (`transport_order_id` / `reservation_id` / `transport_order_invitation_id`) という事実を adversarial review で抽出。`createAdminVendorInvitation` 経由通知が `transport_order_invitation_id` のみ持つケースで表示漏れする bug を未然防止
- **integration test 5 件 (4 件目「empty」/ 5 件目「soft-delete」追加)**: W5 + B2 採用で当初 3 件 → 5 件に増加。境界 case (空配列 / soft-delete) は invariant 化要素

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-26 (Phase 46 完了、累積 15 機能追加 + §1.5 詳細ページ `[id]` 縦切り)*
