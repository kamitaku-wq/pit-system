-- Phase 64-C.0: transport status に `completed` を追加し、`accepted → completed` 遷移を seed する。
--
-- 目的 (DB-layer blocker の解消):
--   業者完了報告 (L2-12 completeAction, Phase 64-C.3) が transport_orders.status_id を
--   accepted から completed へ進めるための前提。現状 seed (0012/0015) は
--   requested / accepted / rejected / cancelled の 4 status + 5 transition のみで、
--   `completed` status も `accepted → completed` 遷移も存在しない。このため
--   enforce_status_transition trigger (20_triggers.sql, transport_orders の
--   BEFORE UPDATE OF status_id) が「遷移先不在」として UPDATE を P0001 で reject する。
--
-- 設計 = 案A 最小 (D1 確定, [2026-05-29 ユーザー決定]):
--   coarse status = requested → accepted → completed
--                   (+ 業者対応不可時 rejected / キャンセル時 cancelled)。
--   引取 / 搬入 / 返却の granular 進捗は status を増やさず、transport_orders の
--   picked_up_at / delivered_at / returned_at の timestamp 列で追跡する。
--   店舗確定 / 未確定は store_confirmed_at IS NULL で判定する (新 status 不要)。
--   spec requirements.md §17.1 の「回送手配中 / 移動中 / 返却移動中」フェーズ status は
--   MVP 非実装 (将来 additive 拡張、spec の概念一覧は将来要件として残す)。
--
-- 既存 seed 機構への合流 (新規 INSERT を直接書かず 0015 の SECURITY DEFINER 関数を CREATE OR REPLACE):
--   - seed_transport_statuses_for_company(uuid) に completed status と
--     accepted → completed 遷移を追加する。既存 4 status / 5 transition は VALUES に維持。
--   - ON CONFLICT DO NOTHING のため、既存行は更新されない (冪等)。新規行のみ INSERT。
--   - companies AFTER INSERT trigger (0013) と wrapper 関数 (0015) は不変。
--     新規 company は trigger 経由で自動的に completed まで seed される。
--   - 既存 company は末尾の backfill DO ブロックで関数を再 PERFORM する (0023 の作法を踏襲)。
--
-- triggers_notification = true で seed する根拠 (既存 blanket-true への 1 行追記 = 最小 diff):
--   - 本列は spec/requirements.md §637 で「triggers_notification=true の遷移が outbox 行を生成する」と
--     規定されているが、その flag 駆動 dispatch は **未配線**。現状の consumer は schema 定義 /
--     status-transitions master CRUD service / admin 管理 UI の「通知」表示のみで、enforce_status_transition
--     trigger (20_triggers.sql) は遷移存在チェックのみ・本列を読まない。outbox dispatcher は
--     notification_outbox から直接 dequeue する。よって本列は dispatch に対し現状 inert。
--   - 既存 transition は cancel を含め全件 true で seed されている (0015)。cancel は cancelTransportOrder が、
--     completed は completeAction (C.3) が、それぞれ service 層で outbox を明示 enqueue する。
--     completed を cancel と同一バケットに置き true で揃える (plan の `false` は採らない)。
--   - **既知の系統的課題 (将来 flag 駆動 dispatch 実装時)**: §637 の auto-enqueue を実装する際は、
--     explicit enqueue を持つ全 transition (cancel / completed / confirmed 系) の本 flag を service 層
--     enqueue と監査し、二重送信を防ぐため false へ揃える必要がある。completed だけ今 false にしても
--     cancel が true のまま残るため将来の監査作業を減らさず、現在の表示非一貫と SECURITY DEFINER ブロック
--     再構築 (= 既存 transition 破壊リスク拡大) を機能差ゼロで招くだけなので採らない。詳細は handoff 参照。
--
-- 実行 role: service_role / db owner (RLS bypass)。SECURITY DEFINER + search_path 固定。
-- 冪等: ON CONFLICT DO NOTHING。さらに _raw_migrations PK でファイル単位の再適用も skip。
--
-- defense in depth (Phase 64-C.0 adversarial gate / Codex 指摘): 本関数は SECURITY DEFINER で
-- tenant テーブル (statuses / status_transitions) に書き込むため、任意の target_company_id を渡せる
-- RPC surface を塞ぐべく PUBLIC/anon/authenticated の EXECUTE を末尾で revoke する。新規 company の
-- 自動 seed は trigger wrapper (0015, 同じく SECURITY DEFINER) が definer 権限で呼ぶため revoke の影響を
-- 受けない。backfill も migration role (owner) で動く。CREATE OR REPLACE は既存権限を保持するため、
-- 0015 以来 default のまま PUBLIC に EXECUTE が残っていた状態を本 migration で是正する。
-- NOTE: reservation 版 seed_reservation_statuses_for_company (0023) も同一 gap を持つ → 別 phase で follow-up。

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
    (target_company_id, 'transport', 'rejected', 'Rejected', 30, false, true, true),
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
    ('rejected', 'cancelled')
  ) AS pairs(from_key, to_key)
  INNER JOIN public.statuses fs
    ON fs.company_id = target_company_id AND fs.status_type = 'transport' AND fs.key = pairs.from_key
  INNER JOIN public.statuses ts
    ON ts.company_id = target_company_id AND ts.status_type = 'transport' AND ts.key = pairs.to_key
  ON CONFLICT (company_id, status_type, from_status_id, to_status_id) DO NOTHING;
END;
$$;

-- SECURITY DEFINER 関数の RPC surface を塞ぐ (20_triggers.sql:268 / 23_record_audit_log.sql:115 と同パターン)。
-- trigger wrapper (definer 権限) と migration backfill (owner) は影響を受けない。REVOKE は冪等。
REVOKE EXECUTE ON FUNCTION public.seed_transport_statuses_for_company(uuid) FROM PUBLIC, anon, authenticated;

-- 既存 company の backfill (冪等: ON CONFLICT DO NOTHING で新規行のみ INSERT)。0023 の作法を踏襲。
DO $$
DECLARE
  c record;
BEGIN
  FOR c IN SELECT id FROM public.companies LOOP
    PERFORM public.seed_transport_statuses_for_company(c.id);
  END LOOP;
END;
$$;
