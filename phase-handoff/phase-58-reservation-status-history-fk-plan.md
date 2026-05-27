# Phase 58 plan v2: reservation_status_history.changed_by_user_id 複合 FK 横展開 (D2)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 58 (前: 57 sealed) |
| 状態 | **plan v2**（Codex adversarial review CONDITIONAL-BLOCK 反映、BLOCK 2 + WARN 3 全採用） |
| 起源 | Phase 57 sealed §Phase 58 推奨スコープ候補 #1 (D2)、debt 台帳 D2 |
| Branch | `phase-42-t4-test-coverage` |
| 起草日時 | 2026-05-27 |
| 担当 | Claude (plan v1 → review 反映 → plan v2) → Codex (implementation 委任) |

## 0. D1 (Phase 57) との差異まとめ (advisor + Codex review 反映後)

| 観点 | D1 (Phase 57 sealed) | D2 (本 Phase) |
|---|---|---|
| 既存単独 FK | `ON DELETE NO ACTION` | **`ON DELETE SET NULL`** ← 差異 (意味変化あり) |
| service INSERT 経路 | 6 箇所 | **0 箇所** (preventive hardening) |
| trigger 生成 INSERT | なし | **なし** (`trg_reservation_transition` は code 上に存在するが本番未適用、`pg_trigger` 直接確認済) |
| test 内 reservation status seed | N/A | **不要** (BLOCK-1 採用: BEFORE INSERT trigger 不在のため seedFixture 簡素化可) |
| test seedFixture helper | `seedTransportStatuses` 既存利用 | **transport 用は使わない**。reservation row + user + company のみで OK |
| spec §refs | §3.11 | **§3.10** |
| ON DELETE 意味変化 | なし | **あり** (SET NULL → NO ACTION)。WARN-1: auth.users CASCADE 経路への影響は soft-delete 運用前提で許容 |

## 1. 現状実装の整合性スナップショット (Phase 57 WARN-1 教訓 + Codex WARN-2 で拡張)

**棚卸し手順 (独立実施 — D1 流用禁止)**: 2026-05-27 実施済:
```
rg -n "reservation_status_history|reservationStatusHistory" src/ scripts/ seed/ tests/ supabase/ drizzle/
grep -rln "SECURITY DEFINER" src/lib/db/raw-migrations/ | xargs grep -l "reservation_status_history"
```

`reservation_status_history` への INSERT は **本番経路 0 箇所** (DDL + RLS のみ):

| # | 場所 | 内容 | 評価 |
|---|---|---|---|
| - | `src/lib/db/raw-migrations/alpha-1-public/11_reservations.sql` L26-40 | CREATE TABLE + INDEX | DDL のみ |
| - | `src/lib/db/raw-migrations/alpha-1-public/19_rls_policies.sql` L206-211 | tenant_isolation RLS | RLS のみ |
| - | `src/lib/db/raw-migrations/alpha-1-public/20_triggers.sql` L1570-1572 | `trg_reservation_transition` BEFORE INSERT 定義 | **本番未適用** (pg_trigger 確認済) |
| - | `src/lib/db/raw-migrations/poc-12-schema-isolation/poc12_20_triggers.sql` | SECURITY DEFINER で reservation_status_history 参照 | **非 production schema** (`pit_v24_poc`) |
| - | service / scripts / seed / tests | (none) | INSERT 経路ゼロ |
| - | `supabase/migrations/` | noop.sql のみ | 該当なし |
| - | `drizzle/` | 不存在 | 該当なし |
| - | 本番 SECURITY DEFINER RPC (post/ + alpha-1-public/) で reservation_status_history を参照するもの | (none) | 該当なし |

**結論**: Phase 58 D2 は **preventive hardening** (将来 reservation status workflow 実装時の protective rail)。複合 FK 追加で既存壊れる経路なし、low-risk pure schema change。

## 2. 既存 data 状態 (Supabase 直接確認 2026-05-27)

| 対象 | 値 | 備考 |
|---|---|---|
| `reservation_status_history` total | **0** | recreate 可能 |
| `users` total | 0 | dev 環境 |
| `users_id_company_id_unique` UNIQUE | **存在** | Phase 56 で追加済 |
| `reservation_status_history_changed_by_user_id_fkey` 既存単独 FK | **存在** | DROP 対象、catalog query で動的特定 |
| `statuses` where status_type='reservation' | 0 | reservation status は production 未 seed |
| 本番 `trg_*` on `reservation_status_history` | **0 件** | trigger 不在確認済 (Codex BLOCK-1 採用) |

