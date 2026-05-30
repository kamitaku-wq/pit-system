-- Phase 64-C.1: auto 確定 (L3-7 の auto 側)。
--   confirmation_mode='auto' の transport_order が accepted へ遷移したとき、店舗確定
--   (store_confirmed_at) を同 UPDATE 内で自動セットする BEFORE UPDATE trigger を追加する。
--
-- 背景 / 設計判断:
--   - accept は respond_to_transport_order RPC (24_vendor_rpcs.sql, SECURITY DEFINER) が
--     `UPDATE transport_orders SET status_id = accepted` で実行する。この RPC は alpha-1-public の
--     **touch 不可 invariant** 対象。auto 確定ロジックは RPC を改変せず追加する必要がある。
--   - store_confirmed_at は vendor の column-level GRANT UPDATE (19_rls_policies.sql:348-361) に
--     **含まれない**ため、vendor session の直接 UPDATE では書けない。SECURITY DEFINER 経路が必須。
--   - そこで「accept の UPDATE OF status_id」に BEFORE trigger を張り、NEW.store_confirmed_at を
--     セットする。trigger は RPC の UPDATE 内 (definer 文脈) で発火し、NEW 列の書込は column GRANT の
--     制約を受けない。RPC 本体を CREATE OR REPLACE で複製する (= 24_vendor_rpcs と二重定義になり
--     drift する) 案より低 drift で、touch 不可 invariant も守れる。
--   - manual 確定 (confirmation_mode='manual') は店舗の confirmAction (C.2) が store_confirmed_at を
--     セットするため、本 trigger は何もしない。
--   - store_confirmed_by_user_id は auto 確定では NULL (system 確定、ユーザー不在)。
--     store_confirmed_at / store_confirmed_by_user_id を結合する paired-NULL CHECK は
--     12_transport.sql に存在しない (確認済) ため、片側 NULL は制約違反にならない。
--
-- セキュリティ / 冪等性:
--   - trigger 関数は SECURITY DEFINER + search_path 固定。statuses への key 解決 SELECT が
--     呼び出し文脈 (vendor accept = definer / store cancel = authenticated + RLS) に依存せず動くように
--     する (record_audit_log と同方針)。SELECT は company も突合し cross-tenant 解決を防ぐ。
--   - 直接呼び出し surface を塞ぐため PUBLIC/anon/authenticated の EXECUTE を revoke (0028 と同方針)。
--   - DROP TRIGGER IF EXISTS → CREATE で再適用冪等。CREATE OR REPLACE FUNCTION も冪等。
--   - 本 trigger は NEW 列のみ書き換える (cross-tenant write なし)。NEW.status_id が別 company の
--     status を指す異常時は company 突合で v_new_key=NULL となり no-op (enforce_status_transition も別途 reject)。
--
-- 意図的トレードオフ (Phase 64-C.1 adversarial gate / Codex BLOCK の裁定結果):
--   本 trigger は accept の **どの経路** (RPC respond_to_transport_order / vendor の直接 status_id UPDATE) でも
--   発火する。vendor は column GRANT(status_id) (19_rls_policies.sql:358) + vendor_portal_update policy
--   (同:341-344) により RPC を介さず status_id=accepted を直接セット可能 (= RPC の招待 revocation/履歴の
--   side-effect をスキップできる **既存の** バイパス。C.1 が新設したものではない)。本 trigger により、その
--   バイパス経路でも auto 行の store_confirmed_at がセットされる。
--   - これは許容: trigger は confirmation_mode='auto' のみ発火し、auto は「店舗が自動確定を事前承認」した
--     モードゆえ、accept 経路に依らず store_confirmed_at セットは意図どおり。manual 行には発火しないため
--     店舗の手動確定権限は保全される。RPC 内 auto-confirm 案より bypass 露出は広いが auto-gate で無害。
--   - **C.3 への hard checkpoint**: vendor の status 書込機構を確定する際、status_id を 19_rls_policies の
--     vendor GRANT から外し status 遷移を RPC-only にできれば、この accept バイパスを根本的に塞げる。
--     C.3 completeAction が status→completed をどう書くか (直接 UPDATE か SECURITY DEFINER RPC か) と
--     結合するため C.1 では実施しない。詳細は phase-64-c1 handoff 参照。

CREATE OR REPLACE FUNCTION public.auto_confirm_transport_order_on_accept()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_new_key text;
BEGIN
  -- auto かつ未確定かつ実遷移 (status_id が実際に変わる) のときだけ status key を解決する。
  --   - status_id IS DISTINCT FROM OLD.status_id: no-op UPDATE (SET status_id=status_id) での誤発火を防ぐ
  --     (enforce_status_transition 20_triggers.sql:83 と同じガード)。
  --   - manual / 確定済は短絡して SELECT しない。
  IF NEW.confirmation_mode = 'auto'
     AND NEW.store_confirmed_at IS NULL
     AND NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    SELECT s.key
      INTO v_new_key
    FROM public.statuses s
    WHERE s.id = NEW.status_id
      AND s.company_id = NEW.company_id
      AND s.status_type = 'transport'
      AND s.is_active = true; -- RPC (24_vendor_rpcs:71) と全 key 解決 SELECT に対称。soft-disable された accepted での誤発火を防ぐ

    IF v_new_key = 'accepted' THEN
      -- accept の UPDATE と同一文・同一 TX で店舗確定をセット。
      NEW.store_confirmed_at := now();
      -- system 確定 (ユーザー不在) を明示。万一 by_user_id が非 NULL だった行でも誤帰属を防ぐ。
      NEW.store_confirmed_by_user_id := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_confirm_transport_order_on_accept() FROM PUBLIC, anon, authenticated;

-- enforce_status_transition (20_triggers.sql) と同じ BEFORE UPDATE OF status_id に張る。
-- 両者は独立 (一方は遷移検証、本 trigger は store_confirmed_at セット)。
DROP TRIGGER IF EXISTS trg_auto_confirm_on_accept ON public.transport_orders;
CREATE TRIGGER trg_auto_confirm_on_accept
  BEFORE UPDATE OF status_id ON public.transport_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.auto_confirm_transport_order_on_accept();
