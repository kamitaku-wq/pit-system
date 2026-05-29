-- ⚠️ 適用方法: Supabase Dashboard > SQL Editor (superuser=postgres) で手動実行 ⚠️
--
-- このファイルは pnpm db:apply-raw:post では適用しない (CI も走らせない)。理由:
--   ・pg_cron は CI の local Supabase で shared_preload_libraries 未設定だと
--     CREATE EXTENSION pg_cron が失敗しうる (本番 Supabase は pg_cron 1.6 を提供済 = 有効化可能)。
--   ・cron job を CI 環境で走らせる意味がない (purge ロジック自体は post/0027 関数を
--     tests/integration/db/purge-expired-reservation-rows.integration.test.ts で検証済)。
--
-- _raw_migrations tracking テーブルへの記録も手動で (post/ と作法を揃える):
--   INSERT INTO _raw_migrations (filename) VALUES ('0007_schedule_purge_cron.sql');
--
-- 目的: A.33 seal prerequisite #2。rate_limit_counters / reservation_verification_codes の
--   expires_at < now() 行を定期 purge し、テーブル無限増殖 (storage/perf DoS) を防ぐ。
--   削除ロジックは public.purge_expired_reservation_rows() (post/0027) に集約済。
--
-- ロール: Dashboard SQL Editor は postgres で実行されるため cron job も postgres で走る。
--   postgres は RLS を bypass するので purge 関数 (SECURITY INVOKER) でも両テーブルを DELETE 可能。
--
-- 頻度: 15 分毎。rate_limit_counters は窓 (vcode global 10min / slots・menus 1min) の expires_at =
--   window_start + window*2 で最大 ~20min、reservation_verification_codes は TTL 既定 10min。
--   15 分毎なら残留行は次窓数本に収まる。本番トラフィック観測後にチューニング可。
--   cron.schedule は jobname 冪等 (同名で再実行すると schedule/command を更新) ゆえ再適用安全。
--
-- 検証 (適用後): SELECT * FROM cron.job WHERE jobname = 'purge-expired-reservation-rows';
--   手動実行で関数の疎通確認: SELECT * FROM public.purge_expired_reservation_rows();
-- 解除: SELECT cron.unschedule('purge-expired-reservation-rows');

CREATE EXTENSION IF NOT EXISTS pg_cron;

SELECT cron.schedule(
  'purge-expired-reservation-rows',
  '*/15 * * * *',
  $$SELECT public.purge_expired_reservation_rows()$$
);
