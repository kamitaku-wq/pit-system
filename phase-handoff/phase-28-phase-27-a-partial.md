# Phase 28 入力契約: Phase 27-A 部分 sealed (RLS visibility + ambiguous fix)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 28 (前: 27 → 27-A partial sealed) |
| 状態 | partial sealed |
| 完了日時 | 2026-05-25 (cycle 3 後) |
| 担当 | Claude (root cause 診断 / 修正方針) + Codex (del-20260525-082032-9ba2 で 0006 SQL 書き出し) |
| 関連 PR | https://github.com/kamitaku-wq/pit-system/pull/1 |
| 前 handoff | `phase-27-pipeline-verified-sealed.md` |

## 達成したこと (Phase 27-A)

- **vendor RLS visibility 復旧** (`/vendor/requests` で invitation が表示される) — Phase 27-A cycle 1/2
  - `28_vendor_select_policies.sql`: statuses / companies に `vendor_select` policy 追加
  - `post/0002_helpers.sql`: `current_vendor_id()` / `current_vendor_user_company_id()` の column `id = auth.uid()` → `auth_user_id = auth.uid()` 修正 (alpha 版と整合)
- **audit_logs FK 違反 cleanup 解消**: 3 helper (loop / spot / cross-tenant) の cleanup を companies DELETE 直前に audit_logs DELETE するよう修正
- **accept RPC ambiguous fix**: `0006_phase_27_a_rpc_and_rls_fixes.sql` で `accept_invitation_and_revoke_others` を alias 修飾版で REPLACE
- **CI 進捗**: Loop test が link visible → detail page 遷移 → accept クリックまで到達 (Phase 27-A 前は依頼一覧の link 段階で fail)

## Claude 側の主要設計判断

1. **Phase 27 を A/B 分割 seal**: advisor の 3 push-cycle budget 上限超過 + cycle 3 で trigger エラーという新 latent state 露見。CI cycle で blind fix し続けるよりも local integration test で iterate する方が効率的と判断。
2. **alpha-1-public 27 ファイル touch なし**: invariant 維持。修正は全て新規 ファイル (28_*.sql / post/0006_*.sql) と post の既存 helper 修正のみ。
3. **redundant 条件削除 (推定 fix)**: 26_*.sql の `vu.vendor_id = current_vendor_id()` 削除を 0006 で実施したが、spot test は依然 fail → root cause は別 (Phase 27-B で再診断必要)。

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260525-082032-9ba2 | `0006_phase_27_a_rpc_and_rls_fixes.sql` 書き出し (138 行) | applied |

advisor 4 回 call (scope 判断 / lockfile / 修正方針 / budget warning)。

## 主要ファイル (Phase 28 reference)

- `src/lib/db/raw-migrations/alpha-1-public/28_vendor_select_policies.sql` — statuses/companies vendor_select
- `src/lib/db/raw-migrations/post/0002_helpers.sql:21-32` — 修正後 current_vendor_* 関数
- `src/lib/db/raw-migrations/post/0006_phase_27_a_rpc_and_rls_fixes.sql` — accept RPC + spot RLS REPLACE
- `tests/_helpers/seed-vendor-e2e.ts:215-250` — cleanup audit_logs 順序修正済
- `tests/e2e/_helpers/seed-vendor-spot-e2e.ts:135-145` — spot cleanup
- `tests/e2e/_helpers/seed-vendor-cross-tenant-e2e.ts:130-145` — cross-tenant cleanup
- `src/lib/db/raw-migrations/alpha-1-public/26_spot_helper_rls.sql` — spot 用 RLS (元定義、要再診断)
- `tmp/ci-artifacts-4/playwright-artifacts/test-results/.../error-context.md` — cycle 3 artifact

## データモデル変更

- raw-migrations 27 ファイル touch なし (invariant 維持)
- 新規: `alpha-1-public/28_vendor_select_policies.sql` (1 ファイル)
- 新規: `post/0006_phase_27_a_rpc_and_rls_fixes.sql` (1 ファイル、関数 2 件 + policy 1 件 REPLACE)
- 修正: `post/0002_helpers.sql` (関数 2 件 body 修正)

## API 契約

- 変更なし
- `respond_to_transport_order` / `accept_invitation_and_revoke_others` の signature 不変

## テスト・QA 状況

- vitest: 86 PASS 維持 (tsc clean)
- CI E2E: pipeline ✓ / Loop fails at accept step (`record "new" has no field "updated_at"`) / Spot fails at link visibility
- 4 cycle: pipeline-verified → RLS cycle 1 → RLS cycle 2 → RPC cycle 3
- 副症状 audit_logs FK 違反: 解消済

