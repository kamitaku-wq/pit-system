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
    WHERE conrelid = 'public.admin_vendor_invitations'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[
        (
          SELECT attnum
          FROM pg_attribute
          WHERE attrelid = 'public.admin_vendor_invitations'::regclass
            AND attname = 'invited_by_user_id'
        )
      ]::smallint[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.admin_vendor_invitations DROP CONSTRAINT IF EXISTS %I',
      existing_fk_name
    );
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.admin_vendor_invitations'::regclass
      AND conname = 'admin_vendor_invitations_invited_by_user_company_fk'
  ) THEN
    ALTER TABLE public.admin_vendor_invitations
      ADD CONSTRAINT admin_vendor_invitations_invited_by_user_company_fk
      FOREIGN KEY (invited_by_user_id, company_id)
      REFERENCES public.users (id, company_id)
      MATCH SIMPLE
      ON DELETE NO ACTION
      ON UPDATE RESTRICT;
  END IF;
END $$;
