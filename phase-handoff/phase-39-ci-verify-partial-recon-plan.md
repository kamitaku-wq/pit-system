# Phase 40 入力契約: Phase 39 CI verify partial sealed + Phase 31-recon plan

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 39 (前: 38 Phase 31-D sealed) |
| 状態 | partial sealed (CI green 未達、3 件 latent bug 修正、2 件残置 + Phase 31-recon 計画) |
| 完了日時 | 2026-05-26 |
| 担当 | Claude (CI 検証 + advisor 3 回 + 構造 fix + 2 件 service/test fix) / Codex (test 2 loginAsAdmin helper) |
| 前 handoff | `phase-38-phase-31-d-sealed.md` |
| 主要 commit | `45dd4e0` `9aab506` `8525f78` |

## 達成したこと (Phase 39)

- **CI E2E 統合検証着手**: branch push (`6f5ad9d`) → 4 回 CI run → 5 件 latent bug 発見
- **latent bug 1/5 修正 (Phase 31-D)**: test 2 認証共有不足 — `loginAsAdmin(page, admin, targetPath)` ヘルパー追加、pathname predicate (Codex del-20260525-224647-03d0)
- **latent bug 2/5 修正 (Phase 31-A foundation)**: **`(admin)` route group は URL 除外** で `/admin/*` は全 404。`src/app/(admin)/` → `src/app/admin/` rename + test 1 regex を pathname predicate に tighten (false positive 排除)
- **latent bug 3/5 修正 (Phase 31-C)**: outbox `target_type: "vendor_user"` が DB CHECK 違反 → spec/data-model.md §3.12 通り `"vendor"` に変更 (dispatcher は target_type 分岐なしのため機能影響なし)
- **latent bug 4/5 修正 (Phase 31-D test infra)**: `cleanupAdminE2E` で `trg_audit_users` が DELETE 監査 row を追加 → companies delete で FK violation。users delete 後に audit_logs 再削除を追加
- **5 件目以降の latent bug 発見**: 下記「残課題」参照
- **typecheck clean 維持** (3 commit すべて)

## Claude 側の主要設計判断

1. **三層レビュー継続**: 各修正前に advisor 呼び出し (合計 3 回)。test 1 unchanged / pathname predicate / 構造 rename / Phase 31-recon scope 拡大判断
2. **`(admin)` → `admin/` rename を選択**: Option 2 (rewrites) / Option 3 (admin/ サブフォルダ) より clean。`(vendor-portal)/vendor/...` パターンと対称
3. **test 1 false positive 修正**: 正規表現 assertion を厳格な pathname predicate に統一。今後 admin route 追加時の test pattern として確立
4. **outbox を service 側で修正**: migration 追加せず service の value を spec compliant に変更 (最小修正、spec/data-model.md v2.4 維持)
5. **(b) scope 判断**: ユーザー確認 (3 件発見時点) で「outbox + cleanup → Phase 31-recon」に確定。CI green を強引に追わず、test infra の根本見直しに pivot

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260525-224647-03d0 | test 2 loginAsAdmin helper (top-level + pathname predicate) | applied (auto-apply P2) |

## 残課題: 未修正の latent bug (Phase 31-recon scope)

| # | Phase 起源 | 症状 | 推定原因 | 影響 |
|---|---|---|---|---|
| 5 | 31-C | `Error: admin_vendor_invitations.sent_at must be a Date` (server-side throw) | service の sent_at field 型変換 or null 渡し (line 120 推定) | invite submit で 500 → success banner 出ず |
| 6 | 31-D test infra | `notification_outbox_company_id_fkey` violation on companies delete | `cleanupAdminE2E` が outbox row を削除していない | CI に毎回 cleanup error 出る、env 汚染 |

## test-quality blind spot (Phase 31-recon の核心問題)

vitest 104 PASS で全件 latent を見落とした原因:
- **`db.insert` / `db.update` を mock** している unit test が大半 → real Postgres の CHECK constraint / trigger / FK を validation していない
- **test 1 false positive**: regex `/\/admin\/vendors/` が URL クエリ内文字列に match で route group bug を 4 phases 跨いで見逃し
- **integration test (`tenant-isolation.test.ts`) は env 必須**で開発ループから外れ、CI でも skip されがち

→ **Phase 31-recon の必須テーマ**: どの service 関数が mocked-unit のみで integration カバーされていないか、test 設計の見直し

