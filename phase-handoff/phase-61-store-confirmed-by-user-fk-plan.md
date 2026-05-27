# Phase 61 plan v1: transport_orders.store_confirmed_by_user_id 複合 FK 横展開 (D5)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 61 (前: 60 sealed) |
| 状態 | **plan v1**（Claude 起草、Codex adversarial review 待ち） |
| 起源 | Phase 60 sealed §推奨 #1「debt 台帳 D5+」精査結果。advisor pivot で C (change_type 拡張) は 4 種 service 全未実装の wake-up 領域と判明 → A-narrow (D5 preventive `store_confirmed_by_user_id` 1 件) へ |
| Branch | `phase-42-t4-test-coverage` |
| 起草日時 | 2026-05-27 |
| 担当 | Claude (plan v1 → Codex review → plan v2) → Codex (implementation 委任) |

## 0. D1-D4 (Phase 57-60 sealed) との差異まとめ

| 観点 | D1-D4 | D5 (本 Phase) |
|---|---|---|
| 対象 table 種別 | status_history / change_logs / invitations (aux table) | **transport_orders (本番主要 active table)** ← 初 |
| 対象 column | `*_by_user_id` (audit / invited) | `store_confirmed_by_user_id` (店間確定 future action) |
| service INSERT/UPDATE 経路 | D1 6 / D2 0 / D3 1+RPC / D4 1+4 UPDATE | **0** (column SET 経路ゼロ、createTransportOrder で default NULL) |
| spec 定義状態 | 各 history/invitation 定義済 | **spec requirements.md L582 で `manual` モード時 future use case 確定済 (未実装)** |
| 既存単独 FK | D1 NO ACTION / D2-D4 SET NULL | **SET NULL** (D2-D4 同型、意味変化 NO ACTION) |
| 既存 transport_orders INSERT/UPDATE 経路 retrogression リスク | N/A | **要確認** (createTransportOrder / cancelTransportOrder / status update RPC で `store_confirmed_by_user_id` 不変、default NULL pattern) |
| spec §refs | §7.x / §3.x | **§7.6 transport_orders + requirements §13** |

## 1. 現状実装の整合性スナップショット (Phase 57-60 棚卸し pattern 流用)

**棚卸し手順 (独立実施 — D1-D4 流用禁止)**: 2026-05-27 実施済:
```
rg -n "store_confirmed_by_user_id|storeConfirmedByUserId" src/ scripts/ seed/ tests/ supabase/ drizzle/
```

`store_confirmed_by_user_id` への INSERT/UPDATE は **本番経路 0 箇所**:

| # | 場所 | 内容 | 評価 |
|---|---|---|---|
| - | `src/lib/db/raw-migrations/alpha-1-public/12_transport.sql` L34 | `store_confirmed_by_user_id uuid REFERENCES users(id) ON DELETE SET NULL` | DDL のみ |
| - | `src/lib/db/schema/transport_orders.ts` L64-66 | drizzle schema (`onDelete: "set null"`) | schema のみ |
| - | `src/lib/services/transport-orders.ts` L689/808/852/998/1056/1141 | `storeConfirmedAt` の SELECT 出力 (type 定義 + row mapping) | **SET 経路なし、SELECT のみ** |
| - | `src/app/admin/transport-orders/[id]/page.tsx` L221 | UI 表示 | SELECT 経由 (write なし) |
| - | service / scripts / seed / tests | (none) | INSERT/UPDATE 経路ゼロ |
| - | `supabase/migrations/` | noop.sql のみ | 該当なし |
| - | `drizzle/` | 不存在 | 該当なし |
| - | 本番 SECURITY DEFINER RPC | `store_confirmed_by_user_id` 参照なし (要 verify) | 該当なし |

**結論**: Phase 61 D5 は **preventive hardening** (将来 `manual` confirmation_mode 実装時の protective rail)。複合 FK 追加で既存壊れる経路なし、low-risk pure schema change。

## 2. 既存 data 状態 (Supabase 直接確認 2026-05-27, advisor 指摘 1 採用)

| 対象 | 値 | 備考 |
|---|---|---|
| `transport_orders.store_confirmed_by_user_id IS NOT NULL` 件数 | **0** (verified 2026-05-27) | `SELECT count(*) FROM transport_orders WHERE store_confirmed_by_user_id IS NOT NULL` で確認、BACKFILL 不要 |
| `users_id_company_id_unique` UNIQUE | **存在** | Phase 56 で追加済 |
| `transport_orders_store_confirmed_by_user_id_*_fk` 既存単独 FK | **存在** | DROP 対象、catalog query で動的特定 |
| 本番 trigger on `transport_orders` (verified 2026-05-27 via pg_trigger) | **3 件**: `trg_audit_transport_orders` (AFTER INSERT/DELETE/UPDATE → `record_audit_log()`), `trg_enforce_status_transition` (BEFORE UPDATE OF status_id, 本 phase 範囲外で発火せず), `trg_set_updated_at` (BEFORE UPDATE) | **Phase 60 D4 audit trigger side-effect pattern を流用** (UPDATE で audit_logs row 生成 = 期待 side-effect、`store_confirmed_by_user_id` 不変 invariant と分離) |