## 3. 採択方針 (Phase 56/57 pattern 流用 + D2 特有判断)

- **Phase 56/57 pattern 完全流用**: `NO ACTION` / `RESTRICT` / MATCH SIMPLE / raw migration authoritative / catalog query で既存 FK 動的特定 → DROP / `users_id_company_id_unique` 冪等 check
- **意味変化 `SET NULL → NO ACTION` の正当化** (Codex WARN-1 採用追記):
  1. data=0 + INSERT=0 で現状影響なし
  2. users hard delete は `is_active=false` soft-delete 運用が前提 (Phase 47 確立、Phase 55 12/12 PASS)
  3. **WARN-1 採用**: `auth.users → public.users ON DELETE CASCADE` 経路は existing constraint であり、複合 FK 追加で auth.users 削除時に public.users CASCADE が `reservation_status_history` で RESTRICT され失敗する可能性がある。本番運用では auth.users hard delete を行わず soft-delete pattern を踏襲する前提で許容。将来 user offboarding 要件が出た時は cleanup 順序 (reservation_status_history → users → auth.users) を実装する別 Phase で対応。
  4. D1 と挙動を統一することで audit log 保全の原則が一貫
- **drizzle schema diff は Phase 57 と完全同形**: `foreignKey({columns, foreignColumns, name}).onUpdate("restrict")` を table options に追加、column-level `.references()` 削除、コメント追加 (Codex WARN-3 採用)
- **test seedFixture は reservation row + user + company のみ** (Codex BLOCK-1 採用): trigger 不在のため reservation status / status_transitions seed は不要

## 4. 新規 migration 設計

**ファイル**: `src/lib/db/raw-migrations/post/0018_reservation_status_history_user_company_composite_fk.sql`

**構造** (Phase 57 0017 pattern を `transport_order_status_history` → `reservation_status_history` 置換):

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

  -- 既存単独 FK (reservation_status_history_changed_by_user_id_fkey) を catalog query で動的特定 → DROP
  FOR existing_fk_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.reservation_status_history'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.reservation_status_history'::regclass
           AND attname = 'changed_by_user_id')
      ]::smallint[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.reservation_status_history DROP CONSTRAINT IF EXISTS %I',
      existing_fk_name
    );
  END LOOP;

  -- 複合 FK 追加
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.reservation_status_history'::regclass
      AND conname = 'reservation_status_history_changed_by_user_company_fk'
  ) THEN
    ALTER TABLE public.reservation_status_history
      ADD CONSTRAINT reservation_status_history_changed_by_user_company_fk
      FOREIGN KEY (changed_by_user_id, company_id)
      REFERENCES public.users (id, company_id)
      MATCH SIMPLE
      ON DELETE NO ACTION
      ON UPDATE RESTRICT;
  END IF;
