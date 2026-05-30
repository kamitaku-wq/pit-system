# Phase 66 plan: 社内ユーザー認証 (Google OAuth + ドメイン許可, 一社専用シンプル方式)

## メタ
| 項目 | 値 |
|---|---|
| Phase | 66 (社内ユーザー登録・認証) |
| 状態 | **実装済 (コード完成)・本番設定待ち** (Google/Supabase 設定 + 実ドメインは納品時) |
| 作成 | 2026-05-30 |
| 起点 | ユーザー質問「実運用でのユーザー登録はどうするのか」 |
| 確定前提 | ① 一社 + 系列店 (複数店舗) ② 会社 Google Workspace あり (@会社.co.jp) ③ **一社のみ提供 = マルチテナント不要 (2026-05-30 ユーザー確定)** |
| 設計方針 | **シンプル方式 (一社専用)**。許可ドメインは設定値で 1 個保持、callback は seed 済 1 社に固定。過剰設計を避ける。 |
| 参照実装 | `C:\Users\kamit\dev\delively_flow` (Google OAuth + 初回 GUEST 自動登録) |

## 背景: 現状の認証実装

| 対象 | 登録経路 | 状態 |
|---|---|---|
| 業者ユーザー (vendor_users) | `/admin/vendors/invite` → `inviteUserByEmail` → パスワード設定 | ✅ 実装済 |
| 社内ユーザー (users) | **無し** (今は seed スクリプトで手動作成のみ) | ❌ 未実装 ← 本 phase |
| 会社 (テナント) | 一社固定、セルフサインアップ不要 | — |

- ログインは `/vendor/login` (共用・`signInWithPassword`) のみ。admin 専用ログイン画面は無い。
- middleware が `/admin/*` 未認証を `/vendor/login?next=` へ誘導、`getAdminUser` が `public.users.role=admin` で判定。
- `getAdminUser` は role=admin のみ確認。**is_active / deleted_at ガード無し** (Codex WARN 既出、本 phase で是正)。
- supabase/config.toml: Google provider 未設定 (`[auth.external.*]` 無し)、site_url=localhost。
- 既存の Supabase client helper: `server.ts` (anon), `browser.ts`, `admin.ts` (service_role)。

## 方針: Google OAuth + 許可ドメイン (一社専用)

会社 Google Workspace の社員だけがワンクリックでログイン。退職者は Workspace 無効化で自動締め出し。
全員が同じ 1 社に属するため会社解決は不要 (seed 済 demo/本番 company に固定)。

### delively_flow との差分 (重要)
delively_flow は「**どの Google アカウントでもログイン可 → 初回 GUEST 自動登録**」。
本システムは一社運用なので **許可ドメイン (@会社.co.jp) 以外はログイン自体を拒否** する fail-closed ゲートを足す。
これがないと無関係な Gmail でも入口が開く (GUEST 止まりでも望ましくない)。

## 設計詳細 (シンプル方式)

### 1. 許可ドメインの保持
- **設定値で 1 個保持**。候補:
  - (a) 環境変数 `ALLOWED_EMAIL_DOMAIN=kaisha.co.jp` (最小、再デプロイで変更)。
  - (b) `company_settings` テーブル (既存, key-value) に `key='allowed_email_domain'` で保持
    (管理画面から変更可能、再デプロイ不要)。← **推奨** (既存テーブル流用、運用で変えやすい)。
- **複数ドメイン対応**: 系列店で別ドメインがあり得るならカンマ区切り (例 `kaisha.co.jp,kaisha-kansai.co.jp`)。
  実装はカンマ split で複数許可にしておくと安全 (一社内の複数ドメインは「マルチテナント化」ではない)。

### 2. ログイン画面 (社内 = Google / 業者 = パスワード)
- 社内スタッフ: 「Google でログイン」ボタン (`signInWithOAuth({ provider:'google', options:{ redirectTo }})`)。
- 業者: 既存のメール+パスワード (vendor_users、外部アカウントで会社 Google を持たないため不変)。
- 実装案 (確定要):
  - **A) 既存 `/vendor/login` に Google ボタンを併設** (最小変更)。
  - **B) 社内専用 `/login` を新設 (Google のみ)、`/vendor/login` は業者専用に整理** (役割分離が明確)。
  → 推奨は **B**。社内/業者の導線・文言を分離でき、middleware の `/admin/*` リダイレクト先も `/login` に
    向けられて綺麗。`/vendor/login` は業者専用に保つ。

