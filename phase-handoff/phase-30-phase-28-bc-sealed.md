# Phase 30 入力契約: Phase 28-B + 28-C sealed (Spot E2E 完全緑化)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 30 (前: 28 → 28-B/28-C sealed) |
| 状態 | 28-B + 28-C sealed / Sprint β Spot レーン CI 緑 |
| 完了日時 | 2026-05-25 (CI run 26397443409, 4 passed / 0 failed) |
| 担当 | Claude (root cause 確証 + 実装、Codex 委任: integration test 1件 + migration 1件) |
| 関連 PR | https://github.com/kamitaku-wq/pit-system/pull/1 |
| 前 handoff | `phase-29-phase-28-a-trigger-fix.md` |
| 主要 commit | `b5b3961` (28-B), `d440af3` (28-C) |

## 達成したこと (Phase 28-B + 28-C)

### Phase 28-B: Spot vendor invitation visibility
- **Root cause 確証**: `vendor_users` の唯一の policy `tenant_isolation` (19_rls_policies.sql) は社内 users 用 (`company_id = current_user_company_id()`)。vendor user として login すると `current_user_company_id()` = NULL → vendor_users 全行 hidden。`transport_order_invitations.vendor_select` (post/0006) の USING 内 EXISTS subquery が authenticated role で評価され 0 件 → Spot invitation 不可視。
- **Fix**: `post/0007_phase_28_b_vendor_user_self_select.sql` 追加。vendor 用 `vendor_self_select` policy (`id = current_vendor_user_id()`)。
- **検証 test**: `tests/integration/spot-rls-reproduce.integration.test.ts` で層別 SELECT (auth.uid / RPC / 単独 / JOIN) により仮説 A-F 中 L のみが真と確証。

### Phase 28-C: accept navigation timeout
- **Root cause 確証**: `27_spot_rpc.sql` の `respond_to_spot_invitation` は RETURNS TABLE(transport_order_id uuid, ...) の OUT 列と body 内 unqualified 参照が衝突し PostgreSQL が ambiguous reference を報告。RPC 常に fail。Phase 27-A で `accept_invitation_and_revoke_others` に対し post/0006 で同 fix 済だったが Spot 側未着手だった。
- **Fix**: `post/0008_phase_28_c_respond_to_spot_invitation_ambiguous_fix.sql` で alias (vu/toi/tro/s) 化のみ。

### CI 最終結果 (run 26397443409)
- Loop: ✓ vendor A can accept (13.5s)
- **Spot: ✓ spot vendor onboarding happy path (13.5s)**
- **cross-tenant: ✓ cross-tenant invitation rejected (1.1s)** (前回 did not run)
- RLS: ✓ vendor A cannot view (2.4s)

### invariant 遵守
- alpha-1-public 27 ファイル + 28_*/29_*.sql touch 0
- 公開 API シグネチャ不変
- vitest 87 PASS / 0 FAIL (Phase 28-A 86 → +1 reproduce test)

## Claude 側の主要設計判断

1. **「local PASS」を疑う**: 最初の reproduce test (Codex 生成) が local PASS したが、advisor 指摘で `withRollback` の finally throw bug を発見 → assertion error が握り潰されていた。修正で本当の挙動が見えた。
2. **層別 SELECT 戦略**: advisor 提案の「auth context → 単独テーブル → JOIN 段階別」が決定打。vendor_users が 0 件で他は visible という非対称が真因 (仮説 L) を一発で示した。
3. **fix 案 1 (vendor_users self_select)**: case-by-case な policy 修正でなく structural な「vendor user は自分の vendor_users 行を見れる」を許可。副作用最小、自然な権限モデル。
4. **CI artifact で error 種別を確認**: screenshot 内に `Runtime PostgresError: column reference "transport_order_id" is ambiguous` の Next.js error overlay が明示されていて、Phase 28-C root cause を即特定。
5. **Phase 27-A 反省遵守**: 「推定 fix を検証なしで push」を回避。local integration test で reproduce → fix → 1件返ることを確認してから push。

## Codex 委任成果

