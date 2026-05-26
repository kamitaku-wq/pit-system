# Phase 48 計画: §1.5 store name 表示

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 48 (前: 47 sealed) |
| 状態 | planning |
| 立案日時 | 2026-05-26 |
| 前 handoff | `phase-47-cancel-action-sealed.md` |
| Branch | `phase-42-t4-test-coverage` |
| 推奨順 | #2 (handoff 順 #1 Worker handler は本番依存で自律 NG、#2 store name 採用) |

## Scope (副作用なし、breaking なし、migration なし)

### IN

1. `TransportOrderListItem` に 3 field 追加: `pickupStoreName / deliveryStoreName / returnStoreName: string | null`
2. `TransportOrderDetail` に 3 field 追加: `pickupStoreName / deliveryStoreName / returnStoreName: string | null`
3. `listTransportOrdersWithLatestInvitation` SELECT に LEFT JOIN stores x3 + 3 column 追加
4. `getTransportOrderDetail` SELECT に LEFT JOIN stores x3 + 3 column 追加
5. parser 関数 (`expectTransportOrderListItem` / `expectTransportOrderDetailBase`) に 3 field 追加
6. 一覧 page: 新 column「移動経路」(movement_type に応じて pickup → delivery 等)
7. 詳細 page: L230-232 を「引取店舗 / 納車店舗 / 返却店舗」(name + 副次 ID) に置換
8. integration test: 既存 list/detail test に store name assertion 追加 (新規 test file は作らない)

### OUT (scope crisp 維持)

- Worker event handler (推奨順 #1、別 Phase、本番依存)
- vendor_change action (推奨順 #3、副作用あり、別 Phase)
- 業務優先一覧テーブル (推奨順 #4、Phase 49 で実施)
- production status seed (推奨順 #5、Phase 50 で実施)
- 招待管理ビュー (副作用あり、別 Phase)
- store deleted_at による表示制御 (履歴保護のため LEFT JOIN は deleted_at 条件なし、削除済みでも name 表示)
- stores テーブル schema 変更 (現状 id/company_id/code/name で十分)

## 主要設計判断

1. **3 field 追加 (削除 0)**: Phase 47 確定 invariants 維持。`TransportOrderListItem` / `TransportOrderDetail` 破壊禁止 = additive only
2. **LEFT JOIN stores x3 (`ps` / `ds` / `rs` alias)**: pickup/delivery/return それぞれ独立 JOIN、null 許容 (movement_type=pickup_only では delivery/return が null)
3. **`s.deleted_at` 条件なし**: 削除済み store でも name 表示 (履歴保護、stores.deleted_at は新規割当禁止のみを意味)
4. **company_id 二重 check 不要**: `transport_orders.company_id = ${companyId}` で tenant 分離済、stores の company_id は同一前提 (DB FK で保証されていないが、業務ロジック前提)
5. **既存 helper 優先**: `expectNullableString` 利用、新規 helper 追加禁止 (Phase 47 反省点)
6. **一覧 column 追加**: 既存 column 削除なし、新規「移動経路」column 追加のみ。movement_type 別 formatter
7. **詳細 page UI**: ID 表示は副次に降格、name を主表示 (`name (ID: xxx)` 形式)
8. **adversarial review skip**: 副作用 0 / migration 0 / breaking 0 / DB CHECK 0 で Phase 47 とは scope の質が違う、簡素 task のため scope 過小評価リスク低

## Codex 委任戦略

**1 委任 1 task で完結 (scope が小さいため Phase 47 のような 3 並列は不要)**

| 委任 | 内容 | 想定行数 |
|---|---|---|
| T1 | service 層 (interface +6, SELECT JOIN x2 +6, parser +6) + 一覧 page (+30) + 詳細 page (+8) + integration test 2 件追加 (+20) | ~80 行 |

委任プロンプト必須項目 (Phase 47 反省):
- 既存 helper (`expectString` / `expectNullableString` / `expectNullableDate` / `expectBoolean` / `expectNumber` / `expectMetricNumber`) を優先利用、類似 helper 新規追加禁止
- `Number.isNaN` 使用、生の `isNaN` 禁止
- `TransportOrderDetail` / `TransportOrderListItem` の既存 field 削除禁止 (additive only)
- stores 構造: `id` / `company_id` / `code` / `name` / `deleted_at` (LEFT JOIN は deleted_at 条件なし)
- 一覧 column 追加位置: 「移動パターン」の右側
- 詳細 page L230-232 は ID 表示置換 (削除ではなく `name + (ID: xxx)` 形式)

## 品質ガードレール

1. typecheck clean (`npm run typecheck`)
2. lint clean (`npm run lint`)
3. integration + unit test green (`npm run test:all` で 148 件 + 既存 assertion 拡張)
4. 既存 17 fix retrogression 0 件
5. invariants 維持確認: `TransportOrderListItem` / `TransportOrderDetail` の既存 field 列挙、削除なし

## ファイル変更見積

| ファイル | 種別 | 行数 |
|---|---|---|
| `src/lib/services/transport-orders.ts` | M | +20 (interface +6, parser +6, SELECT +8) |
| `src/app/admin/transport-orders/page.tsx` | M | +30 (新 column + formatter) |
| `src/app/admin/transport-orders/[id]/page.tsx` | M | +8 (置換) |
| `tests/integration/services/transport-orders.integration.test.ts` | M | +10 (list assertion + seed name) |
| `tests/integration/services/transport-orders-detail.integration.test.ts` | M | +10 (detail assertion) |
| `phase-handoff/phase-48-store-name-plan.md` | A | +110 |
| `phase-handoff/phase-48-store-name-sealed.md` | A (後) | +180 |
| **合計** | 5 M + 2 A | ~370 行 (うち handoff 込み) |

## 完了条件 (DoD)

- [ ] T1 Codex 委任 applied
- [ ] typecheck clean
- [ ] lint clean
- [ ] `npm run test:all` 148 件以上 PASS (新規 assertion 含めて regression 0)
- [ ] 一覧 page で移動経路 column が表示される (browser 確認は省略可、test で代替)
- [ ] 詳細 page で店舗名が表示される (browser 確認は省略可、test で代替)
- [ ] commit 1 件
- [ ] seal handoff 作成
