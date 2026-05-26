-- Phase 50: backfill transport statuses + status_transitions for all existing companies.
-- spec/data-model.md §18.1 per-company seed の MVP blocker 1 解消。
-- 値は tests/_helpers/seed-transport-statuses.ts と完全一致 (test/production invariant)。
-- 冪等: ON CONFLICT DO NOTHING。実行 role: service_role / db owner 必須 (RLS bypass)。
-- 新規 company 追加時: docs/operations/seed-new-company.md 参照 (apply-raw-sql.ts:55-64 SKIP 回避)。

INSERT INTO public.statuses (company_id, status_type, key, name, display_order, is_initial, is_terminal, is_active)
SELECT c.id, 'transport', s.key, s.name, s.display_order, s.is_initial, s.is_terminal, s.is_active
FROM public.companies c
CROSS JOIN (VALUES
  ('requested', 'Requested', 10, true, false, true),
  ('accepted', 'Accepted', 20, false, false, true),
  ('rejected', 'Rejected', 30, false, true, true),
  ('cancelled', 'Cancelled', 40, false, true, true)
) AS s(key, name, display_order, is_initial, is_terminal, is_active)
ON CONFLICT (company_id, status_type, key) DO NOTHING;

INSERT INTO public.status_transitions (company_id, status_type, from_status_id, to_status_id, triggers_notification)
SELECT c.id, 'transport', fs.id, ts.id, true
FROM public.companies c
CROSS JOIN (VALUES
  ('requested', 'accepted'),
  ('requested', 'rejected'),
  ('accepted', 'cancelled'),
  ('requested', 'cancelled'),
  ('rejected', 'cancelled')
) AS pairs(from_key, to_key)
INNER JOIN public.statuses fs
  ON fs.company_id = c.id AND fs.status_type = 'transport' AND fs.key = pairs.from_key
INNER JOIN public.statuses ts
  ON ts.company_id = c.id AND ts.status_type = 'transport' AND ts.key = pairs.to_key
ON CONFLICT (company_id, status_type, from_status_id, to_status_id) DO NOTHING;