## 3. 採択方針 (Phase 58 D2 pattern 完全流用 + D5 特有判断)

- **Phase 58 D2 pattern 完全流用**: `NO ACTION` / `RESTRICT` / MATCH SIMPLE / raw migration authoritative / catalog query で既存 FK 動的特定 → DROP / `users_id_company_id_unique` 冪等 check
- **意味変化 `SET NULL → NO ACTION` の正当化** (D2 採用文言完全流用):
  1. data=0 + INSERT/UPDATE=0 で現状影響なし
  2. users hard delete は `is_active=false` soft-delete 運用が前提 (Phase 47 確立)
  3. `auth.users → public.users ON DELETE CASCADE` 経路は existing constraint、複合 FK 追加で auth.users 削除時に public.users CASCADE が transport_orders で RESTRICT され失敗する可能性。本番運用では auth.users hard delete を行わず soft-delete pattern を踏襲する前提で許容
  4. D1-D4 と挙動を統一することで audit log 保全の原則が一貫
- **drizzle schema diff は Phase 58 と完全同形**: `foreignKey({columns, foreignColumns, name}).onUpdate("restrict")` を table options に追加、column-level `.references()` 削除、コメント追加
- **transport_orders active 経路の retrogression なし invariant**: createTransportOrder / cancelTransportOrder / RPC 経由 status update / vendor accept など既存経路は `store_confirmed_by_user_id` を SET しない (default NULL のまま) → MATCH SIMPLE で FK check skip、既存 test PASS 維持

## 4. 新規 migration 設計

**ファイル**: `src/lib/db/raw-migrations/post/0021_transport_orders_store_confirmed_by_user_company_composite_fk.sql`

**構造** (Phase 58 0018 pattern を `reservation_status_history` → `transport_orders` + `changed_by_user_id` → `store_confirmed_by_user_id` 置換):

```sql
DO $$
DECLARE
  existing_fk_name text;
BEGIN
  -- users_id_company_id_unique は Phase 56 で追加済を冪等 check
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_id_company_id_unique'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_id_company_id_unique UNIQUE (id, company_id);
  END IF;

  -- 既存単独 FK (transport_orders_store_confirmed_by_user_id_*_fk) を catalog query で動的特定 → DROP
  FOR existing_fk_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.transport_orders'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.transport_orders'::regclass
           AND attname = 'store_confirmed_by_user_id')
      ]::smallint[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.transport_orders DROP CONSTRAINT IF EXISTS %I',
      existing_fk_name
    );
  END LOOP;

  -- 複合 FK 追加
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.transport_orders'::regclass
      AND conname = 'transport_orders_store_confirmed_by_user_company_fk'
  ) THEN
    ALTER TABLE public.transport_orders
      ADD CONSTRAINT transport_orders_store_confirmed_by_user_company_fk
      FOREIGN KEY (store_confirmed_by_user_id, company_id)
      REFERENCES public.users (id, company_id)
      MATCH SIMPLE
      ON DELETE NO ACTION
      ON UPDATE RESTRICT;
  END IF;
END $$;
```

## 5. drizzle schema 変更

**ファイル**: `src/lib/db/schema/transport_orders.ts` (modify)

**diff 形式** (Phase 58 同形、column 64-66 の `.references()` 削除 → table options に composite FK 追加):

```diff
-import { ... pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
+import { foreignKey, ... pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
 import { companies } from "./companies";
 import { users } from "./users";
 ...

+// store_confirmed_by_user_id: Composite FK enforces (store_confirmed_by_user_id, company_id) -> users(id, company_id).
+// raw migration 0021 is authoritative; drizzle-kit generate/push must not be used to regenerate this FK.
+// onDelete intentionally omitted in drizzle (raw SQL sets ON DELETE NO ACTION; ON UPDATE RESTRICT here mirrors raw migration).
 export const transportOrders = pgTable(
   "transport_orders",
   {
     ...
     storeConfirmedAt: timestamp("store_confirmed_at", { withTimezone: true }),
-    storeConfirmedByUserId: uuid("store_confirmed_by_user_id").references(() => users.id, {
-      onDelete: "set null",
-    }),
+    storeConfirmedByUserId: uuid("store_confirmed_by_user_id"),
     ...
   },
   (t) => ({
     ... // 既存 indices / FKs 維持
+    storeConfirmedByUserCompanyFk: foreignKey({
+      columns: [t.storeConfirmedByUserId, t.companyId],
+      foreignColumns: [users.id, users.companyId],
+      name: "transport_orders_store_confirmed_by_user_company_fk",
+    }).onUpdate("restrict"),
   }),
 );
```

