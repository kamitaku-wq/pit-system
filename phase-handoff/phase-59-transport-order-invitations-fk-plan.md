# Phase 59 plan v2: transport_order_invitations.invited_by_user_id 複合 FK (D3 解消)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 59 (前: 58 sealed) |
| 状態 | **plan v2** (Codex adversarial review 反映済: BLOCK 3 + WARN 2 全採用) |
| 担当 | Claude (scope + plan v1/v2 + advisor + Codex review) + Codex (review 済 / implementation 予定) |
| 前 handoff | `phase-58-reservation-status-history-fk-sealed.md` |
| Codex review | `phase-59-codex-adversarial-review.md` (del-20260527-053711-f953) |
| Branch | `phase-42-t4-test-coverage` (Phase 58 から +2 commit 予定: feat + seal) |

## スコープ宣言

**debt 台帳 D3 解消**: `transport_order_invitations.invited_by_user_id` の company 整合を schema 強制する。Phase 56/57/58 の複合 FK pattern を完全流用 (`NO ACTION` / `RESTRICT` / MATCH SIMPLE / raw migration authoritative / catalog query 冪等)。

## handoff 警告の解消 narrative (ADR-0008、WARN-1 反映)

handoff §Phase 59 推奨 #1 で「ADR-0008 必読・独立設計必須」「案件単位招待 + 複数業者打診で company 境界をまたぐ可能性」と警告されていたが、独立調査の結果:

- `invited_by_user_id` は **招待発行者 (company 側 user)** で、`users.id` (public schema) を参照 (`src/lib/db/schema/transport_order_invitations.ts:36`)
- 招待**先 (vendor)** は別カラム `vendor_id` / `bound_vendor_id` / `bound_vendor_user_id` (lines 31, 44, 45)
- ADR-0008 の company 境界懸念は vendor 側 (`vendors` / `vendor_users` テーブル) にあって、`invited_by_user_id` には影響しない
- 結論 (WARN-1 修正反映): **発行者側 FK として論理的に D1 (Phase 57) と同パターン (vendor 側カラムへの影響なし)。ただし D3 は active insert 経路を持つため D1 と完全同等ではなく、本番 service 経路の追加検証 (BLOCK-1 観点 6) と RPC 経由不変 assertion (WARN-2 観点 7) を併用する**。

spec 根拠:
- `spec/data-model.md` §7.10 (L833-833): "案件単位招待"、L850: "invited_by_user_id uuid FK"
- `spec/data-model.md` §7.10.2 (L881-933): `accept_invitation_and_revoke_others()` は response/responded_at/is_winning_bid/bound_vendor_id/bound_vendor_user_id のみ UPDATE、`invited_by_user_id` 不変
- 実装確認: `src/lib/db/raw-migrations/post/0006_phase_27_a_rpc_and_rls_fixes.sql:12-72` (authoritative) で `invited_by_user_id` への UPDATE なし → spec 一致

## 達成目標 (Phase 59)

- `transport_order_invitations.invited_by_user_id` に複合 FK `(invited_by_user_id, company_id) → users(id, company_id)` 追加 (MATCH SIMPLE / ON DELETE NO ACTION / ON UPDATE RESTRICT)
- 既存単独 FK (`transport_order_invitations_invited_by_user_id_fkey`) を catalog query で動的特定 → DROP
- `users_id_company_id_unique` は Phase 56 で追加済を冪等 check
- 5 観点 integration test 追加 (Phase 57/58 同形)
- drift 維持 (2 → 2)
- 既存 service / RPC / test に retrogression なし

## D2 と異なる点 (active 経路への配慮)

| 観点 | D2 (Phase 58) | **D3 (Phase 59)** |
|---|---|---|
| 本番 INSERT 経路 | 0 (preventive hardening) | **1 service** (`createTransportOrderWithNotification`) + test seed |
| trigger 不在 | あり (`trg_reservation_transition` 未適用) | なし (audit trigger と updated_at trigger のみ) |
| 既存 test の `actingUserId` | 該当なし | **全件未指定 (NULL)** で実通過 → 新 FK で壊れない |
| INSERT 時 user の company 整合保証 | N/A | service caller 責任 (Phase 57 D1 と同一保証) |
| `ON DELETE SET NULL → NO ACTION` 意味変化 | trivial (data=0) | trivial (本番 user 削除は soft-delete) |

