# Phase 65 production deploy — 「動く環境を顧客に見せられる」状態へ

## メタ
| 項目 | 値 |
|---|---|
| Phase | 65 (production / staging=production 統合運用) |
| 状態 | seed 適用済み + ユーザー作業 (Vercel/auth) 待ち |
| 作成 | 2026-05-30 |
| ユーザー要求 | 「動く環境を顧客に見せられる」状態にしたい = production deploy |
| 現 branch | main / phase-64-mvp-implementation |
| production project | `ljcruianqmfhpdzvfubl.supabase.co` (Supabase MCP 直結) |

## 確定した現状 (2026-05-30 調査)

### Supabase 実プロジェクト
- **project URL**: `https://ljcruianqmfhpdzvfubl.supabase.co`
- Supabase MCP が postgres ロールで直結 (RLS bypass 可)。DIRECT_URL (.env.local) 無しでも
  migration/seed/検証を MCP で実行できる。これが今回の主経路。
- step3 plan §6 方針通り **staging = production 1 環境運用** (第一次納品段階)。

### スキーマ状態 — ✅ 最新 (作業不要)
- `_raw_migrations` count(*)=**61** (list_tables の "65" は reltuples 推定のズレ)。
- 適用済み 61 = local 61 ファイルと**完全一致**。post/0029-0033 (C.4 / late-security) も全適用済み。
- companies INSERT trigger 2つ稼働 (transport status / reservation status 自動 seed)。
  **注意**: trigger 本体 (0013/0023) は rejected を is_terminal=TRUE で seed する旧定義。
  0033 の seed 関数 (canonical) は rejected=stall(false)。**新規 company は trigger 後に
  0033 関数を明示呼び + rejected を is_terminal=false へ UPDATE する必要がある** (下記 seed 手順で対処済)。

### データ状態 (調査時)
- 既存 6 companies は全て `__callback_xxx__` = vendor 招待 callback の E2E テスト残骸
  (stores/users 全 0, vendors 2)。顧客デモには不適 → 新規クリーン company を seed (ユーザー選択)。
- auth.users 5 件 (test 残骸、email は MCP から読めず)。デモ用新規メールと衝突しない。
- **テスト汚染の所在**: CI は local Supabase (127.0.0.1) を使う (.github/workflows/e2e.yml) ので
  CI は本番を汚さない。本番残骸は **ローカルから .env.local 経由で test:integration を本番向きに
  実行**したのが原因と推定。→ Phase 65 で integration-setup.ts に localhost ガード追加済 (commit 4866c2a)。

## 実施済み (Claude / MCP 経由)

### ① テスト本番汚染防止ガード (commit 4866c2a)
`tests/_setup/integration-setup.ts`: DATABASE_URL/DIRECT_URL が localhost
(127.0.0.1/::1/0.0.0.0/localhost) 以外を指すと integration test を throw 拒否。
`ALLOW_REMOTE_INTEGRATION_DB=1` で明示解除可。node probe で local 通過 / remote・pooler・garbage 拒否を確認。

### ② demo company + master seed (MCP execute_sql, 冪等)
- company `code='pitmane-demo'` (`ピットマネ デモ`, Asia/Tokyo, JPY) … id=`35f03fd1-6cea-4456-8cc0-3f13ada095c1`
- store `main` (ピットマネ デモ本店) / lane_type `general` / lane `lane-1` (第1レーン, cap 1)
- work_category `maintenance` / work_menu `oil-change` (オイル交換, 30分, ¥5000) / lane_work_menu 紐付け
- reservation_settings (slot 30分, lead 0, advance 90日)
- vendor `デモ陸送サービス` (portal 通知) + vendor_company_memberships (自社, enabled)
- transport/reservation status: 0033 seed 関数を明示呼び + rejected を is_terminal=false へ補正 (canonical 整合)
- **smoke 検証 (確認済)**: active_lanes=1 / lane_menu_links=1 / active_menus=1 /
  reservation_settings=1 / active_vendor_memberships=1 / admin_users=0 (auth seed 前なので 0 が正)。

### ③ 本番 auth ユーザー seed スクリプト (scripts/seed-prod-demo-auth.ts, tsc green)
- Auth Admin API (service_role) で admin/vendor のログインユーザーを作成 + public.users / vendor_users 紐付け。
- demo company (code='pitmane-demo') / vendor (name='デモ陸送サービス') を参照、無ければ throw。
- 安全装置: DATABASE_URL/Supabase host を表示 + `SEED_PROD_CONFIRM=1` 無しでは書き込まない。冪等。
- seed する資格情報:
  - admin: `admin@pitmane-demo.example.com` / `PitmaneDemo!2026`
  - vendor: `vendor@pitmane-demo.example.com` / `PitmaneVendor!2026`
  - ※ デモ後にパスワード変更推奨。

