# Phase 40 plan: Phase 31-recon (bug 5/6 + integration test + cleanup + pathname predicate)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 40 (前: 39 partial sealed) |
| 状態 | planning |
| 着手日時 | 2026-05-26 |
| 前 handoff | `phase-39-ci-verify-partial-recon-plan.md` |
| branch | `phase-26-ci-verify` (最新 `8525f78`) |

## サマリ

Phase 39 で発見された残 2 bug (sent_at must be a Date / notification_outbox FK violation on cleanup) と、mocked-unit test が real DB constraint を検証できない blind spot を解決する。順序は integration test インフラ確立 → bug 5 TDD 修正 → bug 6 cleanup 修正 → E2E assertion audit → CI green。integration を先に書き bug 5 の正確な再現条件を特定する。

## 事前確認 (着手前 discriminator 結果, 2026-05-26)

- **bug 5 真の発生源**: `src/lib/services/admin-vendors.ts:82` の `getVendorsWithInvitationStatus`。`database.execute(sql\`...\`)` (raw SQL) で `row.sent_at` を unknown のまま受け取り、`expectNullableDate` (line 113) で `instanceof Date` fail → throw。**Drizzle schema mapping を経由しないため postgres-js が timestamptz を string で返す**
- **bug 6 真の発生源**: cleanupAdminE2E に **`notification_outbox` 削除欠如のみ**。CI log で violation は `notification_outbox_company_id_fkey` 1 種のみ (admin_vendor_invitations / vendors / vendor_users は CASCADE/SET NULL で violation なし)
- **vitest.config.ts**: 現状 single config で unit + integration 同一 include。project 分離は新規追加が必要
- **tenant-isolation.test.ts pattern 確認済**: withFixture + `sql.begin` で transaction、`DIRECT_URL` 必須、postgres-js + drizzle 直接接続。再利用可能

## 残る確認事項 (ユーザー判断)

1. **CI に DATABASE_URL secret あるか**: なければ integration は local のみ運用、CI は unit + E2E のみ (現状の方針確認)
2. **bug 5 修正方針の選択** (下記 T3 参照)

## 作業順序

```
#T1 vitest project 設定 (unit/integration 分離)
  ↓
#T2 admin-vendor-invitations integration test 作成 (TDD RED)
  ↓
#T3 bug 5 修正 (sent_at) — RED → GREEN
  ↓ (#T4 は並行可)
#T4 bug 6 修正 (cleanupAdminE2E に outbox + invite + vendor_users + vendors 削除追加)
  ↓
#T5 E2E assertion audit (vendor-portal-loop / spot-loop の regex → pathname predicate)
  ↓
#T6 CI push → green 確認 → Phase 40 seal
```

## タスク詳細

### T1: vitest project 分離 (Codex 委任 / ~30 行 / 依存なし)
- `vitest.config.ts` を unit / integration の 2 project 構成へ
- unit: `tests/unit/**` + `tests/_helpers/**`, DATABASE_URL 不要
- integration: `tests/integration/**`, DATABASE_URL 必須
- 既存 `tenant-isolation.test.ts` が integration に入ること

### T2: integration test 作成 (Codex 強制委任 / ~150 行 / T1 依存)
- 新規 `tests/integration/services/admin-vendors.integration.test.ts` + `admin-vendor-invitations.integration.test.ts`
- パターン: `tenant-isolation.test.ts` の withFixture / rollback-on-throw / DIRECT_URL / drizzle
- カバー (bug 5 regression 含む):
  - **`getVendorsWithInvitationStatus`**: sent_at / created_at が Date object として返ること (bug 5 直接 cover)
  - `createAdminVendorInvitation` happy + duplicate (CHECK / FK 通過確認)
  - `resendAdminVendorInvitation` (status / lastResentAt 更新)
  - `revokeAdminVendorInvitation` (status, cross-tenant)
  - (`runExpireOnce` は tenant-isolation 既存ならスキップ)
- `supabaseAdmin.inviteUserByEmail` は `vi.fn()` mock, DB は real

### T3: bug 5 修正 (Claude / 3〜10 行 / T2 依存)
- 発生源確定: `admin-vendors.ts:82` で raw SQL から string で来た timestamp を helper が拒否
- **修正方針 2 案** (ユーザー判断):
  - **(a) 最小修正**: `expectNullableDate` (line 113) を string accept に拡張。string → `new Date(value)` で変換。3 行追加 / risk 最小
  - **(b) 根本修正**: `database.execute(sql\`...\`)` を Drizzle `select().from().leftJoinLateral(...)` に書き換え、schema 経由で Date object を取得。30〜50 行リライト / 型安全性向上
