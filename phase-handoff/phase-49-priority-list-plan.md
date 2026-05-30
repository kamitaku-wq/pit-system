# Phase 49 計画: §1.1 業務優先一覧テーブル

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 49 (前: 48 sealed) |
| 状態 | planning |
| 立案日時 | 2026-05-27 |
| 前 handoff | `phase-48-store-name-sealed.md` |
| Branch | `phase-42-t4-test-coverage` |
| 推奨順 | handoff 順 #4 採用 (#1 Worker handler / #3 vendor_change は本番依存 / 副作用ありで wake-up 待機) |
| Spec 参照 | `spec/requirements.md` §1.1 (要対応バッジ 3 件), §26.2 (ダッシュボード業務優先一覧) |

## Scope (副作用なし、breaking なし、migration なし)

### IN

1. `listTransportOrdersWithLatestInvitation` の `options` 型に 3 filter 追加:
   - `vendorResponse?: 'pending' | 'rejected'` (vendor_response 列等値 filter)
   - `delayedOnly?: boolean` (`vendor_response='pending' AND notification_sent_at < now() - interval '24 hours'`、Phase 44 metric SQL と完全一致)
   - `limit?: number` (LIMIT N、ダッシュボード表示用)
2. WHERE 句拡張: 3 filter 対応 (既存 statusKey filter と並列、AND 結合)
3. `src/app/admin/dashboard/page.tsx` 拡張:
   - 既存 3 metric カードの下に「業務優先タスク」section 追加
   - 3 sub-section: 「未確認業者依頼 (上位 5 件)」/「対応不可 (上位 5 件)」/「遅延案件 (上位 5 件)」
   - 各 row: 案件番号 (Link で `/admin/transport-orders/[id]`) / 業者名 / 通知送信日時 / 業者対応日時
4. integration test (`transport-orders.integration.test.ts`): 4 件 assertion 追加 (vendorResponse / delayedOnly / limit / 既存 statusKey 維持)

### OUT (scope crisp 維持)

- Realtime 反映 (Supabase Realtime、§26.2 「任意」、別 Phase)
- 仮予約期限切れ間近一覧 (§1.1、reservation service 未実装)
- 今日のリマインド送信予定 (§1.1、reminder service 未実装)
- requested_pickup_at 系の遅延判定 (Phase 45+ から継続、別軸)
- 期間フィルタ / グラフ表示 (Phase 45+ から継続)
- cancelled status の除外判定 (metric との不整合を避けるため、cancelled でも vendor_response が古ければ表示。Phase 47 cancel と整合性を取る次 Phase 別案件)
- 招待管理ビュー (副作用あり、別 Phase)

## 主要設計判断

1. **filter 追加 (削除 0)**: 既存 `statusKey` 維持、`vendorResponse` / `delayedOnly` / `limit` を独立 filter として追加 → 既存 caller (Phase 43 一覧 page) は影響なし
2. **`delayedOnly: true` の semantic 固定**: `vendor_response='pending' AND notification_sent_at IS NOT NULL AND notification_sent_at < now() - interval '24 hours'` (Phase 44 確定 metric SQL line 876-880 と完全一致、invariant)
3. **`vendorResponse` 値域**: 'pending' | 'rejected' のみ提供、'accepted' は業務優先対象外 (spec §1.1 「要対応バッジ」3 件と一致)
4. **cancelled 除外なし**: Phase 44 metric SQL と整合性維持 (cancelled でも vendor_response='pending' なら表示)。Phase 50+ で metric + list 同時更新を別 Phase 提案
5. **dashboard UI**: 既存 3 カード破壊なし、下に section 追加のみ
6. **limit 5 件 hard-code**: 「上位表示」要件 (§26.2)、追加 filter / pagination は別 Phase
7. **adversarial review skip**: 副作用 0 / migration 0 / breaking 0 / DB CHECK 0 (Phase 48 同基準)
8. **既存 helper `expectString` / `expectNullableString` 利用**: Phase 47 反省、新規 helper 追加禁止

## Codex 委任戦略

**1 委任 1 task で完結 (Phase 48 同パターン)**

| 委任 | 内容 | 想定行数 |
|---|---|---|
| T1 | service options 拡張 + WHERE 句 + dashboard 業務優先 section + integration test 4 件 assertion | ~150 行 |

委任プロンプト必須項目 (Phase 47-48 反省継続):
- 既存 helper (`expectString` / `expectNullableString` / `expectNullableDate` / `expectBoolean` / `expectNumber` / `expectMetricNumber`) を優先利用、類似 helper 新規追加禁止
- `Number.isNaN` 使用、生の `isNaN` 禁止
- `TransportOrderListItem` / `TransportOrderListRow` の既存 field 削除禁止 (additive only)
- `delayedOnly` SQL semantic 固定 (Phase 44 metric SQL と完全一致)
- 既存 `statusKey` filter pattern (line 831) と同一 SQL fragment 構造 (`${options?.x ? sql\`AND ...\` : sql\`\`}`)
- dashboard 既存 3 カード破壊禁止、下方追加 only
- LIMIT N の SQL は `${options?.limit ? sql\`LIMIT ${options.limit}\` : sql\`\`}` (sql tag literal で number 受け渡し)

## 品質ガードレール

1. typecheck clean
2. lint clean (Phase 47 同様 next lint interactive で実質 skip、typecheck で代替)
3. integration + unit test green (148 件 + 新規 assertion 維持)
4. 既存 18 fix retrogression 0 件
5. invariants 維持: `TransportOrderListItem` 既存 field / Phase 44 metric SQL semantic / dashboard 既存 3 カード

## ファイル変更見積

| ファイル | 種別 | 行数 |
|---|---|---|
| `src/lib/services/transport-orders.ts` | M | +25 (options 型 + WHERE 句 3 filter + LIMIT) |
| `src/app/admin/dashboard/page.tsx` | M | +80 (3 sub-section table + Link + format) |
| `tests/integration/services/transport-orders.integration.test.ts` | M | +50 (4 assertion) |
| `phase-handoff/phase-49-priority-list-plan.md` | A | +110 |
| `phase-handoff/phase-49-priority-list-sealed.md` | A (後) | +180 |
| **合計** | 3 M + 2 A | ~445 行 (うち handoff 込み) |

## 完了条件 (DoD)

- [ ] T1 Codex 委任 applied
- [ ] typecheck clean
- [ ] `npm run test:all` 148 件以上 PASS (新規 assertion 含めて regression 0)
- [ ] dashboard に業務優先 section 表示 (browser 確認は省略、integration test で代替)
- [ ] commit 1 件
- [ ] seal handoff 作成
