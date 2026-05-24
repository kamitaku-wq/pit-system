# Phase 21: Sprint α-3 Day 4 / 16-E Planning-Only Handoff (sealed)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 21 |
| 状態 | sealed (planning-only) |
| 開始 | 2026-05-25 (Phase 20 sealed 直後) |
| 完了 | 2026-05-25 |
| 担当 | Claude (resume + recon 巻取り + Plan v1/v2 起草 + seal) / Codex (recon 3 件 + adversarial review、admin recon 失敗) |
| 関連 branch | main (uncommitted、本 phase seal 後にまとめて commit) |
| 前 Phase | phase-20-alpha-3-day3-16d.md (sealed, commit 3c1edc9) |
| 関連 incident | R-H-002 (Codex Windows sandbox 不安定継続。close-order recon は完全 block で Claude 巻取り、admin-invitation recon は dispatch 後完了通知未受領で β 繰越確定、adversarial review は成功) |

## このフェーズで達成したこと

- Phase 22 (16-E) 着手前の **Codex recon 並列実行** (Phase 20 教訓「recon → plan → adversarial review 順序」の制度化)
- recon ファイル 3 件生成 (`phase-21-16e-recon-{playwright,spot-rpc,close-order}.md`)、admin-invitation は Codex sandbox 失敗で β 繰越
- close-order recon の Claude 巻取り (Codex sandbox 完全 block 経路、Grep 5 件で必要情報集約)
- **Plan v1 起草 → Codex adversarial review (Major revisions) → Plan v2 化** (`phase-21-alpha-3-day4-16e-plan.md`)
- Plan v2 で 2 件 Critical Issue 解消: A1 を SECURITY DEFINER RPC `close_transport_order` 化 / `transport_order_status_history` 実 schema へ修正 (`version` 列削除)
- スコープ確定: A1/A2/A3/A4/A5 (close service RPC + service wrapper + E2E + integration test) を 16-E 必須、C1 spot / C2 admin は **β 繰越**
- 実装ファイル変更 0 件 (planning-only Phase の定義通り)、`phase-handoff/` 配下に 5 ファイル追加のみ

## Claude 側の主要設計判断

1. **Phase 21 を planning-only Phase 化**: ユーザー選択 (recon + plan 完了で sealed、実装は Phase 22 別セッション)。Phase 20 振り返り「recon を planning 前段に」を実装。トークン節約 + 集中度向上
2. **close-order recon の Claude 巻取り**: Codex sandbox `spawn setup refresh` で 全 block、プレースホルダ ファイルを Write で上書き。`24_vendor_rpcs.sql:5` の「16-E scope」公式コメント発見が決定的
3. **Plan v1 RLS blocker 誤認**: `transport_orders` Drizzle 直接 UPDATE を提案したが、19_rls_policies.sql の vendor-scoped UPDATE policy で fail することを Codex adversarial review が指摘。Phase 19 RPC pattern と同じ SECURITY DEFINER RPC 化に切替
4. **Plan v1 history schema 誤認**: `version` 列を含めた spec を書いたが、実 schema (12_transport.sql:47-55) に `version` 列なし。`changed_at` (default `now()`) 列も Plan v1 で漏れ。Plan v2 で全置換
5. **二重 submit E2E → integration test 降格**: Playwright click 連打は form disable で 2 件目 no-op、real concurrent 再現不可。`Promise.all` race を integration test で検証する設計に変更
6. **admin invitation β 繰越確定**: Codex sandbox 失敗で recon 未生成、scope 推定不能。Phase 20 sealed の「16-E or β 繰越」既明示と整合
7. **spot invitation β 繰越確定**: spot RPC recon で「RLS で vendor portal 非表示」「reject 所有確認未設計」「offered_amount_minor 列未定義」発見、scope 拡大不可避
8. **委任順序設計**: A1a + A3 並列 (target file 分離済) → A1b → A2/A5 → A4。Phase 20 #4/#5 衝突教訓反映

## Codex 委任成果

| 委任 ID | 内容 | 成果物 | 状態 |
|---|---|---|---|
| del-20260524-152810-0e00 | Playwright recon | `phase-21-16e-recon-playwright.md` | applied (Codex 直作成成功) |
| del-20260524-152829-c31b | spot RPC recon | `phase-21-16e-recon-spot-rpc.md` | applied (Codex 直作成成功) |
| del-20260524-152851-2e51 | admin invitation recon | ファイル未生成 (job `bbr1q9m1z` 完了通知未受領) | **override (sandbox-blocked)**、β 繰越確定 |
| (close-order recon ID 不明) | close-order recon | `phase-21-16e-recon-close-order.md` | **override (sandbox-blocked、Claude 巻取り)** |
| del-20260524-153952-8f07 | Plan v1 adversarial review | `phase-21-adversarial-review.md` (Major revisions) | applied、Plan v2 化に反映 |

委任成功率: 3/5 (recon 2 件 + review 1 件)。失敗 2 件 (admin / close-order recon) は Phase 20/21 と同じ Windows sandbox R-H-002 pattern。

## 主要ファイル (next phase reference)

