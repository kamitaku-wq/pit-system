# Phase 64-A.34 TTL purge job (rate_limit_counters + reservation_verification_codes) sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-A.34 (前: A.33 Turnstile + IP/global 送信レート制限) |
| 状態 | **sealed (CI green が最終 gate)** — local: typecheck clean / unit 79 PASS / next build 0err0warn / prettier 変更ファイル clean。**integration は local Supabase 使用不可 (.env.local エンコーディング異常で supabase CLI がパース不可) のため CI で検証** |
| 担当 | Claude (advisor 3 + 敵対的レビュー: Codex 独立 GO + workflow 7 agent。MEDIUM 1 を反映。block override 1 件 = test 設計の仕様判断密度高による自実装) |
| Branch | `phase-64-mvp-implementation` |
| **migration** | **post/0027** (purge 関数、CI 適用) + **manual/0007** (pg_cron schedule、本番専用・手動) → adversarial gate #1 (raw-migration) **該当** |
| **CI gate** | local Supabase 不可のため、**push 後の e2e.yml run (db:setup で 0027 適用 + integration test) の green が seal の実検証 gate**。本 seal は CI green 確認をもって確定する |
| **/clear 推奨** | **推奨** (次 A.35 または公開 surface 露出残作業) |

## スコープ

A.33 seal prerequisite #2 (`rate_limit_counters` の purge job 整備、無限増殖防止) を解決。`rate_limit_counters` と `reservation_verification_codes` の両テーブルの `expires_at < now()` 行を定期 purge する仕組みを配線 (spec §3.8/§3.9 / handoff `phase-64-a33-rate-limit-turnstile-sealed.md` #2)。両テーブルの `expires_at` index は A.32a/A.33 で purge 用に先行定義済だった。

## 実装 (新規 2 + 既存改修 3 + テスト 1)

- **`post/0027_purge_expired_reservation_rows.sql`** (新規): `public.purge_expired_reservation_rows()`。両テーブルの `expires_at < now()` を DELETE し削除件数 `(rate_limit_deleted, verification_codes_deleted)` を返す。**CI の db:setup で適用される** (pg_cron 非依存)。
- **`manual/0007_schedule_purge_cron.sql`** (新規): `CREATE EXTENSION pg_cron` + `cron.schedule('purge-expired-reservation-rows', '*/15 * * * *', ...)`。**本番専用・Dashboard SQL Editor (postgres) で手動適用 + `_raw_migrations` 手動記録** (`0006_auth_trigger.sql` の作法踏襲)。`pnpm db:apply-raw:post` では適用しない。
- **`tests/integration/db/purge-expired-reservation-rows.integration.test.ts`** (新規): `withRollback` で全 INSERT + 関数呼出を 1 tx に閉じ rollback。過去/未来 expiry 行を一意キーで挿入し、purge 後に過去行消失・未来行残存を **存在/不在で検証** (絶対件数非依存) + 返却 count >= 1。
- **`reservation-verification-codes.ts`** (改修): 敵対的レビュー MEDIUM fix。`TTL_MIN_MINUTES` を `ISSUE_RATE_WINDOW_MINUTES` (=10) に引き上げ + module-load 不変条件 assert を追加 (下記)。
- **schema コメント×2 / spec data-model.md** (改修): 「先行定義」→「A.34 配線済」、prerequisite #2 を解決済みに、TTL 範囲を 10〜60 分に更新。

## 設計判断 (敵対的に突かれて確定)