## 6. integration test 設計 (Phase 58 5 観点同形)

**ファイル**: `tests/integration/db/transport-orders-store-confirmed-by-user-fk.integration.test.ts` (新規)

**5 観点 assert** (Phase 58 同形、観点 2 を advisor 指摘 3 で future SET pattern 化):
1. **cross-company UPDATE 失敗**: company A の transport_orders row に company B の user を `store_confirmed_by_user_id` で UPDATE → FK 違反
2. **same-company UPDATE 成功 (future SET pattern with IF MATCH)**: 同 company の user で `confirmTransportOrderManually` future service 想定の `UPDATE transport_orders SET store_confirmed_at = now(), store_confirmed_by_user_id = $userId, version = version + 1 WHERE id = $id AND company_id = $companyId AND version = $expectedVersion` (ADR-0007 IF MATCH) → 成功、`store_confirmed_by_user_id` 確定、`version` increment、`store_confirmed_at` 同時 SET。test は future production service の write pattern を mirror
3. **NULL 許可 (MATCH SIMPLE)**: `store_confirmed_by_user_id = NULL` で UPDATE 成功 (revert pattern)
4. **user hard delete RESTRICT (NO ACTION)**: 参照中の user を DELETE → FK 違反で阻止
5. **statement-time check (NO ACTION non-deferrable)**: cross-company user を UPDATE した時点で即座に FK 違反 (commit 待ちではない)

**audit trigger side-effect 明示** (advisor 指摘 2 採用、Phase 60 D4 pattern 流用):
- 観点 2 の同 company UPDATE 成功時、`trg_audit_transport_orders` AFTER UPDATE で `audit_logs` に 1 行 INSERT される (期待 side-effect、regression ではない)
- 観点 1/5 (FK 違反) では UPDATE 自体が abort されるため `audit_logs` row 生成なし
- `trg_enforce_status_transition` は BEFORE UPDATE OF status_id のため本 phase test (status_id 不変) では発火しない
- `trg_set_updated_at` は updated_at を自動更新 (副次、観点に影響なし)
- invariant: 「UPDATE 後 `store_confirmed_by_user_id` SET 経路で audit_logs 1 行追加」を観点 2 で確認可、ただし audit_logs 内容まで assert する必要はない (D5 hardening の責務範囲外)

**seedFixture 規律 (D5 特有)**:
- `seedTransportStatuses` 利用 (transport_orders.status_id が notNull、必須)
- 1 statement CTE pattern (Phase 60 確立): `WITH auth_user AS (INSERT INTO auth.users ...) INSERT INTO public.users SELECT id, ...`
- 必要 seed: company, user (auth.users CTE), seedTransportStatuses (Phase 57 D1 pattern 同型)、transport_orders row (default NULL)
- 参考 seedFixture: `tests/integration/db/transport-order-status-history-fk.integration.test.ts` (Phase 57 D1、seedTransportStatuses 利用) の構造を移植 + history 関連 seed を削減、target 列を `store_confirmed_by_user_id` に置換

**観点固有調整 (D2 INSERT-based → D5 UPDATE-based)**:
- transport_orders 行は事前に default NULL で INSERT 済、test は UPDATE で `store_confirmed_by_user_id` を SET する形式
- Phase 58 D2 は INSERT 文脈 (status_history は新規行)、Phase 61 D5 は UPDATE 文脈 (transport_orders 既存行更新) — 観点文言を UPDATE ベースに統一

## 7. テスト・retrogression リスク (D5 特有 — 本番 active table)

- 既存 22 test files / 183 tests に retrogression なし (D5 は SET 経路 0 で既存 service 一切非変更)
- **特に検証必須** (Phase 60 §既存 NULL omitted INSERT 経路維持 pattern):
  - createTransportOrder INSERT 経路 (default NULL で `store_confirmed_by_user_id` 省略 → MATCH SIMPLE で通る)
  - cancelTransportOrder UPDATE 経路 (`store_confirmed_by_user_id` 不変、FK check skip)
  - vendor accept/reject RPC 経路 (`store_confirmed_by_user_id` 不変)
  - test fixture (`tests/integration/services/transport-orders-*.integration.test.ts` 群) で transport_orders INSERT が default NULL pattern を維持
