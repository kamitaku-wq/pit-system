# Phase 25 ι spike guide: CI E2E pipeline DIRECT_URL verify

## 目的

- Phase 25 ι の目的は、CI E2E で使う Supabase preview branch に対して、Drizzle migration と raw SQL migration を安全に流せるかを手動確認すること。
- `drizzle.config.ts` は `DIRECT_URL ?? DATABASE_URL` を migration 接続として使う。Drizzle の `pnpm db:migrate` は prepared statement / advisory lock を使うため、session/direct 系の `DIRECT_URL` が必要。
- このプロジェクトの env 命名は `.env.example` に合わせて、runtime 用を `DATABASE_URL`、migration / extension 用を `DIRECT_URL` と分ける。
- `DATABASE_URL` は pgBouncer / pooler transaction mode の port `6543` を想定しており、runtime query では `prepare: false` と組み合わせる。
- pooler transaction mode は prepared statement 非対応のため、Drizzle migration では失敗する可能性が高い。
- raw SQL も `CREATE EXTENSION` / trigger / policy / helper function を含むため、`apply-raw-sql.ts` のコメント通り session 接続 `DIRECT_URL` を前提にする。
- この spike は Strategy A/B 系の Supabase Branching 継続可否を決める gate である。
- preview branch から port `5432` の `DIRECT_URL` を取得でき、migration が完走するなら Strategy A/B を続行する。
- preview branch で `DIRECT_URL` が取れない、または port `5432` でも migration が通らない場合は Strategy C に切り替える。
- ここでは CI workflow 実装は行わない。人間が dashboard で確認し、結果だけを実装判断に渡す。

## 前提条件

- Supabase Branching は preview branch を作る機能なので、対象 organization / project で Pro plan または branching add-on 相当の利用権限が必要。
- 公式 docs では preview branch は独立した Supabase 環境として作られ、branch ごとに database / API credentials を持つ。
- 公式 docs: https://supabase.com/docs/guides/deployment/branching
- dashboard から branch を作る機能は docs 上 beta / public alpha の表記があり、UI は変わる可能性がある。
- GitHub integration を使う場合、PR-linked preview branch が自動生成されるかを確認する。
- GitHub integration を使わない場合でも、dashboard branching で手動 preview branch を作れるか確認する。
- 既存 prod project の branching 設定は Supabase Dashboard の対象 project で、上部 branch selector、Branches tab、または project navigation の Branching / Branches から確認する。
- dashboard branching が無効なら、user menu の feature preview から Branching via dashboard を enable できるか確認する。
- `.env.preview.local` はこの repo の `.gitignore` で `.env.*.local` に該当するため、ローカル検証用の一時 env として扱う。
- `.env.preview.local` には secret を入れるため、commit しない。
- 現在の `package.json` の migration script は `pnpm db:migrate`、raw pre/post chain は `pnpm db:setup`。
- `pnpm db:setup` は `pnpm db:apply-raw:pre && pnpm db:migrate && pnpm db:apply-raw:post` で、pre 1 件 + drizzle 1 件 + post 4 件を流す。
- Branching Strategy B の本命 raw migration は `src/lib/db/raw-migrations/alpha-1-public` の 27 件である。
- Drizzle migration は `src/lib/db/migrations` 配下の SQL 1 件である。

## 手順（ダッシュボード操作）

1. Supabase Dashboard で既存 prod project を開く。
2. branch selector または `Project -> Branches` 相当の画面を開く（2026-05 時点想定、UI 変更時は読み替え）。
3. dashboard branching が未有効なら、user menu の `Branching via dashboard` から enable する（2026-05 時点想定、UI 変更時は読み替え）。
4. `Create branch` または同等の preview branch 作成操作を選ぶ（2026-05 時点想定、UI 変更時は読み替え）。
5. branch name は `feat/e2e-iota-spike-20260525` のように、目的と日付が分かる名前にする。
6. GitHub PR と連動させる場合は、該当 git branch / PR に紐づいているかを確認する。
7. 手動 spike だけなら、GitHub 連携なしの dashboard branch でもよい。
8. 作成後、branch provisioning が完了するまで数分待つ。
9. docs 上の deployment workflow では Health step が最大 2 分待つため、dashboard 上の ready / healthy 表示まで待つ。
10. branch が ready になったら、branch selector で preview branch に切り替える。
11. preview branch の `Settings -> Database -> Connection string` または上部 `Connect` から接続文字列を開く（2026-05 時点想定、UI 変更時は読み替え）。
12. `DIRECT_URL` 候補として、port `5432` の接続文字列を探す。
13. `DATABASE_URL` 候補として、port `6543` か `?pgbouncer=true` の pooler / transaction mode 接続文字列を探す。
14. Supabase docs では direct connection は `db.<project-ref>.supabase.co:5432` 形式、transaction pooler は `:6543` 形式が例示されている。
15. この repo の `.env.example` では shared pooler session mode の `aws-...pooler.supabase.com:5432` も `DIRECT_URL` として使う convention になっている。
16. したがって判定は host 名だけでなく、port と mode 表示で行う。
17. `:5432` かつ session/direct 系なら `DIRECT_URL` 候補。
18. `:6543` または `pgbouncer=true` 付きなら `DATABASE_URL` 候補。
19. port `5432` の branch-specific URL が見つからない場合、この時点で Strategy C 候補として記録する。
20. port `5432` の URL が見つかった場合、password を入れた完全な接続文字列をローカル検証に使う。
21. prod project の URL と取り違えないよう、branch selector が preview branch を指していることを再確認する。

