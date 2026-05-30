-- Phase 64-C.4.0: 業者対応不可フォールバックの状態モデル補正 (rejected を stall = 非 terminal 化)。
--
-- 目的 (L3-3 次候補打診 / L3-4 希望日時変更再依頼 / L3-5 手動切替 の DB-layer 前提):
--   業者が対応不可 (全 invitation rejected) のとき close_transport_order が order を 'rejected' に
--   遷移させるが、現状 seed (post/0028) では 'rejected' が is_terminal=true (= 終端) になっている。
--   フォールバック (再打診 / 日時変更再依頼 / 手動切替) は「rejected → requested で同一 order を
--   再オープン」する設計 (案A, D-C4-1 ユーザー確定) ゆえ、'rejected' は真の終端ではなく
--   「業者が断った → 店舗が次手を判断する」stall 状態に補正する必要がある。
--
-- architect reframe (確定根拠):
--   'rejected' を terminal とする現分類は遷移グラフと矛盾する誤分類だった。'rejected → cancelled'
--   遷移は post/0012 以来 seed 済 = 終端から出る辺が存在し、is_terminal=true と整合しない。
--   真の終端は 'completed' / 'cancelled' のみ。本 migration で 'rejected' を非 terminal 化し、
--   再オープン用の 'rejected → requested' 遷移を追加する。
--
-- 本 migration が行うこと (C.4.0 スコープ厳守。再割当 service は C.4.1 = TS 層、本 migration に含めない):
--   1. seed_transport_statuses_for_company() を CREATE OR REPLACE:
--      - 'rejected' status を is_terminal=false で seed (新規 company 向け)。
--      - 'rejected → requested' 遷移を追加 (既存 6 遷移は維持)。
--   2. close_transport_order() を CREATE OR REPLACE: rejected status の lookup から
--      `is_terminal = true` 述語を除去する (下記 §close 参照。**この修正がないと通常の reject フローが全死する**)。
--   3. backfill (既存 company): rejected の is_terminal を false へ UPDATE + 新遷移を全 company に追加。
--   4. spec/data-model.md §15.5 / §17.1 注記 (本 migration 適用と同 commit で別途 Edit)。
--
-- §close ── close_transport_order の修正が必須な理由 (plan の blast-radius が見落としていた盲点):
--   alpha-1-public/25_close_transport_order.sql:51-59 は遷移先の rejected status を
--     `WHERE key='rejected' AND is_terminal=true AND is_active=true`
--   で引いている。'rejected' を is_terminal=false 化すると、この SELECT が NULL を返し
--   `RAISE EXCEPTION 'terminal transport status not seeded'` (P0002) となる。close_transport_order は
--   respondToTransportOrder (登録 vendor reject) と respondToSpotInvitation (spot reject) の **両方** が
--   closeTransportOrderOnAllRejected 経由で呼ぶため、補正しないと **通常の業者対応不可フロー全体が壊れる**。
--   修正方針 = option (a): lookup から is_terminal 述語を外し `key='rejected'` (+ is_active) で引く。
--   この関数の契約は「全 invitation rejected のとき order を 'rejected' stall へ遷移させる」であり、
--   元の「is_terminal=true の行を terminal とみなす」コメントは key='rejected' をハードコードしていた
--   leaky abstraction だった。option (a) はコードを契約どおりに正直にするだけで、終端判定とは無関係。
--
-- drift surface の明示 (advisor 指摘 / 0028 と同作法):
--   - seed_transport_statuses_for_company の canonical 定義は本 0033 が takeover する
--     (定義系譜: 0012 直接 INSERT → 0015 関数化 → 0028 completed 追加 → 0033 rejected stall 化)。
--     将来 transport status 値を変える場合は **本 0033 のみ** を修正する。0012/0015/0028 は historical artifact。
--   - close_transport_order の canonical 定義も本 0033 が takeover する (元 = alpha-1-public/25)。
--     db:setup 適用順 (alpha-1-public → post) により 0033 が最終定義となる。close ロジック変更時は
--     本 0033 を修正する。alpha-1-public/25 は historical artifact (touch しない)。
--
-- triggers_notification の選択 (plan の `false` から `true` へ意図的に変更, 敵対的 gate で要裁定):
--   新遷移 'rejected → requested' は 0028 の blanket-true 慣習に揃えて triggers_notification=true で seed する。
--   - 根拠: triggers_notification は flag 駆動 dispatch が **未配線** (0028 詳述) ゆえ現状 inert。
--     true/false いずれも機能差ゼロ (admin UI の「通知」表示が異なるのみ)。再オープン通知は C.4.1 service が
--     outbox を明示 enqueue する。
--   - plan は `false` を提案したが、cancel/accepted/completed が全て true のまま 'rejected→requested' だけ
--     false にしても将来の flag 駆動 dispatch 監査作業を減らさず (全 explicit-enqueue 遷移を一括 false 化する
--     必要は変わらない)、seed 関数の INSERT 構造を per-row flag 化する分の drift リスクだけ増やす。0028 が
--     completed で同じ判断 (blanket-true 維持) を下した先例に揃え、minimal diff (VALUES に 1 行追加) とする。
--   - **将来 flag 駆動 dispatch 実装時の TODO**: explicit enqueue を持つ全遷移 (cancel / completed /
--     rejected→requested / confirmed 系) の本 flag を service 層 enqueue と監査し二重送信を防ぐ (0028 と同課題)。
--
-- 実行 role: service_role / db owner (RLS bypass)。SECURITY DEFINER + search_path 固定。
-- 冪等: ON CONFLICT DO NOTHING / 条件付き UPDATE / CREATE OR REPLACE。db:setup 再実行で全文再適用されるため
--   SQL 自体が冪等であること必須 (apply-raw-sql.ts は全 .sql を毎回 sort 順で実行する)。

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) seed 関数 takeover: rejected を is_terminal=false で seed + rejected→requested 遷移を追加
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.seed_transport_statuses_for_company(target_company_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  INSERT INTO public.statuses (company_id, status_type, key, name, display_order, is_initial, is_terminal, is_active)
  VALUES
    (target_company_id, 'transport', 'requested', 'Requested', 10, true, false, true),
    (target_company_id, 'transport', 'accepted', 'Accepted', 20, false, false, true),
    (target_company_id, 'transport', 'completed', 'Completed', 25, false, true, true),
    -- C.4.0: rejected は stall (非 terminal)。再打診で requested へ再オープンする。
    (target_company_id, 'transport', 'rejected', 'Rejected', 30, false, false, true),
    (target_company_id, 'transport', 'cancelled', 'Cancelled', 40, false, true, true)
  ON CONFLICT (company_id, status_type, key) DO NOTHING;

  INSERT INTO public.status_transitions (company_id, status_type, from_status_id, to_status_id, triggers_notification)
  SELECT target_company_id, 'transport', fs.id, ts.id, true
  FROM (VALUES
    ('requested', 'accepted'),
    ('requested', 'rejected'),
    ('accepted', 'completed'),
    ('accepted', 'cancelled'),
    ('requested', 'cancelled'),
    ('rejected', 'cancelled'),
    -- C.4.0: 業者対応不可後の再オープン (次候補打診 / 希望日時変更再依頼 / 手動切替)。
    ('rejected', 'requested')
  ) AS pairs(from_key, to_key)
  INNER JOIN public.statuses fs
    ON fs.company_id = target_company_id AND fs.status_type = 'transport' AND fs.key = pairs.from_key
  INNER JOIN public.statuses ts
    ON ts.company_id = target_company_id AND ts.status_type = 'transport' AND ts.key = pairs.to_key
  ON CONFLICT (company_id, status_type, from_status_id, to_status_id) DO NOTHING;
END;
$$;

-- SECURITY DEFINER 関数の RPC surface を塞ぐ (0028 と同方針)。CREATE OR REPLACE は既存権限を保持するが
-- 自己完結のため明示的に再 REVOKE する (冪等)。
REVOKE EXECUTE ON FUNCTION public.seed_transport_statuses_for_company(uuid) FROM PUBLIC, anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) close_transport_order takeover (§close 参照)
--    元 = alpha-1-public/25_close_transport_order.sql。本 0033 が canonical を takeover する。
--    変更点 (元 25 からの差分):
--    (a) rejected status lookup から `is_terminal=true` 述語を除去 (rejected stall 化との整合)。
--    (b) ambiguous column 修正: invitation 集計の `WHERE transport_order_id = ...` は OUT パラメータ
--        `transport_order_id` (RETURNS TABLE 列) と transport_order_invitations.transport_order_id 列の
--        両方に解決し `column reference "transport_order_id" is ambiguous` (plpgsql_post_column_ref) で
--        実行時エラーになる。元 25 から潜在していたが 25 は適用済 SKIP で休眠しており本 0033 の
--        CREATE OR REPLACE で初めて顕在化した。テーブル別名 toi で qualify して解消 (post/0006 と同作法)。
--    (c) 冪等 close ガード (Codex adversarial BLOCK #2): order が既に 'rejected' なら重複 status_history を
--        書かず closed=false で早期 return する。再オープン後の再 close は v_pending>0 で別途弾かれるが、
--        直接 RPC 連打・二重実行への防御を明示する。
--
--    cross-tenant 露出 (Codex adversarial BLOCK #1, scope 判断): 本関数は SECURITY DEFINER + authenticated
--    GRANT で order の company チェックを持たない。これは元 25 と同一の pre-existing 条件で 0033 が新設した
--    ものではない。正規 caller は respond/spot reject path (TS closeTransportOrderOnAllRejected, authenticated
--    vendor session) のみ。任意 order への直接 call は (a) 全 invitation rejected でなければ no-op、(b) 既
--    rejected なら冪等ガードで no-op、(c) 書込先 company は order 由来 (cross 書込なし) ゆえ実害は限定的
--    (既 rejected 確定 order の再確定 + P0002 による UUID probing)。authenticated 剥奪は TS caller が
--    authenticated session で呼ぶため不可 (RPC 内 call 化は touch 不可の 24/27 改変が必要)。company-scope
--    認可の本格対応は follow-up #1/#2 と同様 専用 least-privilege sweep に defer する。
CREATE OR REPLACE FUNCTION public.close_transport_order(p_transport_order_id uuid)
RETURNS TABLE(
  transport_order_id uuid,
  closed boolean,
  new_status_id uuid,
  history_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_company_id uuid;
  v_from_status_id uuid;
  v_from_key text;
  v_rejected_status_id uuid;
  v_accepted int;
  v_pending int;
  v_rejected int;
  v_history_id uuid;
BEGIN
  SELECT tro.company_id, tro.status_id, s.key
    INTO v_company_id, v_from_status_id, v_from_key
  FROM public.transport_orders tro
  LEFT JOIN public.statuses s ON s.id = tro.status_id
  WHERE tro.id = p_transport_order_id
  FOR UPDATE OF tro;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'transport_order not found: %', p_transport_order_id
      USING ERRCODE = 'P0002';
  END IF;

  -- 冪等ガード (BLOCK #2): 既に rejected stall 終端なら重複 close しない。
  IF v_from_key = 'rejected' THEN
    RETURN QUERY SELECT p_transport_order_id, false, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- 全 invitation の応答を集計する。revoked / expired は除外 (現 attempt の応答のみが close 判定対象)。
  -- C.4.1 の再オープンは旧 invitation を revoked にし新 pending を立てるため、再オープン後は v_pending>0 で
  -- close は false を返し再発火しない (D-C4-5 確定: revoked は本集計に算入されない)。
  -- ambiguous 修正 (b): toi 別名で qualify (response/transport_order_id とも OUT 列衝突回避)。
  SELECT
    COUNT(*) FILTER (WHERE toi.response = 'accepted'),
    COUNT(*) FILTER (WHERE toi.response = 'pending'),
    COUNT(*) FILTER (WHERE toi.response = 'rejected')
  INTO v_accepted, v_pending, v_rejected
  FROM public.transport_order_invitations toi
  WHERE toi.transport_order_id = p_transport_order_id;

  IF v_accepted > 0 OR v_pending > 0 OR v_rejected = 0 THEN
    RETURN QUERY SELECT p_transport_order_id, false, NULL::uuid, NULL::uuid;
    RETURN;
  END IF;

  -- C.4.0: 全 invitation rejected のとき order を 'rejected' stall 状態へ遷移させる。
  -- rejected は is_terminal=false に補正されたため、以前の `AND is_terminal = true` 述語は使わない
  -- (使うと NULL → P0002 で reject フロー全死する)。key='rejected' の active status を直接引く。
  SELECT s.id
    INTO v_rejected_status_id
  FROM public.statuses s
  WHERE s.company_id = v_company_id
    AND s.status_type = 'transport'
    AND s.key = 'rejected'
    AND s.is_active = true
  LIMIT 1;

  IF v_rejected_status_id IS NULL THEN
    RAISE EXCEPTION 'rejected transport status not seeded for company %', v_company_id
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.transport_orders
     SET status_id = v_rejected_status_id,
         vendor_response = 'rejected',
         updated_at = now()
   WHERE id = p_transport_order_id;

  INSERT INTO public.transport_order_status_history (
    company_id, transport_order_id, from_status_id, to_status_id,
    changed_by_user_id, reason
  ) VALUES (
    v_company_id, p_transport_order_id, v_from_status_id, v_rejected_status_id,
    NULL, 'all invitations rejected (auto close)'
  ) RETURNING id INTO v_history_id;

  RETURN QUERY SELECT p_transport_order_id, true, v_rejected_status_id, v_history_id;
END;
$$;

-- 元 (alpha-1-public/25) の GRANT を保持する。close は respond RPC と同 tx 内で authenticated 経路から呼ばれる。
GRANT EXECUTE ON FUNCTION public.close_transport_order(uuid) TO authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) backfill 既存 company (冪等)
-- ─────────────────────────────────────────────────────────────────────────────
-- 3a) 既存 company の 'rejected' を非 terminal 化。条件付きで spurious updated_at bump を避ける。
UPDATE public.statuses
   SET is_terminal = false
 WHERE status_type = 'transport'
   AND key = 'rejected'
   AND is_terminal = true;

-- 3b) 全 company に新遷移 ('rejected → requested') を追加 (seed 関数経由、ON CONFLICT DO NOTHING で冪等)。
--     既存 status の is_terminal は seed 関数の ON CONFLICT DO NOTHING では変わらないため 3a が担保する。
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT id FROM public.companies LOOP
    PERFORM public.seed_transport_statuses_for_company(c.id);
  END LOOP;
END;
$$;
