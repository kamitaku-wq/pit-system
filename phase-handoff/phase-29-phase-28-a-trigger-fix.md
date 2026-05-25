# Phase 29 入力契約: Phase 28-A sealed (transport_order_invitations.updated_at trigger fix)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 29 (前: 28 → 28-A sealed, 28-B 継続) |
| 状態 | 28-A sealed / 28-B 入力契約 |
| 完了日時 | 2026-05-25 (CI cycle 4 で trigger fix 確証) |
| 担当 | Claude (root cause 確証 + 修正実装、Codex 委任なし) |
| 関連 PR | https://github.com/kamitaku-wq/pit-system/pull/1 |
| 前 handoff | `phase-28-phase-27-a-partial.md` |
| 修正 commit | `b020931` fix(phase-28-a): transport_order_invitations.updated_at 列追加 |

## 達成したこと (Phase 28-A)

- **`record "new" has no field "updated_at"` trigger エラー解消** (Loop accept 経路)
  - root cause 確証: 12_transport.sql:84-101 の `transport_order_invitations` schema に `updated_at` 列なし / 20_triggers.sql:236 で `trg_set_updated_at` が attach 済 / set_updated_at 関数は無条件 `NEW.updated_at = now()`
  - 修正: 新規 `alpha-1-public/29_transport_invitation_updated_at.sql` で `ALTER TABLE ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()` + drizzle schema 同期
- **CI 進捗**: cycle 4 で Loop test 2件 PASS (accept + RLS 確認)、残 fail は Spot 1件のみ
- **vitest**: 86 PASS / 0 FAIL 維持 (tsc clean)
- **invariant 維持**: alpha-1-public 27 ファイル touch 0 (Phase 27-A `28_*.sql` の前例に倣い新規 29_*.sql 追加のみ)

## Claude 側の主要設計判断

1. **修正案 ① 列追加を採択**: spec/data-model.md §3 line 105 + §15.8 line 1590 で全テーブル `updated_at` 必須かつ trigger 共通と明示。`transport_order_invitations` だけが spec から漏れた bug。`trigger DROP` 案は spec 違反のため棄却。
2. **created_at は追加せず**: spec §3 line 102-104 で必須だが `invited_at` で実質代替済み。Phase 28 のスコープは trigger fix のみ。スキーマ正規化は将来別 phase で。
3. **integration test 省略**: root cause が schema/trigger/関数本体の直接確認で確定したため、明示的 reproduce test 作成を省略し、既存 vitest 86 PASS の regression 確認 + CI E2E での実証で代替。
4. **advisor overloaded 時の代替**: 第二意見が取れなかったが、事実検証 (schema 4 ファイル直接確認 + spec line 番号引用) で確証度を担保。

## Codex 委任成果

委任なし (Phase 28-A スコープが小さく、Claude 直接実装 11 行)。

## 主要ファイル (Phase 29 reference)

- `src/lib/db/raw-migrations/alpha-1-public/29_transport_invitation_updated_at.sql` — ALTER TABLE 1 行
- `src/lib/db/schema/transport_order_invitations.ts:48` — updatedAt 1 行追加
- `src/lib/db/raw-migrations/alpha-1-public/12_transport.sql:84-101` — 元 schema (列追加対象)
- `src/lib/db/raw-migrations/alpha-1-public/20_triggers.sql:66-75,236` — trigger 関数と attach
- `spec/data-model.md` line 105, 1590 — spec 整合根拠
- `tmp/ci-artifacts-4/playwright-artifacts/test-results/.../error-context.md` — fail 前の artifact
- (CI 最新) https://github.com/kamitaku-wq/pit-system/actions/runs/26392985146 — 28-A 適用後 fail 残骸 (Spot のみ)

## データモデル変更

- 新規: `alpha-1-public/29_transport_invitation_updated_at.sql` (10 行、ALTER TABLE のみ)
- drizzle schema: `transport_order_invitations.ts` に `updatedAt` 列追加 (1 行)
- raw-migrations 27 ファイル + 28_*.sql touch 0

## API 契約

- 変更なし
- 公開 API signature 不変 (respondToTransportOrder / respondToSpotInvitation / accept_invitation_and_revoke_others)

## テスト・QA 状況

- vitest: 86 PASS / 0 FAIL (tsc clean) ✓
- CI E2E (cycle 4 / run 26392985146):
  - Loop: 2 passed ✓ (trigger fix で緑化)
  - Spot: 1 failed (link 不可視 — Phase 28-B root cause 別)
  - cross-tenant: 1 did not run (Spot fail に blocked)
- local DB: 29_*.sql apply 完了 (28_*.sql も同時 apply、Phase 27-A 取りこぼし分)

## 既知の懸念・TODO (Phase 28-B = Phase 29 スコープ)