- drift 2 → 2 (0021 ALTER のみ、drizzle-kit check OK)
- CI E2E 7/7 維持

## 8. 変更ファイル一覧

| ファイル | 種別 |
|---|---|
| `src/lib/db/raw-migrations/post/0021_transport_orders_store_confirmed_by_user_company_composite_fk.sql` | new |
| `src/lib/db/schema/transport_orders.ts` | modify |
| `tests/integration/db/transport-orders-store-confirmed-by-user-fk.integration.test.ts` | new |
| `phase-handoff/phase-61-store-confirmed-by-user-fk-plan.md` | new (本ファイル v1) |
| `phase-handoff/phase-61-codex-adversarial-review.md` | new (Codex review 後) |
| `phase-handoff/phase-61-store-confirmed-by-user-fk-sealed.md` | new (seal 時) |

合計: 1 new (DB) + 1 new (test) + 1 modify (schema) + 3 plan/review/seal = 6 files

## 9. 完了基準 (DoD)

- [x] **pre-check**: `transport_orders.store_confirmed_by_user_id IS NOT NULL` = **0** (verified 2026-05-27 Supabase dev)
- [x] **pre-check 2**: transport_orders trigger 3 件確認 (audit/status_transition/updated_at)、本 phase 範囲内では audit のみ side-effect 発火、Phase 60 D4 pattern 流用
- [ ] migration 0021 apply 成功 (Supabase dev)
- [ ] migration 適用前: `users_id_company_id_unique` 存在確認 (Phase 56 以降冪等)
- [ ] typecheck clean
- [ ] 新規 5 観点 test 全 PASS
- [ ] 既存 183 tests retrogression なし → 188/188 PASS
- [ ] drift 増加なし (2 → 2)
- [ ] CI E2E 7/7 PASS 維持
- [ ] phase-61-store-confirmed-by-user-fk-sealed.md 200 行以内で書き出し

## 10. Phase 62 候補 (前倒し)

D5 完了後の候補:
- **D6 候補**: `attachments.uploaded_by_user_id` (規模軽微、active 経路 0、同 pattern preventive)
- **D7 候補**: `vendor_selection_logs.selected_by_user_id` (ADR-0008 関連、active 経路 0、同 pattern preventive)
- 全テーブル共通 `created_by_user_id` / `updated_by_user_id` は別 sprint テーマ (scope 拡張)
- Phase 60 BLOCK-2 緩和 TODO (`createAdminVendorInvitation` direct call 化 + supabase auth.admin mock 整備)
- MVP blocker #2 #3 / transport_order.changed outbox worker (wake-up 領域)

## 11. 次ステップ (advisor Meta-note 採用: Codex adversarial review skip)

**判断根拠**: D5 は Phase 58 D2 pattern の **5 回目同型 repetition**。Phase 60 BLOCK は D4 active-INSERT semantics 由来で、D5 は active 経路 0 で同じ穴を持たない。pre-check 2 件 (data=0 / audit trigger 既知 pattern) 共に clean。Codex review の marginal value は低く、Codex 委任 quota を implementation 側に振る方が ROI 高い。

1. **(skip) Codex adversarial review** — 5 回目同型 + pre-check clean のため省略 (advisor Meta-note 採用)
2. **Codex implementation 委任** (`Task(codex:codex-rescue) --effort high`): migration + schema + test 一括、Phase 58 D2 BLOCK-1 簡素化を流用、Phase 60 確立の 1 statement CTE pattern (`WITH auth_user AS (INSERT INTO auth.users ...) INSERT INTO public.users SELECT id ...`)、観点 2 で IF MATCH (version) future SET pattern を明示、audit trigger side-effect を expected として記述
3. **検証**: typecheck → `pnpm vitest run tests/integration/db/transport-orders-store-confirmed-by-user-fk.integration.test.ts` → 全体 test 188/188 → drizzle-kit check (drift 2→2)
4. **seal**: `phase-61-store-confirmed-by-user-fk-sealed.md` 200 行以内で書き出し + commit

---

*Plan v1 by Claude 2026-05-27 (advisor pivot 反映: C change_type 拡張 → A-narrow D5 preventive hardening、Phase 58 D2 pattern 完全流用、advisor 指摘 3 採用 = empirical pre-check 反映 + audit trigger side-effect 明示 + IF MATCH future SET pattern、advisor Meta-note 採用 = Codex adversarial review skip で 5 回目同型 marginal value 低下を回避)*
