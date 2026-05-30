# Phase 60 plan v2: admin_vendor_invitations.invited_by_user_id 複合 FK (D4 解消)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 60 (前: 59 sealed) |
| 状態 | **plan v2** (Codex adversarial review 反映済: BLOCK 2 + WARN 4 全採用、NOTE 3 維持) |
| 担当 | Claude (scope + plan v1/v2 + advisor + Codex review) → Codex (implementation 予定) |
| 前 handoff | `phase-59-transport-order-invitations-fk-sealed.md` |
| Codex review | `phase-60-codex-adversarial-review.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 59 から +2 commit 予定: feat + seal) |

## スコープ宣言

**debt 台帳 D4 解消**: `admin_vendor_invitations.invited_by_user_id` の company 整合を schema 強制する。Phase 56/57/58/59 の複合 FK pattern を完全流用 (`NO ACTION` / `RESTRICT` / MATCH SIMPLE / raw migration authoritative / catalog query 冪等)。

## handoff 警告の解消 narrative (ADR-0008)

Phase 59 sealed §Phase 60 推奨 #1 で「ADR-0008 も `admin_vendor_invitations` で関連、独立確認推奨」と warning されていたが、独立調査の結果:

- `invited_by_user_id` は **招待発行者 (admin、company 側 user)** で `users.id` (public schema) を参照 (`src/lib/db/raw-migrations/post/0010_admin_vendor_invitations.sql:18`)
- 招待**先 (vendor)** は別カラム `vendor_id` / `vendor_user_id` で分離 (lines 17, 19)
- service 経路で `companyId = context.adminUser.companyId`, `invitedByUserId = context.adminUser.userId` と両カラム同一 adminUser 由来、かつ事前に vendor company と adminUser company を `findVendor` で照合 (`src/lib/services/admin-vendor-invitations.ts:377-380`)
- ADR-0008 の company 境界懸念は vendor 側 (`vendors` / `vendor_users` テーブル) にあって、`invited_by_user_id` には影響しない
- 結論: **発行者側 FK として Phase 59 D3 と論理的同パターン**。ただし D4 は active insert 経路 (`createAdminVendorInvitation`) + UPDATE 経路 4 つ (callback finalize / expirer / resend / revoke) + audit trigger を持つため、本番経路の追加検証 (観点 6) と UPDATE 不変 suite (観点 7、4 経路) を併用する。

## INSERT/UPDATE 棚卸し結果 (BLOCK-1 反映、独立実施)

### service / route 経路

| 経路 | 種別 | `invited_by_user_id` 取扱 | 影響 |
|---|---|---|---|
| `src/lib/services/admin-vendor-invitations.ts:187-192` (`createAdminVendorInvitation`) | INSERT | `context.adminUser.userId` (同 `companyId` 由来、事前 `findVendor` で company 照合 :377-380) | active 経路、観点 6 で検証 |
| `src/lib/services/admin-vendor-invitations.ts:293-299` (`resendAdminVendorInvitation`) | UPDATE | `set({ sentAt, lastResentAt })` のみ、`invited_by_user_id` 不変 | 観点 7 で不変 assertion |
| `src/lib/services/admin-vendor-invitations.ts:335-347` (`revokeAdminVendorInvitation`) | UPDATE | `set({ status: 'revoked' })` のみ、`invited_by_user_id` 不変 | 観点 7 で不変 assertion |
| `src/app/(vendor-portal)/vendor/admin-invite-callback/finalize/route.ts:34-42` | UPDATE | `status / acceptedAt / vendor_user_id` 更新、`invited_by_user_id` 不変 | 観点 7 で不変 assertion |
| `src/lib/inngest/functions/invitation-expirer.ts:8-21` | UPDATE | `status='expired' / updatedAt` のみ、`invited_by_user_id` 不変 | 観点 7 で不変 assertion |
| `src/lib/services/admin-vendors.ts` | (関連 service) | `invitedByUserId` 参照なし | 影響なし |

### test fixture / seed 経路 (MATCH SIMPLE 継続 PASS 期待値明記)

| 経路 | 種別 | 影響 |
|---|---|---|
| `tests/integration/tenant-isolation.test.ts:69-70` | `users` 行 seed (`ADMIN_A`/`COMPANY_A`) | 既存、後続 `admin_vendor_invitations` INSERT の FK pre-condition |
| `tests/integration/tenant-isolation.test.ts:133-134, 146-147, 202-224` | direct INSERT (same-company `ADMIN_A` を `invited_by_user_id` に渡す) | 既存 fixture で複合 FK 通過 ✅ |
| `tests/integration/tenant-isolation.test.ts:280-297` (expirer audit smoke) | Drizzle INSERT (`invited_by_user_id` omit → NULL) | MATCH SIMPLE で FK check skip、継続 PASS ✅ |
| `tests/integration/services/admin-vendors.integration.test.ts:53-56, 91-104` | omitted / NULL INSERT | MATCH SIMPLE で FK check skip、継続 PASS ✅ |
| `tests/integration/app/admin-invite-callback.integration.test.ts:95-104` | callback fixture (`invited_by_user_id` omit → NULL) | MATCH SIMPLE で FK check skip、継続 PASS ✅ |
| `tests/integration/services/admin-vendor-invitations.integration.test.ts` | service 経由のみ、direct INSERT なし | 既存 fixture で通る ✅ |

### DB 層経路

| 経路 | 影響 |
|---|---|
| `src/lib/db/raw-migrations/post/0011_phase31c_fixup_and_audit_trigger.sql:136-139` (`trg_audit_admin_vendor_invitations`) | INSERT/UPDATE/DELETE で `record_audit_log` 発火、payload は jsonb で row content 記録のみ → FK 制約と直交、**side-effect regression 対象** (WARN-1) |
| RPC | `admin_vendor_invitations` UPDATE で `invited_by_user_id` を書き換える RPC なし (grep 0 件) — Phase 59 観点 7 (RPC 不変) は D4 では service UPDATE 4 経路 (callback/expirer/resend/revoke) に置換 |

## D3 と異なる点 (WARN-1 反映、audit trigger 分離)

| 観点 | D3 (Phase 59) | **D4 (Phase 60)** |
|---|---|---|
| 本番 INSERT 経路 | 1 service (`createTransportOrderWithNotification`) | 1 service (`createAdminVendorInvitation`、事前 vendor company guard あり) |
| **UPDATE 不変対象** | RPC 2 件 (`accept_invitation_and_revoke_others` / `respond_to_spot_invitation`) | **service 4 経路** (callback finalize / expirer / resend / revoke) |
| **audit trigger** | なし | **あり** (`trg_audit_admin_vendor_invitations`、post/0011) — UPDATE 不変対象ではなく **side-effect regression 対象**、jsonb payload で FK 変更影響なし |
| 既存 test fixture | `actingUserId` NULL 経路維持 | tenant-isolation/admin-vendors/callback fixture で NULL 経路維持 (MATCH SIMPLE で継続 PASS) |
| `ON DELETE SET NULL → NO ACTION` 意味変化 | trivial (本番 user は soft-delete) | trivial (本番 admin user は soft-delete) |

## 達成目標 (Phase 60)

- `admin_vendor_invitations.invited_by_user_id` に複合 FK `(invited_by_user_id, company_id) → users(id, company_id)` 追加 (MATCH SIMPLE / ON DELETE NO ACTION / ON UPDATE RESTRICT)
- 既存単独 FK (`admin_vendor_invitations_invited_by_user_id_fkey` 等) を catalog query で動的特定 → DROP
- `users_id_company_id_unique` は Phase 56 で追加済を冪等 check
- 7 観点 integration test 追加 (Phase 59 同形 5 + active 経路 1 + UPDATE 不変 suite 1)
- drift 維持 (2 → 2)
- 既存 service / callback / expirer / resend / revoke / audit trigger / test に retrogression なし

## 実装内容

### 1. 新規 raw migration: `src/lib/db/raw-migrations/post/0020_admin_vendor_invitations_user_company_composite_fk.sql`

Phase 59 (0019) と完全同一構造、テーブル名のみ差替。constraint 名は schema と完全一致させる (NOTE-1 反映):

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
    WHERE conrelid = 'public.admin_vendor_invitations'::regclass
      AND contype = 'f'
      AND conkey = ARRAY[(
        SELECT attnum FROM pg_attribute
        WHERE attrelid = 'public.admin_vendor_invitations'::regclass
          AND attname = 'invited_by_user_id'
      )]::smallint[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.admin_vendor_invitations DROP CONSTRAINT IF EXISTS %I',
      existing_fk_name
    );
  END LOOP;

  -- (c) 複合 FK を IF NOT EXISTS で追加
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.admin_vendor_invitations'::regclass
      AND conname = 'admin_vendor_invitations_invited_by_user_company_fk'
  ) THEN
    ALTER TABLE public.admin_vendor_invitations
      ADD CONSTRAINT admin_vendor_invitations_invited_by_user_company_fk
      FOREIGN KEY (invited_by_user_id, company_id)
      REFERENCES public.users (id, company_id)
      MATCH SIMPLE
      ON DELETE NO ACTION
      ON UPDATE RESTRICT;
  END IF;
END $$;
```

