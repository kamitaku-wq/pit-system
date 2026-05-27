# Phase 62 計画: α-3 release pre-flight 並列調査

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 62 (前: 61 sealed) |
| 種別 | **release pre-flight 調査 Phase** (実装変更なし / 事実列挙のみ) |
| 状態 | planning |
| 開始日時 | 2026-05-27 |
| 担当 | Claude (scope 確定 + Codex 6 lane dispatch + 統合 + seal) + Codex (6 lane 並列調査) |
| 前 handoff | `phase-61-store-confirmed-by-user-fk-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (+1 commit 予定: 本 plan + sealed) |

## 動機 (Why now)

1. **roadmap §0 事実**: alpha-core ハード DDL = 2026-05-31。本日 2026-05-27 (残 4 日)
2. **roadmap §5 進捗ダッシュボード事実**: α-3 行 = 「業者ループ最小 ✓ / Spot E2E 4 passed」かつ「release 判断は次回 Sprint レビュー (5/29)」
3. **直近 15 Phase (47-61) は preventive hardening 系列**: debt 台帳 D1-D5 解消 / change_logs / status_history 整備。release path に直接寄与する系列ではない
4. **Phase 61 sealed 振り返りメモ**: 「Phase 62 は debt 台帳 D6 候補 (attachments) の value 評価 or BLOCK-2 緩和 TODO or wake-up 領域への移行を検討」と 3 方向並列提示
5. **ユーザー prompt**: 「あわせてα版までの進捗も確認したい」と明示

→ release 判断 (5/29) インプットを可視化する **事実列挙調査 Phase** が最も射程に合う。advisor 助言で確認済 (Phase 62 セッション §advisor: 「F = release pre-flight が α版進捗確認とそのまま重なる」)

## scope

### 含む

- Codex 並列 6 lane で release path 構成要素を **事実列挙**
- 各 lane 結果を Claude が統合し sealed handoff にまとめる
- release 判断条件 (roadmap §1.5 Day 2) との照合

### 含まない (Phase 62 で実装しない)

- 新規 migration / schema 変更
- 新規 test / 既存 test 修正 (発見した gap は次 Phase 候補に列挙のみ)
- wake-up 領域 (MVP blocker #2 #3 / Worker handler / reservation feature) への着手
- D6 / D7 / drift 0012 等の preventive hardening 続行

## 6 lane 調査スコープ

| Lane | 調査内容 | 出力契約 |
|---|---|---|
| **L1 business path E2E** | Playwright E2E ファイル列挙 / green/red 状況 / alpha-core verification-checklist.md 消化済項目との照合 | E2E ファイルパス + 該当 spec 項目 + green/red + 漏れ項目 |
| **L2 migration drift** | `pnpm db:drift` 出力詳細 / drift 2 維持の中身 / 0021 反映後の schema diff 内訳 / 残 D 候補テーブル列挙 (D6+ 候補の active 経路有無) | drift 行内訳 + D 候補 active 経路評価 |
| **L3 RLS cross-tenant 漏洩** | Phase 0 PoC RLS test 移植状況 / 既存 integration RLS test 列挙 / helper function (current_user_company_id / current_vendor_user_id / current_vendor_id) 利用箇所 / gap | RLS test ファイル一覧 + helper 利用 grep + spec §22 (RLS) との照合 gap |
| **L4 outbox / worker** | `FOR UPDATE SKIP LOCKED` 実装箇所 / Inngest dispatcher / retry logic / MVP blocker #3 (Worker handler) 残作業 / `transport_order.changed` outbox worker 未実装範囲 | 実装ファイル + test カバレッジ + 残 handler list |
| **L5 admin invite + vendor portal** | Phase 60 BLOCK-2 (`createAdminVendorInvitation` direct call 化 + supabase auth.admin complete mock) の必要差分量 / 既存 mock 構造 / vendor portal token verification path coverage | BLOCK-2 解消に必要なファイル差分 list + 既存 mock helper 列挙 |
| **L6 reservation feature wake-up** | MVP blocker #2 (reservation cancel 遷移) の現状 / `trg_reservation_transition` migration 状態 / status seed function 不足 / 着手前に必要な fixture / migration list | reservation 関連 schema/service/test 列挙 + 着手 entry point 候補 |

## 出力契約 (Phase 62 sealed が答えるもの)

1. **release path 健全度 (5/29 Sprint レビュー材料)**
   - business path E2E green/red ratio
   - migration drift 残数 + 各 drift の release block 性質
   - RLS 漏洩 test 緑維持中か (Phase 1 sealed 後の状況)
   - outbox dispatcher 健全性 (重複送信 0 件確認状態が維持されているか)

2. **release blocker / non-blocker 仕分け**
   - 6/2 以降に slip しても allowable な項目
   - 5/31 release GO のために絶対要件

3. **Phase 63 候補スコープ**
   - L1-L6 から見えた優先度高 item を 3-5 個列挙

## 並列調査 dispatch 方針

- 各 lane Codex 委任 (`Task` で `codex:codex-rescue` subagent、6 並列)
- 各 lane 出力形式統一: 「列挙 + 1 行コメント」、長文・全文引用禁止
- Codex プロンプトには明示:
  - **scope 外ファイル変更禁止** (Phase 61 教訓)
  - **read-only 調査** (Write/Edit/migration 一切なし)
  - **最大 300 行に収まる要約**
- Claude が結果を 200 行以内に統合し phase-62 sealed に書き出す

## advisor 指摘 (反映済)

- 「推奨で進める」= AskUserQuestion option 1 (release path 寄り) と解釈
- option 1 内 D/E (wake-up entry) vs F (pre-flight) → DDL 4 日前 + 5/29 release 判断 2 日前で wake-up entry destabilization 高、F が安全
- F は ユーザー prompt 「α版進捗確認」と完全一致

## seal 基準 (Phase 62 sealed の DoD)

- [ ] 6 lane 全て Codex 出力取得済
- [ ] release path 健全度サマリ (5/29 材料) を sealed に明記
- [ ] release blocker / non-blocker 仕分けを sealed に明記
- [ ] Phase 63 候補スコープ 3-5 個を sealed に列挙
- [ ] 既存 invariants (typecheck / 188 tests / drift 2 / branch 状態) 全件不変 (本 phase は実装変更なし)
- [ ] sealed file 200 行以内

## 注意点

- Phase 62 は **調査 Phase**、コード変更 0 が前提
- 6 lane 並列で Codex token を集中投下 (Claude token 節約)
- 結果が wake-up 領域への着手を示唆する場合、Phase 63 で改めて意思決定
- DDL 5/31 / Sprint レビュー 5/29 は roadmap §0 §5 の事実言及のみ、Claude による日付予測は禁止 (CLAUDE.md Meta Rules)

---

*Phase 62 plan v1 / 2026-05-27 Claude*
*advisor confirmation: option 1 内 F (release pre-flight) commit / D-E wake-up entry destabilization 回避*
