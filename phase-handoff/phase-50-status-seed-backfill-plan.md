# Phase 50 計画 (再開): production status seed backfill migration

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 50 (前: 49 sealed) |
| 状態 | planning (前 blocked plan: `phase-50-status-seed-blocked-plan.md` 別ファイル履歴保持) |
| 立案日時 | 2026-05-27 |
| 前 handoff | `phase-49-priority-list-sealed.md` |
| Branch | `phase-42-t4-test-coverage` |
| 採用方針 | 選択肢 B (seed migration、ユーザー確定) |

## 採用判断 (ユーザー確定)

- ユーザー判断: 「B で問題ありません」「B で問題無いです、進めてほしい」
- B = DB migration で SQL で埋め込み
- 新規 company の自動 seed (trigger) と service 関数 `createCompanyWithDefaults` は **Phase 51+ に切り出し**、Phase 50 は MVP blocker 1 の **既存 companies backfill** のみに絞る

## Scope (副作用なし、breaking なし、production 影響あり)

### IN

1. **新規 raw migration ファイル**: `src/lib/db/raw-migrations/post/0012_seed_transport_statuses_per_company.sql`
   - 既存 companies テーブルの全 row に対して transport status 4 件 (`requested` / `accepted` / `rejected` / `cancelled`) を INSERT
   - 既存 companies の全 row に対して status_transitions 5 件 (`requested→accepted` / `requested→rejected` / `accepted→cancelled` / `requested→cancelled` / `rejected→cancelled`) を INSERT
   - 冪等性: `ON CONFLICT (company_id, status_type, key) DO NOTHING` で UNIQUE 制約に依存 (statuses) / `ON CONFLICT (company_id, status_type, from_status_id, to_status_id) DO NOTHING` (status_transitions)
   - 値は `tests/_helpers/seed-transport-statuses.ts` と完全一致 (test/production の semantic 一致を invariant とする)
2. **運用手順ドキュメント**: `docs/operations/seed-new-company.md` (新規)
   - 新規 company を本番 DB に追加した後、本 migration を再実行する手順
   - `pnpm db:apply-raw:post` の使い方
   - 将来 trigger / service 関数を実装した時にも本ドキュメントを更新する旨

### OUT (scope crisp、後続 Phase に分離)

- **Phase 51 候補**: `companies` INSERT 時の **自動 seed trigger** (spec/CLAUDE.md「DB trigger 最終防衛線」認可済)
- **Phase 52 候補**: `createCompanyWithDefaults` service 関数 (admin sign-up UI / onboarding flow とセットになる可能性、独立判断)
- **Phase 53 候補**: 他 status_type (`reservation` / `service` / `vendor`) の seed (alpha-core 範囲外、要 spec 確認)
- **Phase 54 候補**: notification_rules / reservation_settings の per-company seed
- **error message 更新** (`CancelStatusSeedMissingError` 等): hint「migration を実行してください」を含める → ただし error message 変更はテストアサーションに影響しうるため、本 Phase は SQL 追加のみ
- **`tests/_helpers/seed-transport-statuses.ts` の削除/移行**: test 環境は独立、現状維持 (transaction でロールバックされる test 性質と本番 migration を分離)

## 主要設計判断