### 新規 (本 Phase で追加された planning artifacts)

- `phase-handoff/phase-21-16e-recon-playwright.md` (94 行、Codex 生成、Playwright 環境完備確認)
- `phase-handoff/phase-21-16e-recon-spot-rpc.md` (71 行、Codex 生成、spot 仕様精査 + RLS gap 発見)
- `phase-handoff/phase-21-16e-recon-close-order.md` (Claude 巻取り版、`24_vendor_rpcs.sql:5` 公式コメント発見)
- `phase-handoff/phase-21-adversarial-review.md` (61 行、Codex 生成、Critical 2 件 + Recommended 4 件)
- `phase-handoff/phase-21-alpha-3-day4-16e-plan.md` (Plan v2 確定版、Phase 22 実装契約)

### 変更

なし (planning-only Phase、ソース・migrations・test 変更ゼロ)

## データモデル変更

なし (Phase 22 で `25_close_transport_order.sql` RPC migration 予定、本 Phase では設計のみ)

## API 契約

### 設計確定 (Phase 22 実装対象)

**SECURITY DEFINER RPC** `public.close_transport_order(p_transport_order_id uuid)`:
- 戻り値 TABLE `(transport_order_id uuid, closed boolean, new_status_id uuid, history_id uuid)`
- 副作用: `transport_orders.status_id` 更新 + `transport_order_status_history` INSERT (実 schema 通り)
- 認可: SECURITY DEFINER で RLS bypass、内部認可は Phase 22 で詰める
- GRANT EXECUTE TO authenticated

**service wrapper** `closeTransportOrderOnAllRejected(tx, transportOrderId)`:
- input: `tx: DrizzleTx`, `transportOrderId: string`
- output: `{ closed: boolean; newStatusId?: string; historyId?: string }`
- caller: `respondToTransportOrder` reject 分岐末尾 (同 tx 内)

詳細仕様は `phase-21-alpha-3-day4-16e-plan.md` §2 参照。

## テスト・QA 状況

- Phase 20 baseline `pnpm test` 66/66 PASS 維持 (本 Phase では変更ゼロ、test 実行不要)
- `pnpm typecheck` 維持 (同上)
- Phase 22 目標: `pnpm test` 70/70 PASS (Phase 21 baseline 66 + A5 integration +4) + `pnpm test:e2e` 2/2 PASS (A4)

## 既知の懸念・TODO (Phase 22 実装前に解消)

- [ ] `INSERT INTO statuses` grep で transport_orders 終端 seed 確認 (`is_terminal=true` 行)、未 seed なら A1a 前段に migration 追加
- [ ] `23_record_audit_log.sql` の transport_orders UPDATE trigger 有無確認 (audit_logs 自動 INSERT 経路 / 二重 INSERT 回避)
- [ ] `transport_order_status_history` INSERT の trigger / 手動の区別 (Phase 19 accept 経路 `accept_invitation_and_revoke_others` line 153+ 詳細確認)
- [ ] `accept_invitation_and_revoke_others` advisory lock key と close-order の SELECT FOR UPDATE の race 整合性 (実装で実証)
- [ ] admin-invitation recon Codex job `bbr1q9m1z` 完了確認 (β 繰越前提で参考保存)
- [ ] B2 `data-testid` 追加リスト 確定 (A4 着手後)
- [ ] RPC caller 認可: SECURITY DEFINER 内で `auth.uid()` ベース check を追加するか議論 (no-check 現案)
- [ ] **Codex Windows sandbox R-H-002**: 3 Phase 連続で部分復旧 / 完全 block 混在、状況不安定継続、Phase 22 でも Claude 巻取り運用継続

## Phase 22 (16-E) 入力契約 (必須)

### 前提として動くべき機能

- Phase 19 service `respondToTransportOrder` reject 分岐が機能 (66 test PASS)
- Phase 20 vendor portal `/vendor/requests/[id]` reject UI が機能
- `withAuthenticatedDb(authUserId, fn)` helper が transaction-local auth context 設定
- Playwright 環境完備 (`@playwright/test 1.52`, `playwright.config.ts`, `tests/e2e/` empty)

### 参照すべきファイル

- `phase-handoff/phase-21-alpha-3-day4-16e-plan.md` (Plan v2、Phase 22 実装契約 — **最優先で Read**)
- `phase-handoff/phase-21-16e-recon-close-order.md` (RPC 設計根拠)
- `phase-handoff/phase-21-16e-recon-playwright.md` (E2E setup タスク序列)
- `phase-handoff/phase-21-16e-recon-spot-rpc.md` (β 繰越判断根拠)
- `phase-handoff/phase-21-adversarial-review.md` (Plan v2 化の Critical 指摘元)
- `src/lib/db/raw-migrations/alpha-1-public/12_transport.sql:47-55` (status_history 実 schema)
- `src/lib/db/raw-migrations/alpha-1-public/19_rls_policies.sql` (RLS UPDATE policy 確認)
- `src/lib/db/raw-migrations/alpha-1-public/24_vendor_rpcs.sql` (Phase 19 RPC pattern)
- `src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql:153` (advisory lock pattern)

