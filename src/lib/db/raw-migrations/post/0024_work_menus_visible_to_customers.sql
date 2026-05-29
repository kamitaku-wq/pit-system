-- Phase 64-A.31a: 顧客公開予約フローの作業メニュー可視性
-- spec/requirements.md §12.1 step2 / spec/data-model.md §3.5
--
-- spec §12.1 step2 は「visible_to_customers = true のメニューのみ顧客に表示」を要求するが、
-- work_menus にこの列が存在しなかった (spec/schema drift)。列がないと公開予約ページが
-- 社内専用メニューを含む全 active メニューを匿名訪問者に列挙してしまう (product-exposure 問題)。
--
-- 既定値は false (opt-in 可視性): admin が明示的に公開したメニューのみ顧客に出る。
-- 既存 seed 済みメニューは false で backfill され、公開ページには出ない (fail-safe)。
-- DEFAULT は残す (新規 insert 時に admin が未指定なら非公開 = 安全側)。
-- 冪等: 列の存在チェック後に追加。
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'work_menus'
      AND column_name = 'visible_to_customers'
  ) THEN
    ALTER TABLE public.work_menus
      ADD COLUMN visible_to_customers boolean NOT NULL DEFAULT false;
  END IF;
END $$;
