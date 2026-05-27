# Phase 57 plan v2: transport_order_status_history.changed_by_user_id 複合 FK 横展開 (D1)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 57 (前: 56 sealed) |
| 状態 | **plan v2**（Codex adversarial review CONDITIONAL-GO 反映、WARN 6 全採用） |
| 起源 | Phase 56 sealed §Phase 57 推奨スコープ候補 #1 (D1)、Codex WARN 6 採用の debt 台帳 |
| Branch | `phase-42-t4-test-coverage` |
| 前 handoff | `phase-56-changed-by-user-fk-sealed.md` |
| Codex review | `phase-57-codex-adversarial-review.md` (BLOCK 0 / WARN 6) |

## 1. 現状実装の整合性スナップショット (advisor 助言で追加、WARN-1 で再棚卸)

**棚卸し手順 (WARN-1 対応)**: 以下を実行して INSERT 漏れがないことを確認済 (2026-05-27):
```
rg -n "INSERT INTO.*transport_order_status_history|insert.*transportOrderStatusHistory" src/ scripts/
```

`transport_order_status_history` への INSERT **6 箇所** (plan v1 では 5、post/0008 を追加):

| # | 場所 | `changed_by_user_id` | `company_id` | リスク |
|---|---|---|---|---|
| 1 | `src/lib/services/transport-orders.ts` L137 (createTransportOrderWithNotification) | `parsed.actingUserId ?? null` | `parsed.companyId` | actingUserId は同 service の入力契約 (Zod) で `companyId` と同 row 渡し、Phase 55+56 で実証済 pattern |
| 2 | `src/lib/services/transport-orders.ts` L549 (cancelTransportOrder) | `userId` | `companyId` | 同上 (Phase 47 確立、Phase 55 で 12/12 PASS) |
| 3 | `raw-migrations/post/0008_phase_28_c_respond_to_spot_invitation_ambiguous_fix.sql` L90 (spot accept fix) | `NULL` 固定 | ✓ 安全 |
| 4 | `raw-migrations/alpha-1-public/24_vendor_rpcs.sql` L88 (vendor accept) | `NULL` 固定 | ✓ 安全 |
| 5 | `raw-migrations/alpha-1-public/25_close_transport_order.sql` L72 (auto close) | `NULL` 固定 | ✓ 安全 |
| 6 | `raw-migrations/alpha-1-public/27_spot_rpc.sql` L86 (spot accept) | `NULL` 固定 | ✓ 安全 |

