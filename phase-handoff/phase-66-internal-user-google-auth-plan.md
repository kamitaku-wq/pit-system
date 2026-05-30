# Phase 66 plan: 社内ユーザー認証 (Google OAuth + ドメイン許可リスト, マルチテナント対応)

## メタ
| 項目 | 値 |
|---|---|
| Phase | 66 (社内ユーザー登録・認証) |
| 状態 | plan (設計確定待ち、実装未着手) |
| 作成 | 2026-05-30 |
| 起点 | ユーザー質問「実運用でのユーザー登録はどうするのか」 |
| 確定した前提 | ① 今は一社 + 系列店 ② 会社 Google Workspace あり (@会社.co.jp) ③ **将来は複数社提供の可能性あり (2026-05-30 ユーザー確定)** |
| 設計方針確定 | **テーブル方式 (company_email_domains)** を採用。将来マルチテナント前提が確定したため。 |
| 参照実装 | `C:\Users\kamit\dev\delively_flow` (Google OAuth + 初回 GUEST 自動登録) |

## 背景: 現状の認証実装

| 対象 | 登録経路 | 状態 |
|---|---|---|
| 業者ユーザー (vendor_users) | `/admin/vendors/invite` → `inviteUserByEmail` → パスワード設定 | ✅ 実装済 |
| 社内ユーザー (users) | **無し** (今は seed スクリプトで手動作成のみ) | ❌ 未実装 |
| 会社 (テナント) 自体 | セルフサインアップ無し | ❌ (将来) |

- ログインは `/vendor/login` (共用・`signInWithPassword`) のみ。admin 専用ログイン画面は無い。
- middleware が `/admin/*` 未認証を `/vendor/login?next=` へ誘導、`getAdminUser` が `public.users.role=admin` で判定。
- `getAdminUser` は role=admin のみ確認。**is_active / deleted_at ガード無し** (Codex WARN 既出、本 phase で是正)。

## 方針: Google OAuth + ドメイン許可リスト (data-driven)

`delively_flow` の Google 方式を踏襲しつつ、**「誰でもログインできる」を「許可ドメインのみ」に締める**。
ドメイン→会社のマッピングをテーブル化し、**今は一社だが将来マルチテナントに広げられる**設計にする。

### なぜこの方式か (確定前提との対応)
- 会社 Google Workspace あり → 社員はワンクリックログイン、パスワード管理不要、退職者は Workspace 無効化で自動締め出し。
- 一社運用 → 会社紐付けはドメインで自動解決 (今は 1 ドメイン→1 会社)。
- 将来複数社 → ドメイン→会社をテーブルで持てば、会社ごとにドメインを登録するだけで拡張可能。
  **Google の `hd` (hosted domain) パラメータは使わない** (Google 側で 1 ドメインに固定するとマルチテナント不可)。
  許可判定は必ず自前 callback + DB で行う。Google OAuth クライアントは Supabase project 単位で 1 つ
  (全社共用)、テナント分離は our DB の許可リストが担う。

## 設計詳細

### 1. 新規テーブル `company_email_domains` (マルチテナントの鍵)
```
company_email_domains (
  id          uuid PK default gen_random_uuid()
  company_id  uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE
  domain      text NOT NULL          -- 例: 'kaisha.co.jp' (小文字正規化, @ は含めない)
  is_active   boolean NOT NULL default true
  created_at  timestamptz NOT NULL default now()
  updated_at  timestamptz NOT NULL default now()
  UNIQUE (domain)                    -- ★ドメインは全社で一意 (テナント解決の曖昧性を排除)
)
```
- **UNIQUE(domain) を global** にする理由: 1 ドメインが 2 社に属すると、ログイン時にどちらのテナントか
  決められない。「1 ドメイン = 1 会社」を DB 制約で保証する。
- RLS: 管理者の company-scoped SELECT/CRUD + callback は **service_role で domain 逆引き**
  (認証前は company 未確定 = `current_user_company_id()` が使えないため。ADR-0010 と同型の
  pre-auth service_role 利用境界に追加)。
- seed (今): `INSERT (demo company, '会社の実ドメイン')` 1 行。将来: 会社オンボーディングで追加。

### 2. ログイン画面 (社内 = Google / 業者 = パスワード の共存)
- 社内スタッフ: 「Google でログイン」ボタン (`signInWithOAuth({ provider:'google', options:{ redirectTo }})`)。
- 業者: 既存のメール+パスワード (vendor_users、外部アカウントで会社 Google を持たないため不変)。
- 実装案 (確定要): **A) 既存 `/vendor/login` に Google ボタンを併設** (最小変更) /
  **B) 社内専用 `/login` を新設し Google のみ、`/vendor/login` は業者専用に整理** (役割分離が明確)。
  → 推奨は **B** (社内/業者の導線・文言・ブランドを分離でき、将来のテナント別カスタムにも効く)。
  ただし middleware の未認証リダイレクト先 (`/admin/*` → どのログインか) の整合を取る必要あり。

### 3. callback 認可ゲート (セキュリティの核, fail-closed)
`/auth/callback` (新設) で:
1. `exchangeCodeForSession(code)` でセッション確立。
2. `user.email` 取得。`email_confirmed` 必須 (Google は検証済だが防御的に確認)。
3. `domain = email.split('@')[1]` を小文字化。
4. **service_role で `company_email_domains` を domain 逆引き** (is_active=true)。
   - **不一致 → 拒否** (`signOut()` + `/login?error=domain_not_allowed`)。
     ← これが delively_flow に無い安全装置。未許可 Gmail はログイン自体を通さない。
