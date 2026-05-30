# Phase 64/65 入力契約: Phase 63a 外部設定 (Vercel staging deploy) sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 63a (sub-phase of 63、前: 63 sealed) |
| 種別 | **外部設定 + staging deploy 確認 Phase** (ユーザー作業中心、Claude ガイド + handoff) |
| 状態 | **sealed** (env audit + Vercel project 作成 + production branch 切替 + deploy 成功 + middleware 確認) |
| 完了日時 | 2026-05-27 |
| 担当 | Claude (env audit ガイド + Vercel ガイド + deploy 検証) + ユーザー (ブラウザ操作 / Vercel UI / env 投入) |
| 前 handoff | `phase-63-overall-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 63a で +1 commit 予定: 本 seal) |

## 達成したこと (Phase 63a)

- **env 設定状況 audit 完了** (check-env.ps1 で全 13 keys 確認、Supabase/Resend/Inngest = 実 key 投入済、Turnstile = test key のまま、App URL = localhost のまま)
- **Vercel project `pit-system` 作成完了** (GitHub repo import、URL: `https://pit-system-jade.vercel.app`)
- **Vercel env 13 keys 投入完了** (.env.local の値をユーザーが Vercel UI で投入)
- **Production Branch 切替完了** (Settings → Environments → Production → Branch Tracking で `main` → `phase-42-t4-test-coverage`)
- **手動 trigger deploy 成功** (Vercel docs 最新版に基づく Branch-Based Deployment)
- **middleware 動作確認** (`/admin/dashboard` → 307 redirect → `/vendor/login?next=/admin/dashboard`、`/vendor/login` 200、auth gate 有効)

## env 設定状況 (production-ready 判定)

| service | 状態 | 備考 |
|---|---|---|
| Supabase | ✓ remote (Tokyo region 推定) | URL +32 chars / ANON_KEY +200 chars JWT / SERVICE_ROLE +211 chars JWT / DATABASE_URL +117 chars (pooler) / DIRECT_URL +102 chars (direct) |
| Resend | ✓ 実 API key (`re_Mz1ZN...` +28 chars) | FROM_EMAIL = `onboarding@resend.dev` sandbox mode、本番ドメイン送信は domain verify 必要 |
| Inngest | ✓ EVENT_KEY (`UbDukYq_...` +78) + SIGNING_KEY (`signkey-...` +69) | dev / prod 区別は Phase 65 で確認 |
| Cloudflare Turnstile | ✗ test key `1x000000...` のまま | α-core (Phase 2) では未使用 (顧客予約 Phase 4 で必要)、本 Phase OK |
| App URL | ✗ `http://localhost:3000` のまま | Phase 65 で `https://pit-system-jade.vercel.app` に切替要 (Resend auth callback / signed URL 用) |

## staging deploy 確認結果

| URL | HTTP | 解釈 |
|---|---|---|
| `/` | 200 | HOME 表示 (古い文言「Sprint α-0 着手準備中」、修正未) |
| `/admin/dashboard` | 307 → `/vendor/login?next=...` | **middleware auth gate 動作** |
| `/admin/transport-orders` | 307 | 同上 |
| `/vendor/login` | 200 | login ページ live |

→ **alpha-core 実装 (phase-42-t4-test-coverage 114 commits ahead of main) が staging に live**

## Claude 側の主要設計判断

1. **Vercel UI 最新情報を WebFetch で確認**: 古い「Settings → Git → Production Branch」記憶を撤回、最新 docs (2026-03-12) で「Settings → Environments → Production → Branch Tracking」を確認、ユーザー指摘で訂正反映
2. **check-env.ps1 スクリプト化**: PowerShell 5.1 対話モード複数行入力崩れ + 日本語コメント Shift_JIS 化け + format string parser 罠の 3 連続 issue を ASCII + 文字列連結方式で回避
3. **Production Branch 変更後の手動 deploy trigger 必要性**: Vercel 標準動作 (設定変更だけでは deploy せず、新 push か Create Deployment 必要) を最新 docs から取得して案内
4. **alpha-core release scope の確認**: Phase 63 sealed §step 3 §9 が想定した「staging 外部設定 (ユーザー別セッション進行中)」が本 Phase 63a であることを認識、scope 整合
5. **Phase 65 への引き継ぎ**: production migration + seed + App URL 更新は Phase 65 別セッションで実施、本 Phase 63a で seal

## Phase 41-63a 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-31 | Phase 31-A〜61 | 39-61 | (前 sealed.md 参照) |
| 32 | Phase 62 release pre-flight | 62 | 6 lane 並列調査 + addendum (deployment ゼロ訂正) |
| 33 | Phase 63 verification-checklist 仕分け | 63 | 実装率 32% 訂正 + Phase 64-66 分割確定 |
| **34** | **Phase 63a 外部設定** | **63a** | **Vercel staging deploy live (alpha-core 114 commits 全部含む)** |

## 残課題 / Phase 64/65 todo

### Phase 65 staging 構築の残作業 (本 Phase 63a で着手しない)

