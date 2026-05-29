-- Phase 64-A.33: 公開予約 surface の IP/global 送信レート制限カウンタ (多層防御 L2)
-- spec/requirements.md §12.3 (同一 IP/email/電話からの予約レート制限) / impl-plan §16 #9 (bot/DoS 多層防御)
--
-- 汎用 固定窓 (fixed-window) カウンタ。bucket_key + window_start を主キーとし、リクエストごとに
-- atomic upsert-increment (INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count) で
-- カウントする。read-then-write の race を避けるため increment と判定を単一文に閉じる
-- (A.32b Design A と同じく原子性が不変条件)。
--
-- window_start は呼び出し側 (rate-limiter.ts) が now を window 境界へ truncate して渡す。
-- 固定窓のため window をまたぐと別 PK になり自動的にカウントがリセットされる。
-- expires_at = window_start + window*2 (purge 用の余裕を持たせる)。
--
-- 汎用テーブル: bucket_key の prefix で用途を分離する (例 "rsv:vcode:ip:<ip>" / "rsv:vcode:global")。
-- Phase 2 #9 (vendor ログイン失敗ロック・認証コード送信回数制限) でも再利用できる。
-- company スコープを持たない (キーは IP/global 等) ため tenant 列・tenant policy は持たない。
--
-- RLS (0025 reservation_verification_codes / customer_reservation_tokens canonical 踏襲):
--   RLS 未有効だと Supabase anon/authenticated が PostgREST 経由でカウンタを直読み・改ざんでき、
--   count を書き換えてレート制限を回避できる (防御 bypass)。ENABLE で policy 不在ゆえ anon/authenticated は
--   全行不可視・書込不可。本テーブルの唯一の writer は service_role (RLS bypass) = 公開 route の rate-limiter。
--
-- purge: window ごとに行が増えるため expires_at index を pg_cron purge 用に先行定義する
--   (実 purge job は A.33 follow-up、0025 expired-code purge と同列)。
-- 冪等: テーブル・index とも IF NOT EXISTS。

CREATE TABLE IF NOT EXISTS public.rate_limit_counters (
  bucket_key   text        NOT NULL,
  window_start timestamptz NOT NULL,
  count        integer     NOT NULL DEFAULT 0,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (bucket_key, window_start)
);

CREATE INDEX IF NOT EXISTS rate_limit_counters_expires_at_idx
  ON public.rate_limit_counters (expires_at);

ALTER TABLE public.rate_limit_counters ENABLE ROW LEVEL SECURITY;
-- policy は意図的に作成しない (anon/authenticated 全拒否、service_role のみ RLS bypass で書込)。
