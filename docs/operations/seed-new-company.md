# 新規 company 追加時の status seed 運用手順

> Phase 50 で導入。Phase 51+ で `companies` INSERT trigger または `createCompanyWithDefaults` service 関数が実装され次第、本ドキュメントは更新される。

## 背景

`spec/data-model.md` §18.1 (line 1738-1745) で per-company seed が要求されているが、現状 production の company 作成経路に自動 seed の仕組みがない。

- `tests/_helpers/seed-transport-statuses.ts`: test 環境専用、transaction 内 seed
- `src/lib/db/raw-migrations/post/0012_seed_transport_statuses_per_company.sql`: 既存 companies の backfill (Phase 50 で追加)
- 新規 company 追加時の seed: **本ドキュメントの手順で手動実行** (Phase 51+ で自動化予定)

## 初回 deploy 時 (Phase 50 適用)

deploy 担当が以下を実行:

```bash
pnpm db:apply-raw:post
```

`raw-migrations/post/0012_seed_transport_statuses_per_company.sql` が初回適用され、全 既存 companies に transport status 4 件 (`requested` / `accepted` / `rejected` / `cancelled`) + status_transitions 5 件 (`requested→accepted` / `requested→rejected` / `accepted→cancelled` / `requested→cancelled` / `rejected→cancelled`) が seed される。

## 新規 company 追加時の手順 (Phase 51+ 実装まで)

### 重要: `pnpm db:apply-raw:post` は再実行できない

`src/lib/db/apply-raw-sql.ts` (line 55-64) の SKIP ロジックにより、一度適用された raw migration は再実行されない。新規 company を追加した後に同じ seed を流すには、**SQL の本体 (コメント以外) を直接実行** する必要がある。

### 推奨経路 1: psql 経由 (service_role / db owner で接続)

```bash
psql "$DIRECT_URL" -f src/lib/db/raw-migrations/post/0012_seed_transport_statuses_per_company.sql
```

- ON CONFLICT DO NOTHING で冪等
- 既存 companies は変化なし、新規 company のみ seed される
- 実行 role: service_role または db owner (RLS bypass 必須)

### 推奨経路 2: Supabase SQL Editor

1. Supabase ダッシュボード → SQL Editor を開く
2. `src/lib/db/raw-migrations/post/0012_seed_transport_statuses_per_company.sql` の **SQL 本体 (コメント以外)** をコピペ
3. 実行 (service_role 接続が前提)

### 経路選択基準

- **本番環境**: psql + `DIRECT_URL` (CI/CD 自動化との整合性、監査ログ残る)
- **ステージング・hot fix**: Supabase SQL Editor (即時確認、UI で結果確認)

## post-check SQL (drift 検証)

`ON CONFLICT DO NOTHING` の semantic drift 警告: 既存 row の値が本 SQL と異なる場合、修復されない。以下の SQL で drift を検出:

```sql
-- 1. company ごとの transport status 件数 (期待値 = 4)
SELECT c.id, c.name, COUNT(s.id) AS status_count
FROM public.companies c
LEFT JOIN public.statuses s
  ON s.company_id = c.id AND s.status_type = 'transport'
GROUP BY c.id, c.name
HAVING COUNT(s.id) <> 4;

-- 2. company ごとの transport status_transitions 件数 (期待値 = 5)
SELECT c.id, c.name, COUNT(t.id) AS transition_count
FROM public.companies c
LEFT JOIN public.status_transitions t
  ON t.company_id = c.id AND t.status_type = 'transport'
GROUP BY c.id, c.name
HAVING COUNT(t.id) <> 5;

-- 3. 各 status の値 drift 検出 (display_order / is_initial / is_terminal / is_active)
SELECT c.id AS company_id, s.key, s.display_order, s.is_initial, s.is_terminal, s.is_active
FROM public.companies c
INNER JOIN public.statuses s ON s.company_id = c.id AND s.status_type = 'transport'
WHERE
  (s.key = 'requested'  AND (s.display_order <> 10 OR NOT s.is_initial OR s.is_terminal OR NOT s.is_active)) OR
  (s.key = 'accepted'   AND (s.display_order <> 20 OR s.is_initial OR s.is_terminal OR NOT s.is_active)) OR
  (s.key = 'rejected'   AND (s.display_order <> 30 OR s.is_initial OR NOT s.is_terminal OR NOT s.is_active)) OR
  (s.key = 'cancelled'  AND (s.display_order <> 40 OR s.is_initial OR NOT s.is_terminal OR NOT s.is_active));
```

drift が検出された場合: 手動で UPDATE で値を統一する。一括修復 SQL は別途 hot-fix migration で対応する。

## 関連リソース

- spec: `spec/data-model.md` §18.1
- migration: `src/lib/db/raw-migrations/post/0012_seed_transport_statuses_per_company.sql`
- test helper (semantic source of truth): `tests/_helpers/seed-transport-statuses.ts`
- Phase 50 plan: `phase-handoff/phase-50-status-seed-backfill-plan.md`
- Phase 50 sealed: `phase-handoff/phase-50-status-seed-backfill-sealed.md`
- 将来計画: Phase 51 (`companies` INSERT trigger) / Phase 52 (`createCompanyWithDefaults` service)
