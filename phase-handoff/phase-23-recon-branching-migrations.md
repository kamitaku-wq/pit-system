# Phase 23 Recon: Supabase Branching と raw-migrations 互換性

> Background Codex agent が unresponsive となったため Claude が直接 source-backed で執筆。

## 1. 現 migration 管理状況 (source-backed)

- **raw-migrations 25 ファイル**: `src/lib/db/raw-migrations/alpha-1-public/01_extensions.sql` 〜 `25_close_transport_order.sql` (連番 prefix)。内訳: 01 extensions / 02-17 schema 各テーブル / 18 helper functions / 19 RLS policies / 20 triggers / 21 seed master / 22-23 PII anonymization / audit / 24 vendor RPCs / 25 close_transport_order
- **適用 script**: `src/lib/db/apply-raw-sql.ts` (独自実装、80+ 行)
  - `_raw_migrations(filename PK, applied_at)` トラッキングテーブルで idempotent
  - filename sort 順で逐次 `sql.unsafe(content)` 実行
  - **DIRECT_URL (port 5432, session 接続) 必須** (CREATE EXTENSION / TRIGGER / POLICY が pgBouncer transaction mode で動かないため)
- **Drizzle 経路**: `drizzle.config.ts` は `./src/lib/db/migrations` を out 先に設定、schema 由来の TypeScript 型生成と CRUD 用。**raw-migrations とは別管理**。
- **Supabase CLI**: 未導入 (`package.json` に dep なし)、`supabase/` ディレクトリ不在、`config.toml` 不在
- **既存 `pnpm test` 70/70 PASS** は apply-raw-sql.ts で applied された state 上で動作実証

## 2. Supabase Branching の migration 仕様 (公式仕様)

- `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql` (timestamp prefix 必須) を preview branch に自動 apply
- PR 作成で preview branch 自動生成、PR close で teardown
- `supabase db push` で local→branch、`supabase db pull` で逆方向、`supabase db diff` で乖離検出
- Pro+ プラン: $0.32/day/branch (compute) + storage 課金
- seed.sql / functions / Edge Functions の branch 隔離も可能
- **declarative** (Postgres-only) - extension / function / RLS / trigger すべて SQL 記述可

## 3. 互換性問題リスト

| 問題 | 説明 | 影響 |
|---|---|---|
| 命名規則 | 連番 `01_*.sql` vs timestamp `20251225000001_*.sql` | rename or 別経路必要 |
| ファイル配置 | `raw-migrations/alpha-1-public/` vs `supabase/migrations/` | 移動 or 別経路 |
| トラッキング | `_raw_migrations` table vs `supabase_migrations.schema_migrations` | 状態同期不可、二重管理リスク |
| `config.toml` | 不在 | 新規必要 |
| Supabase CLI | 未導入 | install + CI step 追加 |
| Phase handoff 参照 | Phase 1-22 handoff は `25_close_transport_order.sql` 等を file path で参照 | rename すると履歴文脈断絶 |

## 4. 3 案比較

| 案 | 概要 | Pros | Cons | Cost |
|---|---|---|---|---|
| **A. 全 25 件を supabase/migrations/ に移植** | 連番→timestamp 変換 + 移動 + apply-raw-sql.ts 廃止 | Branching native、`supabase db diff` 等の機能フル活用 | 1-2 day 工数、Phase handoff 参照壊れ、`_raw_migrations` 既 applied 状態との同期手順要設計、新規 raw 追加時の運用切替コスト | **高** |
| **B. raw-migrations 維持 + Branching は env 隔離だけ利用** | `supabase/` 最小構築 (空 `migrations/` + `config.toml`) で preview branch を立て、CI workflow 内で apply-raw-sql.ts を branch DB に向けて実行 | 既存資産そのまま、Phase handoff 整合性維持、apply 経路実証済 | Branching の seed/diff/Edge Function 機能未使用、preview branch は「空 schema + raw apply」になり初回 8-15 分 (25 ファイル apply 時間) | **低** |
| **C. consolidation: 25件を 1 ファイル `00000000000001_initial.sql` 化** | 25 件を結合した initial migration + 以降 declarative | 移行 1 回で済む | initial が ~2000 行でレビュー困難、Phase handoff 参照壊れる、`_raw_migrations` テーブル廃止要 | **中** |