## verify チェックリスト

- [ ] `.env.preview.local` を作成し、取得した URL を `DIRECT_URL=...` として貼る。
- [ ] `DATABASE_URL=...` も取得できる場合は、同じ preview branch の pooler / transaction URL を貼る。
- [ ] `NEXT_PUBLIC_SUPABASE_URL` と `SUPABASE_SERVICE_ROLE_KEY` が branch-specific で取れるかも併せて確認する。
- [ ] `.env.preview.local` が gitignored であることを `git check-ignore .env.preview.local` で確認する。
- [ ] PowerShell で preview env を current shell に読み込む。
- [ ] 例: `Get-Content .env.preview.local | Where-Object { $_ -match '^[A-Za-z_][A-Za-z0-9_]*=' } | ForEach-Object { $k,$v = $_ -split '=',2; [Environment]::SetEnvironmentVariable($k, $v.Trim('\"'), 'Process') }`
- [ ] `pnpm db:migrate` を実行し、Drizzle migration 1 件が port `5432` で通ることを確認する。
- [ ] `pnpm tsx src/lib/db/apply-raw-sql.ts ./src/lib/db/raw-migrations/alpha-1-public` を実行し、raw migration 27 件が `[APPLY]` または `[SKIP]` で完走することを確認する。
- [ ] 必要なら `pnpm db:setup` も実行し、pre 1 件 + drizzle 1 件 + post 4 件の既存 chain が preview env で動くことを確認する。
- [ ] 失敗時は `DIRECT_URL` が `:5432` か、誤って `DATABASE_URL` / `:6543` を読んでいないかを最初に確認する。
- [ ] `drizzle.config.ts` は `.env.preview.local` を自動 load しないため、current shell に env が入っていることを確認する。
- [ ] `Completed: 27 applied, 0 skipped.` または同等の 27 件処理結果を記録する。
- [ ] 再実行時は `_raw_migrations` により `Completed: 0 applied, 27 skipped.` になることが正常である。
- [ ] 成功または失敗メッセージを保存する。
- [ ] 失敗時はエラー先頭 20 行を保存する。

## 失敗時フォールバック判定（Strategy C）

- Strategy C に切り替える条件は明確に 2 つだけにする。
- 1 つ目は、preview branch feature が plan / add-on / 権限不足で使えない場合。
- 2 つ目は、preview branch は作れるが branch-specific `DIRECT_URL` の port `5432` が取得できない場合。
- 3 つ目は、port `5432` の `DIRECT_URL` を使っても `pnpm db:migrate` または 27 件 raw migration が失敗し、接続文字列の取り違えではないと確認できた場合。
- `:6543` の pooler URL しかない場合、Drizzle migration の prepared statement incompatibility を避けられないため Strategy A/B は採用しない。
- `DATABASE_URL` を `DIRECT_URL` に流用して通す判断はしない。
- 1 回の typo / password 入力ミス / env 読み込み漏れは Strategy C 判定にしない。
- URL 再取得、env 再読み込み、`pnpm db:migrate` 再実行まで確認しても同じ failure なら Strategy C とする。
- Strategy C の候補 1 は GitHub Actions service container の `postgres` を使い、CI 内で schema を初期化して E2E を走らせる方式。
- Strategy C の候補 2 は CI 内で `supabase start` を使い、ローカル Supabase stack に対して migration と E2E を走らせる方式。
- service container は軽いが Supabase Auth / Storage との完全一致は弱い。
- `supabase start` は Supabase 依存の再現性が高いが、CI setup と cache が重くなる。
- decision threshold は「branch-specific port `5432` が取得でき、Drizzle 1 件 + raw 27 件が完走するか」で固定する。
- この threshold を満たすなら Strategy A/B 続行、満たさないなら Strategy C に切り替える。

## 完了報告フォーマット

- [ ] preview branch 作成成否:
- [ ] branch name: `feat/e2e-iota-spike-20260525`
- [ ] GitHub integration / PR-linked preview branch の有無:
- [ ] DIRECT_URL の有無:
- [ ] DIRECT_URL の port 番号:
- [ ] DATABASE_URL の有無:
- [ ] DATABASE_URL の port 番号:
- [ ] `pnpm db:migrate` 結果:
- [ ] raw migration 27 件の結果:
- [ ] `pnpm db:setup` を実行した場合の結果:
- [ ] migration 完走 or 失敗エラー:
- [ ] 失敗時はエラー先頭 20 行:
- [ ] 所要時間（provisioning 含む）:
- [ ] Strategy A/B 続行可否:
- [ ] Strategy C fallback 判定理由:
