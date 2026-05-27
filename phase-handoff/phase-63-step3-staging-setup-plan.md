# Phase 63 Step 3 Plan: staging 環境構築ステップ + ユーザー分業

## メタ

| 項目 | 値 |
|---|---|
| Phase 番号 | 63 (step 3 plan) |
| 状態 | plan (ユーザー作業前提確認待ち) |
| 作成日時 | 2026-05-27 |
| 前 step | `phase-63-step2-implementation-state.md` (実装率 32% 判明) |
| Branch | `phase-42-t4-test-coverage` 継続 |

## §1 前提確認 (ユーザー側保有状況、未確認)

step 3 着手前に以下の保有状況を確認:

| 必要リソース | 用途 | 確認質問 |
|---|---|---|
| Vercel アカウント | Next.js hosting | 1.1 既存 / 新規作成必要? |
| Supabase Pro plan (Tokyo region) | production DB + Auth | 1.2 既存 project / 新規必要? local config.toml のみで production project は未存在 |
| Inngest アカウント | outbox dispatcher / inbox worker / invitationExpirer | 1.3 既存 / 新規? |
| Resend アカウント + 送信ドメイン認証 | 業者通知メール | 1.4 既存 / 新規? ドメイン認証済? |
| Cloudflare Turnstile site key | 顧客予約フォーム CAPTCHA (Phase 4 で本格利用、α では不要可) | 1.5 既存 / 新規? α 段階ではダミーで可 |
| カスタムドメイン | 顧客に渡す URL (例: `pit.example-co.jp`) | 1.6 取得済 / Vercel default `*.vercel.app` で渡す? |

## §2 必要な環境変数 (src/ 解析結果)

```
NEXT_PUBLIC_SUPABASE_URL          # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY     # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY         # service_role (Inngest worker / vendor onboarding 用)
DATABASE_URL                      # Supabase pooler (transaction mode 推奨)
DIRECT_URL                        # Supabase direct (migration / Inngest worker 用)
RESEND_API_KEY                    # Resend API key
RESEND_FROM_EMAIL                 # 送信元メアド (認証済ドメイン)
INNGEST_EVENT_KEY                 # (src/lib/inngest/instance.ts で詳細確認要)
INNGEST_SIGNING_KEY               # production signing
NEXT_PUBLIC_TURNSTILE_SITE_KEY    # Cloudflare Turnstile
TURNSTILE_SECRET_KEY              # 同 secret
NEXT_PUBLIC_APP_URL               # 顧客に渡す URL (admin/vendor 共用)
NEXT_PUBLIC_SITE_URL              # 同 (admin-vendor-invitations.ts で fallback)
```

`.env.example` (2216 byte) に存在するが Claude permission 不可、ユーザー側で確認。

## §3 ユーザー作業 vs Claude 作業 分業表

| ステップ | ユーザー作業 | Claude 作業 |
|---|---|---|
| S1 アカウント作成 | Vercel / Supabase / Inngest / Resend / Cloudflare 各種サインアップ | (待機) |
| S2 Supabase project 作成 | Tokyo region で新規 project 作成、anon key + service_role key + pooler URL + direct URL を取得 | `supabase/config.toml` を production 向けに更新する diff 提示 |
| S3 Resend ドメイン認証 | 送信ドメイン (例: `pit.example-co.jp`) を Resend に追加、DNS レコード設定 | (待機) |
| S4 Vercel project 作成 | GitHub repo 接続 + production branch 指定 (例: `main`) | `vercel.json` 作成 + Next.js runtime 設定 + Node.js runtime 固定 |
| S5 環境変数配線 | 取得済 secret を Vercel env vars に投入 (`production` scope) | `.env.example` を最新の env var 一覧に同期 (permission 取得後) |
| S6 production migration 適用 | (なし、Claude 側で実行) | `src/lib/db/raw-migrations/alpha-1-public/00-28` 順序通り適用、`post/0002-0021` 適用、検証クエリ実行 |
| S7 production seed | (なし、Claude 側で実行) | 1 社目 company INSERT + 初期マスター (lane_types / statuses / status_transitions / notification_rules) seed、admin user 1 名招待 (CSV or 直接 INSERT) |
| S8 Inngest production 接続 | Inngest dashboard で signing key + event key 発行 | `src/app/api/inngest/route.ts` の signing 確認 + Vercel Inngest integration 設定 diff 提示 |
| S9 Cloudflare Turnstile (α 段階 optional) | site/secret key 発行 | α では `.env` にダミー投入で動作確認、Phase 4 で本接続 |
| S10 GitHub Actions deploy workflow | (待機) | `.github/workflows/deploy.yml` 新規作成 (production migration 適用 + Vercel deploy トリガー) |
| S11 smoke test | URL 配布前のブラウザ確認 (admin login → 業者招待 → vendor portal login) | Playwright で staging URL に対する 7 spec PASS 確認、CI E2E と同等 |
| S12 ドメイン切替 | Vercel に カスタムドメイン (取得済の場合) 設定、DNS CNAME | (待機) |

