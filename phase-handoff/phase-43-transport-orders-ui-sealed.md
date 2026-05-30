# Phase 44 入力契約: Phase 43 §1.5 業者通知・回送管理 一覧 UI 縦切り sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 43 (前: 42 sealed) |
| 状態 | **sealed** (typecheck clean / unit 35 / integration 91 PASS) |
| 完了日時 | 2026-05-26 |
| 担当 | Claude (scope 確定 + 設計判断 + Codex 出力レビュー & fix) / Codex (3 件委任: service / page.tsx / integration test) |
| 前 handoff | `phase-42-t4-coverage-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (commit `fa313e9`) |

## 達成したこと (Phase 43)

- **§1.5 業者通知・回送管理 admin UI (read-only 一覧)** を縦切り最小で実装
  - 表示: 案件番号 / 業者名 / 移動パターン / 走行可否 (レッカー要 badge) / ステータス / 通知送信日時 / 業者対応 (badge) / 業者対応日時 / 招待 (先着受注 badge)
  - ステータス絞り込み (GET form / dropdown 5 種)
  - 一覧 0 件時のフォールバック表示
- **service 層拡張**: `listTransportOrdersWithLatestInvitation(db, companyId, { statusKey? })` を追加。LATERAL JOIN で最新 invitation を join (is_winning_bid 優先 → invited_at DESC)
- **integration test 3 件追加**: tenant 隔離 / statusKey filter / latest invitation join (全 pass)
- **nav エントリ追加**: admin-shell.tsx に Truck icon で「業者通知・回送」リンク

## Claude 側の主要設計判断

1. **§1.5 read-only 縦切りを選択**: 推奨スコープ 4 候補 (1.4 / 1.5 / 1.8 / 1.1) から、`createTransportOrderWithNotification` が serviceTicketId/vehicleId pre-existing UUID 要求 → §1.4 本格 UI は ticket/vehicle service 先行で 1 Phase 越え。read-only の §1.5 が縦切り最小で確実
2. **詳細ページ (`[id]`) は Phase 44 へ送る**: 一覧で必要情報を全て出せる構成にして scope creep を防止
3. **業者変更/再通知/手動切替/キャンセル/CSV/招待 revoke を除外**: 副作用ありの操作は別 Phase 化
4. **Codex stdin 問題でフォールバック判断**: `codex exec` 直接経路が `Reading additional input from stdin...` で空応答 → Task(codex:codex-rescue) subagent 経路に切替で安定 (2/2 applied)
5. **Phase 41 T1 ルール「post-delegation 実体確認」が再び機能**: Codex auto-apply 通知 (applied: true) を盲信せず typecheck + integration 手元実行 → SQL alias 不整合 / TS narrowing / TS2532 / React key 等 4 件を Claude が引き取り fix

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| codex exec (1回目) | listTransportOrdersWithLatestInvitation service 追加 192 行 | applied (SQL alias 不整合 / TS narrowing 不足を Claude が修正) |
| del-20260526-103539-b4ea | /admin/transport-orders/page.tsx 新規 276 行 | applied (React key minor 修正のみ) |
| del-20260526-104016-fadc | integration test 3 件 88 行 | applied (TS2532 optional chaining を Claude が修正) |

**Codex sandbox 状態**: Phase 41/42 確立の apply_patch 経路は安定 (Task subagent 経由)。**新発見**: `codex exec` 直接 (background) で `tail -40` パイプ介在時に stdin 待ちで hang する事象あり。Task(codex:codex-rescue) サブエージェント経由なら同 prompt で apply 完了する。

## Phase 41-43 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-7 | Phase 31-A/B/C/D | 39-40 | (phase-40-recon-sealed.md 参照) |
| 8 | Phase 25 | 41 | vendor/invitations/callback 同型脆弱性 |
| 9 | Phase 40 (test infra) | 41 | admin-vendors test 1 mock → real DB |
| 10 | Phase 40 (T2 audit) | 42 | T4-#2/#3/#4 audit 残 3 件解消 |
| **11** | Phase 16-B 以降 UI 不在 | **43** | §1.5 業者通知・回送管理 一覧 UI 縦切り (Most Important Feature 可視化層) |

## 残課題 / Phase 44 todo

- **§1.5 残機能**: 業者変更 / 希望日時変更 / 次候補打診 / 手動切替 / キャンセル / CSV エクスポート / 招待 revoke / 通知履歴ビュー / 詳細ページ `[id]`
- **§1.4 店間整備依頼 admin UI**: service_ticket / vehicle / reservation の service と最小 UI が前提 (大規模 Phase)
- **§1.1 Dashboard 実データ化**: モックを transport_orders + vendor_invitations の count query に置換
- **§1.8 通知失敗・運用画面**: notification_outbox.status='failed' 一覧 + 手動再送
- **本番デプロイ前の Supabase URL Configuration 更新** (Phase 41 から継続)
- **`probe-invite-link.ts` を CI に組み込むか?** (Phase 41 から継続)
- **vendor 側 E2E 拡張**: callback も叩く E2E (Phase 41 から継続)
- **spec/data-model.md に admin_vendor_invitations 定義追加** (Phase 42 から継続)
- **Codex shell spawn 制約**: plugin upstream の Windows 制約、Claude 側 scope 外 (Phase 41 から継続)
- **branch merge**: `phase-42-t4-test-coverage` → `phase-26-ci-verify` への merge は未実施 (Phase 42 から継続)
- **Codex exec stdin hang**: `codex exec` を background + pipe (`| tail -N`) で実行すると stdin 待ちで空応答する事象。subagent 経路で回避可能

## Phase 44 入力契約

### 推奨される次 Phase スコープ
1. **§1.1 Dashboard 実データ化** (read-only / 1 Phase で確実 / §1.5 列挙ロジックを使い回せる)
2. **§1.8 通知失敗・運用画面** (outbox 既存・手動再送 1 action のみ追加 / 最小)
3. **§1.5 詳細ページ `[id]`** (一覧から遷移、副作用なし)
4. **§1.5 招待管理ビュー (revoke/再発行)** (副作用あり、admin-vendor-invitations と統合判断必要)
5. **§1.4 店間整備依頼 admin UI** (service_ticket/vehicle service 先行、大規模)

### 参照すべきファイル
- 本 handoff (`phase-43-transport-orders-ui-sealed.md`)
- `phase-42-t4-coverage-sealed.md` (前 Phase)
- `src/lib/services/transport-orders.ts:336-528` (listTransportOrdersWithLatestInvitation + helper)
- `src/app/admin/transport-orders/page.tsx` (Phase 43 新規 276 行、Phase 44 詳細ページの mirror 元)
- `src/app/admin/vendors/page.tsx` (mirror 元、副作用あるパターンの参考)
- `~/.claude/rules/common/codex-collaboration.md` §2.5 d (Phase 41 T1 ルール継続有効)

### 絶対に壊してはいけないもの (invariants)
- 既修正 11 bug すべてに retrogression なし
- typecheck clean / unit 35 PASS / integration 91 PASS
- CI E2E 7/7 PASS (Phase 44 で初 CI 確認時に維持)
- `admin_vendor_invitations.status` 遷移ルール (accepted→revoked 禁止)
- `revoked_at` column は schema に追加しない (Phase 42 確定)
- outbox は createAdminVendorInvitation / createTransportOrderWithNotification 時のみ作成
- **listTransportOrdersWithLatestInvitation の戻り型 `TransportOrderListItem`** を Phase 44+ で破壊変更しない (page.tsx と integration test が依存)
- companyId はサーバー側 admin user から取得、URL/searchParams から取らない (tenant cross-leak 防止)

### 注意点・コンテキスト
- branch: `phase-42-t4-test-coverage` (commit `fa313e9`)
- Phase 43 commit は 1 件 (4 files / 557 insertions / 1 deletion)
- Codex exec 直接 (background + pipe) は stdin hang あり、**subagent 経路推奨**
- 一覧 page.tsx は admin/vendors と同等の tailwind スタイル、副作用なし pure read-only
- LATERAL JOIN の sql template literal は drizzle で OK だが、`FROM ${table} t` の alias 付与は手書きが必要 (drizzle が auto alias しない)

## Codex ledger refs

- codex exec 1 (transport-orders.ts list query) — ledger 未記録 (foreground exec)
- del-20260526-103539-b4ea (page.tsx 新規、applied)
- del-20260526-104016-fadc (integration test 3 件、applied)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 43 commit 数 | 1 (`fa313e9`) |
| 変更ファイル | 3 M + 1 A = 4 files |
| 新規ファイル | 1 (page.tsx、276 行) |
| 修正済 latent bug / 機能追加 | 1 (#11 §1.5 UI 縦切り — 累積 11) |
| advisor 呼び出し | 2 回 (scope 絞込 / Phase 43 候補確認、両方で discriminating fact 抽出に有効) |
| Codex 委任 task 数 | 3 (service / page / test) |
| Codex sandbox-blocked 率 | 0/3 (apply_patch 経路で安定) |
| Codex exec stdin hang | 1 件 (background + pipe で発生、subagent 経路で回避) |
| Claude 側修正 (Codex 出力) | 4 (SQL alias / TS narrowing / TS2532 / React key) |
| integration test 件数 | 88 → 91 (+3: list query 3 件) |
| 新規 service 関数 | 1 (listTransportOrdersWithLatestInvitation) |

## 振り返りメモ

- **advisor の貢献**: 2 回呼び出しで (1) handoff 文言「UI 未実装」を疑い既存実装地図を取得、(2) `createTransportOrderWithNotification` の入力契約 (serviceTicketId 必須) を確認させて §1.4 → §1.5 へ scope 切替を促した。discriminating fact 抽出の威力が再確認された
- **AskUserQuestion で「推奨順に進めたい」回答**: ユーザーが scope 決定を Claude に委ね、Claude が事実評価から §1.5 を選択。advisor の事前分析 (1 Phase に収まる縦切り) と整合
- **Codex exec stdin hang 新発見**: `codex exec ... | tail -40` で stdin 待ちで空応答する事象。background process tasklist では codex.exe が生きているように見えるが応答なし。subagent 経路 (Task(codex:codex-rescue)) で同一 prompt が安定動作。次 Phase 以降は **大規模 prompt は subagent 経路を default にする** 運用を推奨
- **Claude 引き取り 4 件**: Phase 41 で確立した「Codex 出力の typecheck + 実体確認」が機能。特に SQL alias 不整合 (`FROM ${transportOrders}` で alias 不在のまま `t.id` 参照) は実行時 only の bug で typecheck では検出不可、手動の SQL trace で発見 → Phase 41 T1 ルールの価値再確認

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-26 (Phase 43 完了、累積 11 機能追加 + §1.5 UI 縦切り)*
