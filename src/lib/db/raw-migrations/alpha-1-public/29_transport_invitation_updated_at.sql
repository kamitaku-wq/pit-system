-- Phase 28-A: transport_order_invitations.updated_at 列追加 (set_updated_at trigger fix)
-- 20_triggers.sql:236 で trg_set_updated_at が attach されているが、
-- 12_transport.sql:84-101 の table 定義に updated_at 列が無く、UPDATE 実行時に
-- "record \"new\" has no field \"updated_at\"" (Loop accept 経路で発火) を吐いていた。
-- spec/data-model.md §3 line 105 + §15.8 line 1590 で全テーブル必須カラム。
-- alpha-1-public 27 ファイル touch 不可 invariant のため ALTER TABLE で正規化する。

ALTER TABLE public.transport_order_invitations
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();
