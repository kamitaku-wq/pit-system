-- spec §17 (data-model.md line 1726-1731) per seed master.
-- system-global only. per-tenant seed (statuses / status_transitions /
-- notification_rules / reservation_settings) is performed by company-creation
-- service function per spec §18.1 (line 1738-1745), not here.
--
-- 2026-05-24 Phase 16-A0 reconcile (R-H-000):
--   - removed statuses / status_transitions / notification_rules INSERT
--     (DDL has company_id NOT NULL; can't seed with NULL tenant).
--   - kept lane_types (DDL allows NULL company_id) and roles (DDL allows NULL).
--   - column names verified against 06_lanes_work.sql / 03_roles_statuses.sql.

INSERT INTO lane_types (company_id, code, name, sort_order)
VALUES
  (NULL, 'general', 'General', 10),
  (NULL, 'inspection', 'Inspection', 20),
  (NULL, 'bodywork', 'Bodywork', 30),
  (NULL, 'paint', 'Paint', 40),
  (NULL, 'delivery', 'Delivery', 50),
  (NULL, 'other', 'Other', 60)
ON CONFLICT (company_id, code) DO NOTHING;

INSERT INTO roles (company_id, code, name, is_system)
VALUES
  (NULL, 'admin', 'Administrator', true),
  (NULL, 'manager', 'Manager', true),
  (NULL, 'advisor', 'Advisor', true),
  (NULL, 'technician', 'Technician', true),
  (NULL, 'dispatcher', 'Dispatcher', true),
  (NULL, 'viewer', 'Viewer', true)
ON CONFLICT (company_id, code) DO NOTHING;