## §4 ステップ実行順序

```
S1 (ユーザー)
  ↓
S2 Supabase project → S3 Resend domain → S8 Inngest (並列可)
  ↓
S6 migration (Claude, S2 完了が前提)
  ↓
S7 seed (Claude, S6 完了が前提)
  ↓
S4 Vercel project → S5 env vars (S2/S3/S8 完了が前提)
  ↓
S10 deploy workflow (Claude)
  ↓
S11 smoke test (S4-S10 完了が前提)
  ↓
S12 ドメイン切替 (ユーザー、optional)
```

## §5 ブロッカー候補

| ブロッカー | 影響 | 対策 |
|---|---|---|
| Resend ドメイン認証 DNS 反映遅延 | S3 がボトルネック (24-72h) | 早期着手、α 段階は `onresend.com` サブドメインで暫定可 |
| Supabase pooler URL 取得失敗 | S2 ブロッカー | Supabase dashboard → Database settings → Connection pooling から取得 |
| service_role 漏洩リスク | S5 で誤コミット | Vercel env vars 限定、`.env.local` は `.gitignore` 確認済 (要 Claude 側再確認) |
| production migration 失敗 | S6 ブロッカー | local 環境で migration drift 再現テスト (post/ 0002-0021 順序確認) を事前実施 |
| Inngest worker 接続失敗 | S8 ブロッカー | local 環境で `vercel dev` + Inngest CLI で疎通確認 |

## §6 staging vs production 区別 (用語整理)

ユーザー指示「5/31 第一次納品 = URL を顧客に渡して業務で使える α 版」を満たすには:

- **staging**: 開発者 + 一部顧客テスト用、Supabase Pro plan 1 project、Resend サブドメイン認証で可
- **production**: 顧客が業務で使う、Supabase Pro plan 1 project (staging と統合可)、カスタムドメイン + Resend 本ドメイン認証

5/31 第一次納品段階では **staging = production** として 1 環境で運用する選択肢が現実的 (β-1 移行後に分離)。

## §7 Phase 63 step 3 完了条件

- §1 前提 6 項目すべてユーザー回答済
- §3 分業表 12 ステップすべてに着手担当・順序が確定
- §4 順序図とブロッカーをユーザーが承認
- ユーザー作業 (S1, S2, S3, S4, S5, S8, S9, S12) のオーナーシップ確認
- Claude 作業の事前準備 (Vercel.json / deploy.yml / migration scripts / seed scripts) は step 4 (実装着手) で実施

## §8 Phase 63 step 4 への引継ぎ

step 4 = 残作業の優先順位確定 → Phase 64 以降の実装着手 plan に分割。step 3 完了 (前提 + 分業確定) を待って:

- Phase 64-A: **業者ループ閉鎖必須 9 件** 着手 (整備伝票作成 → 店間整備予約作成 → 業者完了報告 → 予定入力 → 対応不可 fallback 4 種 → 確定モード manual)
- Phase 64-B: **マスター運用必須 4 件** (会社作成シード → 店舗 CRUD → レーン CRUD → 通知ルール)
- Phase 65: staging 環境構築 (本 step 3 のステップ実行、Claude + ユーザー並走)
- Phase 66: smoke test + 5/29 Sprint レビュー材料整形 + 5/31 第一次納品判断

順序は **step 4** で確定 (step 3 完了後)。

## §9 ユーザー回答待ち (§1 前提 6 項目)

1. Vercel アカウント保有? 新規作成必要?
2. Supabase project: 既存 / 新規? (現状 local config.toml のみ、production 未存在)
3. Inngest アカウント保有? 新規必要?
4. Resend アカウント + 送信ドメイン認証: 既存 / 新規? ドメイン認証済?
5. Cloudflare Turnstile: α 段階で導入する? β-1 まで保留可?
6. カスタムドメイン: 取得済? Vercel default `*.vercel.app` で 5/31 渡す?

回答後、step 3 を sealed 化 → step 4 (Phase 64 以降の優先順位確定) に進む。

## §10 Invariants 維持

- typecheck clean / 23 test files / 188 tests PASS
- CI E2E 7/7 PASS
- Phase 1-31 累積機能・bug fix retrogression なし
- Phase 63 step 3 は plan のみ、実装変更 0

---

*Phase 63 step 3 plan / Generated by Claude 2026-05-27 / Awaiting user answers on §9 (6 件)*