## 既知の懸念・TODO (Phase 27-B)

- **【最優先 A】Loop `record "new" has no field "updated_at"` trigger エラー**:
  - 仮説: `set_updated_at` trigger が `transport_order_invitations` 全 UPDATE で発火、しかし同 table に `updated_at` 列なし
  - 確認: `transport_order_invitations` schema (alpha-1-public/12_transport.sql) + trigger 設定 (post/0003_triggers.sql / 20_triggers.sql)
  - 修正候補: ① updated_at 列追加 + drizzle schema 同期 ② trigger DROP from transport_order_invitations
- **【最優先 B】Spot vendor link 不可視 root cause 再診断**:
  - 仮説 1: spot-onboarding で作る vendor_users が is_active=false のまま CI 上で何か別の state 持つ
  - 仮説 2: 26_spot_helper_rls.sql の EXISTS branch がそもそも spot 経路で機能しない別要因
  - 推奨手段: **local integration test** で `withAuthenticatedDb` 経由で spot invitation visibility を駆動して reproduce
- **`raw-migrations` 冪等性整理** (Phase 26 で繰越、未着手)
- **`pit_v24_poc` schema 廃止** (Phase 26 で繰越、未着手)

## Phase 28 入力契約

### 前提として動くべき機能

- CI pipeline (Phase 26-A 緑化済)
- vendor RLS visibility (Phase 27-A で復旧)
- vitest 86 PASS / 0 skip 維持

### 参照すべきファイル

- 本 handoff
- `phase-27-pipeline-verified-sealed.md`
- `src/lib/db/raw-migrations/post/0006_phase_27_a_rpc_and_rls_fixes.sql` (現状の post REPLACE)
- `src/lib/db/raw-migrations/post/0002_helpers.sql` (current_vendor_* 関数の確定版)
- `src/lib/db/raw-migrations/alpha-1-public/12_transport.sql` (transport_order_invitations schema 確認)
- `src/lib/db/raw-migrations/post/0003_triggers.sql` (trigger 確認)

### 絶対に壊してはいけないもの (invariants)

- ADR-0010 補項
- raw-migrations 27 ファイル touch 0 (alpha-1-public 内)
- 公開 API シグネチャ (respondToTransportOrder / respondToSpotInvitation 等)
- vitest 86 PASS 維持
- CI pipeline 緑 (E2E pipeline 層、test spec 層は別)

### 推奨される次 Phase スコープ

- **A (最優先)**: trigger エラー fix (transport_order_invitations.updated_at 列追加 or trigger DROP) — local で reproduce 可能
- **B**: spot vendor link 不可視 root cause 再診断 → fix (local integration test 推奨)
- **C**: CI 完全緑化 (A + B 達成後)
- **D 以降**: raw-migrations 冪等性整理 / pit_v24_poc 廃止 (繰越)

### 注意点・コンテキスト

- **local integration test 推奨**: CI cycle は cold 3-7 分、E2E spec は 1-2 分で fail。`withAuthenticatedDb` 経由で integration test 作る方が iterate 速い
- 0006 で `vendor_invited_transport_order_ids` の EXISTS branch から `vu.vendor_id = p_vendor_id` を削除済。spot fix で別ロジック必要なら 0007_*.sql を追加
- Phase 27-A の commit は `phase-26-ci-verify` branch 上、main ahead 50 commits 程度

## Codex ledger refs

- del-20260525-082032-9ba2 (0006 SQL 書き出し)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 27-A 追加 commit 数 | 3 (RLS visibility / auth_user_id fix / RPC + spot RLS) |
| Phase 27-A 追加コード行数 | ~180 (28_*.sql 20 + post/0002 修正 13 + 0006_*.sql 137 + helper cleanup 18) |
| CI run 数 (Phase 27-A 内) | 3 (cycle 1/2/3 全て fail だが症状が異なる方向に進化) |
| Codex 委任率 | 1/1 (高 stake migration、persistent block 経由) |
| advisor 呼び出し | 4 (scope / lockfile / 修正方針 / budget) |
| セッション数 | 1 (Phase 27 resume 後継続) |

## 振り返りメモ

- うまくいった: advisor の budget warning で 4th push を回避、handoff 分割を選んだ。latent state 連鎖を早期に認識
- 次回改善: cycle 1 開始前に local integration test で RLS 経路を駆動する手段を準備すべきだった (CI cold start cost を 4 回浪費)
- 反省: spot RLS の 推定 fix は **検証経路なしで push** したのが筋悪。次は仮説検証 → fix 確証 → push の順を守る

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-25 (Phase 27-A partial, after advisor budget warning)*