| 判断 | 内容・根拠 |
|---|---|
| **purge ロジックと pg_cron を分離** | 関数 (post/0027) は pg_cron 非依存 → CI local Supabase で安全に適用・integration test 可能。`CREATE EXTENSION pg_cron` + `cron.schedule` (manual/0007) は CI local Supabase で `shared_preload_libraries` 未設定だと失敗しうるため本番専用に隔離 |
| **SECURITY INVOKER (DEFINER ではない)** | cron job は postgres ロールで走る (Dashboard superuser で schedule)。**経験的確認済**: 両テーブルは postgres 所有 + `relforcerowsecurity=false`、かつ postgres は `rolbypassrls=true` (service_role も) → INVOKER でも RLS bypass で DELETE 可、silent no-op 経路なし。DEFINER は機能利得ゼロで権限昇格面のみ増やすため不採用 |
| **`SET search_path = ''` + schema 修飾** | search_path injection を構造的に封じる (`now()` は pg_catalog 暗黙 path)。Supabase security advisor `function_search_path_mutable` 回避 |
| **`REVOKE EXECUTE FROM PUBLIC, anon, authenticated`** | PostgREST RPC 経由の呼出を遮断 (defense-in-depth)。漏れても削除対象は expired (無価値) 行のみ = blast radius nil |
| **削除述語は `expires_at < now()` のみ** | consumed_at 状態は問わない (expired 行は verify が必ず弾く)。両テーブル参照 FK は実 DB で **0 件確認済** ゆえ CASCADE/RESTRICT の阻害なし |
| **customer_reservation_tokens は対象外** | spec line 275 で GC を「将来別途」と明示繰延 = A.34 スコープ外 |
| **test は withRollback 隔離** | グローバル purge を呼んでも commit されず並走テスト汚染ゼロ。既存テストは未来 expiry 行を使うため purge 対象外 (二重に安全) |

## 敵対的レビュー (gate #1 該当 → Codex 独立 + workflow 並走)

- **Codex 独立**: **GO** (確信度 86%、CRITICAL/HIGH なし)。CI 安全性・search_path・REVOKE 対象ロール存在・INVOKER+postgres の RLS bypass・withRollback 隔離をすべて確認。
- **Workflow 7 agent (5 観点 → 懐疑検証)**: 確定 finding **MEDIUM 1 件 → 反映済**。

**反映済 [MEDIUM]**: *発行レート guard が purge で無効化されうる TTL 条件*。`issueVerificationCode` の発行レート guard は `created_at > now() - ISSUE_RATE_WINDOW_MINUTES` (10分) で行を数える (consumed_at フィルタなし=意図的)。purge は `expires_at < now()` で削除するため、**TTL < 10 分 のとき** コードが guard 窓終了前に expire し purge に削除され、guard カウントが欠落して発行制限を回避できる。`rate_limit_counters` は `expires_at = window_start + window*2` の余裕で同問題が起きない非対称。
- **現状 exploitable ではない**: 本番唯一の呼出元 `requestReservationVerificationCode` は `ttlMinutes: DEFAULT_TTL_MINUTES`(=10) のみを渡す。schema が `min(1)` を許すため将来の呼出元で活性化しうる latent な弱体化で、**本 A.34 の purge が活性化ベクタ**。
- **fix (Option A loud)**: `TTL_MIN_MINUTES = ISSUE_RATE_WINDOW_MINUTES` に引き上げ (TTL>=窓 を強制 → 行は guard 窓を必ず生き延びてから purge 可能) + **module-load 不変条件 assert** (`TTL_MIN_MINUTES < ISSUE_RATE_WINDOW_MINUTES` で throw。DB 不要、build/test/import で発火し将来の drift を fail-fast)。purge SQL に窓定数を埋め込む Option B (TS→SQL の silent coupling) より、TS→TS で自己検証できる本方式を採用 (advisor 判断)。`consumed_at IS NULL` は guard に追加しない (consumed を数えるのは意図的=再発行でカウントをリセットさせないため)。

## 本番露出 prerequisite (A.33 から更新)

公開 surface 本番露出の hard 依存 3 件のうち **#2 (purge job) を本 A.34 で解決**。残 2 件:

1. **non-Turnstile route の per-company 可用性 DoS は IP 源の信頼性に依存** — 本番 deployment の IP 信頼境界 (Vercel `x-real-ip` / `ipAddress()` 非偽装性) を露出前に要検証 (A.33 から不変)。
2. ~~purge job~~ **解決済 (A.34)**。ただし本番で **`manual/0007` を Dashboard SQL Editor (postgres) で手動適用** + `_raw_migrations` 手動記録が必要。適用後 `SELECT * FROM cron.job WHERE jobname='purge-expired-reservation-rows';` で登録確認。
3. **本番 Turnstile 実キー** provisioning (A.33 から不変)。