## 5. 推奨案 + 理由

**推奨: 案 B (raw-migrations 維持 + Branching は env 隔離だけ利用)**。

理由:
1. **既存 25 件は phase ごと sealed**: Phase 19/20/22 の handoff が「`24_vendor_rpcs.sql:62-72` 参照」のように具体的 path/line を保持。rename は履歴文脈を破壊
2. **apply-raw-sql.ts は実証済 idempotent**: `_raw_migrations` table 経由で重複 apply 防止、70/70 test 通過の prerequisites
3. **Branching の core value (env 隔離) は得られる**: preview branch + connection string 供給だけで Sprint β の CI E2E 目的 (staging 汚染回避) は達成
4. **Sprint β scope を膨らませない**: 案 A は 1-2 day 追加 = Sprint β 中盤がブロック、recon #1 spot 実装と直列化リスク
5. **将来移行の選択肢を残す**: Sprint γ 以降に case studies 蓄積後、必要なら case A に切替可能 (現時点で固定化しない)

## 6. Branching 特化機能の利用可否 (案 B 採用時)

| 機能 | 案 B での扱い |
|---|---|
| preview branch 自動作成 | ✓ 利用可 (PR triggered) |
| seed/fixture script | △ `supabase/seed.sql` 利用不可、CI で apply-raw-sql.ts + `scripts/seed-vendor-dev.ts` 相当を実行 |
| Edge Function deploy | △ Sprint β 未使用、必要なら別途 |
| Auth + Storage branch 隔離 | ✓ 利用可 (Branching が自動) |
| `supabase db diff` で drift 検出 | × 利用不可 (declarative migration ベースのため) |
| connection string 供給 | ✓ 利用可 (GitHub Actions secret 経由 branch URL injection) |

## 7. 段階分割案

### MVP (Sprint β = Phase 24-26)
- `supabase/config.toml` 最小生成 (project_id のみ)
- `supabase/migrations/` 空 (空でも Branching 動作する想定、要 verify)
- GitHub Actions workflow に Supabase Branching trigger を add
- preview branch URL を E2E job に inject
- E2E job 内で `pnpm tsx src/lib/db/apply-raw-sql.ts` を実行 → spot/vendor migrations apply
- Playwright test 実行

### Extension (Sprint γ 以降、必要時のみ)
- `supabase/seed.sql` 化 (seed-vendor-dev.ts の declarative 版)
- raw-migrations の declarative 化検討 (case A 段階移行)
- Edge Function deploy 統合

## 8. cost 見積もり

### 移行作業
- 案 B MVP: **0.5-1 day** (`config.toml` 生成 + workflow YAML + apply-raw-sql.ts 動作確認、verify は staging で実機テスト 1 PR 分)

### 月額 cost (Pro+ 想定)
- preview branch: $0.32/day/branch (公式 Supabase pricing)
- 想定: PR 平均生存 1 day × 月 100 PR = ~$32/month
- 案 B では preview branch 上で raw apply 時間が +8-15 分追加 → GitHub Actions minutes も微増 (PR 100 × 15min = 1,500 min、Pro+ 無料枠 3,000 min 内)

## 9. 既知の懸念 + Unresolved

- **空 `supabase/migrations/` で Branching が動作するか** = 公式 docs で要 verify。**動作しない場合**は dummy `00000000000001_noop.sql` を置く運用に切替
- **preview branch の apply 時間** = 25 ファイル sequential apply で 8-15 分の見込み。**短縮策**: extension/seed のみ Branching declarative 化 + 残りは apply-raw-sql.ts (ハイブリッド) - 検討は Extension phase
- **PR 並列時の Branching limit** = Supabase Pro+ で同時 preview branch 数の上限 (要 docs 確認)
- **DIRECT_URL (port 5432) を branch から取得できるか** = pooler ではなく direct connection が必要、Branching API が出すのは pooler URL の可能性 → verify 必要、不可なら direct connection 取得手段を設計

### Unresolved (Phase 24 plan で確定)
- Supabase Branching が空 migrations で動作する場合の dummy noop 必要性
- preview branch から DIRECT_URL (port 5432) を取得する手段
- 案 B が想定外の障害 (例: branch teardown 後の `_raw_migrations` 状態残留など) で頓挫した場合の fallback (= 案 C consolidation への切替判断基準)
