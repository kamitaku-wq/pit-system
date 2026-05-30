# Phase 65 production deploy plan — 「動く環境を顧客に見せられる」状態へ (WIP)

## メタ
| 項目 | 値 |
|---|---|
| Phase | 65 (production / staging=production 統合運用) |
| 状態 | plan + 現状調査途中 (次セッション継続) |
| 作成 | 2026-05-30 |
| ユーザー要求 | 「動く環境を顧客に見せられる」状態にしたい = production deploy |
| 現 branch | main (C.4 / 64-B すべて merge 済み、HEAD=dd0288a 系) |

## 確定した現状 (2026-05-30 調査)

### 接続済み Supabase 実プロジェクト
- **project URL**: `https://ljcruianqmfhpdzvfubl.supabase.co`
- **Supabase MCP がこの remote に直結** → DIRECT_URL (.env.local secret、Claude 読取不可) 無しでも
  MCP の `apply_migration` / `execute_sql` で migration 適用・seed・検証が可能。これが今回の主経路。
- これは phase-63a が「staging live」と呼んでいた環境。§step3 plan §6 の方針通り
  **staging = production 1 環境運用** (5/31 第一次納品段階)。

### スキーマ状態 (list_tables)
- 全 53 テーブル存在、RLS 全 enabled。`_raw_migrations` = **65 行** (raw migration 大量適用済み)。
- **local raw migration = 61 ファイル** (pre 1 + alpha 29 + post 31)。remote 65 行と差異あり
  → **要確認: 適用済みキー一覧 vs local 61 の差分** (特に post/0029-0033 の C.4/late-security が
    remote に当たっているか)。0033/0032/0031/0030 未適用なら vendor フローが壊れる。
  - 65 > 61 の理由候補: poc-12-schema-isolation/ 等の別系列キーが混在、または旧パスキー残存。
  - **調査未完**: `SELECT name FROM _raw_migrations ORDER BY name;` が MCP で結果取得できず中断
    (execute_sql の戻りがツール結果として観測できなかった。次セッションで再試行 or
     `string_agg` で 1 行化して取得)。

### データ状態 (顧客デモのブロッカー)
- **users = 0** → ★ログインできる管理者が居ない (最優先ブロッカー)。
- stores=0 / lanes=0 / work_menus=0 / work_categories=0 / customers=0 / reservations=0
  → 予約を作る前提のマスターが無い。
- companies=6 / vendors=2 / statuses=36 (=6社×6) / status_transitions=42 / lane_types=6 /
  roles=6 / audit_logs=2 → integration test or seed 試行の残骸 (RLS 分離ゆえ無害だがクラッタ)。

### apply-raw-sql.ts の追跡仕様 (適用差分計算に必須)
- 追跡テーブル `_raw_migrations(name text PK, applied_at)`。
- **キー = bare filename** (例 `0033_reopen_rejected_transport_status.sql`、パス含まず)。
- skip 判定 = `SELECT 1 WHERE name = <filename>`。未適用なら 1 TX 内で `tx.unsafe(raw)` 実行。
- **MCP 経由で手動適用する場合の整合手順**: 各 SQL 適用後に
  `INSERT INTO public._raw_migrations(name) VALUES ('<filename>')` を必ず入れる
  (将来 `pnpm db:apply-raw:post` が二重適用しないように)。
- db:setup 順序 = `apply-raw:pre → apply-raw:alpha-1-public → db:migrate(drizzle) → apply-raw:post`。
  - takeover invariant: post/ が alpha-1-public の関数を CREATE OR REPLACE で上書き。
    **alpha 単独再適用は旧(壊れた)定義を復活させる** → 順序厳守。MCP 手動でも post を最後に。

## 「顧客に見せられる」までの GAP (確定分)

1. **migration 同期**: remote `_raw_migrations` を local 61 と突き合わせ、未適用の post/ (特に 0029-0033)
   を MCP `apply_migration` で順番に適用 + `_raw_migrations` 追跡行 INSERT。
2. **admin user seed**: auth.users へ 1 名作成 (Supabase Auth) → trigger で public.users 同期、
   もしくは直接 INSERT。company/role/store membership 紐付け。1 社クリーンなデモ company を新設推奨
   (既存 6 社のテスト残骸は使わない)。
   - 参考 script: `scripts/seed-admin-dev.ts`, `scripts/d2-seed-company.ts`, `docs/operations/seed-new-company.md`。
3. **master seed**: store 1 / lane 1 (+lane_type) / work_category 1 / work_menu 1 (予約を作れる最小)。
4. **vendor seed**: vendor 1 + vendor_user 1 + vendor_company_membership (業者ループ smoke 用)。
5. **NEXT_PUBLIC_APP_URL** を Vercel env で `https://pit-system-jade.vercel.app` に設定 + redeploy
   (★ユーザー作業: Vercel dashboard)。Vercel Production Branch が `main` を指しているか確認
   (歴史的に `phase-42-t4-test-coverage` だった → 要 main 切替)。
6. **Resend**: sandbox 制約 (verified email のみ送信可か) 確認。α は onresend.com サブドメイン暫定可。
7. **smoke test**: admin login → 予約作成 → 陸送依頼作成 → 業者通知メール → vendor portal login → 応答。

## 分業 (再掲 + 今回の更新)
- **Claude (MCP 経由で可能)**: migration 差分適用、seed (company/user/master/vendor)、SQL 検証、
  smoke 用データ確認。← DIRECT_URL 不要、MCP 接続で完結。
- **ユーザー (dashboard 必須)**: Vercel env (NEXT_PUBLIC_APP_URL 他) 投入 + Production Branch=main 確認 +
  redeploy、Resend ドメイン/sandbox 確認、(auth.users 作成を Supabase Auth UI でやる場合)。
  - 対話ログインが要る場合は프롬프트で `! supabase login` 等を案内。

## 高 stake 注意 (実行前にユーザー承認を取る方針)
- remote DB への migration 適用・seed は outward-facing。**プラン提示 → 承認 → 実行**。
- 既存 6 companies / 2 vendors を消さない (RLS 分離・無害)。新規クリーン company を足す。
- service_role / secret は会話・コミットに出さない。

## 次セッションの最初の一手
1. `SELECT string_agg(name, ',' ORDER BY name) FROM public._raw_migrations;` を MCP で取得し、
   local 61 ファイルと diff → 未適用の post/ を確定。
2. 未適用があれば MCP `apply_migration` で順次適用 (+追跡行 INSERT)。
3. seed プラン (クリーン company + admin + master + vendor) を SQL 化してユーザー承認 → 実行。
4. ユーザーへ Vercel env / Production Branch / Resend の作業依頼を 1 リストで提示。
5. smoke test。

---
*Phase 65 plan / Claude 2026-05-30 / 調査途中 sealed (migration diff 取得が次の起点)*