### 3. callback 認可ゲート (セキュリティの核, fail-closed) — `/auth/callback` 新設
1. `exchangeCodeForSession(code)` でセッション確立。
2. `user.email` 取得 (Google は検証済だが `email_confirmed` を防御的に確認)。
3. `domain = email.split('@')[1]` を小文字化。
4. **許可ドメイン照合** (設定値と一致するか)。
   - **不一致 → 拒否**: `signOut()` + `/login?error=domain_not_allowed`。← delively_flow に無い安全装置。
5. 一致 → `public.users` を get-or-create (company_id は seed 済 1 社に固定):
   - 既存 (auth uid 一致): is_active=true / deleted_at IS NULL を確認。**無効/削除済 → 拒否** (退職者対応)。
   - 新規: `INSERT users (id=auth uid, company_id=<the company>, email, name=Google displayName,
     role_id='viewer' (最低権限), is_active=true)`。
   - **company_id の取得**: 一社なので「唯一の active company」を SELECT、または設定値で company_id 固定。
     (デモは `code='pitmane-demo'`、本番も実会社 1 社)。
6. `next` (検証済 internal path) へ redirect。既定 `/admin/dashboard`。

- **service_role 利用**: 新規 users INSERT は認証直後 (RLS の `current_user_company_id()` が未確立) ゆえ
  service_role/owner 接続で行う。ADR-0010 の pre-auth service_role 境界に「Google callback の
  user provisioning」を追加 (vendor invitation callback と同型)。

### 4. ロール / 店舗割当 UI (新設 `admin/users`)
- 初回ログインユーザーは `viewer` (最低権限) → 管理者が適切なロール + 店舗を付与するまで閲覧のみ
  (delively_flow の GUEST と同思想)。
- 必要画面: ユーザー一覧 / ロール変更 / 店舗 membership (user_store_memberships) 割当 / 無効化 (is_active=false)。
- spec §1.2「認証フロー (Supabase Auth、社内ユーザー)」「ロール割当」の充足。

### 5. 退職者・無効化対応
- 一次: Workspace でアカウント無効化 → Google トークン取得不可 → ログイン不可。
- 二次 (アプリ側): 管理者が `users.is_active=false` / `deleted_at` → callback ゲート + getAdminUser で拒否。
- **getAdminUser に is_active / deleted_at ガードを追加** (既存 Codex WARN 是正、admin 全 action に効く横断改修)。

### 6. 業者ログインとの干渉防止
- 業者は `signInWithPassword` → vendor portal (`vendor_users`)、社内は Google → `users`。経路もテーブルも別。
- エッジケース: 同一人物が会社 Google と業者パスワード両方を持つ場合は入った導線で role 決定。実害薄。

## ユーザー作業 (dashboard, Claude 不可)
1. **Google Cloud Console**: OAuth 2.0 クライアント ID 作成。承認済みリダイレクト URI に
   `https://ljcruianqmfhpdzvfubl.supabase.co/auth/v1/callback` を登録。
2. **Supabase dashboard**: Authentication → Providers → Google を有効化し client id / secret 投入。
3. **Supabase Auth URL 設定**: Site URL / Redirect URLs に `https://pit-system-jade.vercel.app/**` を追加。
4. 会社の実ドメイン (例 `kaisha.co.jp`) を Claude に伝える (設定値 seed 用、秘密ではない)。

## 実装スコープ (確定後の作業分解, 目安)
| # | 作業 | 層 | 規模感 |
|---|---|---|---|
| 1 | 許可ドメイン設定の読み出し (company_settings or env) helper | lib | 小 |
| 2 | `/auth/callback` route (exchange + ドメインゲート + provisioning) | route | 中 (auth-bypass gate 発火) |
| 3 | ログイン画面 Google ボタン (案 B: 社内 `/login` 新設) | UI | 小〜中 |
| 4 | middleware の `/admin/*` 未認証リダイレクト先を `/login` に整合 | middleware | 小 |
| 5 | `admin/users` 管理 UI (一覧 / role / 店舗 / 無効化) | UI + actions | 大 |
| 6 | getAdminUser に is_active/deleted_at ガード | auth lib | 小 (横断影響注意) |
| 7 | seed: 許可ドメイン設定値 1 個 (本番 MCP or 管理画面) | seed | 小 |
| 8 | テスト (callback 許可/拒否, provisioning, 退職者拒否) | tests | 中 |

## adversarial gate 発火条件 (spec/CLAUDE.md 準拠, seal 前に必須レビュー)
- ② 新規 session 機構の導入: Google OAuth callback は新しい認証経路。
- ⑤ 既存 canonical に当てはまらない認可境界: callback の **ドメインゲート + user provisioning** は
  認証直後に service_role で users を作る新経路。→ seal 前に advisor 2 回目 or Codex adversarial review 必須。
