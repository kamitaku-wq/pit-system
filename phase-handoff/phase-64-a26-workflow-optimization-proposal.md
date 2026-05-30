# Phase 64-A.26 前置き: 今後の開発ワークフロー最適化 提案

> **本文書は提案のみ。適用していない。** 採用するものをユーザーが選び、選んだ提案だけを別途実装する。
> 生成: dynamic workflow `optimize-dev-workflow` (4 観点中立診断 → 統合 / 5 agent / 2026-05-29)
> 中立性ルール: 「Codex 委任率が低い」「handoff が重い」を欠陥と決めつけず、outcome(品質・速度・実トークン消費・retrogression) で評価。現行が正しい適応である可能性を各観点で steelman 済み。

---

## 総評

Phase 64-A.1〜A.25 の 25 phase で **23 連続 1 ターン完遂 / retrogression ゼロ / 408 tests PASS / typecheck clean / CI E2E 7/7** を達成。現行ワークフローは Phase 3 末時点で**正しく機能している**。

- **Codex 委任率 1/25 は compliance 逸脱であって outcome 上の欠陥ではない**。A.1-A.25 は atomic verify+consume / cross-tenant ownership / GET-safe 設計 / spec drift 解消など仕様判断量「高」タスク群で、グローバル規則自身の「高 stake・仕様判断量高は Claude 自実装」に合致する正しい適応。複数視点目的は advisor が代替（A.23 GET-safe 発見が実証）。
- **handoff ~160 行はサイズ問題ではなく**、invariants・canonical・ファイルパスという機能的情報の密度。/clear 境界では次セッションの唯一文脈源として load-bearing。

→ **大改革は不要**。A.26 以降で初めて顧客 session / Storage RLS / billing という「高 stake・新 surface」に踏み込むため、現行ゲートの**非決定論的な部分**（security adversarial gate の発火条件）と**未カバー surface**（/r/[token] E2E・Storage 再現手順）を最小限補強する比例的調整のみを提案する。

---

## 維持すべき load-bearing 要素（変えない）

| 要素 | なぜ load-bearing か |
|---|---|
| sealed handoff 二部構成（seal 記録 + 入力契約）全量 | /clear 境界では唯一文脈源。160 行は情報密度であり冗長ではない |
| advisor pre-implementation framing（実装前 1 回） | 設計論点を 1 ターンで確定する主エンジン |
| advisor pre-seal 2 回目（セキュリティ発見） | A.23 GET-safe / A.22 cross-tenant parent をこのパスで捕捉。提案#1 は廃止せず**発火条件を決定論化するだけ** |
| Codex 委任率 1/25（低委任率） | 高判断タスクへの正しい適応。率を 40-70% に近づける改革は現 phase で正当化根拠なし |
| 細粒度 phase 分割（1 phase = 1 service + 1-3 UI + 1 test + 1 commit） | context 枯渇ゼロ・scope creep 防止・rollback 境界明確化の三重効果 |
| typecheck clean + フル test green の二重ゲート | 独立した二検査の直列。どちらも省略不可 |
| invariants セクション（壊してはいけないもの） | 次 phase 先頭確認が retrogression ゼロを担保。GET-safe invariant は静的 test と連動 |
| 主要設計判断セクション（canonical 参照機構） | 後続 phase が「A.21 §37 と同型」と明示引用する参照元 |
| corrupt-fixture test + GET-safe 静的 import 検査 | advisor 発見問題の再発防止装置 |
| scope 規律（次候補を 低/中/高 で分類、高はユーザー確認待ち） | A.25 で A.26 候補を止めた判断が正しく発動 |
| DB-truth 原則 + use-case service placement（ADR-0011） | Phase 5 vendor_billings でも初日から参照する基準 |
| migration / RLS policy は Lane Main 専管 | Phase 4 Storage / Phase 5 billing でも継続 |
| 1 commit per phase | rollback 粒度。retrogression ゼロの直接要因 |

---

## 提案変更（採用はユーザー選択）

