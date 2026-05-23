# 段取りくん DoD (Definition of Done) v1 (2026-05-23)

## 0. メタ

- **作成日**: 2026-05-23
- **更新ルール**: Sprint 末に Lane Main (Claude) が該当 Sprint 項目を ✓ に更新。MVP フェーズ変更時はバージョンを v1.x に上げる
- **想定読者**: Lane Main (Claude / 統合判断)、Lane A (バックエンド/DB)、Lane B (フロントエンド/通知)
- **DoD 階層**: Sprint 共通 (§1) → alpha-core 固有 (§2) → mvp-release 固有 (§3) → Sprint 境界検収 (§4)
- **失格時の対応**: roadmap.md §4 参照 (スコープ縮小 / DDL slip / リスク登録簿更新)

---

## 1. Sprint 共通 DoD (全 Sprint 必須、毎 Sprint 末確認)

### 1.1 コード品質

- [ ] `npm run lint` (Biome lint) がエラー 0 件で完了
- [ ] `tsc --noEmit` (typecheck) がエラー 0 件で完了
- [ ] Biome format 適用済み (フォーマット差分なし)
- [ ] `knip` または `ts-prune` で dead code 0 件
- [ ] `console.log` / デバッグ出力が本番コードに残っていない

### 1.2 テスト

- [ ] Vitest unit test カバレッジ 80% 以上
- [ ] Vitest + supabase local の integration test が全グリーン
- [ ] 該当 Sprint のユーザーストーリーに対応する Playwright E2E test を追加・実行
- [ ] 既存テスト全グリーン (regression なし)

### 1.3 レビュー

- [ ] `code-reviewer` agent レビュー実施済み
- [ ] CRITICAL / HIGH 指摘事項を全解消
- [ ] auth / migration / payment に関わる変更は Codex 並走レビュー実施 (`/codex:adversarial-review`)
- [ ] worktree レーン作業の場合、PR を作成して main へのマージ準備完了

### 1.4 セキュリティ

- [ ] ソースコードに hardcoded secret (API キー・パスワード・トークン) が存在しない
- [ ] 新規ユーザー入力は全て zod schema で検証済み
- [ ] 新規 SQL クエリは Drizzle query builder 経由 (文字列結合禁止)
- [ ] PII を `redact_audit_payload()` を通さずに `audit_logs` に保存していない

### 1.5 Git / リリース

- [ ] commit メッセージが規約準拠 (`feat:` / `fix:` / `docs:` / `chore:` 等)
- [ ] main または feature branch へ push 済み
- [ ] Codex 委任分を `delegation-ledger.jsonl` に記録済み

---

## 2. alpha-core 固有 DoD (2026-05-31 必達)

### 2.1 データ層

- [ ] data-model.md §17 の順序で 46 テーブル migration が全て (※ alpha-core 必須サブセット (実装 priority P0/P1) は Tier 2 で別途確定予定) `supabase db push` 完了
- [ ] 全テーブルで RLS `ENABLE ROW LEVEL SECURITY` が有効
- [ ] `current_user_company_id()` / `current_vendor_user_id() IS NOT NULL` helper function が正常動作
- [ ] 全 enum 値・status_transitions・DB trigger の fire を `psql` で確認
- [ ] `reservations` テーブルの exclusion constraint を 100 並列リクエストでテスト (重複 0 件)
- [ ] `vendor_id ⇔ company_id` 整合性 trigger が不整合 INSERT で ERROR を返す
- [ ] `vendor_sla_overrides` と `pii_anonymization_jobs` の INSERT / SELECT が動作

### 2.2 RLS / セキュリティ

- [ ] 別 `company_id` のロールで `vendor_users` / `users` / `customers` / `transport_orders` / `vendors` が SELECT / UPDATE / DELETE 不可 (RLS 漏洩テスト)
- [ ] `service_role` 使用箇所が Inngest worker / migration / 顧客トークン検証 / 監査クリーンアップのみに限定
- [ ] `vendor_users` が `auth.users` と分離されていることを確認 (共用禁止)
- [ ] `customer_reservation_tokens` に raw token を保存せず hash 検証のみで動作

### 2.3 通知 outbox

- [ ] `idempotency_key` UNIQUE 制約 + `FOR UPDATE SKIP LOCKED` で重複配信 0 件を確認
- [ ] outbox retry: `failed` → retry → 成功の遷移を確認、retry 上限到達で `dead_letter` 停留
- [ ] `notification_deliveries` と `vendor_portal_inbox` が分離して独立動作
- [ ] Resend webhook 受信 → outbox `status` 更新が動作

### 2.4 楽観排他

- [ ] `version` カラム付き UPDATE で同時 2 リクエスト中 1 件のみ成功し他は競合エラーを返す
- [ ] 全 UPDATE クエリに `WHERE id = $1 AND version = $2` が含まれていることを grep で確認

### 2.5 監査ログ

- [ ] `audit_logs` への UPDATE / DELETE を trigger が RAISE EXCEPTION で防御 (append-only)
- [ ] `redact_audit_payload()` 経由で PII が redact された状態で保存されていることを SELECT で確認
- [ ] 状態遷移が発生するたびに `status_transitions` trigger が `status_history` に INSERT