- (①③ は本シンプル方式では非該当: 新規 table / 手書き RLS policy なし。company_settings 流用なら migration 不要)

## マルチテナント将来対応 (今はやらないが崩さない最小配慮)
- 一社確定のためテーブル化はしない。ただし callback の company 解決を「唯一の active company を引く」
  または「設定値の company_id」にしておけば、将来ドメイン→会社テーブルに差し替える際の改修点が
  callback 1 箇所に閉じる (company をベタ書き UUID にしない)。

## 未確定 (実装着手前に決める)
1. 許可ドメイン保持: env か company_settings か (推奨 company_settings = 運用で変更可)。
2. ログイン画面構成: 案 A (併設) か 案 B (社内 `/login` 分離, 推奨) か。
3. 初回ロール: `viewer` 固定で良いか。
4. `admin/users` の操作権限: admin のみか manager も可か。
5. 既存 demo admin (`admin@pitmane-demo.example.com` パスワード) を Google 移行後どう扱うか
   (デモ用に残す / Google 専用にする)。業者パスワードログインは残す。

## 実装完了 (2026-05-30)

### コミット
- `4f9f4f9` Google OAuth ログイン + 許可ドメインゲート
- `cf64218` 社内ユーザー管理画面 (admin/users) + service

### 実装済みファイル
| ファイル | 役割 |
|---|---|
| `src/lib/auth/email-domain.ts` | 許可ドメイン厳密一致判定 (詐称拒否, fail-closed)。unit test 12 件 |
| `src/lib/auth/safe-redirect.ts` | next パスのオープンリダイレクト防止 |
| `src/lib/auth/internal-user-provisioning.ts` | company_settings.allowed_email_domain で会社解決 + users get-or-create (初回 viewer / 退職者拒否)。service_role db |
| `src/app/auth/callback/route.ts` | Google callback: code 交換 → 検証済み email → provisioning。不許可は signOut で拒否 |
| `src/app/login/{page,actions}.tsx` | 社内専用 /login (Google ボタン + パスワード fallback) |
| `src/middleware.ts` | /admin/* 未認証 → /login (業者 /vendor/login と分離) |
| `src/lib/auth/admin-role.ts` | getAdminUser に is_active/deleted_at ガード追加 (退職者締め出し) |
| `src/lib/services/internal-users.ts` | 一覧/ロール変更/有効無効/店舗割当 (company-scoped)。integration test 12 ケース |
| `src/app/admin/users/{page,[id]/page,[id]/actions}.tsx` | 社内ユーザー管理 UI |
| `src/components/layout/admin-shell.tsx` | ナビに「社内ユーザー」追加 |

検証: tsc 0 / next build 成功 / unit 187 passed。

### セキュリティ確認 (ユーザー質問「メールを知っているだけで入れないか」への回答)
2 関門の二重防御で「メールを知っているだけ」では入れない:
1. Google 本体の認証 (アカウントのパスワード + 2FA)。他人のメールを知っていても突破不可。
2. callback の許可ドメインゲート (Google が返す検証済みドメインを厳密一致照合、不一致は成立前 signOut)。
詐称ケース (`x@kaisha.co.jp.evil.com` / `x@evil-kaisha.co.jp` / `x@mail.kaisha.co.jp`) は unit test で拒否を実証。

## 本番稼働に必要な残作業 (実ドメイン確定 = 納品時)
### ユーザー作業 (dashboard)
1. Google Cloud Console: OAuth クライアント ID 作成 + リダイレクト URI
   `https://ljcruianqmfhpdzvfubl.supabase.co/auth/v1/callback` 登録。
2. Supabase: Authentication → Providers → Google 有効化 (client id/secret)。
3. Supabase Auth URL: Site URL / Redirect URLs に `https://pit-system-jade.vercel.app/**`。
4. 会社の実ドメイン (例 `kaisha.co.jp`) を Claude に伝える。
### Claude 作業 (MCP)
5. company_settings に `key='allowed_email_domain'`, value=`["<会社ドメイン>"]` を seed。

※ 実ドメイン確定までコードは完成済みで凍結。納品時に上記 5 ステップで有効化できる。

### 未確定の運用判断 (実害なし、納品前に詰める)
- admin/users の操作は現在 admin のみ (manager 拡張は後で可能)。
- 初回ロールは viewer 固定。
- 既存 demo admin パスワードログインは /login に残置 (Google 設定前の検証用)。

---
*Phase 66 / Claude 2026-05-30 / コード実装完了。本番有効化 (Google/Supabase 設定 + 実ドメイン seed) は納品時。*
