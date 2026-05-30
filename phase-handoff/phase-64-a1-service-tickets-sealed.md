# Phase 64-A.2 入力契約: Phase 64-A.1 service_tickets CRUD sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.1 (前: 63a sealed) |
| 状態 | **sealed** (service_tickets CRUD + admin UI + integration tests / 192 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude (advisor + canonical pattern 確認 + sandbox-blocked override + Codex test 配置修正 + seal) + Codex 1 lane (del-20260528-001358-a1f7、apply 成功) |
| 前 handoff | `phase-63a-external-setup-sealed.md` |
| Branch | `phase-64-mvp-implementation` (Phase 63a の `phase-42-t4-test-coverage` から分岐、本 seal で +1 commit) |

## 達成したこと (Phase 64-A.1)

- 新規 branch `phase-64-mvp-implementation` 切り出し (`phase-42-t4-test-coverage` から、Phase 63 sealed §90 確定)
- 7 ファイル新規作成 (service / page x3 / actions x2 / integration test): 1064 行
- 既存 schema / RLS / raw-migration 変更 **0** (drizzle schema = DB 実体一致を確認、spec §6.1 §6.4-6.5 のドリフトは spec 側が古い記述と判明)
- typecheck clean / **192 tests PASS** (既存 188 + 新規 4)
- canonical pattern (`transport-orders.ts` + `withRollback` + `describeIntegration`) を mirror

## Phase 64-A.1 で実装したファイル

| path | 行数 | 種別 |
|---|---|---|
| `src/lib/services/service-tickets.ts` | 291 | service (zod input / CRUD / list / detail) |
| `src/app/admin/service-tickets/page.tsx` | 202 | list page (server component, filters) |
| `src/app/admin/service-tickets/new/page.tsx` | 148 | 新規作成 form |
| `src/app/admin/service-tickets/new/actions.ts` | 39 | `createServiceTicketAction` |
| `src/app/admin/service-tickets/[id]/page.tsx` | 189 | 詳細・編集 form |
| `src/app/admin/service-tickets/[id]/actions.ts` | 55 | `updateServiceTicketAction` / `deleteServiceTicketAction` |
| `tests/integration/services/service-tickets.integration.test.ts` | 140 | 4 cases: create / list scoped / update / delete cross-tenant 拒否 |

## Claude 側の主要設計判断

1. **canonical pattern mirror 戦略**: Codex 委任前に `transport-orders.ts` (service) + `transport-orders/page.tsx` (list) を Grep で構造把握、Codex 側に「mirror せよ」と明示。codex-read-delegate hook で全文 Read 抑制
2. **schema 真の源**: spec/data-model.md §6.1 §6.4-6.5 と drizzle schema / raw-migration にドリフトあり (spec が古い `vehicle_management_number/since/until`、実体は drizzle と一致)。**drizzle + raw-migration を真の源として扱う方針確定**
3. **A.2 vehicle_ownerships 運用ロジック方針**: isPrimary 排他制約 / ends_on 自動更新 trigger は **DB レベル未実装 (L1798 TODO)**、本 Phase は DB schema 変更なし、所有権譲渡は service `drizzle.transaction()` 内で「既存 active を `ends_on=CURRENT_DATE` セット → 新規 INSERT」runtime ロジックで対応 (Phase 64-A.2 委任プロンプトに明示済)
4. **Codex test 配置ミスの修正**: 初回 Codex は `src/lib/services/__tests__/` 配下に置き vitest include 対象外。Claude 側で `tests/integration/services/<name>.integration.test.ts` に手動移動 (A.2 委任プロンプトに「配置先固定」明示済)

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| del-20260528-001358-a1f7 | A.1 service_tickets CRUD (7 ファイル / 仕様判断量 低) | **成功** / apply 7 files / 1064 行 / tsc clean / 192 tests PASS (test 配置のみ Claude 修正) |
| (A.2 委任 試行 1) | A.2 vehicles CRUD | **sandbox-blocked** / shell exit -1073741502 (Windows DLL init failed) / apply 0 |
| (A.2 委任 試行 2) | A.2 同上 (shell 検証禁止指示付き) | **sandbox-blocked** / read-only sandbox で apply_patch 拒否 / apply 0 |

→ A.2 は次 session で Claude 自実装に fallback (CLAUDE.md §2.4 sandbox-blocked override)

## sandbox-blocked 詳細記録 (override reason)

- 試行 1: `Get-Content` / `cmd /c dir` / file read すべて exit -1073741502 で fail (Windows STATUS_DLL_INIT_FAILED 0xC0000142)、apply_patch 着手前に block
- 試行 2: `--dangerously-bypass-approvals-and-sandbox` フラグ無効、`patch rejected: writing is blocked by read-only sandbox` で apply_patch 失敗
- A.1 は同経路で成功 → A.2 で時間経過で sandbox 状態が変化した可能性 (codex-companion runtime 側の Windows 制約、Claude scope 外)
- **reason**: `sandbox-blocked: codex-companion runtime read-only sandbox + DLL init failed (2 retries on subagent path)`

## Phase 64-A.2 入力契約

### 参照すべきファイル

- 本 handoff (`phase-64-a1-service-tickets-sealed.md`)
- `.tmp/phase-64-a2-codex-prompt.md` (A.2 委任プロンプト原本、仕様判断点・許可/禁止判断・所有権譲渡ロジック明示済)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- `src/lib/services/service-tickets.ts` (**canonical mirror 元として A.2 で必読**、315 行)
- `tests/integration/services/service-tickets.integration.test.ts` (integration test mirror 元)
- `src/lib/db/schema/{vehicles,vehicle_ownerships}.ts` (drizzle schema = 真の源)
- `src/lib/db/raw-migrations/alpha-1-public/08_customers_vehicles.sql` (DB 実体)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能すべてに retrogression なし
- typecheck clean / 24 test files / **192 tests PASS** (Phase 64-A.1 で 188 → 192 増)
- CI E2E 7/7 PASS
- 既存 invariants 全件 (Phase 43-63a 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続、Phase 66 で main rebase)

### Phase 64-A.2 着手時の最初の判断

1. **Codex 再委任 vs Claude 自実装の判断**: 別 session で codex sandbox 状態が改善している可能性あり。委任 1 回試行 → sandbox-blocked なら Claude 自実装に即 fallback (本 Phase で 2 回連続失敗の前例)
2. canonical mirror 元: `src/lib/services/service-tickets.ts` を Read (315 行、codex-read-delegate hook escalation で通過)
3. 所有権譲渡仕様は **本 sealed §Claude 判断 3 で確定済**、改めて議論せず実装
4. test 配置は `tests/integration/services/vehicles.integration.test.ts` 固定 (`__tests__/` 配下禁止)
5. lint 問題 (`next lint` ESLint 設定プロンプト stop) は本 Phase スコープ外、別 issue

### 想定規模 (Phase 64-A.2)

| 指標 | 値 |
|---|---|
| 新規ファイル | 7 (service / page x3 / actions x2 / integration test) |
| 想定行数 | 600-900 (A.1 1064 行 ± 所有権譲渡 transaction ロジック追加分) |
| 想定 tests 追加 | 6+ ケース (vehicles CRUD 4 + ownership transfer 2+) |
| 完了後 tests 合計 | 198+ |
| 仕様判断量 | 中 (vehicle_ownerships 所有権譲渡 service transaction) |

### 注意点

- spec/data-model.md §6.4-6.5 は drizzle と乖離、**drizzle schema + raw-migration を真の源として参照**
- vehicle_ownerships の isPrimary 排他 / ends_on 自動更新は Phase 5+ 別 Phase 扱い、本 Phase で trigger 追加禁止
- `pnpm lint` の ESLint 設定プロンプト stop は既知問題、本 Phase で fix しない

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.1 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 7 新規 (service / UI / test) + 1 (本 sealed) = 8 files |
| 新規 service 関数 | 5 (`createServiceTicket` / `updateServiceTicket` / `deleteServiceTicket` / `listServiceTickets` / `getServiceTicketById`) |
| advisor 呼び出し | 1 (着手前戦略確認) |
| Codex 委任 task 数 | 3 (A.1 成功 1 / A.2 失敗 2) |
| Codex 採用率 | 1/3 (A.1 のみ) |
| sandbox-blocked | 2 件 (A.2、override 記録済) |
| 新規 tests | 4 cases / 140 行 |
| invariants 維持 | typecheck clean / 192 tests / E2E 7/7 |
| MVP blocker 解消 | 0 (整備伝票 UI は MVP 必須機能、Phase 63 step2 §C 24 件のうち 1 件消化) |

## 振り返りメモ

- **Codex 委任の sandbox 失敗連鎖**: A.1 同経路で成功直後の A.2 で 2 連続 sandbox-blocked。codex-companion runtime の Windows 制約は時間経過で状態変動あり、本 Phase で再現性確認はできず。次 session で再委任試行 → 失敗時 Claude 即 fallback の運用が現実的
- **canonical pattern mirror 戦略の効果**: Codex 全文 Read 不要 (codex-read-delegate hook で抑制)、Grep + 構造把握 + Codex 側に「mirror せよ」明示で実装パターン適合。ただし test 配置先は Codex が誤解しやすく、プロンプトで明示位置固定が必要 (A.2 プロンプトに反映済)
- **spec ドリフトの発見**: data-model.md §6.4-6.5 が drizzle schema と乖離 (`vehicle_management_number/since/until` vs `registrationNumber/startsOn/endsOn`)。spec が古い記述、実装は raw-migration ベースで正しく動いている。spec 更新は別 Phase で実施推奨 (本 Phase で spec 編集はスコープ外)

---

*Phase 64-A.1 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.2 vehicles + vehicle_ownerships (本 branch `phase-64-mvp-implementation` 継続、Codex 再委任 1 回 → 失敗時 Claude 自実装)*