### 2.6 業者通知ループ E2E (Playwright)

- [ ] 予約作成 → `transport_orders` 生成 → 業者へ Resend メール送信
- [ ] vendor portal ログイン (`vendor_users` + helper) → 対応可否の回答
- [ ] capture 同意取得 → 引取日時 / 搬入日時 / 返却日時の入力
- [ ] 完了報告 → `status_history` 記録 → `audit_logs` への redact 保存
- [ ] 対応不可フォールバック 4 パス全動作確認: 次候補自動割当 / 顧客希望変更 / 手動切替 / キャンセル

### 2.7 リリース準備

- [ ] Vercel 本番デプロイ完了 + smoke test (主要ルート 200 応答)
- [ ] Supabase Tokyo 本番環境への migration 完了
- [ ] `git tag v0.1.0-alpha` を push 済み
- [ ] GitHub Release ノート公開 (変更概要・既知制限を記載)
- [ ] `spec/verification-checklist.md` の alpha-core 受入項目が全 ✓
- [ ] `docs/vendor-onboarding.md` 作成済み (業者向け初期設定手順)
- [ ] UI / メール本文 / docs に「他社」「マルチテナント」「SaaS」「is_shared」が **0 件** ( で確認)

### 2.8 最小 CRUD / 予約フォーム

- [ ] service_tickets 最小 CRUD (一覧/詳細/作成) 動作
- [ ] vehicles 最小 CRUD (一覧/詳細/作成) 動作
- [ ] reservation 作成最小フォーム (空き枠検索 + 確定) 動作

---

## 3. mvp-release 固有 DoD (Sprint β-1 〜 β-4 で順次達成)

### 3.1 Phase 3 完了基準 (Sprint β-1、β-2)

- [ ] FullCalendar で日表示 / 週表示 / 月表示が動作し、店舗別・レーン別に切替可能
- [ ] 予約枠のドラッグ移動が exclusion constraint と連動して重複を防止
- [ ] `service_tickets` の CRUD (一覧 / 詳細 / 作成 / 更新 / 削除) が全動作
- [ ] `vehicles` + `vehicle_ownerships` の CRUD が全動作
- [ ] `customers` / `vehicles` / `service_tickets` への partial GIN インデックス検索が動作
- [ ] `phone_normalized` GENERATED ALWAYS カラムが INSERT / UPDATE で自動生成

### 3.2 Phase 4 完了基準 (Sprint β-3、β-4)

- [ ] 顧客予約フロー E2E: 公開 URL アクセス → 入力 → メール認証コード → 予約確定
- [ ] `customer_reservation_tokens` が署名付き・有効期限付きで発行・検証
- [ ] Cloudflare Turnstile + IP / メール / 電話番号ごとの rate limit が動作
- [ ] LINE / SMS 通知拡張の統合テスト (Twilio または後追加プロバイダー)
- [ ] PII 匿名化 cron が毎日 03:00 JST に起動し `scheduled_for` 経過分を処理
- [ ] `v_accounting_audit_trail` view の SELECT が正しい集計を返す

### 3.3 リリース準備 (mvp-release 末)

- [ ] `git tag v1.0.0` を push 済み
- [ ] `spec/verification-checklist.md` の mvp-release 受入項目が全 ✓
- [ ] `docs/index.html` を本番版 UI スクリーンショットで更新
- [ ] Sentry エラートラッキング + Vercel Analytics が本番環境で有効

---

## 4. Sprint 検収ゲート (Lane Main = Claude が判定)

各 Sprint 末に以下を全項目チェックしてから次 Sprint に進む:

1. **Sprint 共通 DoD 全項目 ✓** (§1 の全チェックボックス)
2. **Sprint 固有タスク全完了** (roadmap.md §1 の該当 Sprint タスク表)
3. **次 Sprint 入力契約クリア** (roadmap.md §1 の Sprint 境界 handoff 要件)
4. **リスク登録簿更新済み** (risks.md §5 のルールに従い新規 High リスクを登録)

### 失格時の対応

- **スコープ縮小**: 未完了機能を後続 Sprint へ後ろ倒し (roadmap.md を更新)
- **DDL slip**: alpha-core 期限 (2026-05-31) は slip 禁止。mvp-release は 1 Sprint 以内なら許容
- **リスク登録簿**: 新規 High エントリを risks.md に追加
- **ユーザー報告**: 判定できない場合は AskUserQuestion で再判断を仰ぐ

---

## 5. 関連ドキュメント

- `spec/roadmap/roadmap.md` — Sprint 計画・タスク表・フェーズ定義
- `spec/roadmap/risks.md` — リスク登録簿
- `spec/roadmap/dependency-graph.md` — タスク依存グラフ
- `spec/verification-checklist.md` — 受入テスト原典
- `spec/implementation-plan.md §17` — DoD 上位定義 (本ファイルの親)

---

*v1: 2026-05-23 Claude + Codex 協調作成*