- **推奨は (a)**。raw SQL の `LEFT JOIN LATERAL` は Drizzle で書き換えコスト高、helper 拡張で十分

### T4: bug 6 修正 (Claude or Codex / 1〜3 行 / 独立)
- `tests/_helpers/seed-admin-e2e.ts` `cleanupAdminE2E` (現 4 ステップ → 5 ステップ)
- 修正: `companies` delete 前に `notification_outbox` 削除 1 行追加
  ```
  await db.delete(notificationOutbox).where(eq(notificationOutbox.companyId, seeded.companyId));
  ```
- CI log で violation は `notification_outbox_company_id_fkey` のみ → 他 table は CASCADE/SET NULL で問題なし
- 既存 audit_logs 二段削除パターンは維持
- ※ admin_vendor_invitations / vendor_users / vendors の追加削除は **over-cleaning**、追加 violation が出てから判断 (advisor 指摘)

### T5: E2E assertion audit (Codex 委任 / ~20 行 / 独立)
- 対象: `tests/e2e/vendor-portal-loop.spec.ts`, `vendor-portal-spot-loop.spec.ts`
- `page.waitForURL(/regex/)` / `expect(page).toHaveURL(/regex/)` を pathname predicate へ
- 参考: `admin-vendor-invite.spec.ts` の `loginAsAdmin` (line 33, 106)
- ※ `admin-vendor-invite.spec.ts:117` の `/invited=ok/` はクエリ確認意図 → 変更不要

### T6: CI green + seal (Claude)
- T1-5 完了後 push、CI 観察
- seal 条件:
  - admin-vendor-invite test 1/2/3 PASS
  - vendor-portal-loop / spot-loop PASS
  - vitest unit 104 PASS / typecheck clean
  - cleanupAdminE2E に FK violation log なし
  - integration test (DATABASE_URL あり環境で) 全 PASS

## Codex 委任候補

| Task | 委任 | 理由 |
|---|---|---|
| T1 | Codex | ボイラープレート設定 (~30 行) |
| T2 | Codex 強制 | tests/ 配下 150 行 |
| T3 | Claude | helper 3 行修正 (判断含むため Claude 推奨、override reason: 設計判断含み) |
| T4 | Claude | 1 行修正 (Codex 委任の overhead に見合わず) |
| T5 | Codex | 多ファイル定型変換 |

## リスク

| リスク | 対処 |
|---|---|
| bug 5 が integration で再現せず E2E 固有 | E2E の認証経路 / inviteUserByEmail mock 経路を確認 |
| CI に DATABASE_URL なし | integration は local のみ運用、CI は unit + E2E のみ |
| FK 削除順序ミスで violation 移動 | data-model.md FK 定義 (RESTRICT/CASCADE) で検証 |
| `notification_outbox.admin_vendor_invitations_id` FK 無い | outbox は companyId 経由削除必須 (T4 設計済) |

## 成功基準 (Phase 40 seal)

- [ ] CI E2E green (admin-vendor-invite test 1/2/3, vendor-portal-loop, spot-loop)
- [ ] vitest unit 104 PASS / typecheck clean / cleanup log エラーなし
- [ ] integration test admin-vendor-invitations 全 PASS (DATABASE_URL あり環境)
- [ ] 既修正 4 bug に regression なし (route group / loginAsAdmin / outbox target_type / audit cleanup)

## 参照ファイル

- `phase-handoff/phase-39-ci-verify-partial-recon-plan.md` (前 handoff)
- `src/lib/services/admin-vendor-invitations.ts:120` 周辺 (bug 5)
- `tests/_helpers/seed-admin-e2e.ts` `cleanupAdminE2E` (bug 6)
- `tests/integration/tenant-isolation.test.ts` (integration pattern)
- `tests/unit/lib/services/admin-vendor-invitations.test.ts` (mock 利用箇所)
- `tests/e2e/admin/admin-vendor-invitations.spec.ts` (Phase 31-D E2E)
- spec/data-model.md §3.12 (notification_outbox), Admin Vendor Invitation 関連
- CI run `26424357549` (5/5 bug 発見 run)

## 絶対に壊さないもの

- 既修正 4 bug (route group `admin/` / loginAsAdmin pattern / outbox target_type=vendor / audit cleanup 二段)
- vitest 104 PASS / typecheck clean
- 公開 API シグネチャ (6 service 関数) 不変
- spec/data-model.md v2.4 / `target_type` enum 維持

---

*Generated by phase-handoff skill (planner agent + Claude) at 2026-05-26 (Phase 40 planning)*
