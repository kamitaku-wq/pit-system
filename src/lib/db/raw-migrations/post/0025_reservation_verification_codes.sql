-- Phase 64-A.32a: 顧客公開予約フローの email 6 桁コード本人確認 (security core)
-- spec/requirements.md §12.1 step6-7 / §12.3 / spec/data-model.md §3.x (新規)
--
-- create-on-confirm (A.29 sealed): 予約はコード検証「後」に作成されるため、検証コードは
-- reservation_id を持てない (customer_reservation_tokens は reservation_id NOT NULL)。
-- → 予約に先行する独立した検証状態テーブルを新設。company_id + email でスコープする。
--
-- 6 桁コード = ~20bit と低エントロピーのため、token (256bit) と異なり以下を必須とする:
--   ・active コードは (company_id, email) 毎に最大 1 件 (partial unique index)
--     → concurrent issue を直列化し、ORDER BY created_at の決定論性を DB レベルで保証する。
--   ・試行回数制限 + ロック (attempt_count >= max_attempts で verify 不可)
--   ・短 TTL (expires_at) / single-use (consumed_at) / supersede (再発行で旧 active を consume)
--   ・code_hash は HMAC-SHA256(pepper, companyId:email:code) を保存。生コードは保存しない。
--     pepper は環境変数のみに保持し DB には格納しない (DB 読取漏洩でもコード逆引き不能)。
--     HMAC に email/companyId を畳み込むことで email binding を暗号構造レベルで強制する。
--   ・送信レート制限 (IP/global) + Turnstile は A.33 (spec §12.3 L1/L3)。
--     公開 route の本番露出は A.33 完了が hard 依存 (再発行で attempt_count がリセットされるため)。
--
-- email binding (最重要 invariant): コードは特定 email 宛に発行され、verify は (company_id, email)
--   で active 行を引く。別 email で他人の予約を確定する攻撃は「その email 宛コードが無い」=
--   not_found で構造的に塞がる (A.32b は customer.email を verify が返す verifiedEmail から取る契約)。
--
-- 設計詳細・敵対的レビュー反映: phase-handoff/phase-64-a32a-design-plan.md。
--
-- onDelete CASCADE: ephemeral・非業務データのため company ライフサイクルをブロックしない
--   (customer_reservation_tokens の company restrict とは意図的に異なる)。
-- updated_at は trigger を置かず service の全 UPDATE で明示セットする (canonical 踏襲)。
-- 冪等: テーブル・index とも IF NOT EXISTS。
CREATE TABLE IF NOT EXISTS public.reservation_verification_codes (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES public.companies(id) ON DELETE CASCADE,
  email         text NOT NULL,
  code_hash     text NOT NULL,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts  integer NOT NULL DEFAULT 5,
  expires_at    timestamptz NOT NULL,
  consumed_at   timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reservation_verification_codes_attempt_count_nonneg CHECK (attempt_count >= 0),
  CONSTRAINT reservation_verification_codes_max_attempts_positive CHECK (max_attempts > 0),
  -- email は service の normalizeEmail (trim + lower) で正規化済みを格納する backstop。
  CONSTRAINT reservation_verification_codes_email_normalized CHECK (email = lower(email))
);

-- active コードは (company_id, email) 毎に最大 1 件 (concurrent issue 直列化 / 決定論)。
-- issue の supersede+INSERT が競合すると 23505 を返すため service 側で retry する。
CREATE UNIQUE INDEX IF NOT EXISTS reservation_verification_codes_active_per_email_uniq
  ON public.reservation_verification_codes (company_id, email)
  WHERE consumed_at IS NULL;

-- A.33 の TTL purge job (pg_cron) 用に先行定義。
CREATE INDEX IF NOT EXISTS reservation_verification_codes_expires_at_idx
  ON public.reservation_verification_codes (expires_at);

-- RLS (customer_reservation_tokens canonical 踏襲、敵対的レビュー HIGH 対応)。
-- RLS 未有効だと Supabase anon/authenticated ロールが PostgREST 経由で本テーブルを直読み・改ざんでき、
-- attempt_count 改ざんでロック回避・既知 code_hash 注入で検証偽装が可能になる (auth bypass)。
-- ENABLE で anon は policy 不在ゆえ全行不可視 (0 行)。authenticated は同 company のみ (canonical パリティ)。
-- 本テーブルの唯一の writer は service_role (RLS bypass) = reservation-verification-codes service。
ALTER TABLE public.reservation_verification_codes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON public.reservation_verification_codes;
CREATE POLICY tenant_isolation ON public.reservation_verification_codes
  FOR ALL TO authenticated
  USING (company_id = public.current_user_company_id())
  WITH CHECK (company_id = public.current_user_company_id());
