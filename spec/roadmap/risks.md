# 段取りくん リスク登録簿 v1 (2026-05-23)

## 0. メタ

- **作成日**: 2026-05-23
- **更新ルール**: Sprint 境界 (各 Sprint 検収ゲート) + リスク発火時に即座追記
- **想定対応者**: Lane Main = Claude (最終判断)、Codex agent = 一次仮説・実装委任

### リスク評価基準

| 評価 | 定義 |
|------|------|
| **High (致命)** | MVP-α 5/31 必達を直接脅かす / データ消失 / セキュリティ事故 |
| **Medium (重要)** | Sprint 内で対応必要、放置で Sprint slip |
| **Low (補強)** | 中長期で対応、MVP-β までに解消 |

---

## 1. High リスク (致命、即座対応)

### R-H-000: Schema Drift Incident (2026-05-24 発火)

**発火**: D-2 動作確認中に `notification_outbox.target_type` の channel/recipient 意味論逆を発見 → advisor 指摘で全 22 ファイル audit → **18 テーブル drift / critical 7 件**
**詳細**: `spec/audit/audit-schema-drift-2026-05-24.md`
**影響**: Sprint α-1 sealed の前提が崩壊、α-2 (5/28-29) を **業者ループ縦切り → reconciliation sprint** に切替 (roadmap.md v1.2)。alpha-core 5/31 release は条件付き (critical 7 reconcile + 業者ループ最小動作で release 判断、未達なら 6/2+ slip)
**critical 7 件**: transport_orders / statuses / vendor_sla_overrides / transport_order_invitations / vendor_selection_logs / notification_deliveries / transport_order_vendor_attempts
**high 11 件**: vendors / vendor_company_memberships / vendor_service_areas / vendor_available_days / status_transitions / notification_rules / reservation_settings / attachments / transport_order_status_history / transport_order_change_logs (+ vendor_available_stores low 1 件)
**根本原因仮説**:
1. E-2 27/27 緑は trigger 発火を検証、列名・意味論は検証外 (advisor 指摘)
2. spec/audit/audit-coverage.md (2026-05-23) Tier 1 修正は spec 側のみ、migration 側追従漏れ
3. alpha-1-public/*.sql は Phase 8/9 Codex 委任、Claude review で spec cross-check 不十分
**対応**:
1. α-2 = reconciliation sprint (critical 7 を DROP+recreate or ALTER で spec 一致)
2. E-2 fixtures / RLS / Drizzle schema 連鎖修正
3. α-3 = 業者ループ縦切り + 条件付き release 判断
4. 今後の migration 委任 prompt に「spec §X.Y を 1 行ずつ照合」必須化
**予防 (恒久)**:
- migration 委任 prompt に spec cross-check を必須化
- Sprint 末で `drift-audit.ts` script 自動実行 (β で実装)

---

### R-H-001: MVP-α 5/31 必達リスク (PoC 未消化)

**発火条件**: Sprint α-0 (5/23-25) 終了時に PoC 16 項目のうち 1 つでも失敗
**検知方法**: 各 PoC の自動テスト結果 + Sprint α-0 検収ゲート
**影響**: 全 MVP-α 計画が崩壊、Phase 2 縦切りリリース不可能
**対応**:
1. PoC 失敗項目を切り離し、該当機能を MVP-β に後ろ倒し
2. ステークホルダー (= ユーザー) に slip 申告 + 縮小スコープ提案
3. Codex 並列レビューで代替案を即時生成

**予防**:
- Sprint α-0 を確実に 2.5 日確保 (他作業を一切入れない)
- Codex 並列で PoC 16 項目を最大 4 並列で消化

---

### R-H-002: Codex 連鎖失敗 / sandbox 障害 / レート枯渇

**発火条件**: Codex 委任 3 回連続失敗 (apply_patch denied, sandbox blocked, レート 429 等)
**検知**: codex-safe-exec.log + delegation-ledger.jsonl 失敗パターン
**影響**: 並列 3 本が事実上 1 本 (Claude のみ) に縮退、開発速度 1/3
**対応**:
1. Lane Main が引き取り (sandbox-blocked reason で override 記録)
2. CODEX_POLICY を balance (80 行閾値) に降格
3. Claude 単独実装に切替 (8 日納期の現実性再評価)

**予防**:
- Sprint α-0 で Codex 動作確認を最初に実施
- worktree 別 sandbox 設定の事前検証

---

### R-H-003: Phase 2 縦切りの RLS 漏洩

**発火条件**: vendor_users が別会社の transport_orders / vendors を SELECT/UPDATE 可能
**検知**: PoC R-RLS テスト + Sprint α-2 完了時の浸透テスト
**影響**: テナント境界違反 = §A.8.11 完全失格、ローンチ不可
**対応**:
1. 即座にローンチ停止、RLS policy 全面再検証
2. helper function (current_user_company_id / current_vendor_user_id) の単体テスト追加
3. ADR-0001 + ADR-0004 再確認、policy 設計書作成

**予防**:
- migration §17 順序厳守 (RLS は最後に enable しない)
- Codex + code-reviewer 並走で policy DDL レビュー

---

### R-H-004: 既存 spec のバグ発覚 (data-model.md / requirements.md)

**発火条件**: 実装中に Phase 1 sealed の spec に矛盾 / 致命欠落発見
**検知**: Sprint α-1 migration 実装中 / Sprint α-2 業務ロジック実装中
**影響**: 仕様再合意 + spec 修正 + 実装手戻り = Sprint slip
**対応**:
1. spec 修正案を Claude が提示 → Codex 第二意見 → ユーザー承認
2. phase-handoff/phase-1.md に修正記録 (sealed 後追記)
3. リスク重大度に応じて DDL 維持 or slip 判断

**予防**:
- TODO 11 件 v2 確定済み + Codex adversarial review 済 (リスク低減済)
- 実装前に各 Sprint で spec 該当部読み合わせ

---

### R-H-005: Vercel / Supabase 本番デプロイ障害 (5/30-31)

**発火条件**: 本番デプロイで RLS policy / Inngest function / Resend webhook が動かない
**検知**: Sprint α-3 smoke test
**影響**: リリース不可、5/31 DDL slip
**対応**:
1. Vercel preview 環境で再現 → fix → 再デプロイ
2. Supabase service_role 経由で migration 手動修復
3. Resend は SES へ緊急切替準備 (Phase 4 で計画していたもの先取り)

**予防**:
- Sprint α-1 末で Vercel preview デプロイ実施 (早期検知)
- Inngest dev mode と prod mode の差分を Sprint α-2 で検証

---

## 2. Medium リスク (Sprint 内対応)

### R-M-001: Worktree マージ衝突 (Lane Main / A / B 間)

**発火条件**: 同一ファイル (migration / 共通 util / 共通 type) を複数 Lane が同時編集
**検知**: rebase 時 conflict
**影響**: マージ作業で Sprint 内時間を消費、最大 0.5 日 slip
**対応**: Lane Main 主導で手動 merge、衝突原因のファイルを次 Sprint で「触れる Lane」明確化
**予防**: migration は Lane Main 専管、shared type は Sprint 頭に一括定義

---

### R-M-002: outbox 重複送信 (idempotency_key UNIQUE 違反)

**発火条件**: dispatcher が同一 outbox row を 2 重 dequeue
**検知**: notification_deliveries に同 idempotency_key で 2 件出現
**影響**: 業者へ同一通知が重複送信、信頼失墜
**対応**: FOR UPDATE SKIP LOCKED 実装確認、retry 条件見直し
**予防**: Sprint α-0 PoC で重複送信 0 件確認 (R-H-001 と連動)

---

### R-M-003: 楽観排他 (version カラム + IF MATCH) の競合多発

**発火条件**: 予約ステータス更新で version 不一致エラーが頻発
**検知**: Sprint α-2 負荷テスト / 本番ログ
**影響**: UI 側で再試行 UX が劣化、業者操作ストレス増大
**対応**: retry 上限 3 回 + conflict 時ユーザー通知 UI 追加
**予防**: 競合多発するテーブルに SELECT FOR UPDATE 検討、PoC で測定

---

### R-M-004: Resend rate limit / 配信遅延

**発火条件**: 一斉通知 (複数業者同時) で Resend 100 req/s 上限超過
**検知**: Resend dashboard + notification_deliveries の failed 件数
**影響**: 業者への通知遅延、予約変更の周知漏れ
**対応**: outbox dispatcher の送信間隔を throttle (100ms/req)、Resend queue 利用
**予防**: Sprint α-0 で Resend API 動作確認、上限値をドキュメント化

---

### R-M-005: Supabase Tokyo region 障害

**発火条件**: ap-northeast-1 でインシデント発生 (RTO > 30 分)
**検知**: Supabase status page + アプリの DB 接続エラー
**影響**: 全機能停止、MVP-α デモ / リリースに直撃
**対応**: ステークホルダーに即時報告、回復まで待機 (フォールバック DB なし)
**予防**: Sprint α-3 前後を避けてデプロイ、事前に status page を監視登録

---

### R-M-006: pg_trgm GIN index の性能問題 (Phase 3)

**発火条件**: 業者検索 (vendor_name LIKE) が 500ms 超
**検知**: Sprint α-3 / Phase 3 性能テスト
**影響**: 画面の体感速度悪化、採用に影響
**対応**: GIN index 再構築 + クエリプラン確認、必要なら Supabase full-text search へ切替
**予防**: Sprint α-1 で migration と同時に GIN index 追加 (後付けは reindex コスト)

---

### R-M-007: §A.8.11 用語ポリシー違反 (顧客向け画面 / メール文)

**発火条件**: UI 文言 / メールテンプレート / docs に「他社」「マルチテナント」「SaaS」「is_shared」が混入
**検知**: Sprint α-3 検収 + 提案先デモ前 grep チェック
**影響**: 顧客向けに競合情報 / 内部構造が露出、契約リスク
**対応**: Codex grep + UI 文言一括置換、メールテンプレート再確認
**予防**: 各 Sprint 末に禁止用語 grep を CI 化 (lint ルール追加)

---

### R-M-008: 業者初回同意フローの法務確認漏れ

**発火条件**: 業者登録時の同意取得フローが法務未確認のまま本番リリース
**検知**: Sprint α-3 検収ゲート
**影響**: 個人情報保護法 / 特定電子メール法の抵触リスク
**対応**: 同意文言を法務確認用ドキュメントに抽出 → ユーザー承認後に実装固定
**予防**: Sprint α-2 で同意文言ドラフトを提出、Sprint α-3 前に確定

---

## 3. Low リスク (中長期対応)

### R-L-001: 監査ログ膨張 (audit_logs / status_history)

audit_logs と reservation_status_history が長期運用で膨張。MVP-β で retention policy (90 日ローリング削除 or アーカイブ) を実装。

### R-L-002: Resend → SES 移行タイミング

月間送信数が Resend 無料枠を超えた時点で SES へ切替。Phase 4 で計画済み。移行手順は ADR として事前策定。

### R-L-003: LINE/SMS 通知の事業者契約遅延

LINE Business / Twilio 契約が MVP-β に間に合わない場合、メール通知のみでローンチ。契約状況を週次確認。

### R-L-004: バックアップ・復旧訓練未実施

Supabase 自動バックアップは有効だが、Point-in-Time Recovery の手順が未訓練。MVP-β リリース後 2 週間以内に復旧ドリル実施。

### R-L-005: 監視・アラート (Sentry / Vercel Analytics) 設定遅延

エラー監視が未設定のまま本番稼働するリスク。Sprint α-3 で最低限の Sentry DSN 設定を必須化。詳細ダッシュボードは MVP-β で整備。

### R-L-006: パフォーマンス劣化 (50 画面の slow query)

画面数増加に伴い N+1 クエリが潜伏するリスク。Phase 3 でクエリプロファイリングを実施、上位 10 件の slow query を修正。

---

## 4. エスカレーションフロー

- **Sprint 内発見**: Lane 担当 (Codex agent) が即座に Lane Main (Claude) に escalate
  - メカニズム: `/codex:rescue` 結果を受け取り、Claude が判定・対応方針決定
- **Sprint 境界**: 検収ゲートで Lane Main が全リスクの状態確認
- **High 発火**: ユーザーに即時報告 (判断仰ぐ)
- **Medium / Low 発火**: リスク登録簿に追記、次 Sprint 計画で対応優先度設定

---

## 5. リスク登録簿の更新ルール

- 毎 Sprint 検収ゲートで全リスクの状態確認
- 新規リスク発火時に即座追加 (発火条件 / 検知 / 影響 / 対応 / 予防 を必ず埋める)
- リスク解消時は「**解消済** (日付 / 解消方法)」と追記、削除はしない (履歴保持)
- High リスクが 3 件以上同時発火した場合は MVP-α スコープ縮小を即時検討

---

## 6. 関連ドキュメント

- `spec/roadmap/roadmap.md` — 本体マトリクス (Sprint 計画 / レーン分担)
- `spec/roadmap/dod-checklist.md` — Sprint 検収ゲート定義
- `spec/roadmap/dependency-graph.md` — タスク依存関係
- `spec/decisions-draft-2026-05-23.md` v2 — TODO 11 件 v2 (本リスク登録簿の前提)
- `spec/codex-review-decisions-2026-05-23.md` — Codex 第二意見 (R-H-004 の根拠)

---

*v1: 2026-05-23 Lane Main (Claude) + Codex 協調作成*
*High 5 件 / Medium 8 件 / Low 6 件 = 計 19 件*
