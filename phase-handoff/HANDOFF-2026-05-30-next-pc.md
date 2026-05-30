# 引き継ぎ書 (別PC継続用) — 2026-05-30

> **次セッション最初の指示**: このファイルを読んだら、まず「現状報告」と「どう進めるか相談」から始めること
> (ユーザー指示)。いきなり実装に入らない。

## 0. 最初に読むファイル (この順で)
1. 本ファイル (全体像)
2. `phase-handoff/phase-67-feature-inventory.md` — **機能棚卸し (spec 画面 vs 実装の対応表)**。最重要。
3. `phase-handoff/phase-65-production-deploy-plan.md` — 本番デプロイ状況・デモ資格情報・残作業
4. `phase-handoff/phase-66-internal-user-google-auth-plan.md` — 社内ユーザー Google 認証 (実装済・本番設定待ち)
5. `CLAUDE.md` (project root) + `spec/CLAUDE.md` — 規律。特に「日付・確度を自発予測しない」

## 1. リポジトリ状態 (2026-05-30 時点)
- branch: **main** (origin/main と完全同期 = 0/0、working tree クリーン)
- 最新コミット: `4bb46c7 fix(phase-67): admin ナビを全実装ページに是正 + 機能棚卸し`
- **Vercel Production Branch = main**。main に push すると本番 `https://pit-system-jade.vercel.app` へ自動デプロイ。
- 検証コマンド: `npx tsc --noEmit` / `npx next build` / `npx vitest run --project=unit`
  (integration は localhost Supabase 必須。本番向き DATABASE_URL では汚染ガードが拒否=設計通り)。
- ⚠️ コミットは **tsc+build+test green を目視確認後** に行う規律 (過去の赤コミット反省)。

## 2. 本番環境 (動いている)
- Supabase project: **`ljcruianqmfhpdzvfubl.supabase.co`** (Tokyo, MCP 直結で SQL/seed 可)
- 本番 URL: **`https://pit-system-jade.vercel.app`**
- スキーマ: raw migration 61 件すべて適用済み (最新)。
- demo company: `code='pitmane-demo'`, id=`35f03fd1-6cea-4456-8cc0-3f13ada095c1`
  - master: store 1 / lane 1 / lane_type / work_category / work_menu(visible_to_customers=true) /
    reservation_settings / vendor「デモ陸送サービス」(email=kamitaku@funct.jp) + membership
  - **未投入**: customers 0 / vehicles 0 / service_tickets 0 / transport_orders 0
    (= 陸送依頼 smoke を通すには画面で顧客・車両・整備伝票を先に作る必要)
- デモ資格情報 (本番ログイン可、デモ後パスワード変更推奨):
  - admin: `admin@pitmane-demo.example.com` / `PitmaneDemo!2026` (ログイン → `/admin/dashboard`)
  - vendor: `vendor@pitmane-demo.example.com` / `PitmaneVendor!2026` (`/vendor/login` → `/vendor/requests`)
- ログイン経路: 社内=`/login` (Google ボタン+パスワード fallback)、業者=`/vendor/login` (パスワード)。
  middleware が `/admin/*` 未認証を `/login` へ、`/vendor/*` を `/vendor/login` へ誘導。

## 3. ここまでの到達点
- **Phase 64-B**: 店舗が陸送依頼を作る入口 (`/admin/transport-orders/new`) 実装 → 業者ループが end-to-end で閉じた。
- **Phase 65**: 本番デプロイ (migration 確認 / demo seed / auth seed script / Resend 疎通確認済み /
  テスト本番汚染防止ガード)。本番ログイン可能な状態に到達。
- **Phase 66**: 社内ユーザー Google OAuth + 許可ドメインゲート + admin/users 管理画面。
  コード完成・本番有効化 (Google Cloud OAuth + Supabase Provider 設定 + 実ドメイン seed) は納品時。
- **Phase 67**: ナビ是正 (実装 46 ページ中 7 しか動線が無かった欠落を是正) + 機能棚卸し。

## 4. ★ユーザーが今回指摘した核心課題 (次の主題)
**「店舗ごとのピット状況が全く反映されていない / 簡素すぎる」**