### 2. drizzle schema 更新: `src/lib/db/schema/admin_vendor_invitations.ts` (NOTE-2 反映)

Phase 59 と**完全同型** pattern: `invited_by_user_id` の単独 `references()` を削除し、テーブルレベルで `foreignKey()` 複合 FK を追加。`.onUpdate("restrict")` のみ明示、**`onDelete` は omit** (raw migration 0020 が authoritative)。

参考 base: `src/lib/db/schema/transport_order_invitations.ts:40, 84-88` (Phase 59、`onDelete` omit pattern)。

具体的変更:
- Line 20-22: `invitedByUserId: uuid("invited_by_user_id").references(() => users.id, { onDelete: "set null" })` → `invitedByUserId: uuid("invited_by_user_id")` (`.references()` 削除)
- `(t) => ({ ... })` 内に `invitedByUserCompanyFk: foreignKey({ columns: [t.invitedByUserId, t.companyId], foreignColumns: [users.id, users.companyId], name: "admin_vendor_invitations_invited_by_user_company_fk" }).onUpdate("restrict")` を追加 (constraint 名は raw migration 0020 と完全一致)
- `foreignKey` を `drizzle-orm/pg-core` から import 追加
- ファイル冒頭コメントに「Composite FK enforces (invited_by_user_id, company_id) -> users(id, company_id). raw migration 0020 is authoritative; drizzle-kit generate/push must not be used to regenerate this FK. onDelete intentionally omitted (raw SQL sets ON DELETE NO ACTION; ON UPDATE RESTRICT here mirrors raw migration).」を追記