## invariants (A.35 / 後続で壊さない)

- typecheck clean / unit 79 PASS / next build 0err0warn / prettier clean。**integration は CI green が gate** (local 不可)。
- `public.purge_expired_reservation_rows()` は SECURITY INVOKER + `SET search_path=''` + REVOKE PUBLIC/anon/authenticated を維持。削除述語は `expires_at < now()` のみ。
- 本番 cron は **postgres ロール**で schedule (RLS bypass が DELETE の前提)。
- **`TTL_MIN_MINUTES >= ISSUE_RATE_WINDOW_MINUTES`** を維持 (module-load assert が守る)。発行レート guard に `consumed_at IS NULL` を足さない。
- purge は pg_cron に非依存な関数 (post/0027) と本番専用 schedule (manual/0007) の分離を維持。post/ に pg_cron 依存を混入させない (CI を壊す)。
- A.33 invariants (global は Turnstile 後 + company 単位、per-IP cross-company、A.32b oracle、checkRateLimit atomicity) 全件維持。

## follow-up (非ブロッカー)

1. **issue rate guard を `rate_limit_counters` へ移行 (本質解、A.32a スコープ)**: guard が `created_at` で行存在に依存する設計を、purge-safe な `rate_limit_counters` (`expires_at = window_start + window*2`) の atomic increment へ移すと TTL との coupling が消え、本 A.34 の TTL クランプ + assert は不要になる。
2. **cron 設定の本番検証**: `cron.schedule` 構文・権限は **CI 未実行** (manual/本番専用、A.32b の「CI 未検証」注記precedent)。linked Supabase (staging、pg_cron 1.6 提供済 + 両テーブル存在) で検証する場合は **live recurring job という永続副作用**ゆえユーザー確認の上で実施。
3. **purge 頻度チューニング**: 15 分毎は本番トラフィック観測後に調整可 (`cron.schedule` は jobname 冪等)。
4. **総 Resend コスト上限** (A.33 follow-up): 要れば Turnstile 後に deployment-wide global cap を追加。

## A.35 引き継ぎ契約

1. 公開 surface 本番露出には prerequisite #1 (IP 信頼境界検証) + #3 (本番 Turnstile キー) が依然 hard 依存。#2 (purge) は配線済だが本番は `manual/0007` 手動適用が必要。
2. purge 関数の SECURITY/search_path/REVOKE/述語、cron の postgres ロール前提、`TTL_MIN_MINUTES >= ISSUE_RATE_WINDOW_MINUTES` 不変条件を壊さない。
3. e2e.yml の push トリガーから `phase-64-mvp-implementation` を削除するのは main マージ時。

## メトリクス

| 指標 | 値 |
|---|---|
| commit | 1 (実装 + レビュー反映 + handoff) |
| 変更ファイル | 新規 3 (post/0027 + manual/0007 + integration test) + 既存改修 4 (schema×2 + spec + reservation-verification-codes.ts の TTL fix) |
| 新規 tests | integration +1 (purge 削除挙動、CI で検証) |
| advisor | 3 (着手前: 設計レビュー / 実装後: empirical 確認後の方針 / MEDIUM fix のスコープ判断) |
| 敵対的レビュー | Codex 独立 (GO 86%) + workflow 7 agent (MEDIUM 1 反映) |
| Codex 委任 | 0 (migration/security/test 設計の判断密度高で自実装、block override 1 件 = 例外記録 `purge-test-0027`) |
| 経験的検証 | linked Supabase: FK 0 件 / table owner=postgres / FORCE RLS=false / postgres・service_role rolbypassrls=true / pg_cron 1.6 available |

*Phase 64-A.34 sealed (CI green gate) / Generated by Claude 2026-05-29 / 次: A.35 または公開 surface 露出残 (prerequisite #1/#3 + /clear)*