### 事実 (phase-67-feature-inventory.md に詳細)
- 業者通知ループ (Phase 2) は完成。しかし **プロダクト核心の「ピット稼働状況」ビューが未実装**。
- spec では明確に定義済み (screen-list §1.1 店舗別ピット稼働 / §1.2 カレンダー店舗別・レーン別表示 /
  requirements §28 カレンダー / §29.5.1 レーン稼働率)。実装計画上 **Phase 3** = これからのフェーズ。
- 現カレンダー (`/admin/calendar`) は全予約を 1 タイムライン表示のみ。店舗/レーン別フィルタ・
  空き枠ドラッグ作成・ステータス色分け・店間移動/業者手配バッジ すべて無し。
- ダッシュボードは業者対応 3 カードのみ。店舗別ピット稼働カード無し。

### 主要機能ギャップ (優先度順、私見)
1. ★**店舗別ピット稼働状況ビュー** (dashboard §1.1 + calendar §1.2 レーン別)。最大の欠落。整備工場が毎日見る中核。
2. カレンダーの店舗別/レーン別/作業種別フィルタ + ステータス色分け + バッジ (§1.2)。
3. カレンダーからの空き枠ドラッグ予約作成 (§1.2)。
4. レーン稼働率 (requirements §29.5.1)。
5. 管理画面からの店間整備依頼フル atomic (§1.4: 予約+伝票+依頼 1TX、現状は 2 段運用)。
6. 顧客予約一覧画面 (§1.3) / 監査ログ閲覧 (§1.9) / 会社設定 (§3.1) / 予約枠設定画面 (§3.9)。

## 5. 次セッションの進め方 (提案)
1. このファイル + phase-67-feature-inventory.md を読み、**現状を 1 画面分で報告**。
2. ユーザーに「ピット状況ビューから着手するか / 他の優先順位か」を**相談**してから着手。
3. ピット状況ビューに着手するなら: spec §1.1/§1.2/requirements §28/§29.5.1 を再読 → 設計を plan 化
   (店舗別×レーン別の稼働表示データモデル、reservations + lanes + lane_working_hours の集計) →
   advisor/Codex で設計レビュー → 実装。adversarial gate 該当時 (新 cross-tenant 集計境界) は seal 前レビュー。

## 6. 未消化の申し送り (別 phase)
- 業者通知メールの本文レンダリング (cancel/confirm/completed の payload に to/subject/html 無し =
  実メール飛ばない既知ギャップ。phase-64-c3 sealed §2)。業者向けはポータル表示が中核。
- Inngest production 配線確認 (本番 outbox 実績 0、cron 稼働未確認)。Resend 単体は smoke-resend で疎通済み。
- Resend 独自ドメイン認証 (現 from=onboarding@resend.dev のテスト用)。
- datetime 順序検証 / getAdminUser は is_active/deleted_at ガード追加済 (Phase 66)。
- 既存 `__callback_xxx__` 6 社 (E2E テスト残骸、RLS 分離で無害) のクリーンアップは納品時。
- spec §14.3 フル atomic (64-B-full) / 監査ログ閲覧 / 会社設定 / 予約枠設定画面 / 表示項目設定。

## 7. 道具・規律メモ
- Supabase MCP: `execute_sql` (本番直クエリ、auto-mode classifier が credential/破壊操作は要承認)、
  `apply_migration` / `get_advisors` / `get_publishable_keys` 等。
- 本番 auth 検証は anon key で `/auth/v1/token?grant_type=password` を node fetch で叩ける
  (anon key は公開値: get_publishable_keys で取得)。curl は Cloudflare に弾かれることがある→node fetch 推奨。
- Codex 委任 hook: tests/ 等 ≥30 行は block。「仕様解釈が必要なテスト設計」は例外で Claude 可 (理由明示+再実行)。
- `.env.local` は読めない (secret)。本番 seed script は SEED_PROD_CONFIRM=1 ガード付き。

---
*Handoff / Claude 2026-05-30 / 別PC継続用。再開時は現状報告→相談から。*