- **del-20260525-101249-b838**: `spot-rls-reproduce.integration.test.ts` 新規 (250行, 強制委任パス)
- **del-20260525-103007-aeb7**: 同テストに 4 つの DIAG SELECT 追加 (24行, 強制委任パス)
- **del-20260525-104111-5fe7**: `withRollback` finally throw bug 修正 (assertion 握りつぶし)
- **del-20260525-104353-d938**: Supabase auth admin client で auth user 作成 + cleanup (FK 制約対応)
- **del-20260525-110144-00d9**: `post/0008` 100行 migration alias 化 (高 stake migration)
- post/0007 は Claude 直 (17行, 閾値以下、auth/migration 高 stake)

## 主要ファイル (Phase 30 reference)

- `src/lib/db/raw-migrations/post/0007_phase_28_b_vendor_user_self_select.sql` (新規 21行)
- `src/lib/db/raw-migrations/post/0008_phase_28_c_respond_to_spot_invitation_ambiguous_fix.sql` (新規 101行)
- `tests/integration/spot-rls-reproduce.integration.test.ts` (新規 322行、診断用層別 SELECT)
- `src/lib/db/raw-migrations/alpha-1-public/19_rls_policies.sql:220-225` (vendor_users tenant_isolation 元定義)
- `src/lib/db/raw-migrations/alpha-1-public/27_spot_rpc.sql` (元 RPC、touch 不可)
- `src/lib/db/raw-migrations/post/0006_phase_27_a_rpc_and_rls_fixes.sql` (28-C の参考 fix pattern)

## データモデル変更

- 新規 policy: `public.vendor_users.vendor_self_select` (SELECT, authenticated, `id = current_vendor_user_id()`)
- 新規/置換 function: `public.respond_to_spot_invitation(uuid, text, text)` (alias 化のみ、ロジック等価)
- raw-migrations alpha-1-public touch 0

## API 契約

- 変更なし (公開 service signature: respondToInvitation / respondToSpotInvitation / respondToTransportOrder)

## テスト・QA 状況

- vitest: 87 PASS / 0 FAIL (tsc clean) ✓
- CI E2E (run 26397443409): 4 passed / 0 failed ✓
  - Loop / Spot / cross-tenant / RLS 全緑
- local DB: 27_spot_rpc 後の post/0007 + post/0008 apply 済
- 反省: 第 1 CI cycle で post/0007 適用後 Spot list visibility ✓ 確認、L112 timeout で新問題発覚 → Phase 28-C へ即移行 (同セッション内完結)

## 既知の懸念・TODO (Phase 30 スコープ候補)

- **vendors テーブルも同じ問題**: Phase 28-B 診断 layer 1c で vendors 0 件 (authenticated role)。今は transport_orders policy が SECURITY DEFINER 経由なので顕在化していないが、将来 vendor portal の他画面で vendors を直接 SELECT する時に問題化する可能性。先回り fix なら同パターンで `vendors.vendor_self_select` 追加。
- **`raw-migrations` 冪等性整理** (Phase 26 から繰越、未着手)
- **`pit_v24_poc` schema 廃止** (Phase 26 から繰越、未着手)
- **drizzle migrate と raw-migrations の役割整理** (NOTICE "relation already exists" 多発)
- Phase 28-C で発見: Spot RPC は alpha-1-public/27_spot_rpc.sql の元定義に SQL injection 系の脆弱性チェックなし (string 連結なし、SECURITY DEFINER で OK、認可は current_vendor_user_id() で実装済)

## Phase 30 入力契約

### 前提として動くべき機能
- CI Loop / Spot / cross-tenant / RLS test 全緑 (Phase 28 完了範囲)
- vitest 87 PASS / 0 skip 維持
- vendor portal `/vendor/requests` の list + detail + accept/reject flow 完動

