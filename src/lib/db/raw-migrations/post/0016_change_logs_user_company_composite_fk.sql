DO $$
DECLARE
  existing_fk_name text;
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_id_company_id_unique'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_id_company_id_unique UNIQUE (id, company_id);
  END IF;

  FOR existing_fk_name IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.transport_order_change_logs'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[
        (
          SELECT attnum
          FROM pg_attribute
          WHERE attrelid = 'public.transport_order_change_logs'::regclass
            AND attname = 'changed_by_user_id'
        )
      ]::smallint[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.transport_order_change_logs DROP CONSTRAINT IF EXISTS %I',
      existing_fk_name
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.transport_order_change_logs'::regclass
      AND conname = 'transport_order_change_logs_changed_by_user_company_fk'
  ) THEN
    ALTER TABLE public.transport_order_change_logs
      ADD CONSTRAINT transport_order_change_logs_changed_by_user_company_fk
      FOREIGN KEY (changed_by_user_id, company_id)
      REFERENCES public.users (id, company_id)
      MATCH SIMPLE
      ON DELETE NO ACTION
      ON UPDATE RESTRICT;
  END IF;
END $$;
