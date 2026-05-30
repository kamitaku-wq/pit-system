# Phase 56 入力契約: Phase 55 change_logs service 統合 sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 55 (前: 54 sealed) |
| 状態 | **sealed** (typecheck clean / 17 test files / 152 tests PASS / cancel integration 12/12) |
| 完了日時 | 2026-05-27 |
| 担当 | Claude (scope + plan + service Edit + seal) + Codex (adversarial review + test edit + service edit 委任) |
| 前 handoff | `phase-54-sql-function-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 54 `8b43358` から +2 予定) |

## 達成したこと (Phase 55)

- **MVP blocker 4 service 統合 完了**: Phase 53 schema 整合 → Phase 55 で `cancelTransportOrder` から `transport_order_change_logs` INSERT を実装、spec §7.8 + §15.6 を service レベルで担保
  - `transport_order_change_logs` row 1 件作成: `change_type='cancelled'`, `requires_notification=false` (二重通知防止), `changed_by_user_id=userId`
  - snapshot 4+1 フィールド (status_id / status_key / version / vendor_id / cancelled_at): reason 除外 (status_history + outbox payload に既存)
  - 既存 `currentOrderRow` SELECT に `t.cancelled_at` 列追加 (Codex BLOCK 3 対応で DB 実値ベース snapshot)
- **Codex adversarial review 完遂**: CONDITIONAL-GO → BLOCK 3 + WARN 4 全採用、plan v2 で反映後実装
- **TDD 規律遵守**: RED (test 7 箇所追記、+57 行) → GREEN (service 29 行追加) → typecheck → 全 test 152/152 green
- **Codex 委任 2 件** (両方 auto-apply 済): adversarial-review (`del-20260527-012705-35d2`) + test edit (`del-20260527-014026-d12a`) + service edit (`blk-mpnejpby-8cog` 委任)
- **失敗系 0 件 assertion 完備**: ConcurrentTransportOrderCancelError / TerminalStatusCancelError / TransportOrderNotFoundError (cross-tenant + soft-deleted) / CancelStatusSeedMissingError で change_log row 不在を担保

## Claude 側の主要設計判断

1. **snapshot 最小化 (4+1 フィールド)**: reason は status_history.reason + cancel outbox payload に既存、change_log で重複保存しない (Codex BLOCK 2 採用)
2. **requires_notification=false 固定**: 既存 `to:{id}:cancelled:v{ver}` outbox が通知責任、change_log 由来通知は不要 (Codex BLOCK 1 採用)。将来 vendor_changed / datetime_changed は `true` + `to:{id}:changed:{change_log_id}` outbox pattern 採用予定 (別 Phase)
3. **SELECT 拡張で snapshot DB 実値ベース**: `currentOrderRow.cancelled_at` は業務上常に null だが SELECT 結果使用、固定値書き込み排除 (Codex BLOCK 3 採用)
4. **raw SQL 統一**: cancelTransportOrder 全体が raw SQL なので change_log INSERT も `tx.execute(sql\`INSERT...\`)` で統一 (Codex WARN 1 採用)
5. **INSERT 位置 = `updatedOrderRow` 成功後**: cancel 失敗ケース (version conflict / already-cancelled / terminal / not-found) では INSERT 走らず、change_log 0 件で正しい (失敗系 test で 0 件 assert 担保)
6. **helper 抽出は YAGNI**: 現状 cancel 1 種類のみ、Phase 56+ で vendor_changed / datetime_changed 追加時に共通 helper 抽出
7. **`changed_by_user_id` company CHECK 別 Phase**: admin role middleware で companyId 保証済、schema CHECK 追加は別 Phase (Codex WARN 4 後送)

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| `del-20260527-012705-35d2` | adversarial review (plan v1) | CONDITIONAL-GO (BLOCK 3 + WARN 5 指摘) → plan v2 で BLOCK 3 + WARN 4 採用 |
| `del-20260527-014026-d12a` | test edit (7 箇所 +57 行) | applied / TS syntax OK / RED 期待通り |
| `blk-mpnejpby-8cog` | service edit (29 行) | applied / typecheck clean / GREEN 達成 |

**Codex 出力品質**: Phase 43→44→45→46→47→48→49→50→51→52→53→54→55 で 0→0→0→0→1→2→0→0→2→0→0→0→**3** (review 1 + edit 2、すべて 1 回採用、修正なし)。

## Phase 41-55 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-23 | Phase 31-A〜53 | 39-53 | (前 sealed.md 参照) |
| 24 | Phase 51 sealed drift 課題 | 54 | SQL 関数共通化 (drift 3 → 2) |
| **25** | Phase 53 schema 整合 follow-up | **55** | `cancelTransportOrder` 内 `transport_order_change_logs` INSERT 統合 (MVP blocker #4 service 統合完了) |

## 残課題 / Phase 56 todo

### MVP blocker

- **#1**: 解消済 ✓ (Phase 50 + 51)
- **#2**: reservation cancel 遷移 (wake-up 領域)
- **#3**: Worker handler (wake-up 領域)
- **#4**: 解消済 ✓ (Phase 53 schema + Phase 55 service 統合で完全完了)

### Phase 56 推奨スコープ候補

1. **他 change_type 統合** (Phase 55 cancel pattern 横展開): `vendor_changed` (vendor 変更時)、`datetime_changed` (予定時刻変更時)、`rejected_reassigned` (全 vendor 拒否で再割当時)、`recreated` (再起票時) — 各々 service 関数特定が必要、spec §15.6 確認必須、`requires_notification=true` + `to:{id}:changed:{change_log_id}` outbox pattern で実装、helper 抽出 (`insertTransportOrderChangeLog`) 検討
2. **`changed_by_user_id` company 整合 schema CHECK** (Codex WARN 4 後送): users テーブル FK + company_id CHECK 追加検討
3. **drift 2 → 1 (0012 書き換え)** (Phase 54 sealed §残課題 #3): 0012 を `seed_transport_statuses_for_company` 経由に書き換え、過去 migration 改変で破壊的 (慎重判断)
4. **MVP blocker #2 #3** (両方 wake-up 領域、reservation service / Worker event handler)
5. **transport_order.changed outbox worker 実装** (`notified_at` 更新ロジック、MVP blocker #3 関連、wake-up 領域)
6. **redaction policy 拡張** (transport_orders entity 用 `redact_transport_order_payload` 関数追加、他 change_type で PII フィールド snapshot 必要時)
7. 一般 todo (Phase 47-52 sealed 継続)

### 一般 todo

(Phase 47-54 sealed 参照、変化なし)

## Phase 56 入力契約

### 参照すべきファイル

- 本 handoff (`phase-55-change-logs-integration-sealed.md`)
- `phase-54-sql-function-sealed.md`
- `phase-53-change-logs-sealed.md` (schema 整備)
- `phase-55-change-logs-integration-plan.md` (Codex review 反映 plan v2)
- `src/lib/services/transport-orders.ts` cancelTransportOrder (L412-、Phase 55 change_log INSERT 統合済)
- `src/lib/db/schema/transport_order_change_logs.ts` (Phase 53 schema)
- `tests/integration/services/transport-orders-cancel.integration.test.ts` (12 tests、change_log assertion 含む)
- spec/data-model.md §7.8 (change_logs schema)、§11.2 (redaction policy audit_logs)、§15.6 (各 action 記録要件)、L1581 (`to:{id}:changed:{change_log_id}` 規約)
- spec/requirements.md L548, L600, L672, L683 (change_logs 業務要件)

### 絶対に壊してはいけないもの (invariants)

- 既修正 25 bug/機能すべてに retrogression なし
- typecheck clean / 17 test files / 152 tests PASS
- CI E2E 7/7 PASS
- 既存 invariants 全件 (Phase 43-54 確定)
- **Phase 55 cancel change_log semantic 維持**: `change_type='cancelled'`, `requires_notification=false`, snapshot 4+1 フィールド (reason 除外)、`changed_by_user_id=userId`
- **二重通知防止**: cancel 時の change_log は `requires_notification=false`、新規 outbox 投入は禁止 (既存 `to:{id}:cancelled:v{ver}` が responsible)
- **snapshot は DB 実値ベース**: 固定値書き込み禁止 (Codex BLOCK 3 原則)
- **raw SQL 統一**: cancelTransportOrder 内の DB 操作は raw SQL で統一 (ORM 混在禁止)
- **失敗系 change_log 0 件 invariant**: cancel 失敗時 (version/already/terminal/not-found/seed-missing) は change_log row 不在 (test で担保)

### 注意点

- branch: `phase-42-t4-test-coverage` (Phase 55 commit +1 予定、Phase 54 `8b43358` から)
- Phase 55 変更ファイル: 2 modify (service + test) + 1 new (plan) = 3 files
- Codex 委任 3 件 (review + test + service)、advisor 呼び出し 0 件
- `notified_at` 永遠に NULL: cancel は `requires_notification=false` なので worker scan 対象外、意図通り
- 他 change_type 横展開時は `requires_notification=true` を採用、Phase 55 cancel パターンと差別化

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 55 commit 数 | 1 予定 (Phase 54 `8b43358` から +1) |
| 変更ファイル | 2 modify + 1 new (plan) = 3 files |
| 修正済 latent bug / 機能追加 | 1 (#25 change_logs service 統合 — 累積 25) |
| advisor 呼び出し | 0 |
| Codex 委任 task 数 | 3 (adversarial review + test edit + service edit) |
| Codex sandbox-blocked | 0/3 |
| Claude 側修正 (Codex 出力) | 0 (3 件全て 1 回採用) |
| test files | 17 (変化なし) |
| integration + unit test 件数 | 152 (変化なし、既存 test に assertion 追記のみ) |
| 新規 test assertion | +33 (主要 snapshot 27 + 失敗系 0 件 5 + idempotency 1) |
| 新規 migration | 0 (Phase 53 schema 利用) |
| 新規 SQL function | 0 |
| MVP blocker 解消 | 1 (#4 完全完了、schema + service 両方達成) |

## 振り返りメモ

- **Codex review が plan 品質を大きく上げた**: BLOCK 3 件 (requires_notification 矛盾、reason 重複、cancelled_at 固定値) はいずれも 1 回採用で plan 構造ごと改善。adversarial-review への先行投資が後工程の手戻りを最小化
- **Codex 委任 3 件全て 1 回採用**: review/test/service すべて修正なしで通過、Phase 53 (review NO-GO → ユーザー判断 B) と対照的、Phase 55 は plan 修正後 review で潜在問題を解消したため
- **TDD 順序が機能**: RED 期待で test 追記 → service 改修で GREEN、test 改修と service 改修を分離したことで失敗系 0 件 assertion が網羅的に追加可能になった
- **Phase 53 + 54 + 55 で change_logs 完全完了**: schema 整備 (53) → SQL 関数共通化 (54) → service 統合 (55) で MVP blocker #4 を 3 Phase に分割完了、各 Phase 軽微規模を維持
- **連続 9 Phase 完走 (48-55)**: wake-up 領域を回避しつつ 9 features 追加 (#18-#25 + #17 = 9)、規律安定

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-27 (Phase 55 完了、累積 25 機能追加 + change_logs service 統合、MVP blocker #4 完全完了)*