## 実装内容

### 1. 新規 raw migration: `src/lib/db/raw-migrations/post/0019_transport_order_invitations_user_company_composite_fk.sql`

Phase 58 (0018) と同一構造、テーブル名のみ差替:

```sql
DO $$
DECLARE
  existing_fk_name text;
BEGIN
  -- (a) users(id, company_id) UNIQUE 冪等 check (Phase 56 で追加済)
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.users'::regclass
      AND conname = 'users_id_company_id_unique'
  ) THEN
    ALTER TABLE public.users
      ADD CONSTRAINT users_id_company_id_unique UNIQUE (id, company_id);
  END IF;

  -- (b) 既存単独 FK を catalog query で動的 DROP
  FOR existing_fk_name IN
    SELECT conname FROM pg_constraint
    WHERE conrelid = 'public.transport_order_invitations'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.transport_order_invitations'::regclass
          AND attname = 'invited_by_user_id'
      )]::smallint[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.transport_order_invitations DROP CONSTRAINT IF EXISTS %I',
      existing_fk_name
    );
  END LOOP;

  -- (c) 複合 FK を IF NOT EXISTS で追加
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.transport_order_invitations'::regclass
      AND conname = 'transport_order_invitations_invited_by_user_company_fk'
  ) THEN
    ALTER TABLE public.transport_order_invitations
      ADD CONSTRAINT transport_order_invitations_invited_by_user_company_fk
      FOREIGN KEY (invited_by_user_id, company_id)
      REFERENCES public.users (id, company_id)
      MATCH SIMPLE
      ON DELETE NO ACTION
      ON UPDATE RESTRICT;
  END IF;
END $$;
```

### 2. drizzle schema 更新: `src/lib/db/schema/transport_order_invitations.ts` (BLOCK-3 反映)

Phase 56/57/58 と**完全同型** pattern: `invited_by_user_id` の単独 `references()` を削除し、テーブルレベルで `foreignKey()` 複合 FK を追加。`.onUpdate("restrict")` のみ明示、**`onDelete` は omit** (raw migration 0019 が authoritative)。

参考 base: `src/lib/db/schema/reservation_status_history.ts:9-11, 35-39` (Phase 58、`onDelete` omit pattern)。

### 3. integration test 新規: `tests/integration/db/transport-order-invitations-fk.integration.test.ts` (BLOCK-1 + WARN-2 + NOTE-2 反映)

Phase 57/58 同形 5 観点 + D3 active 経路 2 観点 = **計 7 観点**:

- (i) cross-company user 拒否 (FK 違反)
- (ii) same-company user 受理
- (iii) NULL `invited_by_user_id` 受理 (MATCH SIMPLE)
- (iv) **referenced user delete is restricted** (NOTE-2 label 明確化): 既存 invitation 行が `invited_by_user_id` で user を参照中 → user 削除を NO ACTION RESTRICT で拒否 (invitation 自身の削除挙動は対象外、別系統)
- (v) statement-time check 確認 (deferred check ではない、`NO ACTION non-deferrable` D1/D2 文言で統一)
- (vi) **active 経路 same/cross-company actingUserId 検証** (BLOCK-1): `createTransportOrderWithNotification` を **same-company** user の `actingUserId` 付で呼び成功、**cross-company** user の `actingUserId` 付で呼び FK 違反 (本番 service 経路で D3 が壊れないこと + cross-company を schema で捕捉できることを併証)
- (vii) **ADR-0008 RPC 経由 `invited_by_user_id` 不変 assertion** (WARN-2): invitation 行を seed → `accept_invitation_and_revoke_others()` 実行後 / 別 invitation で `respond_to_spot_invitation()` 実行後 (RPC 存在時)、`invited_by_user_id` が変更されていないことを assert (将来の RPC regression 検知)

auth.users CTE pattern (Phase 57/58 から継承): user INSERT は `WITH auth_user AS (INSERT INTO auth.users ...)` 必須。

