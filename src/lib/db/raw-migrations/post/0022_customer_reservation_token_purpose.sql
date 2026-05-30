-- Phase 64-A.27: per-action token foundation
-- spec/data-model.md §3.7 / spec/requirements.md §12.2 / §4.7
--
-- customer_reservation_tokens に purpose 列を追加 (view / modify / cancel の discriminator)。
-- A.21 hash+atomic verify+consume canonical を踏襲し、purpose は consume の WHERE 述語で
-- 必須強制する (view token は cancel 不可・cancel token は modify 不可)。
--
-- 既存行は single-use view token のため DEFAULT 'view' で backfill 後、DROP DEFAULT して
-- 新規 insert は purpose 明示を必須にする (fail-fast)。
-- 冪等: 列・制約とも存在チェック後に追加。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'customer_reservation_tokens'
      AND column_name = 'purpose'
  ) THEN
    ALTER TABLE public.customer_reservation_tokens
      ADD COLUMN purpose text NOT NULL DEFAULT 'view';
    ALTER TABLE public.customer_reservation_tokens
      ALTER COLUMN purpose DROP DEFAULT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.customer_reservation_tokens'::regclass
      AND conname = 'customer_reservation_tokens_purpose_check'
  ) THEN
    ALTER TABLE public.customer_reservation_tokens
      ADD CONSTRAINT customer_reservation_tokens_purpose_check
      CHECK (purpose IN ('view', 'modify', 'cancel'));
  END IF;
END $$;
