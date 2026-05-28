# Phase 64-A.4 入力契約: Phase 64-A.3 customers sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.3 (前: 64-A.2 vehicles sealed) |
| 状態 | **sealed** (customers CRUD + admin UI + integration tests / 204 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §119 推奨に従い直接実装、Codex 試行スキップ) |
| 前 handoff | `phase-64-a2-vehicles-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |

## 達成したこと (Phase 64-A.3)

- 7 ファイル新規/上書き (service / page x3 / actions x2 / integration test): 約 600 行
- 既存 schema / RLS / raw-migration / 既存 service すべて変更 **0** (禁止ファイル群 untouched)
- typecheck clean (一発通過、エラー 0)
- **204 tests PASS** (199 + 新規 5 ケース、目標 203+ 超過達成)
- canonical pattern (`service-tickets.ts` / `vehicles.ts`) を mirror、所有権譲渡なしの単純 CRUD
- 既存 `src/app/admin/customers/page.tsx` (placeholder) を本実装で上書き

## Phase 64-A.3 で実装したファイル

| path | 行数 | 種別 |
|---|---|---|
| `src/lib/services/customers.ts` | 187 | service (zod / CRUD / list / getById) |
| `src/app/admin/customers/page.tsx` | 147 | list page (server component, q 部分検索) |
| `src/app/admin/customers/new/page.tsx` | 78 | 新規作成 form |
| `src/app/admin/customers/new/actions.ts` | 41 | `createCustomerAction` |
| `src/app/admin/customers/[id]/page.tsx` | 143 | 詳細・編集 |
| `src/app/admin/customers/[id]/actions.ts` | 53 | update / delete (soft) actions |
| `tests/integration/services/customers.integration.test.ts` | 173 | 5 cases |

## Claude 側の主要設計判断

1. **Claude 直接実装 (Codex 試行スキップ)**: handoff §119 で「次 Phase で再試行価値は低い、A.3 は Claude 直接実装で始める方が現実的」と明示推奨されており、ユーザー確認の上スキップ。block override 記録 7 件 (本 Phase 全 Write が観測対象)
2. **soft delete 採用**: `customers.deletedAt` 列が schema / raw-migration 双方に存在、許可された判断 §soft delete に従い hard delete でなく `updated_at + deleted_at セット` で実装
3. **email zod schema は `union(email, literal(""), null)`**: form の空文字列入力を許容するため、`z.string().email()` の strict 検証を緩和。actions 層で `optionalFormValue` が空文字を null に変換するため実害なし
4. **email 列の trim**: spec/data-model.md §3.7 で email 形式は強制せず (顧客が手入力するケース想定)。zod で email 形式チェックのみ
5. **list の検索**: `q` 単一パラメータで fullName / fullNameKana / email / phone を ILIKE 部分一致 (vehicles.ts 同パターン)
6. **JOIN 不要**: customers は他テーブルへの FK を持たない (companies のみ)、所有関係は vehicle_ownerships 別管理なので joined columns なし。`selectListColumns` と `selectDetailColumns` を分離 (detail は notes を追加)

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.3 customers CRUD | **Claude 自実装 (handoff §119 推奨 + ユーザー確認)** |

→ A.3 は Codex 試行ゼロで Claude 完遂。block override 記録 7 件 (本 Phase 全 Write が観測対象)。

## Phase 64-A.4 入力契約

### 参照すべきファイル

- 本 handoff (`phase-64-a3-customers-sealed.md`)
- `phase-64-a2-vehicles-sealed.md` (A.2 transferOwnership pattern)
- `phase-64-a1-service-tickets-sealed.md` (A.1 canonical pattern)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- `src/lib/services/customers.ts` / `vehicles.ts` / `service-tickets.ts` (canonical mirror 元)
- 残 MVP blocker は Phase 63 step2 §C 残 21 件 (整備伝票 + 車両 + 顧客 = 3 件消化済)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1/A.2/A.3 機能すべてに retrogression なし
- typecheck clean / 26 test files / **204 tests PASS**
- CI E2E 7/7 PASS
- 既存 invariants 全件 (Phase 43-63a / 64-A.1/A.2 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- vehicle_ownerships の isPrimary 排他 / ends_on 自動更新 trigger は **依然 DB 未実装**、A.4 でも trigger 追加禁止

### Phase 64-A.4 着手時の最初の判断

1. **次の MVP blocker 選定**: Phase 63 step2 §C 24 件のうち消化済 3 件 (service_tickets / vehicles / customers)、次の候補は stores CRUD or work_categories/work_menus / statuses 系のマスタ CRUD が低コスト
2. **Codex 委任の再試行**: A.2 で 3 連続 sandbox-blocked、A.3 はスキップ。A.4 でも再試行価値は低い見込み (windows sandbox 環境変わらず)、Claude 直接実装デフォルトで OK
3. canonical mirror: `customers.ts` (本 A.3、joined なし最単純) が最も近いマスタ CRUD pattern
4. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定
5. spec ドリフト (data-model.md §6 系) は次の MVP blocker でも個別に確認、drizzle + raw-migration を真の源として参照

### 想定規模 (Phase 64-A.4 例: stores CRUD)

| 指標 | 値 |
|---|---|
| 新規ファイル | 7 (service / page x3 / actions x2 / integration test) |
| 想定行数 | 400-600 (customers と同等規模) |
| 想定 tests 追加 | 4-5 ケース (CRUD + tenant 分離 + q 検索) |
| 完了後 tests 合計 | 208+ |
| 仕様判断量 | 低 (canonical CRUD のみ) |

### 注意点

- customers と異なり stores は code (UNIQUE) を持つ可能性あり、raw-migration で要確認
- 既存 stores seed / 既存依存先 (vehicles / customers→vehicle_ownerships は customer 経由) との FK は維持
- spec ドリフト確認 (data-model.md §3.x) は raw-migration の stores 部分を真の源とする

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.3 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 7 新規/上書き (service / UI / test) + 1 (本 sealed) = 8 files |
| 新規 service 関数 | 5 (`createCustomer` / `updateCustomer` / `deleteCustomer` / `listCustomers` / `getCustomerById`) |
| advisor 呼び出し | 0 (canonical mirror が明確、判断保留点なし) |
| Codex 委任 task 数 | 0 (handoff §119 推奨 + ユーザー確認でスキップ) |
| Codex 採用率 | 0/0 (A.3 単体)、累積 1/4 (A.1-A.3) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3 試行なし) |
| 新規 tests | 5 cases / 173 行 (CRUD 4 + q 検索 1) |
| invariants 維持 | typecheck clean / 204 tests / E2E 7/7 |
| MVP blocker 消化 | 累積 3/24 (service_tickets + vehicles + customers) |

## 振り返りメモ

- **handoff §119 推奨の効果**: 「Claude 直接実装で始める」指示に従い、Codex 試行コストをゼロ化。canonical mirror が明確 (service-tickets.ts / vehicles.ts) なので調査 → 7 ファイル / 600 行を 1 ターンで作成、typecheck 一発通過。Phase 64-A 系のように pattern が確立した MVP CRUD では Claude 直接実装が最効率
- **handoff の質**: 前 Phase の §119 振り返りメモ + §80 着手判断が完全に活きた。蒸留ファイルに「次 Phase で何を判断すべきか」を書く価値が再確認できた
- **email zod の緩和**: form の空文字列処理を意識して `union(email, literal(""), null)` に。実装途中で気付ければそのまま進めるが、将来的に form 層で常に null 変換する場合 strict email に戻す余地あり (今は実害なし)

---

*Phase 64-A.3 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.4 (候補: stores / マスタ CRUD、本 branch `phase-64-mvp-implementation` 継続)*