## Phase 58 継承項目 (advisor の指示 #3)

| 項目 | 継承内容 |
|---|---|
| WARN-1 | `auth.users → public.users CASCADE` 経路は soft-delete 運用前提で許容、cleanup 順序実装は別 Phase |
| BLOCK-2 文言統一 | "statement-time check (NO ACTION non-deferrable)" を D1/D2 と統一 |
| 5 観点 integration test | Phase 57/58 同形 (cross/same/NULL/RESTRICT/statement-time) |
| auth.users CTE pattern | 新規 test の user INSERT は CTE 必須 |
| catalog query 冪等性 pattern | DO ブロック + `IF NOT EXISTS` / `IF EXISTS` + FOR LOOP DROP |

## 不変条件 (invariants)

- 既修正 28 機能 (#1-#28) すべてに retrogression なし
- typecheck clean / 20 test files / 166 tests PASS (Phase 58 base) → +5 test で 171 tests 目標
- CI E2E 7/7 PASS
- 複合 FK semantic 維持: `(invited_by_user_id, company_id) → users(id, company_id)`, MATCH SIMPLE, ON DELETE NO ACTION, ON UPDATE RESTRICT
- users(id, company_id) UNIQUE 維持 (Phase 56 で追加)
- raw migration 0016+0017+0018+**0019** が authoritative (drizzle-kit generate/push 禁止)
- catalog query 冪等性 pattern 維持
- **`accept_invitation_and_revoke_others()` 不変** (UPDATE 対象に `invited_by_user_id` 含まないこと、post/0006 authoritative)
- **`respond_to_spot_invitation()` 不変** (BLOCK-2): UPDATE 対象に `invited_by_user_id` 含まないこと (post/0008 authoritative)
- **既存 `createTransportOrderWithNotification` test 全件 PASS** (actingUserId NULL 経路維持)
- **active 経路 same-company actingUserId が新 FK 下で動く** (BLOCK-1 観点 6 で保証)
- ADR-0008 文脈保護: vendor 側カラム (vendor_id / bound_vendor_id / bound_vendor_user_id) には影響を与えない

## リスク評価

| 項目 | リスク | 緩和策 |
|---|---|---|
| service caller が cross-company user を渡す | 中 | service 層では既に Phase 57 で同型保証下、追加 schema FK で deeper guarantee |
| auth.users CASCADE 削除時 NO ACTION で阻害 | 低 | soft-delete 運用前提 (WARN-1)、本番 user 物理削除なし |
| 既存単独 FK 名が想定と違う | 低 | catalog query で動的特定 (固定名想定なし) |
| drift 増加 | 低 | 0019 ALTER のみ、drift 2 → 2 維持 |
| ADR-0008 RPC への影響 | 低 | post/0006 authoritative 確認、`invited_by_user_id` 不変 |

## 想定 Codex 委任

| del id | task | 想定 |
|---|---|---|
| adversarial-review | plan v1 review | BLOCK/WARN を plan v2 で全採用 |
| implementation | migration 0019 + drizzle schema + 5 観点 test 一括 | auto-apply / 1 発採用想定 (Phase 55/57/58 と同等) |

## 主要メトリクス目標

| 指標 | 目標 |
|---|---|
| 変更ファイル | 2 new (migration + test) + 1 modify (schema) + 2 plan/review + 1 seal = 6 files |
| test files | 21 (Phase 58 20 → +1) |
| integration + unit test 件数 | 173 (Phase 58 166 → +7、観点 6/7 含む) |
| 新規 test assertion | +7 (cross / same / NULL / RESTRICT delete / statement-time / **active service same+cross** / **RPC 不変**) |
| 新規 migration | 1 (`0019_transport_order_invitations_user_company_composite_fk.sql`) |
| drift | 2 → 2 (増加なし) |
| Claude 側修正 (Codex 出力) | 0 (4 回連続 1 発採用目標) |

## 次ステップ

1. Codex adversarial review 投入 → BLOCK/WARN 収集
2. plan v2 反映
3. Codex implementation 一括委任
4. typecheck / vitest / drift QA
5. seal handoff (200 行以内)

---

*plan v1 by Claude (Phase 59、advisor 確認後)*