### 3. integration test 新規: `tests/integration/db/admin-vendor-invitations-fk.integration.test.ts`

**Phase 59 test の seed helper を literal copy 禁止** (WARN-2 反映): Phase 59 の `seedUser` は auth.users と public.users を別 statement で INSERT しており、Phase 60 plan の CTE contract と矛盾。新規 test では user seed を `WITH auth_user AS (INSERT INTO auth.users (...) RETURNING id) INSERT INTO public.users (...) SELECT id ...` の **1 statement CTE 形式に固定**する。

7 観点:

- **(i)** cross-company user 拒否 (FK 違反): 別 company の `invited_by_user_id` を渡して raw INSERT → `FOREIGN_KEY_VIOLATION` (SQLSTATE 23503) で reject
- **(ii)** same-company user 受理: 同 company の `invited_by_user_id` で raw INSERT → 成功、returning で行確認
- **(iii)** NULL `invited_by_user_id` 受理 (MATCH SIMPLE): `invited_by_user_id` を NULL で INSERT → 成功 (MATCH SIMPLE で FK check skip)
- **(iv)** **referenced user delete is restricted** (vendor cascade とは別系統と test 名で明示、NOTE-3 反映): 既存 invitation 行が `invited_by_user_id` で user を参照中 → user 削除を NO ACTION RESTRICT で拒否
- **(v)** statement-time check 確認 (`NO ACTION non-deferrable` D1/D2/D3 文言で統一)
- **(vi)** **active 経路 same/cross-company adminUser 検証** (BLOCK-2 反映、direct service call **必須**、raw INSERT fallback **禁止**):
  - **same-company**: 通常 fixture の `adminUser` で `createAdminVendorInvitation` を呼び成功
  - **cross-company**: `adminUser.companyId = vendor.companyId` のまま `adminUser.userId` だけ別 company の public user id に差し替える manual `adminUser` を構築し service を direct call。`findVendor` の company guard を通過させた上で INSERT が FK 23503 になることを assert (service 前段 auth context を bypass した上で composite FK が active 経路を捕捉できることを証明)
