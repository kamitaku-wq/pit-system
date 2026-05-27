# Phase 56 入力契約: changed_by_user_id company 整合 schema CHECK (plan v2)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 56 (前: 55 sealed) |
| 状態 | **planning (Codex CONDITIONAL-GO 反映済)** |
| 担当 | Claude (scope + plan v1/v2 + Codex review) |
| 前 handoff | `phase-55-change-logs-integration-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (`04b8c21` 以降 +1 予定) |
| 推定規模 | 軽微: migration 1 + schema 2 + test 数件 |
| Codex review | CONDITIONAL-GO (BLOCK 2 / WARN 6) → plan v2 で BLOCK 2 解決経路変更 + WARN 6 全採用 |

## 目的

Phase 55 で `transport_order_change_logs.changed_by_user_id` への INSERT を実装したが、`users.company_id` ≠ `change_logs.company_id` の組み合わせを DB が許す状態 (Codex WARN 4 後送)。schema レベルで company 整合を保証し、admin role middleware に頼らない多層防御を完成させる。

## 達成定義 (DoD)

- `(changed_by_user_id, company_id) → users(id, company_id)` 複合 FK で cross-company INSERT が DB レベルで block される
- 既存 152 tests が retrogression なく PASS
- typecheck clean
- 新規 test で違反 INSERT 失敗 + 正常系 INSERT 成功を担保
- migration 0016 追加で drift 2 → 2 (drift 増加なし)

## 方針: 複合 FK アプローチ (採択候補 A)

### 選択肢比較

| Option | 内容 | 評価 |
|---|---|---|
| **A. 複合 FK** | `users(id, company_id) UNIQUE` + `change_logs(changed_by_user_id, company_id) → users(id, company_id)` composite FK | **採択**: DB native、最も堅牢、Postgres らしい |
| B. trigger BEFORE INSERT/UPDATE | `users.company_id = NEW.company_id` 確認 trigger | drift 累積、関数追加コスト |
| C. CHECK 関数 | immutable subquery 不可、技術的に厳しい | 不採用 |

### 実装ステップ (v2: Codex BLOCK 1/2 解決経路変更)

1. `users` テーブルに `CONSTRAINT users_id_company_id_unique UNIQUE (id, company_id)` 追加 (PK の冗長 superset、複合 FK 参照先用、制約名明示で WARN 2 採用)
2. **catalog query で既存 FK 名を特定** (WARN 3 採用):
   ```sql
   SELECT conname FROM pg_constraint
   WHERE conrelid = 'public.transport_order_change_logs'::regclass
     AND contype = 'f'
     AND conkey = ARRAY[
       (SELECT attnum FROM pg_attribute
        WHERE attrelid='public.transport_order_change_logs'::regclass
          AND attname='changed_by_user_id')
     ];
   ```
3. `transport_order_change_logs.changed_by_user_id` の既存単独 FK を `DROP CONSTRAINT IF EXISTS <resolved_name>` (WARN 1 採用)
4. `transport_order_change_logs(changed_by_user_id, company_id) → users(id, company_id)` 複合 FK 追加:
   - `MATCH SIMPLE` (デフォルト)
   - **`ON DELETE NO ACTION`** (v2 採用、BLOCK 1 回避)
   - **`ON UPDATE RESTRICT`** (users.company_id 変更禁止前提)
5. drizzle schema (`users.ts` + `transport_order_change_logs.ts`) を同期:
   - users.ts: `unique("users_id_company_id_unique").on(t.id, t.companyId)` 追加
   - transport_order_change_logs.ts: 既存 `.references(() => users.id, { onDelete: "set null" })` を **削除**、table-level `foreignKey({ columns: [t.changedByUserId, t.companyId], foreignColumns: [users.id, users.companyId], name: ... })` 追加 (onDelete 省略 = no action がデフォルト)
   - **drizzle-kit generate/push 使用禁止** をコメント明記 (BLOCK 2 残余対応)
6. integration test 追加 (cross-company INSERT 失敗 / same-company 成功 / NULL 許可 / user hard delete RESTRICT、WARN 4+5 採用)

### v2 設計判断: BLOCK 1/2 解決経路変更の理由

| Codex 提案 (列指定 SET NULL) | v2 採用 (NO ACTION) |
|---|---|
| `ON DELETE SET NULL (changed_by_user_id)` で actor 列のみ NULL 化 | `ON DELETE NO ACTION` で user hard delete を RESTRICT |
| Postgres 15+ 依存、Supabase バージョン要確認 | Postgres バージョン非依存 |
| drizzle 0.36.4 表現不可、コメント運用ガード必要 | drizzle で自然に表現可能 (onDelete 省略) |
| user hard delete 時に actor が消える (audit 価値減) | actor 保持 = audit 用途で望ましい |

**根拠**: spec §15.7 で `deleted_at IS NULL` 規約 = soft delete only、hard delete は migration / 監査クリーンアップ限定。change_log の actor は soft delete (deleted_at) で保持される (FK 参照先は残る) ため、`ON DELETE SET NULL` の actor 列 NULL 化要件は実用上不要。

### 複合 FK の挙動 (v2)

- **MATCH SIMPLE** (デフォルト): `(changed_by_user_id, company_id)` の片方が NULL なら FK チェックなし → `changed_by_user_id = NULL` での INSERT 許可 (将来 worker insert / system actor 用)
- **ON DELETE NO ACTION**: 参照先 user の hard delete attempt は複合 FK 違反で RESTRICT (audit 整合保護)
- **ON UPDATE RESTRICT**: `users.company_id` 変更は複合 FK 違反で RESTRICT (admin 操作で禁止前提を schema 強制)

## 対象スコープ (含む / 含まない)

### 含む

- `transport_order_change_logs.changed_by_user_id` の複合 FK 化
- `users(id, company_id) UNIQUE` 追加
- drizzle schema 更新 (2 files)
- migration 0016 新規
- integration test +2-3 件 (違反 / 正常 / NULL 許可)

### 含まない (別 Phase、debt 台帳化: WARN 6 採用)

同種の `changed_by_user_id` / `invited_by_user_id` company 整合穴は以下にも存在。Phase 56 では change_logs のみ修正、他は debt として明示記録:

| # | 対象 | 列名 | 優先度 (audit 重要度) | 想定 Phase |
|---|---|---|---|---|
| D1 | `transport_order_status_history` | `changed_by_user_id` | **高** (status 遷移 audit、頻出 + critical action) | Phase 57+ |
| D2 | `reservation_status_history` | `changed_by_user_id` | 中 (reservation status audit) | Phase 57+ |
| D3 | `transport_order_invitations` | `invited_by_user_id` | 中 (招待発行 audit、§ADR-0008 関連) | Phase 57+ |
| D4 | `admin_vendor_invitations` | `invited_by_user_id` (該当列あれば) | 低 | Phase 57+ |

その他 OUT:
- 他 change_type service 実装 (Phase 57+ 検討)
- redaction policy 拡張

## 既知のリスク (v2 更新)

| # | リスク | 対策 |
|---|---|---|
| R1 | 既存 152 tests への retrogression | 既存 test fixture は same-company で生成、cross-tenant test (TransportOrderNotFoundError) は cancel 失敗で INSERT 未到達。retrogression 無いはずだが念のため全件実行 |
| R2 | `users.company_id` 変更時 ON UPDATE 挙動 | RESTRICT 採用、admin 操作で変更禁止前提 |
| R3 | drizzle composite FK 表現 | `foreignKey({ columns: [...], foreignColumns: [...] })` で表現可能、`onDelete` 省略 = NO ACTION で自然 (BLOCK 2 自然解消) |
| R4 | migration 順序 | 0016 で users UNIQUE 先 → change_logs FK 入替 (依存順) |
| R5 | 既存 FK 名取得 | catalog query で特定 (WARN 3)、migration は `DROP CONSTRAINT IF EXISTS` で冪等性確保 |
| R6 | status_history などへの横展開を求められる可能性 | スコープ「含まない」§の debt 台帳に明示 (WARN 6 採用)、Phase 57+ で順次横展開 |
| R7 | drizzle-kit generate/push で意図しない FK 差分 | 本 Phase 56 では drizzle-kit 使用禁止、raw migration が authoritative、schema コメントで明記 |
| R8 | user hard delete attempt が予期せず RESTRICT エラー化 | spec §15.7 で hard delete は監査クリーンアップ限定、運用上は影響なし、test で挙動明示 |

## 参照ファイル

- `src/lib/db/schema/transport_order_change_logs.ts` (Phase 53 + 56 改修対象)
- `src/lib/db/schema/users.ts` (Phase 56 改修対象)
- `src/lib/db/raw-migrations/post/0014_recreate_transport_order_change_logs.sql` (Phase 53)
- `src/lib/db/raw-migrations/post/0015_seed_transport_statuses_function.sql` (Phase 54、最新 migration 番号確認用)
- `tests/integration/services/transport-orders-cancel.integration.test.ts` (Phase 55 test 追加先候補)
- spec/data-model.md §3.2 (users)、§7.8 (transport_order_change_logs)、§17 (migration 順序)

## 主要メトリクス目標

| 指標 | 目標 |
|---|---|
| 変更ファイル | 3 (migration 新規 + schema 2 修正) + test 1 = 4 files |
| 新規 migration | 1 (`0016_change_logs_user_company_composite_fk.sql`) |
| 新規行数 | migration 15-25 行 + schema 修正 10 行 + test 30-50 行 = 計 55-85 行 |
| typecheck | clean 維持 |
| 既存 test | 17 files / 152 tests PASS 維持 |
| 新規 test | +2〜+3 (cross-company INSERT 失敗 / same-company 成功 / NULL 許可) |
| Codex 委任 | adversarial review 1 (完了 v1 review) + migration 起草 1 + test 1 = 計 2-3 件 |
| advisor 呼び出し | 1 (Phase 56 scope 確定で実施済) |
| MVP blocker 解消 | 0 (Codex WARN 4 後送解消 = hardening follow-up) |
| drift | 2 → 2 (増加なし、ALTER のみ) |
| 新規 test | +4 (cross-company INSERT 失敗 / same-company 成功 / NULL 許可 / user hard delete RESTRICT) |

## 次ステップ

1. ~~Codex adversarial review (`codex exec`) で plan v1 第二意見~~ ✅ 完了 (CONDITIONAL-GO, BLOCK 2 + WARN 6)
2. ~~レビュー結果統合 → 修正 plan v2~~ ✅ v2 で反映 (BLOCK 1/2 経路変更で解決、WARN 6 全採用)
3. **ユーザー approval** ← 現在ここ
4. TDD で実装:
   - RED: integration test 追加 (cross-company INSERT 失敗 / same-company 成功 / NULL 許可 / user hard delete RESTRICT)
   - migration 0016 起草 + 適用 (Codex 委任候補)
   - drizzle schema 同期 (users.ts + transport_order_change_logs.ts)
   - GREEN 確認
5. typecheck + 全 test 実行 (152 + 新規 4 = 156 PASS 目標)
6. Phase 56 seal (handoff 書き出し + commit)

## Codex Review Summary (v1 → v2 反映)

判定: **CONDITIONAL-GO** (実装可、ただし BLOCK 2 + WARN 6 への対応必須)

| 採用 | 内容 | v2 反映 |
|---|---|---|
| ✅ BLOCK 1 | `ON DELETE SET NULL` で複合 FK が全列 NULL 化 = company_id NOT NULL 違反 | **解決経路変更**: 列指定 SET NULL ではなく `ON DELETE NO ACTION` 採用 (spec §15.7 soft delete only により actor NULL 化不要) |
| ✅ BLOCK 2 | drizzle 0.36.4 が列指定 SET NULL 表現不可 | BLOCK 1 経路変更で自然解消、drizzle-kit generate/push 禁止運用は schema コメントで明記 |
| ✅ WARN 1 | 既存単独 FK を schema から外す (二重制約回避) | 採用、`.references()` 削除 + table-level composite foreignKey |
| ✅ WARN 2 | UNIQUE 制約名明示 | `users_id_company_id_unique` 命名採用 |
| ✅ WARN 3 | FK 名は catalog query で特定 | migration steps に SQL 明記 + `DROP CONSTRAINT IF EXISTS` |
| ✅ WARN 4 | test に user delete 挙動 | 採用、ただし v2 では NO ACTION なので「hard delete attempt RESTRICT」test |
| ✅ WARN 5 | RLS test とは別の直 DB 制約 test | 採用、cross-company INSERT 失敗 test は service 層経由ではなく DB 直接 INSERT で担保 |
| ✅ WARN 6 | status_history/invitations 同種穴の debt 台帳化 | 「含まない」§ に D1-D4 として優先度付き明示 |