## ★ ユーザー作業 (Claude 不可、dashboard / ローカル実行が必要)

### A. 本番 auth ユーザー作成 (ローカルで 1 コマンド)
`.env.local` が本番 (`ljcruianqmfhpdzvfubl`) の NEXT_PUBLIC_SUPABASE_URL /
SUPABASE_SERVICE_ROLE_KEY / DATABASE_URL を指している状態で:
```
# 1) dry check (host 確認のみ、書き込まない)
pnpm tsx scripts/seed-prod-demo-auth.ts
# → 表示された host が本番か確認

# 2) 本実行
SEED_PROD_CONFIRM=1 pnpm tsx scripts/seed-prod-demo-auth.ts   # PowerShell: $env:SEED_PROD_CONFIRM=1; pnpm tsx ...
```
※ Claude は .env.local secret を読めないため本コマンドはユーザー実行。完了後ログインユーザーが揃う。

### B. Vercel 設定 (dashboard)
1. **Production Branch を `main` に設定** (Settings → Git。歴史的に `phase-42-t4-test-coverage` だった)。
   - 現状 main に C.4 / 64-B / Phase 65 が全 merge 済。main を production にする。
2. **環境変数 (Production scope) を確認/投入**:
   - `NEXT_PUBLIC_SUPABASE_URL` = `https://ljcruianqmfhpdzvfubl.supabase.co`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` / `SUPABASE_SERVICE_ROLE_KEY`
   - `DATABASE_URL` (pooler 6543) / `DIRECT_URL` (5432)
   - `RESEND_API_KEY` / `RESEND_FROM_EMAIL`
   - `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`
   - `NEXT_PUBLIC_APP_URL` = `https://pit-system-jade.vercel.app` (顧客に渡す URL)
   - `NEXT_PUBLIC_SITE_URL` = 同上 (fallback)
   - Turnstile (α は ダミー可): `NEXT_PUBLIC_TURNSTILE_SITE_KEY` / `TURNSTILE_SECRET_KEY`
3. **redeploy** (env 反映のため)。

### C. Resend
- sandbox 制約確認: verified ドメイン/アドレスへのみ送れるか。α は `onresend.com` サブドメイン暫定可。
- `RESEND_FROM_EMAIL` が verified ドメインのアドレスであること。

### D. Inngest
- production の signing key / event key が Vercel env と一致しているか。
- `/api/inngest` が Inngest dashboard に sync されているか (デプロイ後)。

## smoke test (デプロイ + auth seed 後)
1. `https://pit-system-jade.vercel.app/admin/dashboard` → 未認証なら `/vendor/login?next=/admin/dashboard` へ。
2. admin (`admin@pitmane-demo.example.com`) でログイン → dashboard 表示。
3. `/admin/transport-orders/new` で陸送依頼作成 → 業者通知 (outbox/Resend)。
4. vendor (`vendor@pitmane-demo.example.com`) で `/vendor/login` → `/vendor/requests` に依頼が出る。
5. vendor が応答 (accept/reject) → admin dashboard に反映。
6. (任意) 顧客予約 `/r/reserve/35f03fd1-6cea-4456-8cc0-3f13ada095c1` で menus/slots が返るか。

## ログイン経路メモ
- 専用 admin ログインページは無い。ログインは `/vendor/login` (汎用 Supabase signInWithPassword)。
- admin は `/admin/*` にアクセス → middleware が未認証なら `/vendor/login?next=/admin/...` へ誘導 →
  ログイン後 next へ戻る。getAdminUser が public.users.role=admin で admin 判定。
- ログイン直後の既定 redirect は `/vendor/requests` ゆえ、admin は `?next=/admin/dashboard` 経由が綺麗。

## 残課題 / 別 phase
- spec §14.3 フル atomic (予約+依頼同時) は 2 段運用のまま (64-B-full)。
- datetime 順序検証 / getAdminUser の isActive・deletedAt ガード (Codex WARN 申し送り)。
- 既存 `__callback_xxx__` 6 社のクリーンアップは納品時にユーザー実施予定 (RLS 分離で無害)。
- MCP execute_sql の結果表示が途中から truncated になった (クエリ実行は成功、表示のみ)。
  最終 drift 再検証は表示回復時に `docs/operations/seed-new-company.md` の post-check SQL で再確認推奨。

---
*Phase 65 / Claude 2026-05-30 / seed 適用済み・ユーザー作業 (auth seed + Vercel) 待ち*