- **(vii)** **UPDATE 不変 suite** (WARN-3 反映、4 経路の subcase): invitation 行を seed (`status='sent'`, `invited_by_user_id=admin user A`) → 以下 4 経路の UPDATE 後にいずれも `invited_by_user_id` が変更されていないことを assert
  - (vii-a) callback finalize 経路 (`status='accepted'` UPDATE)
  - (vii-b) expirer 経路 (`status='expired'` UPDATE)
  - (vii-c) `resendAdminVendorInvitation` 経路 (`sentAt / lastResentAt` UPDATE)
  - (vii-d) `revokeAdminVendorInvitation` 経路 (`status='revoked'` UPDATE)

auth.users CTE pattern (WARN-2): user INSERT は必ず 1 statement CTE で行う。

## Phase 59 継承項目

| 項目 | 継承内容 |
|---|---|
| WARN-1 (Phase 58→59) | `auth.users → public.users CASCADE` 経路は soft-delete 運用前提で許容、cleanup 順序実装は別 Phase |
| BLOCK-2 文言統一 | "statement-time check (NO ACTION non-deferrable)" を D1/D2/D3 と統一 |
| 7 観点 integration test | Phase 59 同形 5 + active 経路 1 + 不変 suite 1 (4 subcase) |
| auth.users CTE pattern | **1 statement CTE 固定**、Phase 59 helper literal copy 禁止 (WARN-2) |
| catalog query 冪等性 pattern | DO ブロック + `IF NOT EXISTS` / `IF EXISTS` + FOR LOOP DROP |
| Drizzle `onDelete` omit pattern | raw migration authoritative、Phase 58 BLOCK-3 確立 / Phase 59-60 継承 |
| active 経路保護 (Phase 59 BLOCK-1) | service direct call で same/cross-company adminUser 検証 (raw INSERT fallback 禁止、BLOCK-2) |

## 不変条件 (invariants、WARN-4 反映)