### 絶対に壊してはいけないもの (invariants)

- Phase 19 invariants: `respondToTransportOrder` シグネチャ、6 error class `code` プロパティ、`respond_to_transport_order` RPC signature、`accept_invitation_and_revoke_others` RPC signature
- Phase 20 invariants: `withAuthenticatedDb(authUserId, fn)` シグネチャ、middleware matcher `/vendor/:path*`、seed credentials `vendor-dev1@example.com` / `vendor-dev-pass-001`、`(vendor-portal)/vendor/` 配下のファイル配置
- Phase 21 設計判断: Plan v2 の SECURITY DEFINER RPC pattern、target file 配置 (`25_close_transport_order.sql` / `close-transport-order.ts` / `tests/_helpers/seed-vendor-e2e.ts` / `tests/e2e/vendor-portal-loop.spec.ts`)
- `pnpm test` 66/66 → 70/70 (減らない、増えるのみ)

### 推奨される次 Phase スコープ (Phase 22 / 16-E)

Plan v2 §1 の A 分類 5 タスク必須:
- A1a SECURITY DEFINER RPC `close_transport_order` migration
- A1b service wrapper `closeTransportOrderOnAllRejected`
- A2 `respondToTransportOrder` reject 分岐統合 (Claude 直接 patch)
- A3 E2E test fixture `tests/_helpers/seed-vendor-e2e.ts`
- A4 E2E spec `tests/e2e/vendor-portal-loop.spec.ts` (2 ケース)
- A5 integration test +4 ケース (happy / partial / concurrent / 二重 submit race)

B1 staging smoke (手動) は sealed 直前、B2 `data-testid` は A4 着手時に追加。

### 注意点・コンテキスト

- §9 TODO 全消化が実装着手の前提 (Critical)
- 委任率目標 ~90%、A2 のみ Claude 直接、他 5 件 Codex 強制委任 (tests/ helpers/ services/ migrations すべて該当)
- E2E test は §3.1 サブエージェント強制ルールで Codex 必須
- Codex sandbox 失敗時は Claude 巻取り + ledger override `sandbox-blocked` reason 記録 (Phase 20/21 と同 pattern)
- 16-E 完了で Sprint α-3 全体 sealed、Sprint β 着手 (C1 spot + C2 admin の再 recon 起点)

## Codex ledger refs

- del-20260524-152810-0e00 (Playwright recon、applied)
- del-20260524-152829-c31b (spot RPC recon、applied)
- del-20260524-152851-2e51 (admin invitation recon、**override sandbox-blocked**)
- (close-order recon ID 不明、**override sandbox-blocked + Claude 巻取り**)
- del-20260524-153952-8f07 (Plan v1 adversarial review、applied)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 追加コード行数 | 0 (planning-only、ソース変更ゼロ) |
| 追加 planning artifacts | 5 ファイル (recon 3 + adversarial review 1 + plan 1) ~750 行 |
| 変更ファイル数 | 0 |
| Codex 委任率 | 60% (5 委任中 3 件 applied、2 件 override sandbox-blocked) |
| pnpm test | 66/66 PASS 維持 (変更ゼロ) |
| pnpm typecheck | PASS 維持 |
| Codex sandbox 失敗 | 2/5 (admin recon 完全 dispatch-only / close-order recon 完全 block) |
| Claude 手動巻取り | 1 件 (close-order recon、Grep 5 件で代替) |
| セッション数 | 1 (Phase 20 sealed → 21 連続) |
| 経過時間 | ~30 分 (recon 並列 + plan v1/v2 + seal) |

## Phase 振り返りメモ

- **うまくいったこと**:
  - Phase 20 教訓「recon → plan → adversarial review 順序」の制度化が成功、adversarial review の Critical 2 件指摘が plan v1 → v2 化の決定打となった (history schema 誤認 / RLS blocker)
  - close-order recon の Claude 巻取りで R-H-002 sandbox 失敗を 5 Grep call + 1 Write で吸収、コンテキスト浪費最小
  - Plan-only Phase 化でトークン消費を planning に集中、実装 Phase で fresh context で着手可能に
  - β 繰越判断 (admin / spot) を recon 根拠で明確化、scope 過剰を回避

- **次回改善したいこと**:
  - admin-invitation recon の Codex job dispatch-only 状態 (完了通知未受領) が ledger 上どう記録されるか確認、`bbr1q9m1z` job 結果取得経路の改善
  - Plan v1 起草時に history schema を実際の SQL `CREATE TABLE` で確認せず、推測で書いた → Phase 22 では着手前に Grep で実 schema を必ず突き合わせる
  - RLS policy 確認を Plan v1 起草前に行わなかった → Phase 22 では migration 設計時に RLS policy の grep を hard rule 化
  - Codex adversarial review のフォーマット指定 (Verdict / Critical / Recommended / Validated / Open Q / Independent) が有効、次回も同フォーマットを継続

---

*Generated by phase-handoff skill / Filled by Claude at Phase 21 seal (2026-05-25, planning-only)*
