# Phase C-2a: 標準 trigger 5 種 (Codex 委任)

## ゴール

既存ファイル `src/lib/db/raw-migrations/alpha-1-public/20_triggers.sql` (現状 stub) を **完全置換** して 5 種の標準 trigger を実装。

注意: `record_audit_log` trigger は **本ファイルに含めない** (Phase C-2b で 23_record_audit_log.sql に分離、Claude 単独 Critical)。

## 5 trigger 群

### (1) set_updated_at (BEFORE UPDATE)

```sql
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;
```

対象テーブル (全 47 - updated_at 列を持つもの。`audit_logs` は append-only で除外):

```
companies / company_settings / system_settings / reservation_settings /
users / user_store_memberships / roles / permissions /
statuses / status_transitions /
stores / store_business_hours / store_holidays /
lane_types / lanes / lane_working_hours / lane_work_menus / work_categories / work_menus /
customers / vehicles / vehicle_ownerships / customer_reservation_tokens /
service_tickets / reservations / reservation_status_history /
vendors / vendor_users / vendor_company_memberships / vendor_service_areas /
vendor_available_stores / vendor_available_days / vendor_sla_overrides / vendor_selection_logs /
transport_orders / transport_order_status_history / transport_order_change_logs /
transport_order_vendor_attempts / transport_order_invitations /
notification_rules / notification_outbox / notification_deliveries / vendor_portal_inbox /
attachments / pii_anonymization_jobs
```

除外: `audit_logs` (append-only) / `user_sessions` (updated_at なし)。

各テーブルに:
```sql
CREATE TRIGGER trg_set_updated_at BEFORE UPDATE ON public.<table>
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
```

### (2) enforce_status_transition (BEFORE UPDATE OF status_id)

spec/data-model.md §15.5 / status_transitions マスター。reservations / service_tickets / transport_orders で status_id 変更時、status_transitions に from_status_id → to_status_id 行があることを検証。

```sql
CREATE OR REPLACE FUNCTION public.enforce_status_transition()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.status_id IS DISTINCT FROM OLD.status_id THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.status_transitions st
      WHERE st.company_id = NEW.company_id
        AND st.from_status_id = OLD.status_id
        AND st.to_status_id = NEW.status_id
    ) THEN
      RAISE EXCEPTION 'invalid status transition: % -> % on %', OLD.status_id, NEW.status_id, TG_TABLE_NAME
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_status_transition BEFORE UPDATE OF status_id ON public.reservations
  FOR EACH ROW EXECUTE FUNCTION public.enforce_status_transition();
CREATE TRIGGER trg_enforce_status_transition BEFORE UPDATE OF status_id ON public.service_tickets
  FOR EACH ROW EXECUTE FUNCTION public.enforce_status_transition();
CREATE TRIGGER trg_enforce_status_transition BEFORE UPDATE OF status_id ON public.transport_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_status_transition();
```

### (3) enforce_vendor_user_tenancy (BEFORE INSERT/UPDATE)

vendor_users.company_id は vendors.company_id と一致必須。PoC sync_vendor_user_company_id を改名 + 強化。

```sql
CREATE OR REPLACE FUNCTION public.enforce_vendor_user_tenancy()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_vendor_company_id uuid;
BEGIN
  SELECT v.company_id INTO v_vendor_company_id
  FROM public.vendors v
  WHERE v.id = NEW.vendor_id;

  IF v_vendor_company_id IS NULL THEN
    RAISE EXCEPTION 'vendor_id % does not exist', NEW.vendor_id USING ERRCODE = '23503';
  END IF;

  -- INSERT 時は company_id を自動設定、UPDATE 時は一致確認
  IF TG_OP = 'INSERT' THEN
    NEW.company_id := v_vendor_company_id;
  ELSIF NEW.company_id IS DISTINCT FROM v_vendor_company_id THEN
    RAISE EXCEPTION 'vendor_users.company_id (%) must match vendors.company_id (%)',
      NEW.company_id, v_vendor_company_id USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_vendor_user_tenancy BEFORE INSERT OR UPDATE OF vendor_id, company_id ON public.vendor_users
  FOR EACH ROW EXECUTE FUNCTION public.enforce_vendor_user_tenancy();
```

### (4) enforce_membership_shared (BEFORE INSERT/UPDATE)

spec ADR-0001 / vendor_company_memberships の `is_shared` 整合。同一 vendor が複数 company に登録される場合は `is_shared = true` 必須。

```sql
CREATE OR REPLACE FUNCTION public.enforce_membership_shared()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  v_other_companies int;
BEGIN
  SELECT count(*) INTO v_other_companies
  FROM public.vendor_company_memberships vcm
  WHERE vcm.vendor_id = NEW.vendor_id
    AND vcm.company_id <> NEW.company_id;

  IF v_other_companies > 0 AND NEW.is_shared = false THEN
    RAISE EXCEPTION 'vendor % is registered to multiple companies, is_shared must be true', NEW.vendor_id
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_enforce_membership_shared BEFORE INSERT OR UPDATE ON public.vendor_company_memberships
  FOR EACH ROW EXECUTE FUNCTION public.enforce_membership_shared();
```

### (5) sync_user_delete (AFTER DELETE on auth.users)

auth.users が削除された時、public.users / public.vendor_users.auth_user_id を NULL に。Supabase 標準 `ON DELETE SET NULL` で十分なはずだが、追加の clean-up trigger。

実際: public.users は `id REFERENCES auth.users(id) ON DELETE CASCADE` で消える。vendor_users.auth_user_id は `ON DELETE SET NULL`。  
**結論: 既存 FK で十分、本 trigger は最小限の no-op stub にする** (Plan 整合のため定義のみ残す)。

```sql
CREATE OR REPLACE FUNCTION public.sync_user_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  -- auth.users DELETE 時の補助 cleanup (FK の ON DELETE CASCADE / SET NULL で大半カバー)
  -- 必要な場合のみ追加クリーンアップ (現状 NoOp)
  RETURN OLD;
END;
$$;
-- trigger は auth.users に張れない (権限制限) — 関数だけ定義し、Supabase の trigger 管理機能経由で接続
-- (本 Phase ではスキップ可、Phase D 以降で対応)
```

## 出力要件

1. ファイル全体を **DROP TRIGGER IF EXISTS / DROP FUNCTION IF EXISTS で冪等化** (再 apply 安全)
2. 5 関数 + 全 trigger 文 (set_updated_at × ~44 / enforce_status_transition × 3 / enforce_vendor_user_tenancy × 1 / enforce_membership_shared × 1)
3. ファイル先頭にコメント (5 trigger の役割 / Phase C-2b との分離)
4. 完了行数: ~120-150 行見込み
5. typecheck / pnpm 実行はしない

## 禁止事項

- record_audit_log trigger は本ファイルに **含めない** (Phase C-2b で分離)
- SET search_path 省略しない (advisor WARN function_search_path_mutable を Phase B-2 で検出済)
- audit_logs / user_sessions には set_updated_at を張らない

## 完了確認

- 5 CREATE OR REPLACE FUNCTION
- ~44 set_updated_at triggers
- 3 enforce_status_transition triggers
- 1 enforce_vendor_user_tenancy trigger
- 1 enforce_membership_shared trigger
