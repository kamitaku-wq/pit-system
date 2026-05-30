# Phase 60 入力契約: Phase 59 transport_order_invitations.invited_by_user_id 複合 FK sealed (D3 解消)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 59 (前: 58 sealed) |
| 状態 | **sealed** (typecheck clean / 21 test files / 173 tests PASS / drift 2→2) |
| 完了日時 | 2026-05-27 |
| 担当 | Claude (scope + plan v1/v2 + advisor + Codex review + seal) + Codex (adversarial review + implementation 委任) |
| 前 handoff | `phase-58-reservation-status-history-fk-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 58 から +2 commit 予定: feat + 本 seal) |

## 達成したこと (Phase 59)

- **debt 台帳 D3 解消**: `transport_order_invitations.invited_by_user_id` の company 整合を schema 強制
  - 複合 FK `(invited_by_user_id, company_id) → users(id, company_id)` 追加 (MATCH SIMPLE / ON DELETE NO ACTION / ON UPDATE RESTRICT)
  - 既存単独 FK を catalog query で動的特定 → DROP
  - `users_id_company_id_unique` は Phase 56 で追加済を冪等 check
- **ADR-0008 narrative 解消**: handoff §推奨 #1 警告「ADR-0008 必読・独立設計必須」に対し、`invited_by_user_id` は招待発行者 (company 側 user) で vendor 側カラム (`vendor_id` / `bound_vendor_id` / `bound_vendor_user_id`) は分離されている → vendor 側 company 境界懸念は本 FK に影響しない、と論証 (WARN-1 で narrative 緩和)
- **advisor 助言 3 件全採用**: ①既存 test fixture の `actingUserId` 整合確認 → 全件未指定 (NULL) 経路 → 新 FK で壊れない、②`accept_invitation_and_revoke_others` (post/0006 authoritative) は `invited_by_user_id` 不変確認、③Phase 58 継承項目を plan v1 明記
- **Codex adversarial review CONDITIONAL-BLOCK**: BLOCK 3 + WARN 2 + NOTE 1/2 全採用 → plan v2 で軽量反映
  - BLOCK-1: active 経路 service 検証 (`createTransportOrderWithNotification` same/cross-company actingUserId 観点 6 追加)
  - BLOCK-2: invariants に `respond_to_spot_invitation` (post/0008) 追加
  - BLOCK-3: Drizzle schema は `onDelete` omit (raw migration authoritative、Phase 58 同型)
  - WARN-1: "完全同型" narrative を「論理的同パターン + 追加検証併用」に緩和
  - WARN-2: ADR-0008 RPC 経由 `invited_by_user_id` 不変 assertion (観点 7 追加)
- **7 観点 integration test 追加**: cross / same / NULL / referenced-user-delete-restricted / statement-time / active service same+cross / RPC 不変
- **Codex 委任 2 件** (auto-apply 済、修正周回**ゼロ** = 4 回連続 1 発採用): adversarial review + implementation 一括
- **drift 維持**: 0019 ALTER のみで drift 2 → 2 (drizzle-kit check "Everything's fine 🐶🔥")

## Claude 側の主要設計判断

1. **Phase 56/57/58 pattern 完全流用**: `NO ACTION` / `RESTRICT` / MATCH SIMPLE / raw migration authoritative / catalog query / DO ブロック冪等性
2. **D2 → D3 差異の明示化**: D2 は preventive (本番 INSERT=0)、**D3 は active service 経路あり** (`createTransportOrderWithNotification`) → BLOCK-1 観点 6 で本番経路保護
3. **ADR-0008 RPC 不変保証の構造化** (WARN-2 採用): SQL inspection (post/0006 + post/0008) → 観点 7 で実行時 assertion 追加、将来の RPC regression を捕捉可能に
4. **既存 test fixture の `actingUserId` NULL 経路維持**: `inputFor()` は `actingUserId` を omit、service 内 `parsed.actingUserId ?? null` で NULL INSERT → MATCH SIMPLE で FK check skip、Phase 57 D1 と同型
5. **意味変化 `SET NULL → NO ACTION`**: D2 と同様、soft-delete 運用前提で許容、auth.users CASCADE 経路は別 Phase

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| del-20260527-053711-f953 (review) | plan v1 adversarial review | CONDITIONAL-BLOCK (BLOCK 3 / WARN 2 / NOTE 2) → plan v2 で全採用 |
| (implementation、auto-apply 済) | migration 0019 + drizzle schema + 7 観点 test 一括 | applied / typecheck clean / 173/173 PASS / 7/7 新規 PASS / 30/30 regression PASS / **修正 0 回** |

**Codex 出力品質**: Phase 43→...→55→56→57→58→**59** で 0→0→...→2→0→0→0→3→3→2→**2** (review 1 + implementation 1、**修正 0 回**で確定、Phase 55+57+58+**59** で 4 回連続 1 発採用精度)。

## Phase 41-59 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-28 | Phase 31-A〜58 | 39-58 | (前 sealed.md 参照) |
| **29** | Phase 58 sealed §Phase 59 推奨 #1、debt 台帳 D3 | **59** | `transport_order_invitations.invited_by_user_id` 複合 FK で company 整合 schema 強制 (active 経路で本番 service guard 追加) |

## 残課題 / Phase 60 todo

### MVP blocker

- #1: 解消済 ✓ (Phase 50+51)
- #2: reservation cancel 遷移 (wake-up 領域)
- #3: Worker handler (wake-up 領域)
- #4: 解消済 ✓ (Phase 53+55)

### Phase 60 推奨スコープ候補

1. **debt 台帳 D4** (`admin_vendor_invitations.invited_by_user_id` 複合 FK): 優先度 中、規模軽微、Phase 56-59 pattern 完全流用可、INSERT 棚卸し独立実施 (admin invite server action 経路あり、`src/lib/services/admin-vendor-invitations.ts:190`)
2. 他 change_type service 実装 (vendor_changed / datetime_changed / rejected_reassigned / recreated) + change_log 統合、Phase 55 cancel pattern + Phase 56 FK 強制活用
3. drift 2 → 1 (0012 書き換え) (Phase 54 sealed §残課題)、破壊的、慎重判断
4. MVP blocker #2 #3 (wake-up 領域)
5. transport_order.changed outbox worker 実装 (wake-up 領域)
6. redaction policy 拡張 (`redact_transport_order_payload` 関数追加)
7. reservation feature 実装着手 (Phase 58 D2 が protective rail として機能)
8. cancel test seedFixture 謎調査 (Phase 56 sealed §残課題、Phase 57-59 未着手)
9. `20_triggers.sql` 末尾 trigger 未適用 historical artifact の原因調査 (Phase 58 で発見)

### 一般 todo

(Phase 47-58 sealed 参照、変化なし)

## Phase 60 入力契約

### 参照すべきファイル

- 本 handoff (`phase-59-transport-order-invitations-fk-sealed.md`)
- `phase-58-reservation-status-history-fk-sealed.md` (D2 元 pattern)
- `phase-57-status-history-fk-sealed.md` (D1 元 pattern)
- `phase-56-changed-by-user-fk-sealed.md` (Phase 56 元 pattern)
- `phase-59-transport-order-invitations-fk-plan.md` (v2 採用版、Codex review 反映済)
- `phase-59-codex-adversarial-review.md` (BLOCK 3 / WARN 2 / NOTE 1-2)
- `src/lib/db/raw-migrations/post/0019_transport_order_invitations_user_company_composite_fk.sql` (D3 migration、D4 横展開時に流用)
- `src/lib/db/raw-migrations/post/0010_admin_vendor_invitations.sql` (D4 元定義、`invited_by_user_id` references 確認)
- `src/lib/db/schema/transport_order_invitations.ts` (D3 schema)
- `src/lib/db/schema/admin_vendor_invitations.ts` (D4 対象 schema)
- `src/lib/services/admin-vendor-invitations.ts` (D4 service 経路、:190 で `invitedByUserId: context.adminUser.userId`)
- `tests/integration/db/transport-order-invitations-fk.integration.test.ts` (7 観点 / auth.users CTE / active service / RPC 不変、D4 で流用可)
- spec/data-model.md §3.2 (users)、§7.10 (transport_order_invitations、L833-933)、§17 (migration 順序)
- spec/CLAUDE.md ADR-0008 (D4 も `admin_vendor_invitations` で関連、独立確認推奨)

### 絶対に壊してはいけないもの (invariants)

- 既修正 29 bug/機能すべてに retrogression なし
- typecheck clean / 21 test files / 173 tests PASS
- CI E2E 7/7 PASS
- 既存 invariants 全件 (Phase 43-58 確定)
- **Phase 59 複合 FK semantic 維持**: `(invited_by_user_id, company_id) → users(id, company_id)`, MATCH SIMPLE, ON DELETE NO ACTION, ON UPDATE RESTRICT
- **users(id, company_id) UNIQUE 維持** (Phase 56 で追加、Phase 57+58+59 で再利用、D4 でも再利用)
- **`accept_invitation_and_revoke_others()` 不変** (post/0006、UPDATE 対象に `invited_by_user_id` 含まない、観点 7 で assertion 化)
- **`respond_to_spot_invitation()` 不変** (post/0008、UPDATE 対象に `invited_by_user_id` 含まない)
- **drizzle-kit generate/push 禁止**: raw migration 0016+0017+0018+0019 が authoritative
- **catalog query 冪等性 pattern 維持**: D4 でも DO ブロック + `IF NOT EXISTS` / `IF EXISTS` + FOR LOOP DROP pattern 踏襲
- **auth.users CTE pattern 維持**: 新規 integration test の user INSERT は `WITH auth_user AS (INSERT INTO auth.users ...)` 必須
- **Drizzle `onDelete` omit pattern 維持** (Phase 58 BLOCK-3 確立、Phase 59 継承): raw migration が authoritative
- **active 経路の retrogression なし** (Phase 59 BLOCK-1 観点 6 確立、D4 admin invite 経路でも同様検証推奨)

### 注意点

- branch: `phase-42-t4-test-coverage` (Phase 59 から、seal commit + feat commit で +2 予定)
- Phase 59 変更ファイル: 2 new (migration + test) + 1 modify (schema) + 2 plan/review + 1 seal = 6 files
- Codex 委任 2 件 (review + implementation)、advisor 呼び出し 1 件 (plan v1 起草前 approach + 3 検証指示)
- **D4 着手前**: INSERT 棚卸しを **独立実施** (admin invite server action 経路あり、admin_vendor_invitations は admin → vendor 招待で `invited_by_user_id` = admin user の company)
- ADR-0008 が `admin_vendor_invitations` でも関連する可能性、Phase 59 narrative pattern 流用で independent 確認推奨
- D4 active 経路 test は Phase 59 観点 6 を参照、cross-company admin user 検証パターンを継承

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 59 commit 数 | 2 予定 (feat + 本 seal commit) |
| 変更ファイル | 2 new + 1 modify + 2 plan/review + 1 seal = 6 files |
| 修正済 latent bug / 機能追加 | 1 (#29 transport_order_invitations invited_by_user_id 複合 FK — 累積 29) |
| advisor 呼び出し | 1 (plan v1 起草前 approach + 3 検証) |
| Codex 委任 task 数 | 2 (adversarial review + implementation) |
| Codex sandbox-blocked | 0/2 (auto-apply 済) |
| Claude 側修正 (Codex 出力) | **0** (Phase 55+57+58+**59** = 4 回連続 1 発採用) |
| test files | 21 (Phase 58 20 → +1) |
| integration + unit test 件数 | 173 (Phase 58 166 → +7) |
| 新規 test assertion | +7 (cross / same / NULL / referenced-user-delete-restricted / statement-time / active service same+cross / RPC 不変) |
| 新規 migration | 1 (`0019_transport_order_invitations_user_company_composite_fk.sql`) |
| 新規 SQL function | 0 |
| MVP blocker 解消 | 0 (active 経路 hardening) |
| drift | 2 → 2 (増加なし) |

## 振り返りメモ

- **handoff narrative 警告を独立調査で論破**: 「ADR-0008 関連で重い」と handoff §推奨 #1 が警告したが、`invited_by_user_id` は招待発行者 (company 側)、vendor 側は別カラム → spec L833-933 + schema 行番号で裏取り → Codex WARN-1 で narrative 緩和されつつも論旨維持。advisor の事前指示が有効
- **active 経路への配慮 (BLOCK-1 観点 6)**: D2 と異なり service 本番経路がある D3 で、既存 fixture `actingUserId` NULL 経路維持 + same/cross-company assertion で active route を schema レベルで保護。Phase 60 (D4 admin invite) でも同型必須
- **ADR-0008 RPC 不変 assertion (WARN-2 観点 7)**: SQL inspection だけでなく実行時 assertion 化することで future regression を捕捉可能に。Codex 第二意見が plan 品質を 1 段上げた好例
- **4 回連続 1 発採用 (Phase 55 / 57 / 58 / 59)**: プロンプト中の「BLOCK 採用詳細」「auth.users CTE pattern 明示」「anti-pattern 列挙」「対 base file 引用」が Codex 出力品質を安定化
- **連続 13 Phase 完走 (47-59)**: wake-up 領域回避しつつ 13 features (#17-#29) 追加。Phase 60 (D4) は軽微 (規模小)、その後 wake-up 領域 or change_type 拡張へ

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-27 (Phase 59 完了、累積 29 機能追加 + transport_order_invitations 複合 FK 強制、debt 台帳 D3 解消、D4 残)*