1. **production Supabase migration 適用** (raw-migrations 0001-0021 + alpha-1-public 全件、`drizzle-kit migrate` or 手動)
2. **初期 seed** (admin user 1 / vendor user 1 / 業者 1 / 店舗 1 / レーン 1 / 作業メニュー 1)
3. **NEXT_PUBLIC_APP_URL を Vercel URL に切替** (Vercel env で `https://pit-system-jade.vercel.app` に更新)
4. **smoke test** (login → 予約作成 → 業者招待 → メール送信確認)
5. **Resend sandbox 制約確認** (recipient restriction / verified email へのみ送信か)
6. **Supabase Tokyo region 実機確認** (DATABASE_URL host 部分検証)

### Phase 64 機能実装 (別セッション、別 branch)

Phase 63 sealed §step 4 のとおり:
- 64-A 整備伝票/車両 (8-12 files)
- 64-B 予約 TX (5 files、advisor / codex:adversarial-review ゲート要)
- 64-C 業者ループ閉鎖 (6-8 files)
- 64-D マスター UI (8-12 files)
- 64-E 業務効率 (3-5 files)

## Phase 64/65 入力契約

### 参照すべきファイル

- 本 handoff (`phase-63a-external-setup-sealed.md`)
- `phase-63-overall-sealed.md` (Phase 63 統合)
- `phase-63-step3-staging-setup-plan.md` (staging 12 ステップ、Phase 65 で実行)
- `phase-63-step4-implementation-priority-plan.md` (Phase 64-66 分割詳細)
- `.env.local` (env 真の源、Phase 65 で Supabase / Resend / Inngest dashboard と突合)
- `scripts/check-env.ps1` (env 診断スクリプト、Phase 65 で再利用可)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能すべてに retrogression なし
- typecheck clean / 23 test files / 188 tests PASS
- CI E2E 7/7 PASS (`phase-42-t4-test-coverage`)
- 既存 invariants 全件 (Phase 43-63 確定)
- **Vercel project `pit-system` 設定維持**: Production Branch = `phase-42-t4-test-coverage`、env 13 keys 投入済
- **staging URL live**: `https://pit-system-jade.vercel.app/vendor/login` 200 維持

### Phase 65 着手時の最初の判断

1. Supabase Dashboard で migration 適用状態確認 (適用済か未適用か)
2. 未適用なら `drizzle-kit migrate` で raw-migrations 順次適用 (順序は spec/data-model.md §17)
3. seed script 作成 (`tests/_helpers/seed-admin-e2e.ts` 参照、production 向け minimal 化)
4. Vercel env で `NEXT_PUBLIC_APP_URL` を `https://pit-system-jade.vercel.app` に変更 + 再 deploy
5. smoke test (Playwright 手動 or curl)

### 注意点

- branch: `phase-42-t4-test-coverage` (Phase 64 着手時に `phase-64-mvp-implementation` へ切り出し予定、Phase 63 sealed §残課題)
- Vercel project URL: `https://pit-system-jade.vercel.app` (固定)
- Resend sandbox mode: 顧客実メール送信は domain verify 必要、α-core 段階は社内テストメール想定で許容
- Cloudflare Turnstile test key: 顧客予約フロー (Phase 4) で本番 key 必要、本 Phase スコープ外

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 63a commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 (`scripts/check-env.ps1`) + 1 (本 sealed) = 2 files (src 0、機能変更 0) |
| 修正済 latent bug / 機能追加 | 0 (外部設定 Phase) |
| advisor 呼び出し | 0 (Phase 63 sealed の advisor 助言を継承) |
| Codex 委任 task 数 | 0 (ユーザー作業 + Claude ガイドで完結) |
| WebFetch 使用 | 1 (Vercel docs 最新 Production Branch 設定確認) |
| Vercel deploy 成功数 | 2 (初回 main / 再 deploy `phase-42-t4-test-coverage`) |
| staging URL live 確認 | ✓ middleware 動作 |
| env keys 投入 | 13 |
| 未消化 staging 残作業 | 6 件 (Phase 65) |
| MVP blocker 解消 | 0 (機能実装は Phase 64) |

## 振り返りメモ

- **Phase 63 sealed §step 3 §9 「ユーザー別セッション進行中」の正体が本 Phase 63a**: 別セッションで進められていた Phase 63 sealed が想定した「外部設定の進行中ステータス」が本 Phase で完了状態に更新
- **Vercel UI 最新情報の Claude 知識欠落**: 「Settings → Git → Production Branch」古情報で 2 回案内失敗、ユーザー指摘で WebFetch → 「Settings → Environments → Production → Branch Tracking」最新情報取得、Claude の知識更新タイミングと UI 変化のラグを実感
- **PowerShell 5.1 の罠連続**: 対話モード複数行入力 + 日本語コメント文字化け + format string parser、3 連続で issue を出してから ASCII + 文字列連結で安定。Windows env での スクリプト配布は ASCII + 動作確認済 PS 1.0+ 構文が安全
- **alpha-core staging live の意味**: 顧客への URL 共有はまだ早い (DB seed 未 / 機能 32%) が、開発側で「動く環境」を持てた価値は大きい。Phase 64/65 で seed + 実装が揃えば 5/31 第一次納品が現実視野に入る (Claude の予測ではなく事実列挙)

---

*Phase 63a sealed / Generated by Claude 2026-05-27 / 次セッション: Phase 64 (新 branch) or Phase 65 (本 branch で staging migration + seed) / ユーザー判断で順序決定*