5. 一致 → company_id 確定。`public.users` を get-or-create:
   - 既存 (auth uid 一致): company_id 一致を確認 (防御) + is_active=true / deleted_at IS NULL を確認。
     **無効/削除済 → 拒否** (退職者対応)。
   - 新規: `INSERT users (id=auth uid, company_id, email, name=Google displayName,
     role_id = 最低権限 'viewer', is_active=true)`。← 初回ログイン provisioning。
6. `next` (検証済 internal path) へ redirect。既定は `/admin/dashboard`。

### 4. ロール / 店舗割当 UI (新設 `admin/users`)
- 初回ログインユーザーは `viewer` (最低権限) で入る → 管理者が適切なロール + 店舗を付与するまで
  閲覧のみ (delively_flow の GUEST と同思想)。
- 必要画面: ユーザー一覧 / ロール変更 / 店舗 membership (user_store_memberships) 割当 / 無効化 (is_active=false)。
- spec §1.2「認証フロー (Supabase Auth、社内ユーザー招待)」「ロール割当」の充足。

### 5. 退職者・無効化対応
- 一次: Workspace でアカウント無効化 → Google トークン取得不可 → ログイン不可。
- 二次 (アプリ側): 管理者が `users.is_active=false` / `deleted_at` セット → callback ゲートで拒否。
- **getAdminUser に is_active / deleted_at ガードを追加** (既存 Codex WARN 是正、本 phase scope)。
  これは admin 全 action に効く横断改修。

### 6. 業者ログインとの干渉防止
- 業者は `signInWithPassword` → vendor portal (`vendor_users` 判定)、社内は Google → `users` 判定。
  経路もテーブルも別。
- エッジケース: ある人物が「会社ドメインの Google」も「業者パスワード」も持つ場合、どちらの導線で
  入ったかで role が決まる (users vs vendor_users)。実害は薄いが plan に明記し、必要なら
  「同一 email が users と vendor_users に併存」時の優先順位を後続で定義。

## マルチテナント将来対応の担保 (本 phase で崩さない不変条件)
1. ドメイン→会社は **テーブル駆動** (ハードコード禁止)。会社追加 = `company_email_domains` に行追加。
2. Google OAuth クライアントは **project 単位 1 つ**を全社共用。テナント分離は our DB 許可リスト。
3. `hd` パラメータを使わない (Google 側ドメイン固定を避ける)。
4. callback の company 解決・provisioning は company_id を**動的に**扱う (特定 company をベタ書きしない)。
5. 将来の会社セルフオンボーディング (Phase 5+): company INSERT + domain 登録 + 初代 admin 指名、の
   足場として company_email_domains をそのまま使える。

## ユーザー作業 (dashboard, Claude 不可)
1. **Google Cloud Console**: OAuth 2.0 クライアント ID 作成。承認済みリダイレクト URI に
   Supabase の `https://ljcruianqmfhpdzvfubl.supabase.co/auth/v1/callback` を登録。
2. **Supabase dashboard**: Authentication → Providers → Google を有効化し client id / secret を投入。
3. **Supabase Auth URL 設定**: Site URL / Redirect URLs に本番 `https://pit-system-jade.vercel.app/**` を追加。
4. 会社の実ドメイン (例 `kaisha.co.jp`) を Claude に伝える (seed 用、秘密ではない)。

## 実装スコープ (確定後の作業分解, 目安)
| # | 作業 | 層 | 規模感 |
|---|---|---|---|
| 1 | `company_email_domains` migration (table + RLS + index) | raw-migration post/ | 中 (adversarial gate 発火: 手書き RLS) |
| 2 | domain→company 解決 service (service_role, pre-auth) | service | 中 |
| 3 | `/auth/callback` route (exchange + 許可ゲート + provisioning) | route | 中 (auth-bypass gate 発火) |
| 4 | ログイン画面 Google ボタン (+ 社内/業者 分離 案 B) | UI | 小〜中 |
| 5 | `admin/users` 管理 UI (一覧 / role / 店舗 / 無効化) | UI + actions | 大 |
| 6 | getAdminUser に is_active/deleted_at ガード | auth lib | 小 (横断影響注意) |
| 7 | seed: 会社ドメイン 1 行 (本番 MCP) | seed | 小 |
| 8 | テスト (callback 許可/拒否, provisioning, 退職者拒否, cross-tenant) | tests | 中〜大 |

## adversarial gate 発火条件 (spec/CLAUDE.md 準拠, seal 前に必須レビュー)
- ① raw-migration 変更あり: `company_email_domains` table + RLS policy 新規。
- ③ 手書き RLS policy 新規作成: company_email_domains の company-scoped policy。
- ⑤ 既存 canonical に当てはまらない cross-tenant boundary: **ドメイン→テナント解決は新しい認可境界**
  (認証前に company を確定する初の経路)。→ seal 前に advisor 2 回目 or Codex adversarial review 必須。

## 未確定 (実装着手前に決める)
1. ログイン画面構成: 案 A (併設) か 案 B (分離, 推奨) か。
2. 初回ロール: `viewer` で確定か (最低権限で provisioning する方針)。
3. 業者ログインを `/vendor/login` のまま残すか、社内 `/login` 新設に伴い導線整理するか。
4. `admin/users` の権限: 誰がロール/店舗を割当可能か (admin のみ? manager も?)。
5. 既存の demo admin (`admin@pitmane-demo.example.com` パスワード) を Google 移行後どう扱うか
   (デモ用に残す / Google 専用にする)。

---
*Phase 66 plan / Claude 2026-05-30 / 設計確定待ち。実装未着手。マルチテナント将来対応を不変条件として組込済。*
