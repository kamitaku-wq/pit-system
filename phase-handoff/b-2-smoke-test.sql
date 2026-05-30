-- Phase B-2 smoke test
-- 前提: Phase 9-B sealed → apply (DELETE FROM _raw_migrations WHERE filename='18_helper_functions.sql' + pnpm db:apply-raw-sql)
-- 実行手段: mcp__supabase__execute_sql (1 文ずつ) または psql
-- 期待: 全クエリ成功 + 期待件数一致

-- ============================================================
-- Section 1: 関数存在確認 (期待 7 rows)
-- ============================================================
SELECT proname, pg_get_function_arguments(oid) AS args
FROM pg_proc
WHERE pronamespace = 'public'::regnamespace
  AND proname IN (
    'current_user_company_id',
    'current_vendor_id',
    'current_vendor_user_id',
    'vendor_accessible_company_ids',
    'vendor_invited_transport_order_ids',
    'redact_audit_payload',
    'accept_invitation_and_revoke_others'
  )
ORDER BY proname;
-- 期待: 7 rows、redact は (p_entity text, p_data jsonb)、accept は (p_invitation_id uuid)

-- ============================================================
-- Section 2: pii_anonymization_jobs テーブル + 制約確認
-- ============================================================
SELECT
  (SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='pii_anonymization_jobs') AS table_exists,
  (SELECT count(*) FROM pg_constraint
   WHERE conrelid = 'public.pii_anonymization_jobs'::regclass
     AND conname = 'pii_anonymization_jobs_unique_pending') AS exclude_constraint,
  (SELECT count(*) FROM pg_indexes
   WHERE schemaname = 'public'
     AND tablename = 'pii_anonymization_jobs'
     AND indexname LIKE 'idx_pii_anonymization_jobs%') AS partial_indexes;
-- 期待: 1, 1, 2

-- ============================================================
-- Section 3: redact_audit_payload smoke (5 entity)
-- ============================================================
SELECT
  public.redact_audit_payload('customers', '{"phone":"09012345678","email":"test@example.com"}'::jsonb) AS redacted_customer,
  public.redact_audit_payload('vehicles', '{"vin":"1HGBH41JXMN109186"}'::jsonb) AS redacted_vehicle,
  public.redact_audit_payload('users', '{"email":"admin@example.com"}'::jsonb) AS redacted_user,
  public.redact_audit_payload('vendor_users', '{"email":"vendor@example.com"}'::jsonb) AS redacted_vendor_user,
  public.redact_audit_payload('customer_reservation_tokens', '{"token_hash":"abc123","other":"keep"}'::jsonb) AS redacted_token,
  public.redact_audit_payload('unknown_entity', '{"foo":"bar"}'::jsonb) AS passthrough;
-- 期待:
--   customer: {"phone":"***5678","email":"t***@example.com"}
--   vehicle:  {"vin":"***09186"}
--   user:     {"email":"a***@example.com"}
--   vendor_user: {"email":"v***@example.com"}
--   token:    {"other":"keep"}  (token_hash 削除)
--   passthrough: {"foo":"bar"}

-- ============================================================
-- Section 4: vendor_accessible_company_ids smoke
-- ============================================================
SELECT public.vendor_accessible_company_ids(gen_random_uuid());
-- 期待: 0 rows (該当 vendor なし、エラー無し)

-- ============================================================
-- Section 5: pii_anonymization_jobs state machine 1 ループ
-- ============================================================
-- 注意: 既存 company / customer が必要。下記は SET 後の手順を示すコメント
-- (1) 任意の company_id / customer_id を取得 (例: SELECT id FROM companies LIMIT 1)
-- (2) 以下を順に実行:

-- INSERT (pending) → verified → scheduled → processing → completed
-- UPDATE pii_anonymization_jobs SET status='verified', verified_at=now(), updated_at=now() WHERE id=$id AND status='pending';
-- UPDATE pii_anonymization_jobs SET status='scheduled', updated_at=now() WHERE id=$id AND status='verified';
-- UPDATE pii_anonymization_jobs SET status='processing', updated_at=now() WHERE id=$id AND status='scheduled';
-- UPDATE pii_anonymization_jobs SET status='completed', processed_at=now(), updated_at=now() WHERE id=$id AND status='processing';

-- EXCLUDE constraint 検証 (同一 customer の active job 二重作成は失敗するはず → 23P01)

-- ============================================================
-- Section 6: accept_invitation_and_revoke_others 認可ガード smoke
-- ============================================================
-- (a) authenticated として非 vendor user の auth.uid で呼ぶ → 42501 'caller is not an authenticated vendor user'
-- (b) vendor_user として招待の vendor と異なる vendor_user で呼ぶ → 42501 'caller vendor_user does not belong to invitation vendor'
-- (c) 正常系: 招待の vendor の vendor_user で呼ぶ → (transport_order_id, version) 返却
-- (d) スポット招待 (vendor_id NULL) で呼ぶ → P0002 'invitation has no bound vendor'
-- (e) 二重受注試行 (is_winning_bid=true がすでに存在) → 55P03 'already has winning bid'

-- ============================================================
-- DoD まとめ
-- ============================================================
-- Section 1: 7 rows
-- Section 2: 1, 1, 2
-- Section 3: 6 redact 結果が期待通り
-- Section 4: 0 rows、エラー無し
-- Section 5: state machine 4 遷移完走 + EXCLUDE 検証 (23P01)
-- Section 6: 認可ガード 5 ケース全て期待通り (42501/42501/正常/P0002/55P03)