- **【最優先】Spot vendor link 不可視 root cause 確定**:
  - 観測: `/vendor/requests` で「現在 pending の依頼はありません」表示、login は成功 (heading "Spot E2E Vendor")
  - 確認済 (これらは pass する見込み):
    - `/vendor/requests/page.tsx:22` は `withAuthenticatedDb(user.id, ...)` 経由 (RLS 評価)
    - fixture: expires_at = now()+7days / response=pending / vendor_id=null / invitee_email/name 正常
    - statuses RLS は Phase 27-A `28_vendor_select_policies.sql` で追加済 (vendor_accessible_company_ids 経由)
    - `current_vendor_user_id()` 関数本体 (18_helper_functions.sql:39-52) は `auth_user_id = auth.uid()` で正しい
    - spot onboarding (src/lib/services/spot-onboarding.ts:298-308) で `vendor_users.email = invitationEmail` 一致
  - **未確認**: 上記が全て成り立つはずなのに CI で空。**local integration test で `withAuthenticatedDb` 経由で SELECT を駆動して reproduce が必須**
  - 仮説候補:
    - A. `current_vendor_user_id()` が SECURITY DEFINER 内で `auth.uid()` を解決できていない (search_path or session 文脈)
    - B. policy EXISTS の `lower(vu.email) = lower(transport_order_invitations.invitee_email)` の correlated subquery が動作していない
    - C. `current_vendor_id()` が NULL を返し、JOIN 先 statuses が空 (Loop は vendor_id 持ち、Spot は NULL なので current_vendor_id() ロジック差異)
    - D. onboarding で is_active=false → test L94-99 で UPDATE するが、UPDATE の transaction visibility 問題
- **`raw-migrations` 冪等性整理** (Phase 26 から繰越、未着手)
- **`pit_v24_poc` schema 廃止** (Phase 26 から繰越、未着手)

## Phase 29 入力契約

### 前提として動くべき機能

- CI Loop (Phase 28-A で緑化) — accept 経路は trigger fix で OK
- vendor RLS visibility for Loop (Phase 27-A で復旧)
- vitest 86 PASS / 0 skip 維持

### 参照すべきファイル

- 本 handoff (`phase-29-phase-28-a-trigger-fix.md`)
- `phase-28-phase-27-a-partial.md` (Phase 27-A の経緯)
- `tests/e2e/vendor-portal-spot-loop.spec.ts:90-146` (Spot test 本体)
- `tests/e2e/_helpers/seed-vendor-spot-e2e.ts:150-298` (fixture)
- `src/lib/services/spot-onboarding.ts:200-336` (onboarding ロジック)
- `src/app/(vendor-portal)/vendor/requests/page.tsx:22-43` (SELECT クエリ)
- `src/lib/db/raw-migrations/post/0006_phase_27_a_rpc_and_rls_fixes.sql:87-137` (vendor_invited_transport_order_ids + policy)
- `src/lib/db/raw-migrations/alpha-1-public/18_helper_functions.sql:39-69` (current_vendor_user_id / vendor_accessible_company_ids)
- `src/lib/db/raw-migrations/alpha-1-public/26_spot_helper_rls.sql` (元定義、要再確認)
- `src/lib/db/with-auth.ts` (withAuthenticatedDb 実装)

### 絶対に壊してはいけないもの (invariants)

- ADR-0010 補項
- raw-migrations alpha-1-public 内 27+28+29 ファイル touch 0 (新規 30_*.sql or post/0007_*.sql で対応)
- 公開 API シグネチャ
- vitest 86 PASS 維持
- CI Loop test 緑 (Phase 28-A 確証範囲)

### 推奨される次 Phase スコープ

- **A (最優先)**: local integration test で `withAuthenticatedDb(spot_vendor_user.auth_user_id, ...)` 経由で transport_order_invitations SELECT を駆動 → reproduce → 仮説 A-D を順に潰す
- **B**: root cause 確定後、post/0007_*.sql or alpha-1-public/30_*.sql で fix
- **C**: CI Spot 緑化 + cross-tenant 復活
- **D 以降**: raw-migrations 冪等性整理 / pit_v24_poc 廃止 (繰越)

### 注意点・コンテキスト

- **「推定 fix を検証なしで push」厳禁** (Phase 27-A 反省、Phase 28-B でも遵守)
- **local integration test 推奨**: CI cycle は 3-7 分、E2E spec は 1-2 分。`withAuthenticatedDb` 経由で integration test 作る方が iterate 速い
- post/0006 は redundant 条件削除済み (Phase 27-A) だが Spot test に効かなかった → root cause は post/0006 と無関係の別経路
- Phase 28-A の commit は `phase-26-ci-verify` branch、main ahead 50+ commits

## Codex ledger refs

- (Phase 28-A は委任なし)
- Phase 27-A から継承: del-20260525-082032-9ba2 (0006 SQL 書き出し)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 28-A 追加 commit 数 | 1 (b020931) |
| Phase 28-A 追加コード行数 | 10 (29_*.sql 10) + 1 (drizzle) |
| CI run 数 (Phase 28-A 内) | 1 (cycle 4 で Loop 緑化確証) |
| Codex 委任率 | 0/1 (小規模 fix のため Claude 直接) |
| advisor 呼び出し | 1 (overloaded で失敗、ユーザー確認で代替) |
| セッション数 | 1 (Phase 27-A resume 後継続) |
| 検証コスト | tsc clean / vitest 86 PASS / CI E2E 3m41s |

## 振り返りメモ

- うまくいった: schema + trigger + 関数本体 + spec の 4 階層直接確認で root cause を「推定」ではなく「確証」に持ち込んだ。fix が小さく cycle が早かった
- うまくいった: Phase 27-A の反省 (検証なし push 禁止) を意識し、ユーザー判断分岐を 4 回挟んで方針承認を取った
- 反省: advisor overloaded 時の代替策が「事実検証密度を上げる」のみ。Codex の adversarial review を並行で呼べばよかった
- 次回改善: Phase 28-B では最初から local integration test を書いて仮説 A-D を潰す体制で開始する

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-25 (Phase 28-A trigger fix, CI cycle 4 で Loop 緑化確証後)*
