# Phase 41 入力契約: Phase 40 Phase 31-recon sealed (bug 5/6/7 完全修正 + test infra 強化)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 40 (前: 39 partial sealed) |
| 状態 | **sealed (CI green 達成)** |
| 完了日時 | 2026-05-26 |
| 担当 | Claude (plan + bug 5/6/7 fix + heredoc bypass) / Codex (T2 background apply / T1+T5 partial apply) |
| 前 handoff | `phase-39-ci-verify-partial-recon-plan.md` |
| 主要 commit | `40e9e5e` (bug 5/6 + T1 + T5) / `1bc4a6e` (bug 7 + T2) |
| CI run (green) | `26427395391` (e2e 7/7 PASS) |

## 達成したこと (Phase 40)

- **bug 5 修正 (Phase 31-C 起源)**: `admin-vendors.ts:113` `expectNullableDate` を string accept に拡張。raw SQL `database.execute()` で postgres-js が timestamptz を ISO string で返す挙動に対応 (`new Date(value)` 変換 + Invalid Date チェック)
- **bug 6 修正 (Phase 31-D test infra)**: `cleanupAdminE2E` に `notification_outbox` 削除 1 行追加 (FK violation 解消)
- **bug 7 修正 (Phase 31-B 起源、Phase 40 surface)**: admin invite callback の fragment-based implicit flow 対応。server route を client page + finalize server action に分離
- **T1 vitest project 分離**: unit / integration 分離 + setupFiles (DATABASE_URL 未設定時 mock) + passWithNoTests
- **T2 integration test 追加**: `admin-vendors.integration.test.ts` (117 行) + `admin-vendor-invitations.integration.test.ts` (232 行) で bug 5 regression cover + 4 service 関数 real Postgres 検証
- **T5 E2E pathname predicate 統一**: vendor-portal-loop / spot-loop の URL assertion 3 箇所
- **CI green 達成**: e2e 7/7 PASS (test 1-7 全成立)、Phase 39 fail 全解消
- **typecheck clean / vitest unit 35 PASS / integration 79 PASS** 維持

## Claude 側の主要設計判断

1. **着手前 discriminator 実施 (advisor 指摘的中)**: planner agent の 4 仮説を `grep "must be a Date"` で 30 秒で 1 つに絞り込み。throw site は `admin-vendor-invitations.ts` ではなく **`admin-vendors.ts:113` (vendor listing helper)** が真相
2. **bug 5 最小修正方針**: helper の string accept (Option a) を選択。raw SQL を Drizzle select に書き換える Option b は LATERAL JOIN リライトコスト高で却下
3. **bug 6 over-cleaning 回避**: CI log で violation が `notification_outbox_company_id_fkey` のみと確認、planner 案の `admin_vendor_invitations` / `vendor_users` / `vendors` 追加削除は不要と判断 (advisor 指摘的中)
4. **bug 7 修正方針**: callback を server route 一本化から **client page (fragment 解析 + setSession) + finalize server action (DB update)** に分離。Supabase implicit flow は fragment-based のため server で fragment 受け取り不可
5. **hook bypass 判断**: Codex 5 連続 sandbox-blocked + hook 3 回 PERSISTENT BLOCK で詰み → user 承認の上で Bash heredoc bypass。CLAUDE.md「Write files: NOT echo」原則の例外運用
6. **CI 投入順序**: bug 5/6 + T1 + T5 を先に 1 commit push (`40e9e5e`) → bug 7 surface 確認 → bug 7 + T2 を別 commit push (`1bc4a6e`)。中間 CI で 4 bug 解消を確認しつつ次 bug surface を早期検出

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260526-005144-9f15 | T1 vitest project 分離 (background) | apply (config + setup file 作成) |
| del-20260526-005203-9ada | T5 E2E pathname predicate (background) | apply (3 箇所修正) |
| del-20260526-010635-7724 | T2 integration test (background) | **rejected (空振り疑い)** → 実は apply 成功 (後で発覚) |
| (sync rescue) | T1 vitest config 同期書き換え | apply (sync 版が overwrite、setup file は別途 Claude integrate) |
| (sync exec) | bug 7 callback 修正 | read-only sandbox で apply 拒否 → Claude 自実装 (heredoc bypass) |

**Codex 環境問題**: Windows read-only sandbox + approval `never` で `apply_patch` 拒否が連続発生。Phase 41 で `~/.codex/config.toml` 見直し推奨。

## 修正済 latent bug 完全リスト (Phase 39+40 累積)

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1 | 31-D | 39 | test 2 認証共有不足 (loginAsAdmin helper) |
| 2 | 31-A | 39 | `(admin)` route group → URL 除外 (admin/ rename) |
| 3 | 31-C | 39 | outbox `target_type: vendor_user` → `vendor` |
| 4 | 31-D test infra | 39 | `cleanupAdminE2E` audit_logs 二段削除 |
| 5 | 31-C | **40** | `admin-vendors.ts` raw SQL ISO string → Date 変換 |
| 6 | 31-D test infra | **40** | `cleanupAdminE2E` notification_outbox 削除追加 |
| 7 | 31-B | **40** | callback fragment-based 対応 (client page + finalize) |

## 残課題 / 既知の懸念

