# Phase B-1a: 5 helper functions for `public` schema

## ゴール

`src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql` を **完全置換** して、5 つの helper 関数を実装する。現在は `-- implemented in Phase B-1a` のスタブのみ。

## 重要原則: spec §14.2 のコードをそのまま貼らない

spec/data-model.md §14.2 のサンプルコードは PoC schema 由来。alpha-1-public の実 DDL と 3 点乖離しているため、**DDL を真実の源として翻訳** すること。spec をコピーするな。

## 出力要件

1. **ファイル全体を上書き** (PowerShell から Write)
2. **先頭に 3 行 SQL コメント** で spec 偏差を記録 (下記の正確な文言)
3. **5 関数 すべて** `CREATE OR REPLACE FUNCTION public.<name>` で定義
4. **schema 修飾**: 関数本体内の table 参照は `public.<table>` で書く (Phase A-2 で users.ts 乖離が発生した教訓)
5. SQL のみ。実行・apply は不要

## ファイル先頭コメント (この 3 行をそのまま貼る)

```sql
-- spec §14.2 deviations from alpha-1-public DDL (SQL is source of truth):
--   1. vendor_users links to auth via auth_user_id (not id); use is_active + deleted_at IS NULL
--   2. vendor_company_memberships uses (starts_on, ends_on) time window (no is_enabled column)
--   3. vendors join adds deleted_at IS NULL guard
```

## 5 関数の正確な仕様

### 1. `current_user_company_id() RETURNS uuid`
- LANGUAGE sql STABLE SECURITY DEFINER
- `SET search_path = public, pg_temp`
- 本体:
```sql
SELECT company_id
FROM public.users
WHERE id = auth.uid()
  AND is_active = true
  AND deleted_at IS NULL
LIMIT 1
```

### 2. `current_vendor_id() RETURNS uuid`
- LANGUAGE sql STABLE SECURITY DEFINER
- `SET search_path = public, pg_temp`
- 本体 (auth_user_id で join、is_active + deleted_at):
```sql
SELECT vendor_id
FROM public.vendor_users
WHERE auth_user_id = auth.uid()
  AND is_active = true
  AND deleted_at IS NULL
LIMIT 1
```

### 3. `current_vendor_user_id() RETURNS uuid`
- LANGUAGE sql STABLE SECURITY DEFINER
- `SET search_path = public, pg_temp`
- 本体:
```sql
SELECT id
FROM public.vendor_users
WHERE auth_user_id = auth.uid()
  AND is_active = true
  AND deleted_at IS NULL
LIMIT 1
```

### 4. `vendor_accessible_company_ids(p_vendor_id uuid) RETURNS SETOF uuid`
- LANGUAGE sql STABLE  (※ SECURITY DEFINER は付けない — SETOF はクエリ呼び出し側 RLS でフィルタ済み前提)
- `SET search_path = public, pg_temp`
- 本体 (vendors の company + memberships の time-window 内 company を UNION):
```sql
SELECT company_id
FROM public.vendors
WHERE id = p_vendor_id
  AND deleted_at IS NULL
UNION
SELECT company_id
FROM public.vendor_company_memberships
WHERE vendor_id = p_vendor_id
  AND (starts_on IS NULL OR starts_on <= CURRENT_DATE)
  AND (ends_on IS NULL OR ends_on >= CURRENT_DATE)
```

### 5. `vendor_invited_transport_order_ids(p_vendor_id uuid) RETURNS SETOF uuid`
- LANGUAGE sql STABLE
- `SET search_path = public, pg_temp`
- 本体 (response NOT IN 除外 + deleted_at):
```sql
SELECT transport_order_id
FROM public.transport_order_invitations
WHERE vendor_id = p_vendor_id
  AND response NOT IN ('revoked', 'expired')
  AND deleted_at IS NULL
```

## GRANT (ファイル末尾に追加)

```sql
GRANT EXECUTE ON FUNCTION public.current_user_company_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_vendor_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.current_vendor_user_id() TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_accessible_company_ids(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vendor_invited_transport_order_ids(uuid) TO authenticated;
```

## 禁止事項

- spec §14.2 のサンプル SQL をコピペしない (3 点乖離のため壊れる)
- `SET search_path` 省略しない (SECURITY DEFINER の必須対策)
- table 名を schema 修飾なしで書かない (Phase A-2 教訓)
- DROP FUNCTION や migration tracking は書かない (apply は別工程)
- typecheck / pnpm 実行はしない (Phase A-2 で sandbox spawn error 多発の教訓)

## 完了条件

- ファイルが ~70-80 行程度に収まる
- 5 関数すべて CREATE OR REPLACE で書かれる
- 5 GRANT 文がある
- 先頭 3 行コメントが正確に貼られる