1. **`raw-migrations/post/` に配置**: 既存 pattern と整合 (`0002_helpers.sql` から `0011_phase31c_fixup_and_audit_trigger.sql` までの連番)、Phase 50 = `0012_` 採用
2. **drizzle migration 経路を使わない**: `drizzle-kit migrate` は schema 変更用、seed/triggers/RLS は raw SQL 経路 (`db:apply-raw:post`) が既存 pattern
3. **冪等性は ON CONFLICT で保証**: UNIQUE 制約 `(company_id, status_type, key)` (statuses) / `(company_id, status_type, from_status_id, to_status_id)` (status_transitions) があるため安全に何度でも実行可
4. **SQL は CROSS JOIN + INNER JOIN pattern**: 全 companies に対して 4 status + 5 transitions を一括 INSERT、ループ不要、効率的
5. **`from_status_id IS NOT NULL` のみ seed**: 「initial transition (NULL → requested)」は test helper にもないため scope 外
6. **値は test helper と完全一致**: `requested (initial, displayOrder=10)` / `accepted (displayOrder=20)` / `rejected (terminal, displayOrder=30)` / `cancelled (terminal, displayOrder=40)`、`triggers_notification: true`
7. **test 環境は触らない**: test は transaction で独立、production migration を流す経路と分離。test_helpers/seed-transport-statuses.ts は現状維持
8. **adversarial review skip 不採用、advisor 助言を採用**: Phase 47/50 の「軽微判定 vs 実態」教訓を踏まえ、本 Phase は **production code path への影響あり** のため Codex adversarial review を実施

## Codex 委任戦略

**2 段階**:

| 委任 | 内容 | 想定行数 |
|---|---|---|
| T1 (adversarial review) | scope/SQL/冪等性/UNIQUE 制約/test 影響を Codex に独立評価依頼 | (レビュー、行数なし) |
| T2 (implement) | review GO 後、migration SQL + docs を実装 | ~80 行 (SQL 60 + docs 60) |

委任プロンプト必須項目:
- spec/data-model.md §18.1 (line 1738-1745) per-company seed と整合
- 値は `tests/_helpers/seed-transport-statuses.ts` と完全一致
- 冪等: ON CONFLICT DO NOTHING
- CROSS JOIN + INNER JOIN 構造
- raw-migrations/post/ 配置、ファイル名 `0012_seed_transport_statuses_per_company.sql`

## 品質ガードレール

1. typecheck clean (SQL のみなので影響なし)
2. integration + unit test green (152 件、test 環境は触らないので影響なし)
3. SQL syntax 確認 (Codex pre-flight)
4. UNIQUE 制約名と一致確認 (`statuses_company_id_status_type_key_unique` / `status_transitions_company_id_status_type_from_status_id_to_status_id_unique`)
5. value semantic 一致確認 (test_helper と production migration の値が同じ)
6. **実際の DB への適用は本 Phase scope 外** (CI/CD / 本番 deploy 担当が `pnpm db:apply-raw:post` で実行、本 Phase は SQL ファイル commit のみ)

## ファイル変更見積

| ファイル | 種別 | 行数 |
|---|---|---|
| `src/lib/db/raw-migrations/post/0012_seed_transport_statuses_per_company.sql` | A | ~60 |
| `docs/operations/seed-new-company.md` | A | ~60 |
| `phase-handoff/phase-50-status-seed-backfill-plan.md` | A | +160 (本ファイル) |
| `phase-handoff/phase-50-status-seed-backfill-sealed.md` | A (後) | ~180 |
| **合計** | 4 A | ~460 行 (handoff 込み) |

## 完了条件 (DoD)

- [ ] Codex adversarial review GO 判定
- [ ] T2 Codex 委任 applied (migration SQL + docs)
- [ ] typecheck clean (影響なし想定)
- [ ] `npm run test:all` 152 件 PASS (影響なし想定)
- [ ] SQL syntax 確認 (構文エラーなし、UNIQUE 制約名と一致)
- [ ] commit 1 件
- [ ] seal handoff 作成

## 補足: MVP blocker 1 の状態

| state | 内容 |
|---|---|
| Before Phase 50 | 本番で company を作成しても statuses 行なし、cancelTransportOrder が `CancelStatusSeedMissingError` を throw |
| After Phase 50 (本 Phase) | 既存 companies は backfill 済、新規 company は本 migration を再実行する手動運用 |
| After Phase 51 (将来) | companies INSERT trigger で自動 seed、運用負荷ゼロ |
| After Phase 52 (将来) | `createCompanyWithDefaults` service 関数で sign-up UI 統合 |

Phase 50 完了で MVP blocker 1 は **「既存 companies に対して」解消**。完全解消は Phase 51+ で trigger or service 関数を追加した時点。