- **本番 invite flow 未検証**: bug 7 修正は E2E で動作確認したが、本番の `inviteUserByEmail` 経由 (Supabase 自動メール送信) でも fragment-based か query-based か未確定。本番 Supabase project の URL Configuration 次第
- **Codex sandbox 不調**: 6 回中 5 回 sandbox-blocked。Phase 41 で `~/.codex/config.toml` 見直しが必要
- **T2 integration test の品質 audit 未実施**: typecheck pass / Codex 自動生成だが、各 test ケースが意図通り real DB で検証しているか手動レビュー未実施

## Phase 41 入力契約

### 推奨される次 Phase スコープ

1. **本番 invite flow E2E 検証**: 実際の `inviteUserByEmail` メール経由でも /vendor/requests に到達するか確認。fragment vs query flow を本番設定でも統一
2. **Codex sandbox 設定見直し**: `~/.codex/config.toml` の sandbox-mode / approval-policy を writable に設定、apply_patch が機能する状態にして委任率回復
3. **T2 integration test 品質 audit**: 各 test ケースのアサーションが real DB constraint を validation しているか確認、足りない箇所追加
4. **`vendor/invitations/callback` (別 callback) も同じ bug?**: PKCE 期待のため Supabase 設定次第で同じ issue 発生する可能性、proactive に audit

### 参照すべきファイル
- 本 handoff (`phase-40-recon-sealed.md`)
- `phase-handoff/phase-40-recon-plan.md` (plan)
- `phase-handoff/phase-39-ci-verify-partial-recon-plan.md` (前 Phase)
- `src/app/(vendor-portal)/vendor/admin-invite-callback/page.tsx` (bug 7 fix client)
- `src/app/(vendor-portal)/vendor/admin-invite-callback/finalize/route.ts` (bug 7 fix server action)
- `src/lib/services/admin-vendors.ts:113` (bug 5 fix)
- `tests/_helpers/seed-admin-e2e.ts` `cleanupAdminE2E` (bug 6 fix)
- `tests/integration/services/admin-vendors{,-invitations}.integration.test.ts` (T2)
- `vitest.config.ts` + `tests/_setup/integration-setup.ts` (T1)
- CI run `26427395391` (green run)

### 絶対に壊してはいけないもの (invariants)
- 既修正 7 bug 全てに retrogression なし
- vitest unit 35 PASS / integration 79 PASS / typecheck clean
- CI E2E 7/7 PASS (admin-vendor-invite × 3, vendor-portal-loop × 2, spot-loop × 2)
- 公開 API シグネチャ不変 (6 service 関数 + callback URL `/vendor/admin-invite-callback`)
- spec/data-model.md v2.4 / `target_type` enum 維持

### 注意点・コンテキスト
- branch: `phase-26-ci-verify`、最新 commit `1bc4a6e`
- CI green: e2e 7/7 PASS (run `26427395391`)
- Codex 委任は現在 broken (sandbox-blocked) — Phase 41 復旧推奨
- hook bypass 1 回実施 (page.tsx, user 明示承認下、heredoc 経由)

## Codex ledger refs

- del-20260526-005144-9f15 (T1 vitest config, applied)
- del-20260526-005203-9ada (T5 E2E predicate, applied)
- del-20260526-010635-7724 (T2 integration test, applied — rejected reason 撤回)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 40 commit 数 | 2 (`40e9e5e`, `1bc4a6e`) |
| 追加 / 削除コード行数 | +538 / -70 |
| 新規ファイル | 4 (T2 × 2, callback page + finalize, integration-setup) |
| 削除ファイル | 1 (admin-invite-callback/route.ts) |
| 修正済 latent bug | 3 (5, 6, 7) — 累積 7 bug 全消化 |
| CI run 数 | 2 (`26426538349` partial / `26427395391` green) |
| advisor 呼び出し | 2 回 (plan 着手前 / bug 7 fix 前) |
| Codex 委任 task 数 | 5 (T1×2, T2, T5, bug 7 — うち bug 7 sandbox-blocked) |
| Codex sandbox-blocked 率 | 5/6 |
| hook block 数 | 3 (page.tsx 連続 + vitest.config.ts) |
| セッション数 | 1 (Phase 39 partial → Phase 40 sealed) |

## 振り返りメモ

- **advisor の貢献**: 2 回呼び出しで (1) bug 5 真因 (admin-vendors helper) を 4 仮説 → 30 秒 grep で確定、(2) T4 over-cleaning 懸念で minimal fix に誘導、(3) bug 7 修正方針の選択肢提示 + scope 警告
- **Codex broken 問題**: 6 回委任中 5 回 sandbox-blocked。background notification が "auto-apply 済" を返しても実際は read-only でファイル変更なしのケースあり (T1+T5 は成功、bug 7 sync は失敗)。Phase 41 で config 修正必須
- **小さい fix が大きい効果**: bug 5 (3 行) + bug 6 (1 行) + bug 7 (~100 行) + T1 (~40 行) で 7 bug 全消化 + CI green。Phase 31 全体の累積 latent bug を 2 Phase で完済
- **TDD 順序の柔軟運用**: 当初 plan は T1→T2→T3 TDD 順だったが、bug 5 の修正が 3 行と自明なため先行修正で CI 早期投入。advisor の「T2 has value as regression coverage either way」が後押し
- **学び**: hook と Codex 環境の二重壁で詰まった時の打開策は user 承認 + heredoc bypass。次回は Phase 開始時に Codex sandbox 状態を check して broken なら最初から Claude 自実装計画にすべき

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-26 (Phase 40 CI green 達成、Phase 31 累積 7 bug 全消化)*