END $$;
```

## 5. drizzle schema 変更

**ファイル**: `src/lib/db/schema/reservation_status_history.ts` (modify)

**diff 形式** (Phase 57 `transport_order_status_history.ts` diff と完全同形、Codex WARN-3 でコメント拡張):

```diff
-import { index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
+import { foreignKey, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
 import { companies } from "./companies";
 import { reservations } from "./reservations";
 import { statuses } from "./statuses";
 import { users } from "./users";

 // 予約ステータス変更履歴。
 // spec/data-model.md §3.10
+// Composite FK enforces (changed_by_user_id, company_id) -> users(id, company_id).
+// raw migration 0018 is authoritative; drizzle-kit generate/push must not be used to regenerate this FK.
+// onDelete intentionally omitted in drizzle (raw SQL sets ON DELETE NO ACTION; ON UPDATE RESTRICT here mirrors raw migration).
 export const reservationStatusHistory = pgTable(
   "reservation_status_history",
   {
     ...
-    changedByUserId: uuid("changed_by_user_id").references(() => users.id, {
-      onDelete: "set null",
-    }),
+    changedByUserId: uuid("changed_by_user_id"),
     ...
   },
   (t) => ({
     reservationChangedAtIdx: index(...).on(t.reservationId, t.changedAt),
+    changedByUserCompanyFk: foreignKey({
+      columns: [t.changedByUserId, t.companyId],
+      foreignColumns: [users.id, users.companyId],
+      name: "reservation_status_history_changed_by_user_company_fk",
+    }).onUpdate("restrict"),
   }),
 );
```

## 6. integration test 設計 (Codex BLOCK-1 / BLOCK-2 反映後)

**ファイル**: `tests/integration/db/reservation-status-history-fk.integration.test.ts` (新規)

**5 観点 assert** (Phase 57 同形、観点 5 を D1 文言に統一):
1. **cross-company INSERT 失敗**: company A の reservation row に company B の user を `changed_by_user_id` で指定 → FK 違反
2. **same-company INSERT 成功**: 同 company の user で指定 → 成功
3. **NULL 許可 (MATCH SIMPLE)**: `changed_by_user_id = NULL` で INSERT 成功
4. **user hard delete RESTRICT (NO ACTION)**: 参照中の user を DELETE → FK 違反で阻止
5. **statement-time check (NO ACTION non-deferrable)**: cross-company user を INSERT した時点で即座に FK 違反 (commit 待ちではない) — D1 観点 5 と同文言

**seedFixture 規律 (D2 特有 — Codex BLOCK-1 採用で簡素化)**:
- **`seedTransportStatuses` は使わない** (transport 専用、D2 では不要)
- **reservation status / status_transitions inline seed も不要** (本番 trigger 不在確認済)
- 必要なのは: company, user (`WITH auth_user AS (INSERT INTO auth.users ...)` CTE pattern 必須), reservation row, optional from_status_id/to_status_id (NULL でも OK、trigger 検証なし)
- 参考 seedFixture: `tests/integration/db/transport-order-status-history-fk.integration.test.ts` の構造を移植 + transport 関連 seed を削減、reservation 用に置換

## 7. テスト・retrogression リスク

- 既存 19 test files / 161 tests に retrogression なし (D2 は INSERT 0 経路で既存 service 一切非変更)
- drift 2 → 2 (0018 ALTER のみ、drizzle-kit check OK)
- CI E2E 7/7 維持

## 8. 変更ファイル一覧

| ファイル | 種別 |
|---|---|
| `src/lib/db/raw-migrations/post/0018_reservation_status_history_user_company_composite_fk.sql` | new |
| `src/lib/db/schema/reservation_status_history.ts` | modify |
| `tests/integration/db/reservation-status-history-fk.integration.test.ts` | new |
| `phase-handoff/phase-58-reservation-status-history-fk-plan.md` | new (本ファイル v2) |
| `phase-handoff/phase-58-codex-adversarial-review.md` | new (Codex review v1) |
| `phase-handoff/phase-58-reservation-status-history-fk-sealed.md` | new (seal 時) |

合計: 1 new (DB) + 1 new (test) + 1 modify (schema) + 3 plan/review/seal = 6 files

## 9. 完了基準 (DoD)

- [ ] migration 0018 apply 成功 (Supabase dev)
- [ ] migration 適用前: `\d users` で `users_id_company_id_unique` 存在確認 (Phase 57 WARN-6 教訓)
- [ ] typecheck clean
- [ ] 新規 5 観点 test 全 PASS
- [ ] 既存 161 tests retrogression なし → 166/166 PASS
- [ ] drift 増加なし (2 → 2)
- [ ] CI E2E 7/7 PASS 維持
- [ ] phase-58-reservation-status-history-fk-sealed.md 200 行以内で書き出し

## 10. Phase 59 候補 (前倒し)

D2 完了後の候補 (各 phase で §1 相当の INSERT 棚卸しを **独立実施**):
- **D3**: `transport_order_invitations.invited_by_user_id` (§ADR-0008 関連、**独立設計必須** — 案件単位招待 + 複数業者打診で company 境界をまたぐ可能性)
- **D4**: `admin_vendor_invitations.invited_by_user_id` (規模軽微、同 pattern)
- 他 change_type service 実装 (Phase 55 cancel pattern + Phase 56 FK 強制活用)

## 11. 次ステップ

1. **Codex implementation 委任** (`Task(codex:codex-rescue) --effort high`): migration + schema + test 一括、BLOCK-1 簡素化 (status seed 不要) を委任プロンプトに明示、auth.users CTE pattern も
2. **検証**: typecheck / `pnpm vitest run tests/integration/db/reservation-status-history-fk.integration.test.ts` / drizzle-kit check
3. **全体 test 実行**: 既存 161 tests retrogression なし確認
4. **seal**: `phase-58-reservation-status-history-fk-sealed.md` 書き出し + commit

---

*Plan v2 by Claude 2026-05-27 (Codex adversarial review CONDITIONAL-BLOCK 反映、BLOCK 2 + WARN 3 全採用、advisor 助言 3 採用、Phase 57 pattern 流用 + D2 特有事項 = SET NULL→NO ACTION 意味変化 + trigger 不在検証で test 簡素化 + 0018 命名)*
