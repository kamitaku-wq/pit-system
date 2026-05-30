# Phase 69 進捗トラッカー (自律実行・随時更新)

> 目的: 一晩の自律実行の進捗をコンパクション耐性のある形で保持。各ストリーム/コミット後に更新。
> 計画: phase-69-beta-parallel-plan.md (v2) / 監査: phase-68-feature-audit.md

## 環境の事実 (重要)
- **ローカルDB無し** (Docker未稼働 / supabase CLI無 / .env.local無)。→ integration test / migration適用 / 視覚適合 は**実行不可・保留**。
- 緑ゲート(実行可能): `pnpm typecheck` + `pnpm test`(unit) + `bash scripts/gate.sh pnpm build`(ダミーenv)。
- 本番DBには触れない。secrets入り.envは作らない。
- baseline: typecheck緑 / unit 91 passed / build緑(ダミーenv)。

## DB依存で保留中の検証 (起床後に実施・重要度順)
- [ ] **最優先**: `pnpm db:setup` で migration 適用 (新規 post/0034_statuses_color.sql ほか)。
      ※ 0034 の backfill CASE は seed の key を推測。不一致でも color=NULL→フロント既定色で正しく描画されるので「直さなくて良い」。
- [ ] `pnpm test:integration` 実行 (S1: transport-orders payload非空アサーション含む)
- [ ] **S1 実送信確認**: 業者 email 設定済 vendor で回送依頼作成 → Inngest/Resend で実メール着信確認
- [ ] 視覚適合: `pnpm dev` 起動 → demo核心画面スクショ → confirmed PNG 比較

## ストリーム進捗
### S0 Schema/Contract Spine (main直列)
- [x] **S0a statuses.color** (0034 migration + schema + status-color.ts helper + services passthrough + unit5) ✅ commit f2fb7d3
- [~] S0b version×4 → **handoff に延期** (DB必須のIF-MATCH配線。migration+error+配線を一括でDB検証する方が安全)
- [x] **S0c invitation expirer** (transport_order_invitations expired化 + inngest統合 + unit+2) ✅ commit次
- [x] **S2 稼働率 service** (pit-utilization.ts 計算コア + unit10) ✅ commit f542df3
- [ ] S0d contract固定 (vendor-portal-orders.ts IF は S3 着手時)

### S1 Notification Critical Path (高stake・Claude)
- [x] **業者メール描画層** (vendor-emails.ts builder + service payload配線 + dispatcher欠損ガード + unit7 + integration契約) ✅ commit dad6c7a
      ※ 規約逸脱: React Email でなく repo規約のインライン文字列(dispatcher直読み)に統一。
      ※ 初回招待(invite)のみ実装。cancel/reopen/confirm の業者メール描画は未実装(別途)。

### S2 Admin Core (このセッション)
- [ ] 稼働率service / ①dashboard / ②calendar / ③floor board / ④予約作成§2薄縦切り

### S3 Vendor Portal (contract-first→Codex)
- [ ] 3a shell/contract / 3b inbox・detail / 3c list/respond/progress/invite

### S4 Settings/Ops (Codex)
- [ ] 権限matrix / 通知失敗UI日本語化 / statuses.color UI / version IF MATCH配線

## コミットログ (このセッション)
- c598207 docs(phase-69): 監査+計画v2+レビュー+進捗
- f2fb7d3 feat(phase-69): statuses.color (S0a)
- dad6c7a fix(phase-69): 業者通知メール描画層 (S1)
- f542df3 feat(phase-69): 店舗別ピット稼働 集計 service (S2 core)
- (次) feat(phase-69): transport invitations 期限切れ (S0c)

## 未解決・要判断 (起床後)
（なし）
