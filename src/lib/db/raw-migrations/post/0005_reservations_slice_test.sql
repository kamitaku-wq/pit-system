-- vertical slice 検証専用スタブテーブル。
-- 目的: Drizzle ORM が表現できない EXCLUDE USING gist (tstzrange) が
-- raw SQL + apply-raw-sql.ts 経路で正しく適用されることを確認する。
-- α-1 (Sprint α-1 で 46 テーブル展開時) にこのテーブルを DROP し、
-- 本実装の reservations テーブル (data-model.md §6.2) に置換する。
CREATE TABLE IF NOT EXISTS public._reservations_slice_test (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL,
  store_id uuid NOT NULL,
  time_range tstzrange NOT NULL,
  CONSTRAINT no_overlap_within_store EXCLUDE USING gist (
    company_id WITH =,
    store_id WITH =,
    time_range WITH &&
  ),
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public._reservations_slice_test IS 'vertical slice 検証用、α-1 で削除予定 (data-model.md §6.2 reservations に置換)';