### 提案#1【high】adversarial gate 発火条件の決定論的チェックリスト化
**変更**: sealed handoff テンプレの pre-seal に「adversarial gate チェックリスト」5 項目を追記。以下いずれか該当 phase は pre-seal 前に必ず advisor 2 回目 or Codex adversarial review を「enumerate cross-tenant / GET-safety / auth-bypass holes」フレームで呼ぶ:
1. raw-migration 変更あり
2. 新規署名鍵 / session 機構の導入
3. 手書き RLS policy または Storage bucket policy の新規作成
4. 金銭計算 / billing (Phase 5)
5. 既存 canonical に当てはまらない cross-tenant boundary の新規追加

加えて roadmap Sprint β-3 DoD に「顧客 facing route(/r/[token]/*・予約フロー・token 発行)を security-reviewer agent でレビューし HIGH 以上修正済み」を追加。
**根拠**: A.23/A.22 の 2 件は informal な 2 回目 advisor が捕捉。発火条件が Claude 判断任せで、A.26 以降の初出高 stake surface で呼び忘れリスク。1 行追記で決定論化。
**tradeoff**: checkbox theater 化リスク → 各項目を yes/no でなく「該当する具体的変更名を 1 行書く」形式にする。

### 提案#2【high】Phase 4 設計 spike を A.26 前に 1 phase として切る
**変更**: A.26 実装着手前に「Phase 4 設計 spike」を 1 handoff として独立。内容:
- (a) customer session 方式の確定（署名付き cookie / opaque session + DB table / JWT 流用 の 3 択）
- (b) Storage bucket 命名規約 + bucket policy RLS 設計方針（1 company=1 bucket vs 全社 1 bucket + path prefix）
- (c) Turnstile 多層防御の実装境界（4.7 を独立先行 or β-3 に束ねる）

spike phase 自体は実装コードを書かず、確定した設計決定を spec/CLAUDE.md inline ADR に記録して sealed。
**根拠**: A.26 handoff が候補 1(中-高)/2(高)/3 を並置。Phase 4 入口は高判断密集。設計を前出しして spike に凝縮すれば実装 phase の advisor 往復を減らし 1 ターン完遂率を維持。
**tradeoff**: phase 数 +1。設計が spike で固まり切らない場合に投資が部分無駄 → spike DoD を「3 設計決定が全確定」とし、未確定ならユーザー確認待ちで止める。

### 提案#3【medium】/r/[token] E2E smoke test を session 設計 phase 着手前に実装
**変更**: A.26 着手前 or spike phase と並行で /r/[token] の Playwright E2E smoke を実装。2 ケース:「有効 token URL → GET → confirm POST → consume → 詳細表示」+「無効/使用済 token → 404/error」。テスト intent 設計は Claude が先に仕様書化、fixture + 機械的アサートは提案#4 の sandbox 再検証成功時のみ委任候補。
**根拠**: session 設計で /r/[token] が変わるとき E2E なしで進むリスク。実ブラウザの redirect / form POST / cookie / URL unfurl は integration test で代替不可。2 phase 持ち越しは優先度判断のみで阻害要因なし。
**tradeoff**: Playwright が staging URL 依存でメンテコスト。GET-safe test と重複 → E2E は 2 ケースに絞り、exhaustive は integration test の役割と明記。

### 提案#4【medium】Codex sandbox 1 回再検証（停止均衡の解除 or 確定）
**変更**: 次 session 開始時（spike より前）に `codex exec "echo hello"` を Bash で実行。成功→ apply_patch 経由ダミーファイル書込テスト→ 環境機能を確定してから Phase 4 以降の委任対象（admin UI CRUD 5 ファイル組・E2E fixture 部分）の候補化を認める。失敗（spawn setup refresh / CreateProcessAsUserW）→ sandbox-blocked で override 記録し Phase 4/5 通じて Claude 固定を確定。どちらも handoff に 1 行記録。
**根拠**: A.2 以前の sandbox 失敗が A.3 以降 22 phase の試行停止を引き起こした可能性（停止均衡）。グローバル §2.5 は apply_patch 経由なら機能と判明済だが A.3 以降の再検証記録なし。1 コマンドで状態確定、コストほぼゼロ。**委任率を上げるのが目的ではなく、Phase 5 で週間制限がバインドしたとき委任経路が使えるかの不確実性解消が目的**。
**tradeoff**: sandbox 成功→委任導入で bundling 効果喪失・1 ターン完遂 streak 崩壊リスク → 委任は「sandbox 成功確認済」かつ「週間制限が実際にバインドした phase のみ」かつ「service 設計を先に完全確定し仕様判断量を低に固めてから」の三条件全充足時に限定。

### 提案#5【medium】Storage bucket policy 再現手順管理規律を spec/CLAUDE.md に 1 行追記
**変更**: spec/CLAUDE.md migration 規律に追記:「Storage bucket 作成 / bucket policy 設定は SQL migration 管理対象外だが、phase-handoff §再現手順に Supabase CLI コマンド or SQL RPC を明記。Phase 4 Storage 連携 phase の DoD に『bucket 作成コマンドを handoff §再現手順に記載済み』を追加」。
**根拠**: 現行 migration 規律は raw SQL に厳格だが Storage bucket policy は dashboard/CLI 操作で再現手順が残らない。R-H-000 Schema Drift Incident と同型の「手順書のない設定変更がドリフトを生む」問題が Storage で起きうる。
**tradeoff**: handoff 行数微増・CLI コマンド陳腐化 → 安定 subcommand（`storage buckets create` 等）に限定。

### 提案#6【low】notification_outbox channel CHECK 拡張を β-4 Day1 の Lane Main タスクに明示
**変更**: roadmap β-4 に追記:「Day1 Lane Main: notification_outbox.channel CHECK を ALTER TABLE で email→email/line/sms に拡張 + outbox dispatcher の channel routing インターフェース設計確定。Day2 以降: LINE/SMS 実装（この migration を前提）」。
**根拠**: channel 型拡張をいつ・どの migration で行うか未明記。migration は Lane Main 専管で Codex 委任不可のため Day1 に集中して詰まる。interface を先に切れば Lane A への並列委任が可能。
**tradeoff**: roadmap 先行確定で設計陳腐化リスク → 方針レベル（「email→enum 拡張 migration が必要」）に留め、具体 enum 値は β-4 着手時に確定と注記。Phase 4 優先のため今すぐ着手不要。

---

## 最適化全体のリスク

- **handoff 薄型化のクラッシュリスク**: 連続 phase での入力契約圧縮（本提案では非推奨・不採用）を将来検討する際、session 途中クラッシュ時に disk handoff が薄すぎて復元不能になる。本提案は /clear あり境界の handoff を変えない。
- **セキュリティチェックリストの checkbox theater**: 提案#1 が形式消化になり、informal な 2 回目 advisor が持っていた「気づかなかった class を拾う」効果が弱まる。各項目を具体的変更名記入形式にして緩和。
- **Codex round-trip による 1 ターン完遂率低下**: 提案#4 で委任導入時、bundling 効果喪失で 23 連続 streak が崩れる。三条件制限で緩和するが週間制限圧力で制限が緩むリスク。
- **Phase 4 spike の設計未確定リスク**: 提案#2 で spike を切っても候補 1 確定にユーザー判断が必要で、応答待ちで spike がブロックされ後続自律進行が遅延しうる。

---

## 推奨採用順（参考）

1. **提案#4（sandbox 再検証）** — コストほぼゼロ、即実施可、以降の判断根拠になる
2. **提案#1（adversarial gate チェックリスト）** — high、A.26 以降の高 stake surface で即効く
3. **提案#2（Phase 4 設計 spike）** — high、A.26 の進め方そのものを決める
4. **提案#3（/r/[token] E2E）** — medium、session 設計前に入れると安全
5. **提案#5（Storage 手順規律）** — medium、Storage 連携 phase の前で十分
6. **提案#6（channel 拡張明示）** — low、β-4 着手前で十分

*Generated by dynamic workflow `optimize-dev-workflow` / 提案のみ・未適用 / Phase 64-A.26 前置き*
