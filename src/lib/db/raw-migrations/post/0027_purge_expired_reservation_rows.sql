-- Phase 64-A.34: 公開予約 surface の TTL purge 関数 (A.33 seal prerequisite #2)
-- spec/data-model.md §3.8/§3.9 (purge prerequisite) / handoff phase-64-a33-rate-limit-turnstile-sealed.md #2
--
-- 目的: rate_limit_counters (窓ごとに行が増える) / reservation_verification_codes (短 TTL コード) は
--   expires_at 経過後も行が残り、purge が無いとテーブルが無限増殖する (storage/perf DoS)。
--   両テーブルの expires_at < now() 行を 1 関数に集約して削除する。
--
-- 設計判断:
--  ・purge ロジック (本関数) と pg_cron スケジューリング (manual/0007) を分離する。
--    本関数は pg_cron に非依存ゆえ db:apply-raw:post (CI local Supabase) で安全に適用でき、
--    tests/integration/db/purge-expired-reservation-rows.integration.test.ts で削除挙動を実証できる。
--    cron.schedule + CREATE EXTENSION pg_cron は CI の local Supabase で
--    shared_preload_libraries 未設定だと失敗しうるため本番専用 (manual/0007) に隔離する。
--  ・SECURITY INVOKER (DEFINER ではない): 呼出元 = pg_cron job は postgres ロールで走り
--    (manual/0007 を Dashboard superuser で schedule)、postgres は RLS を bypass するため
--    INVOKER でも DELETE が通る。DEFINER は機能利得ゼロで権限昇格面のみ増やすため採らない
--    (0006_auth_trigger.sql の DEFINER は「起動者≠所有者」の真の DEFINER 用途で本件とは状況が違う)。
--  ・SET search_path = '' + 全オブジェクト schema 修飾: SECURITY 系 advisor の
--    function_search_path_mutable 指摘を避け、search_path injection を構造的に塞ぐ
--    (now() は pg_catalog 常時暗黙 path で解決)。
--  ・REVOKE EXECUTE FROM PUBLIC/anon/authenticated: PostgREST 経由の RPC 呼出を遮断する
--    defense-in-depth。万一呼出が漏れても削除対象は expired (既に無価値) 行のみで blast radius は nil。
--  ・削除は expires_at < now() のみを述語とし consumed_at/状態は問わない: expired 行は
--    verify が必ず弾く (A.32b oracle で not_found/expired は verification_failed に畳まれる) ため、
--    active-per-email partial unique index (consumed_at IS NULL) との競合も起きない。
--  ・対象外: customer_reservation_tokens も expires_at を持つが spec line 275 が GC を
--    「将来別途」と明示繰延しているため A.34 スコープ外 (本関数では触らない)。
--
-- 冪等: CREATE OR REPLACE。返り値 = 削除件数 (本番で purge が実働しているかを監視できる)。

CREATE OR REPLACE FUNCTION public.purge_expired_reservation_rows()
RETURNS TABLE (rate_limit_deleted bigint, verification_codes_deleted bigint)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $$
DECLARE
  v_rate_limit_deleted bigint;
  v_codes_deleted bigint;
BEGIN
  DELETE FROM public.rate_limit_counters WHERE expires_at < now();
  GET DIAGNOSTICS v_rate_limit_deleted = ROW_COUNT;

  DELETE FROM public.reservation_verification_codes WHERE expires_at < now();
  GET DIAGNOSTICS v_codes_deleted = ROW_COUNT;

  RETURN QUERY SELECT v_rate_limit_deleted, v_codes_deleted;
END;
$$;

-- PostgREST (anon/authenticated) からの RPC 呼出を遮断 (defense-in-depth)。
-- cron は postgres (関数所有者) で走るため EXECUTE grant は不要。
REVOKE ALL ON FUNCTION public.purge_expired_reservation_rows() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_expired_reservation_rows() FROM anon, authenticated;
