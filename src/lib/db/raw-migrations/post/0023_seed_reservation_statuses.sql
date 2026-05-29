-- Phase 64-A.29: reservation status の per-company seed (顧客予約作成フローの初期 status)。
-- spec/data-model.md §18.1 per-company seed の reservation 版。spec v2.1「DB trigger 最終防衛線」認可済。
--
-- A.29 決定 (ユーザー判断): 顧客予約は「認証後に confirmed で作成」(create-on-confirm)。
--   → reservation status は初期 status 'confirmed' 1 件のみ seed する。
--   → transition (pending→confirmed 等) は seed しない。状態機械の transition は
--     その present consumer (customer-cancel / vendor-staff workflow) と共に別 phase で来る。
--     A.28 handoff の規律「状態機械を consumer 不在で投機的に焼き込むな」に従う。
--
-- enforce_status_transition trigger は BEFORE UPDATE OF status_id のみ発火 (20_triggers.sql)。
-- INSERT (statusId='confirmed') は transition 検証を受けないため、transition 行は作成に不要。
--
-- 構成は 0015_seed_transport_statuses_function.sql をミラー:
--   1) seed_reservation_statuses_for_company(uuid) function (値の source of truth)
--   2) companies AFTER INSERT trigger で新規 company に自動 seed
--   3) 既存 company の backfill (冪等)
--
-- 実行 role: service_role / db owner (RLS bypass)。SECURITY DEFINER + search_path 固定。
-- 冪等: ON CONFLICT DO NOTHING で再 fire / 既存行ありでも安全。

CREATE OR REPLACE FUNCTION public.seed_reservation_statuses_for_company(target_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.statuses (company_id, status_type, key, name, display_order, is_initial, is_terminal, is_active)
  VALUES
    (target_company_id, 'reservation', 'confirmed', 'Confirmed', 10, true, false, true)
  ON CONFLICT (company_id, status_type, key) DO NOTHING;
END;
$$;

CREATE OR REPLACE FUNCTION public.seed_reservation_statuses_on_company_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  PERFORM public.seed_reservation_statuses_for_company(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_reservation_statuses_on_company_insert ON public.companies;
CREATE TRIGGER trg_seed_reservation_statuses_on_company_insert
  AFTER INSERT ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public.seed_reservation_statuses_on_company_insert();

-- 既存 company の backfill (冪等: ON CONFLICT DO NOTHING)。
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT id FROM public.companies LOOP
    PERFORM public.seed_reservation_statuses_for_company(c.id);
  END LOOP;
END;
$$;
