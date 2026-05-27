# Phase 64-A.3 入力契約: Phase 64-A.2 vehicles + vehicle_ownerships sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.2 (前: 64-A.1 service_tickets sealed) |
| 状態 | **sealed** (vehicles CRUD + 所有権譲渡 transaction + admin UI + integration tests / 199 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (Codex 3 連続 sandbox-blocked 後の fallback、CLAUDE.md §2.4 override 適用) |
| 前 handoff | `phase-64-a1-service-tickets-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |

## 達成したこと (Phase 64-A.2)

- 7 ファイル新規作成 (service / page x3 / actions x2 / integration test): 約 850 行
- 既存 schema / RLS / raw-migration / 既存 service すべて変更 **0** (禁止ファイル群 untouched)
- typecheck clean (1 件あった `Object is possibly 'undefined'` を `?.` で即修正)
- **199 tests PASS** (192 + 新規 7 ケース、目標 198+ 達成)
- 所有権譲渡 transaction (`transferOwnership`) を DB schema 変更なしで service-runtime に実装
- canonical pattern (`transport-orders.ts` `.transaction()` / `service-tickets.ts` 構造) を mirror

## Phase 64-A.2 で実装したファイル

| path | 行数 | 種別 |
|---|---|---|
| `src/lib/services/vehicles.ts` | 261 | service (zod / CRUD / list / listOwnerships / transferOwnership) |
| `src/app/admin/vehicles/page.tsx` | 167 | list page (server component, filters + q 部分検索) |
| `src/app/admin/vehicles/new/page.tsx` | 93 | 新規作成 form |
| `src/app/admin/vehicles/new/actions.ts` | 41 | `createVehicleAction` |
| `src/app/admin/vehicles/[id]/page.tsx` | 188 | 詳細・編集 + 所有履歴 + 譲渡 form |
| `src/app/admin/vehicles/[id]/actions.ts` | 75 | update / delete (soft) / transferOwnership actions |
| `tests/integration/services/vehicles.integration.test.ts` | 195 | 7 cases |

## Claude 側の主要設計判断

1. **Codex 3 連続 sandbox-blocked → Claude 自実装 fallback**: 前 session 2 回 + 本 session 1 回いずれも read-only sandbox + STATUS_DLL_INIT_FAILED で apply_patch 拒否。前 sealed §79-85 の判断基準通り Claude 自実装に切替 (`block override 記録` 7 件は本判断の観測点)
2. **soft delete 採用**: `vehicles.deletedAt` 列が schema 定義 + raw-migration 双方に存在、許可された判断 §soft delete に従い hard delete でなく `updated_at + deleted_at セット` で実装
3. **transferOwnership は `ctx.db.transaction(...)`**: `transport-orders.ts` と同パターン。test 内 `outerTx.transaction(...)` は drizzle の SAVEPOINT で nested transaction として動作 (検証: test 全 7 ケース PASS)
4. **ends_on は JS UTC `YYYY-MM-DD`**: `sql\`CURRENT_DATE\`` を避け JS で日付文字列生成 (drizzle date 型互換、test 環境で TZ 問題回避)
5. **modelYear 範囲**: zod で `min(1900).max(2100)` (data-model.md §3.7 に範囲指定なし、現実的レンジで guard)
6. **list の検索**: `q` 単一パラメータで registration_number / vin / maker / model を ILIKE 部分一致 (許可された判断 §検索/フィルタ粒度)

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (A.2 委任 試行 3、本 session) | A.2 vehicles CRUD | **sandbox-blocked** / read-only sandbox + apply_patch 拒否 / apply 0 / ledger reject 記録済 (del-20260527-232820-d1c0) |

→ A.2 は Claude 自実装で完遂。block override 記録 7 件 (本 Phase 全 Write が観測対象)。

## sandbox-blocked override (本 session 記録)

- **reason** (ledger 記録済): `sandbox-blocked: codex shell read-only sandbox rejected apply_patch (3rd retry across 2 sessions, A.2 vehicles) - hook auto-apply notification was false positive, git status confirms 0 files applied`
- 前 session の sandbox-blocked 2 件と合計 3 件、handoff §79 の「失敗時 Claude 即 fallback」条件成立
- hook の `auto-apply 済` 通知は false positive (Codex 自身 "No files were applied" 明示、git status 確認で 0 ファイル) — ledger reject で覆した

## Phase 64-A.3 入力契約

### 参照すべきファイル

- 本 handoff (`phase-64-a2-vehicles-sealed.md`)
- `phase-64-a1-service-tickets-sealed.md` (A.1 canonical pattern)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- `src/lib/services/vehicles.ts` / `service-tickets.ts` (canonical mirror 元、A.3 でも参照)
- 残 MVP blocker は Phase 63 step2 §C 残 22 件 (整備伝票 + 車両 = 2 件消化済)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1/A.2 機能すべてに retrogression なし
- typecheck clean / 25 test files / **199 tests PASS**
- CI E2E 7/7 PASS
- 既存 invariants 全件 (Phase 43-63a / 64-A.1 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- vehicle_ownerships の isPrimary 排他 / ends_on 自動更新 trigger は **依然 DB 未実装** (L1798 TODO)、A.3 でも trigger 追加禁止

### Phase 64-A.3 着手時の最初の判断

1. **次の MVP blocker 選定**: Phase 63 step2 §C 24 件のうち消化済 2 件 (service_tickets / vehicles)、次は customers CRUD が canonical mirror で最も低コスト (vehicles の 1/3 規模、所有権譲渡なし)
2. **Codex 委任の再試行**: A.2 と別 session で sandbox 状態改善している可能性あり、A.3 では 1 回試行 → 失敗時即 Claude fallback
3. canonical mirror: `vehicles.ts` (本 A.2) or `service-tickets.ts` (A.1) どちらでも可、customers は所有権譲渡なしで `service-tickets.ts` の方が近い
4. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定
5. spec ドリフト (data-model.md §6 系) は次の MVP blocker でも個別に確認、drizzle + raw-migration を真の源として参照

### 想定規模 (Phase 64-A.3 = customers CRUD)

| 指標 | 値 |
|---|---|
| 新規ファイル | 7 (service / page x3 / actions x2 / integration test) |
| 想定行数 | 400-600 (transferOwnership なしで vehicles の 70%) |
| 想定 tests 追加 | 4-5 ケース (CRUD + tenant 分離) |
| 完了後 tests 合計 | 203+ |
| 仕様判断量 | 低 (canonical CRUD のみ) |

### 注意点

- customers schema は `fullName / fullNameKana / email / phone / postalCode / address / notes` のみ、所有関係は別 (vehicle_ownerships) なので customers.ts service は単純な CRUD
- 既存 customers seed / 既存依存先 (transport_orders / service_tickets / vehicle_ownerships) との FK は維持
- spec ドリフト確認 (data-model.md §3.7) は raw-migration `08_customers_vehicles.sql` の `customers` 部分を真の源とする

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.2 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 7 新規 (service / UI / test) + 1 (本 sealed) = 8 files |
| 新規 service 関数 | 7 (`createVehicle` / `updateVehicle` / `deleteVehicle` / `listVehicles` / `getVehicleById` / `listOwnershipsByVehicle` / `transferOwnership`) |
| advisor 呼び出し | 0 (canonical mirror が明確、判断保留点なし) |
| Codex 委任 task 数 | 1 (試行 3、sandbox-blocked → ledger reject) |
| Codex 採用率 | 0/3 (A.2 累積、A.1 込みなら 1/4) |
| sandbox-blocked | 3 件累積 (Phase 64-A.2 全試行、override 記録 7 件) |
| 新規 tests | 7 cases / 195 行 (transferOwnership 3 + CRUD 4) |
| invariants 維持 | typecheck clean / 199 tests / E2E 7/7 |
| MVP blocker 消化 | 累積 2/24 (Phase 63 step2 §C のうち service_tickets + vehicles) |

## 振り返りメモ

- **Codex sandbox 失敗 3 連続**: 前 session 2 + 本 session 1。本 session でも `codex exec` および `Task(codex:codex-rescue)` 双方の経路で sandbox 状態が悪化したまま (Windows STATUS_DLL_INIT_FAILED 0xC0000142)。codex-companion runtime 側の Windows 制約で Claude scope 外、ledger に 3 件 reject 記録。次 Phase で再試行価値は低い、A.3 は Claude 直接実装で始めて hook block の自実装観測を続ける方が現実的
- **hook auto-apply 通知の false positive**: PostToolUse:Agent hook が `auto-apply 済 (P2)` と通知したが Codex 自身は "No files were applied" 明示、git status で 0 ファイル確認。hook は notification を盲信せず実体確認する CLAUDE.md §2.4-d 教訓を再確認
- **canonical pattern mirror の効率**: service-tickets.ts / transport-orders.ts を Grep + 1 ファイル Read で構造把握、Claude 直接実装でも 7 ファイル / 850 行を 1 ターンで作成完了 (typecheck 1 件のみエラー、 `?.` で即修正)。Phase 64-A 系の MVP CRUD は今後も同パターン適用可能

---

*Phase 64-A.2 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.3 customers CRUD (本 branch `phase-64-mvp-implementation` 継続、Codex 1 回試行 → 失敗時 Claude 自実装)*