## Phase 40 入力契約

### 推奨される次 Phase スコープ (Phase 40 = Phase 31-recon)

1. **service 関数 audit**: `createAdminVendorInvitation` / `resendInvitation` / `revokeInvitation` / `runExpireOnce` の各 4 関数を real Postgres integration で実行検証 (sent_at 含む型保証 + constraint 通過)
2. **test pattern 統一**: pathname predicate を全 E2E spec に適用 (vendor-portal-loop / vendor-portal-spot-loop も regex assertion を audit)
3. **cleanup helper の完全化**: `cleanupAdminE2E` で関連 table を体系的に削除 (audit_logs 二段、notification_outbox、admin_vendor_invitations、vendor_users、vendors)
4. **bug 5 + 6 修正**: recon 計画と並行で
5. **CI green 確認**: bug 5/6 修正後に再 push、最終 green を Phase 40 seal の条件に

### 参照すべきファイル
- 本 handoff (`phase-39-ci-verify-partial-recon-plan.md`)
- `phase-38-phase-31-d-sealed.md` (前 Phase)
- `src/lib/services/admin-vendor-invitations.ts` line 120 周辺 (sent_at)
- `tests/_helpers/seed-admin-e2e.ts` `cleanupAdminE2E` (notification_outbox + sequencing)
- `tests/unit/lib/services/admin-vendor-invitations.test.ts` (mock 利用箇所)
- spec/data-model.md §3.12 `notification_outbox` constraint
- CI run `26424357549` (5/5 bug 発見 run)

### 絶対に壊してはいけないもの (invariants)
- 既に修正済 4 bugs の retrogression なし: route group rename / loginAsAdmin pattern / outbox target_type=vendor / audit_logs cleanup 二段
- vitest 104 PASS / typecheck clean
- 公開 API シグネチャ (6 service 関数) 不変
- spec/data-model.md v2.4 / `target_type` enum 維持

### 注意点・コンテキスト
- branch: `phase-26-ci-verify`、最新 commit `8525f78`
- CI 4 run 全失敗: `26422424837` `26422931740` `26423649079` `26424357549`
- Phase 39 で commit 3 個 (`45dd4e0` `9aab506` `8525f78`)、すべて CI green 未達のままだが latent bug 4 件は確実に解消
- audit_logs cleanup error は Phase 31-C で初回 surface、Phase 39 でようやく user delete trigger 発生源を確認

## Codex ledger refs

- del-20260525-224647-03d0 (test 2 loginAsAdmin, auto-apply P2)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 39 commit 数 | 3 (`45dd4e0` `9aab506` `8525f78`) |
| 追加 / 修正コード行数 | +28 / -3 (test fix + folder rename + service 1 行 + cleanup 3 行) |
| folder rename | 9 files (`(admin)/` → `admin/`) |
| 修正済 latent bug | 4 (route group + test 2 auth + outbox target_type + audit cleanup) |
| 未修正 latent bug | 2 (sent_at validation + notification_outbox cleanup) |
| CI run 数 | 4 (全 failure) |
| advisor 呼び出し | 3 回 (test 2 fix / 404 root cause / outbox scope decision) |
| Codex 委任 task 数 | 1 (test 2 spec) |
| セッション数 | 1 (Phase 31-D sealed → Phase 39 partial) |

## 振り返りメモ

- うまくいった: advisor 3 回呼び出しで test 1 false positive・route group bug・scope creep を順次解明。盲目進行を防いだ
- うまくいった: ユーザーへの scope 確認 (3 件発見時) で「Phase 31-recon に pivot」の合意。CI green を強引に追わず方針転換
- 課題: vitest mock-unit が real DB と乖離しすぎ、Phase 31-A〜D の 4 bug を完全に見逃した。Phase 31-recon の主題
- 課題: Phase 31-A handoff の "CI E2E 統合検証 — defer to Phase 27" 判断が Phase 39 まで持ち越され、bug が累積した
- 学び: 「test PASS = 機能正常」は false。pathname predicate / 厳格 assertion / integration カバレッジが必須
- 学び: CI 1 run = ~5 分。早めに走らせれば 4 bug を Phase 31-A 時点で捕捉できた

---

*Generated by phase-handoff skill / Partial sealed by Claude at 2026-05-26 (Phase 39 CI verify 中断、4 bug 修正 + 2 bug 残置 + Phase 31-recon plan)*
