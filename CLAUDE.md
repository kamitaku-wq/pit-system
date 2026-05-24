# CLAUDE.md (project root)

このファイルはプロジェクト全体に効くメタルール。設計・実装の詳細仕様は `spec/CLAUDE.md` と `spec/*` を参照。

## Meta Rules (IMPORTANT)

### 日付・期日・確度の自発的予測禁止

- Claude は **日付・期日・確度・スケジュール予測を自発的に持ち出さない**。
- 5/31 / 6/15 等の DDL は spec/roadmap に記載がある場合の事実言及のみ可。確度評価（「12% で達成」等）や Claude による予測（「○日でできます」「○日かかります」）は **聞かれた時のみ** 答える。
- ユーザーから「いつまでにできる？」「予測は？」「スピード感どう？」と明示的に聞かれた時のみ算出して回答する。
- ロードマップ DDL に対するユーザー側スコープ判断はユーザーが行う。Claude は事実（残タスク数・依存・ブロッカー）の提示に留める。

理由: 過去のセッションで Claude の予測が信頼に値しないことが判明したため (2026-05-23 ユーザー指示)。

## 参照すべきドキュメント

実装に着手する前に必ず以下を確認：

1. `spec/CLAUDE.md` — プロジェクト全体概要・確定事項・実装規律
2. `spec/requirements.md` v2.2 — 機能要件
3. `spec/data-model.md` v2.4 — DB スキーマ・RLS・migration 順序 §17（v2.4: phone_verified_at / quoted_amount_minor / tax_rate_bps / billing_status 追加）
4. `spec/implementation-plan.md` v2.2 — Phase 構成・PoC・service 関数
5. `spec/roadmap/roadmap.md` v1.1 — Sprint 構成・レーン定義
6. `spec/audit/audit-*.md` (2026-05-23) — 4 レーン監査結果
7. `phase-handoff/phase-18-alpha-3-day1-16b.md` — 直前 sealed handoff (Phase 16-B createTransportOrderWithNotification 完了)

## Evolution Memory (Evolver)

This project uses evolver for self-evolution. Hooks automatically:
1. Inject recent evolution memory at session start
2. Detect evolution signals during file edits
3. Record outcomes at session end

For substantive tasks, call `gep_recall` before work and `gep_record_outcome` after.
Signals: log_error, perf_bottleneck, user_feature_request, capability_gap, deployment_issue, test_failure.