**結論 (WARN-2 対応)**: 4/6 NULL、2/6 (#1, #2) は呼出側 server action で `actingUserId`/`userId` を session 由来 (`current_user_company_id()` 配下の user) として渡す入力契約。Phase 55 cancel test で 12/12 PASS、Phase 56 change_logs 統合でも同 pattern が複合 FK 下で動作実証済。残るネガティブケース (cross-company actingUserId 投入時の FK 違反) は本 phase の test 観点 1 + 観点 5 で直接カバー。

## 2. 既存 data 状態 (Supabase 直接確認)

```
transport_order_status_history     total=0  with_user=0  violating_composite_fk=0
reservation_status_history         total=0
transport_order_invitations        total=0
admin_vendor_invitations           total=0
```

→ **Phase 56 sealed の「data 蓄積あり (recreate 不可)」前提が事実と異なる**。本番 data ゼロ、複合 FK 追加で既存 row 違反なし、Phase 56 と同 pattern を低リスクで流用可。

## 3. 採択方針 (Phase 56 を踏襲)

| 項目 | 値 | 理由 |
|---|---|---|
| FK 表現 | 複合 FK `(changed_by_user_id, company_id) → users(id, company_id)` | Phase 56 同 pattern、DB native 堅牢 |
| MATCH | MATCH SIMPLE | `changed_by_user_id IS NULL` を許可（システム/auto-close 経由） |
| ON DELETE | NO ACTION | spec §15.7 soft delete only、actor NULL 化要件なし、audit 整合保護優先 |
| ON UPDATE | RESTRICT | admin による users.company_id 変更を schema 強制禁止 |
| users 側 UNIQUE | 既存 `users_id_company_id_unique` 再利用 | Phase 56 で追加済 |
| 既存単独 FK 削除 | catalog query で動的特定 → DROP CONSTRAINT | 二重制約回避、drizzle 自動生成名非依存 |
| drizzle schema | column-level `.references()` 削除 + table-level `foreignKey({...})` 追加 + コメント明記 | drizzle-kit generate/push 禁止運用維持 |

## 4. 新規 migration 設計

**ファイル**: `src/lib/db/raw-migrations/post/0017_status_history_user_company_composite_fk.sql`

**構造** (Phase 56 0016 pattern 流用、`users_id_company_id_unique` 追加部分は省略可):

```sql
DO $$
DECLARE
  existing_fk_name text;
BEGIN
  -- users_id_company_id_unique は Phase 56 で追加済なので idempotent check のみ
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_id_company_id_unique'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_id_company_id_unique UNIQUE (id, company_id);
  END IF;

  -- 既存単独 FK (drizzle 自動生成名) を catalog query で特定 → DROP
  FOR existing_fk_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.transport_order_status_history'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[
        (SELECT attnum FROM pg_attribute
         WHERE attrelid = 'public.transport_order_status_history'::regclass
           AND attname = 'changed_by_user_id')
      ]::smallint[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.transport_order_status_history DROP CONSTRAINT IF EXISTS %I',
      existing_fk_name
    );
  END LOOP;

  -- 複合 FK 追加
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.transport_order_status_history'::regclass
      AND conname = 'transport_order_status_history_changed_by_user_company_fk'
  ) THEN
    ALTER TABLE public.transport_order_status_history
      ADD CONSTRAINT transport_order_status_history_changed_by_user_company_fk
      FOREIGN KEY (changed_by_user_id, company_id)
      REFERENCES public.users (id, company_id)
      MATCH SIMPLE
      ON DELETE NO ACTION
      ON UPDATE RESTRICT;
  END IF;
END $$;
```

## 5. drizzle schema 変更

**ファイル**: `src/lib/db/schema/transport_order_status_history.ts`

- `changedByUserId` から `.references(() => users.id, { onDelete: "set null" })` を削除
- `foreignKey({ columns: [t.changedByUserId, t.companyId], foreignColumns: [users.id, users.companyId], name: "transport_order_status_history_changed_by_user_company_fk" }).onUpdate("restrict")` を追加
- コメント追記: `// raw migration 0017 is authoritative; drizzle-kit generate/push must not be used to regenerate this FK.`

## 6. integration test 設計

**ファイル**: `tests/integration/db/transport-order-status-history-fk.integration.test.ts` (新規)

**5 観点 assert** (Phase 56 pattern 流用 + WARN-5 で観点 5 追加):
1. **cross-company INSERT 失敗**: company A の row に company B の user を `changed_by_user_id` で指定 → FK 違反
2. **same-company INSERT 成功**: 同 company の user で指定 → 成功
3. **NULL 許可 (MATCH SIMPLE)**: `changed_by_user_id = NULL` で INSERT 成功（auto-close / vendor accept / spot 経由）
4. **user hard delete RESTRICT (NO ACTION)**: 参照中の user を DELETE → FK 違反で阻止
5. **commit 時 deferred check (WARN-5 対応)**: TX 内で cross-company user を INSERT 後、commit 時点で FK 違反が確実に raise されること (NO ACTION の deferred 動作確認)

**seedFixture 規律 (advisor 助言で明記)**: user INSERT は **`WITH auth_user AS (INSERT INTO auth.users ...)` CTE pattern 必須** (Phase 56 で users_id_fkey 違反 → test fix 1 周回した轍を避ける)。`tests/integration/record-audit-log.test.ts` または `tests/integration/db/transport-order-change-logs-fk.integration.test.ts` の seedFixture を参考に。

## 7. テスト・retrogression リスク

| リスク | 対応 |
|---|---|
| service write が複合 FK 違反 (#1, #2) | 既存 156 tests retrogression 確認、cancel test (12/12) と create test pattern で actingUserId/companyId 整合は実証済 |
| 24_vendor_rpcs.sql の accept path | `changed_by_user_id = NULL` なので無関係 |
| migration 順序 | 0017 は post/ 配下、0016 と同 epoch、Phase 56 後の +1 |
| drift | 0017 ALTER のみで drift 2 → 2 (増加なし期待) |

## 8. 変更ファイル一覧

| ファイル | 種別 |
|---|---|
| `src/lib/db/raw-migrations/post/0017_status_history_user_company_composite_fk.sql` | new |
| `src/lib/db/schema/transport_order_status_history.ts` | modify |
| `tests/integration/db/transport-order-status-history-fk.integration.test.ts` | new |
| `phase-handoff/phase-57-status-history-fk-plan.md` | new (本ファイル) |
| `phase-handoff/phase-57-status-history-fk-sealed.md` | new (seal 時) |

合計: 2 new (DB) + 1 new (test) + 1 modify (schema) + 2 plan/seal = 5-6 files

## 9. 完了基準 (DoD)

- [ ] migration 適用前: `\d users` で `users_id_company_id_unique` 存在確認 (WARN-6 対応)
- [ ] migration 0017 apply 成功 (Supabase dev)
- [ ] typecheck clean
- [ ] 新規 **5 観点** test 全 PASS (WARN-5 で観点 5 追加)
- [ ] 既存 156 tests retrogression なし → **161/161 PASS** (156 + 5)
- [ ] drift 増加なし (2 → 2)
- [ ] CI E2E 7/7 PASS 維持
- [ ] phase-57-status-history-fk-sealed.md 200 行以内で書き出し

## 10. Phase 58 候補 (前倒し)

D1 完了後、D2-D4 は data ゼロ確認済なので同 pattern で連続実装可:
- D2: `reservation_status_history.changed_by_user_id` (規模軽微、同 pattern)
- D3: `transport_order_invitations.invited_by_user_id` (§ADR-0008 関連)
- D4: `admin_vendor_invitations.invited_by_user_id` (規模軽微)

**WARN-4 対応**: D2-D4 各 phase で **本 plan §1 相当の INSERT 棚卸しを独立実施**すること。D1 pattern をそのまま流用しない。特に **D3 (transport_order_invitations)** は ADR-0008 (案件単位招待・複数業者打診) で `invited_by_user_id` が company 境界をまたぐ送信フローを持つ可能性があり、独立設計が必須。

## 11. 次ステップ

1. **本 plan を Codex adversarial review** (`/codex:adversarial-review --wait --effort high`)
2. BLOCK/WARN を plan v2 に反映
3. 実装委任 (`/codex:rescue --wait --effort high`)
4. test fix 必要なら Codex 再委任、不要なら直接 verify
5. seal & commit

---

*Plan v2 by Claude 2026-05-27 (advisor 助言 1 + Codex review WARN 6 全採用、Phase 56 pattern 流用 + data=0 検証済 + post/0008 棚卸し追加)*

**WARN-3 採用判断**: `DO $$` ブロック外 EXCEPTION フォールバックは追加しない。0016 と同等構造で運用踏襲、idempotency check が冪等性を担保する。0016 が production で問題なく適用された実績に従う。
