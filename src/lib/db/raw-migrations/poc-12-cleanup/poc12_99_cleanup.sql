-- PoC #12 cleanup: schema 隔離検証完了後の片付け
-- 手動 apply 用 (apply-raw-sql.ts で poc-12-cleanup dir を指定):
--   pnpm exec tsx src/lib/db/apply-raw-sql.ts ./src/lib/db/raw-migrations/poc-12-cleanup
-- または MCP execute_sql で直接実行可能。

DROP SCHEMA IF EXISTS pit_v24_poc CASCADE;
DELETE FROM public._raw_migrations WHERE filename LIKE 'poc12_%';