- 既修正 29 機能 (#1-#29) すべてに retrogression なし
- typecheck clean / 21 test files / 173 tests PASS (Phase 59 base) → +7 test で 180 tests 目標
- CI E2E 7/7 PASS
- 複合 FK semantic 維持: `(invited_by_user_id, company_id) → users(id, company_id)`, MATCH SIMPLE, ON DELETE NO ACTION, ON UPDATE RESTRICT
- users(id, company_id) UNIQUE 維持 (Phase 56 で追加)
- raw migration 0016+0017+0018+0019+**0020** が authoritative (drizzle-kit generate/push 禁止)
- catalog query 冪等性 pattern 維持
- **`createAdminVendorInvitation` 既存 test 全件 PASS** (`context.adminUser` 一貫性経路維持)
- **active 経路 same-company adminUser が新 FK 下で動く** (観点 6 で保証)
- **UPDATE 4 経路 (callback finalize / expirer / resend / revoke) で `invited_by_user_id` 不変** (観点 7 suite で保証)
- **audit trigger (`trg_audit_admin_vendor_invitations`) 動作不変** (jsonb payload に FK 変更影響なし、side-effect regression 対象)
- **Phase 59 transport RPC invariants 維持** (WARN-4): `accept_invitation_and_revoke_others()` / `respond_to_spot_invitation()` で `invited_by_user_id` 不変、`tests/integration/db/transport-order-invitations-fk.integration.test.ts` を既存 regression として維持実行
- ADR-0008 文脈保護: vendor 側カラム (`vendor_id` / `vendor_user_id`) には影響を与えない
- `tests/integration/tenant-isolation.test.ts:133-148, 202-224, 280-297` 既存 INSERT 経路全件 PASS (same-company `ADMIN_A` seed 済 + NULL 経路は MATCH SIMPLE で通る)
- `tests/integration/services/admin-vendors.integration.test.ts:53-56, 91-104` および `tests/integration/app/admin-invite-callback.integration.test.ts:95-104` の NULL omitted INSERT 全件 PASS

## リスク評価

| 項目 | リスク | 緩和策 |
|---|---|---|
| service caller が cross-company adminUser を渡す | 低 | 通常 `context.adminUser` 一貫性で同一 company、test 観点 6 で direct service call で schema 捕捉 |
| auth.users CASCADE 削除時 NO ACTION で阻害 | 低 | soft-delete 運用前提、本番 admin user 物理削除なし |
| 既存単独 FK 名が想定と違う | 低 | catalog query で動的特定 (固定名想定なし) |
| drift 増加 | 低 | 0020 ALTER のみ、drift 2 → 2 維持 |
| audit trigger payload への影響 | 低 | payload は jsonb で row content 記録のみ、FK 制約と直交 (side-effect regression 対象として monitor) |
| UPDATE 経路の暗黙的 `invited_by_user_id` 書き換え | 低 | grep で書き換え 0 件、観点 7 suite で 4 経路 assertion 化 |
| Phase 59 helper literal copy で CTE contract 違反 | 中 | WARN-2 で literal copy 禁止明記、CTE 形式を plan に固定 |

## 想定 Codex 委任

| del id | task | 想定 |
|---|---|---|
| adversarial-review | plan v1 review | ✅ 完了 (BLOCK 2 + WARN 4 + NOTE 3、plan v2 全採用) |
| implementation | migration 0020 + drizzle schema + 7 観点 test 一括 | auto-apply / 1 発採用想定 (Phase 55/57/58/59 と同等、5 回連続 1 発採用目標) |

## 主要メトリクス目標

| 指標 | 目標 |
|---|---|
| 変更ファイル | 2 new (migration + test) + 1 modify (schema) + 2 plan/review + 1 seal = 6 files |
| test files | 22 (Phase 59 21 → +1) |
| integration + unit test 件数 | 180 (Phase 59 173 → +7) |
| 新規 test assertion | +7 (cross / same / NULL / RESTRICT delete / statement-time / active service same+cross / **UPDATE 不変 suite 4 subcase**) |
| 新規 migration | 1 (`0020_admin_vendor_invitations_user_company_composite_fk.sql`) |
| drift | 2 → 2 (増加なし) |
| Claude 側修正 (Codex 出力) | 0 (5 回連続 1 発採用目標) |

## 次ステップ

1. ✅ Codex adversarial review 投入 → BLOCK 2 / WARN 4 / NOTE 3 収集
2. ✅ plan v2 反映
3. Codex implementation 一括委任 (auto-apply)
4. typecheck / vitest / drift QA
5. seal handoff (200 行以内)

---

*plan v2 by Claude (Phase 60、Codex adversarial review 反映済、BLOCK 2 + WARN 4 全採用、NOTE 3 維持)*