### 参照すべきファイル
- 本 handoff (`phase-30-phase-28-bc-sealed.md`)
- `phase-29-phase-28-a-trigger-fix.md` (Phase 28-A trigger fix の経緯)
- `phase-28-phase-27-a-partial.md` (Phase 27-A 経緯)
- `tests/integration/spot-rls-reproduce.integration.test.ts` (層別 SELECT 戦略の reference)
- `src/lib/db/raw-migrations/post/0006_*.sql` (RPC ambiguous fix pattern)
- `src/lib/db/raw-migrations/post/0007_*.sql` (vendor user self_select policy)
- `src/lib/db/raw-migrations/post/0008_*.sql` (Spot RPC alias)

### 絶対に壊してはいけないもの (invariants)
- alpha-1-public 27+28+29 ファイル touch 0 (引き続き、新規 30_*.sql or post/0009_*.sql で対応)
- 公開 API シグネチャ (respondToInvitation / respondToSpotInvitation / respondToTransportOrder 等)
- vitest 87 PASS / CI E2E 4 passed
- ADR-0010 補項

### 推奨される次 Phase スコープ
- **A (低リスク)**: vendors に vendor_self_select policy 追加 (先回り、Phase 28-B と同パターン、post/0009 で 10 行程度)
- **B**: Sprint β 残タスク (admin invite 完成、ε-patch 等、ロードマップ確認)
- **C**: raw-migrations 冪等性整理 (Phase 26 から繰越)
- **D**: pit_v24_poc schema 廃止 (Phase 26 から繰越)
- **E**: 上記 vendor portal 全機能緑化を踏まえ Sprint β Spot レーン正式 close (ロードマップ更新)

### 注意点・コンテキスト
- 「推定 fix を検証なしで push」厳禁 (Phase 27-A 反省、引き続き)
- branch: `phase-26-ci-verify`、main から ahead 52 commits
- post/0007 と 0008 は post-hook で apply される (drizzle migrate の後)、alpha-1-public 適用後の REPLACE で順序問題なし
- local DB と CI DB の migration 状態は db:setup で同一になる前提 (apply 順序が決定的)

## Codex ledger refs

- del-20260525-101249-b838 (Spot RLS reproduce test 新規)
- del-20260525-103007-aeb7 (test に DIAG SQL 追加)
- del-20260525-104111-5fe7 (withRollback bug fix)
- del-20260525-104353-d938 (auth user 作成 + cleanup)
- del-20260525-110144-00d9 (post/0008 migration alias)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 28-B/C 追加 commit 数 | 2 (b5b3961, d440af3) |
| 追加コード行数 | 21 (0007) + 101 (0008) + 322 (test) = 444 |
| CI run 数 (Phase 28-B/C 内) | 2 (28-B: 1 fail with 進展, 28-C: 1 pass) |
| Codex 委任率 | 5/6 (移行 fix を除く全実装) |
| advisor 呼び出し | 3 回 (Phase 28-B 進路相談、診断方針、root cause 確証) |
| セッション数 | 1 (Phase 29 resume 後継続、28-A → 28-B → 28-C 一気通貫) |
| 検証コスト | tsc clean / vitest 87 PASS / CI E2E 27.5s 全緑 |

## 振り返りメモ

- うまくいった: advisor 3 回呼び出しで「local PASS を疑え」「層別 SELECT で潰せ」「Phase 27-A 轍を避けろ」が全部刺さった
- うまくいった: CI artifact (screenshot) に Next.js error overlay が見えて Phase 28-C root cause を 1 分で特定
- うまくいった: Phase 27-A の post/0006 fix pattern を Phase 28-C で再利用、ambiguous fix は機械的変換のみ
- うまくいった: `withRollback` bug を発見できたのは「強制 fail で console.log 確認」を試したから (advisor 指摘の "layer 1 を assert で固定" の副産物)
- 反省: 最初の reproduce test (Codex 生成) を local PASS で「reproduce 不能 → CI 特有要因」と一瞬結論しかけた。advisor の "test 差異未調整" 指摘で救われた
- 次回改善: integration test の `withRollback` パターンは error 握り潰し bug があるので、project 全体で `try { await fn } catch (e) { innerError = e } finally { throw ROLLBACK }; if (innerError) throw innerError` パターンに統一すべき (別 phase で refactor 候補)

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-25 (CI run 26397443409 で Spot E2E 4 passed 全緑化確証後)*
