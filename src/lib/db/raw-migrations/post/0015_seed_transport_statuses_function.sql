-- Phase 54: transport status seed の SQL 関数共通化 (drift surface 3 → 2 に削減)。
-- Phase 50 (0012_) backfill SQL / Phase 51 (0013_) trigger / test helper の 3 箇所同期課題を、
-- SQL 関数 public.seed_transport_statuses_for_company(uuid) に集約。
--
-- 本 migration の役割:
--   1) function 新規追加 (source of truth として 1 箇所に値定義)
--   2) Phase 51 trigger function を CREATE OR REPLACE で新関数経由 (ラッパー) に refactor
--      → trigger object 自体 (trg_seed_transport_statuses_on_company_insert) は維持、内部実装のみ置換
--
-- 既存 0012 (backfill) は適用済 (apply-raw-sql.ts SKIP) なので触らない。
-- 新規 deploy では 0012 が古い直接 INSERT pattern で走るが、ON CONFLICT で冪等、結果同じ。
-- 0012 を「historical artifact」として保持、将来値変更時は 0015 function のみ修正。
--
-- 実行 role: service_role / db owner (RLS bypass)。SECURITY DEFINER + search_path 固定。

CREATE OR REPLACE FUNCTION public.seed_transport_statuses_for_company(target_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.statuses (company_id, status_type, key, name, display_order, is_initial, is_terminal, is_active)
  VALUES
    (target_company_id, 'transport', 'requested', 'Requested', 10, true, false, true),
    (target_company_id, 'transport', 'accepted', 'Accepted', 20, false, false, true),
    (target_company_id, 'transport', 'rejected', 'Rejected', 30, false, true, true),
    (target_company_id, 'transport', 'cancelled', 'Cancelled', 40, false, true, true)
  ON CONFLICT (company_id, status_type, key) DO NOTHING;

  INSERT INTO public.status_transitions (company_id, status_type, from_status_id, to_status_id, triggers_notification)
  SELECT target_company_id, 'transport', fs.id, ts.id, true
  FROM (VALUES
    ('requested', 'accepted'),
    ('requested', 'rejected'),
    ('accepted', 'cancelled'),
    ('requested', 'cancelled'),
    ('rejected', 'cancelled')
  ) AS pairs(from_key, to_key)
  INNER JOIN public.statuses fs
    ON fs.company_id = target_company_id AND fs.status_type = 'transport' AND fs.key = pairs.from_key
  INNER JOIN public.statuses ts
    ON ts.company_id = target_company_id AND ts.status_type = 'transport' AND ts.key = pairs.to_key
  ON CONFLICT (company_id, status_type, from_status_id, to_status_id) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_transport_statuses_on_company_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.seed_transport_statuses_for_company(NEW.id);
  RETURN NEW;
END;
$$;
