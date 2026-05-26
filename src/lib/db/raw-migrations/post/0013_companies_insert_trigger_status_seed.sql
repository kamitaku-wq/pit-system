-- Phase 51: companies INSERT trigger で transport status 自動 seed (MVP blocker 1 完全解消)。
-- spec/data-model.md §18.1 per-company seed の自動化。spec v2.1「DB trigger 最終防衛線」認可済。
-- Phase 50 0012_ で既存 companies は backfill 済、本 trigger で新規 company 追加時も自動 seed。
--
-- 値は tests/_helpers/seed-transport-statuses.ts および 0012_*.sql と完全一致 (drift surface 警告、
-- 3 箇所同期、共通化は Phase 52+ 別 Phase 検討)。
--
-- SECURITY DEFINER 採用理由: statuses / status_transitions に RLS 有効 (19_rls_policies.sql)、
-- Phase 52 admin sign-up UI 等で auth role が companies INSERT する場合に備え、db owner 権限で
-- RLS bypass する。既存 20_triggers.sql の trigger は INVOKER-safe (set_updated_at /
-- enforce_status_transition) のため DEFINER 不要、本 trigger は RLS bypass で意図的に逸脱。
-- search_path 固定で SECURITY DEFINER の typical risk (search_path injection) を回避。
--
-- 冪等: ON CONFLICT DO NOTHING で再 fire でも安全 (AFTER INSERT ON ROW のみ、UPDATE/DELETE fire なし)。

DROP TRIGGER IF EXISTS trg_seed_transport_statuses_on_company_insert ON public.companies;
DROP FUNCTION IF EXISTS public.seed_transport_statuses_on_company_insert();

CREATE OR REPLACE FUNCTION public.seed_transport_statuses_on_company_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.statuses (company_id, status_type, key, name, display_order, is_initial, is_terminal, is_active)
  VALUES
    (NEW.id, 'transport', 'requested', 'Requested', 10, true, false, true),
    (NEW.id, 'transport', 'accepted', 'Accepted', 20, false, false, true),
    (NEW.id, 'transport', 'rejected', 'Rejected', 30, false, true, true),
    (NEW.id, 'transport', 'cancelled', 'Cancelled', 40, false, true, true)
  ON CONFLICT (company_id, status_type, key) DO NOTHING;

  INSERT INTO public.status_transitions (company_id, status_type, from_status_id, to_status_id, triggers_notification)
  SELECT NEW.id, 'transport', fs.id, ts.id, true
  FROM (VALUES
    ('requested', 'accepted'),
    ('requested', 'rejected'),
    ('accepted', 'cancelled'),
    ('requested', 'cancelled'),
    ('rejected', 'cancelled')
  ) AS pairs(from_key, to_key)
  INNER JOIN public.statuses fs
    ON fs.company_id = NEW.id AND fs.status_type = 'transport' AND fs.key = pairs.from_key
  INNER JOIN public.statuses ts
    ON ts.company_id = NEW.id AND ts.status_type = 'transport' AND ts.key = pairs.to_key
  ON CONFLICT (company_id, status_type, from_status_id, to_status_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_seed_transport_statuses_on_company_insert
  AFTER INSERT ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_transport_statuses_on_company_insert();
