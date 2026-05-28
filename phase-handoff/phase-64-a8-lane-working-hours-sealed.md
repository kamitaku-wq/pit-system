# Phase 64-A.9 入力契約: Phase 64-A.8 lane_working_hours sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.8 (前: 64-A.7 lane_work_menus sealed) |
| 状態 | **sealed** (lane_working_hours service + lane detail 営業時間 table + integration tests / 252 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §85 推奨に従い直接実装、Codex 試行スキップ) |
| 前 handoff | `phase-64-a7-lane-work-menus-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |

## 達成したこと (Phase 64-A.8)

- 1 ファイル新規 (service `lane-working-hours.ts` / 約 130 行)
- 既存 UI 拡張: `src/app/admin/lanes/[id]/page.tsx` (+84 行、7 曜日 table)、`actions.ts` (+23 行、replaceLaneWorkingHoursAction)
- integration test 1 ファイル新規 (8 ケース、CRUD + dedupe + time refine + tenant + CASCADE + 順序)
- 既存 schema / RLS / raw-migration 変更 **0**
- 既存 service 関数の挙動変更 **0** (純粋追加のみ)
- typecheck clean (TS2532 を destructure 経由で回避、2 段で通過)
- **252 tests PASS** (243 + 新規 9、目標 248+ 超過)
- canonical pattern: **per-lane full-replace transaction** = 新規確立 (`replaceLaneWorkingHours` = tenant 検証 + dedupe + delete-all/insert-all)

## ⚠ 既知の schema drift (advisor 指摘で発覚 / IMPORTANT)

`spec/data-model.md §5.3` と `raw-migrations/alpha-1-public/06_lanes_work.sql` に齟齬:

| 観点 | spec §5.3 | raw-migration (実装) |
|---|---|---|
| PK | `(lane_id, day_of_week)` | `id uuid` |
| UNIQUE | (PK 想定) | **なし** |
| `is_closed` | あり | **なし** |
| CHECK | (記載なし) | `day_of_week 0-6` + `starts_at < ends_at` |

→ A.7 handoff §107 の「`(lane_id, day_of_week) UNIQUE`、is_closed トグル」の記述は **誤り**。本 A.8 は raw-migration を真として実装 (raw 不変規律 §74 と整合)。
→ UI は 7 行 fixed 営業日 checkbox (休業 = 行なし) 表現で運用、is_closed カラムは追加しない。
→ 将来の reconciliation 経路: ① spec を raw に追従 (推奨、複数範囲/曜日サポート確保) ② raw-migration v2 で UNIQUE + is_closed 追加 (`§13.1 lane_utilization_daily` の precise 計算で必要なら検討)。

## Phase 64-A.8 で実装したファイル

| path | 行数 | 種別 |
|---|---|---|
| `src/lib/services/lane-working-hours.ts` | 130 | service (replace + list + dedupe + time refine) |
| `src/app/admin/lanes/[id]/page.tsx` | +84 | 「営業時間」セクション追加 (7 曜日 table) |
| `src/app/admin/lanes/[id]/actions.ts` | +23 | `replaceLaneWorkingHoursAction` 追加 |
| `tests/integration/services/lane-working-hours.integration.test.ts` | 305 | 9 cases (CRUD + dedupe + time refine + tenant + CASCADE 2 方向 + 順序) |

独立 admin 画面は作成せず、lane detail 内サブセクションで一本化 (A.7 と同方針)。

## Claude 側の主要設計判断

1. **per-lane full-replace 採用**: A.7 の M:N replace と同思想、ただし「変更検出 diff」ではなく単純 delete-all + insert-all。max 7 行 / 設定変更頻度低のため write churn 最小化は不要。トランザクション境界明確
2. **休業日 = 行なし表現**: schema に is_closed カラムが無いため、休業を「行が存在しないこと」で表現。UI は「営業」checkbox の on/off で行の有無を制御、UX 自然
3. **dedupe 防御**: schema に UNIQUE(lane_id, day_of_week) が無い (drift) ため、service 側で同曜日重複を `DuplicateDayOfWeekError` で reject。UI は 1 行/曜日固定だが入力は untrusted 扱い
4. **time 形式正規化**: `<input type="time">` は "HH:MM" 返し、PG `time` 型は "HH:MM:SS" 保存・返却。zod regex は両形式 accept、内部 `normalizeTime()` で "HH:MM:SS" に統一
5. **time validation は zod refine**: `startsAt < endsAt` を `superRefine` で事前 check。DB CHECK 違反より早期に明確なメッセージ。文字列比較 ("HH:MM:SS" 字句順序) で OK
6. **tenant 検証 1 段階**: lane が companyId に属し deletedAt なし。lane_working_hours の companyId は lane と同じ必要があり、insert 時に明示
7. **CASCADE 検証**: lane の soft delete (deletedAt set) は CASCADE 不発火、raw `DELETE FROM lanes` でのみ rows が消える。test で明示
8. **TS noUncheckedIndexedAccess 対応**: drizzle return の Array index access が undefined union になるため、destructure (`const [first, second] = list`) + optional chain (`first?.dayOfWeek`) で型通過

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.8 lane_working_hours | **Claude 自実装 (handoff §85 推奨 + 5 連続 1 ターン完遂継続)** |

→ A.8 も Codex 試行ゼロで Claude 完遂。block override 記録 3 件 (service + UI + test、内容: canonical 新規確立かつ schema drift 判断ありの自実装)。

## Phase 64-A.9 入力契約

### 参照すべきファイル

- 本 handoff (`phase-64-a8-lane-working-hours-sealed.md`)
- `phase-64-a7-lane-work-menus-sealed.md` (M:N replace canonical)
- `src/lib/services/lane-working-hours.ts` (per-lane full-replace canonical)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker は Phase 63 step2 §C 残 14 件 (A.8 で lane_working_hours 消化、累積 10/24)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.8 機能すべてに retrogression なし
- typecheck clean / 33 test files / **252 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.8 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- vehicle_ownerships の isPrimary 排他 / ends_on 自動更新 trigger は **依然 DB 未実装**、A.9 でも trigger 追加禁止
- `lane_types` schema は deletedAt なし、A.9 以降も追加禁止 (raw-migration 不変)
- `lane_working_hours` schema は UNIQUE / is_closed なし、A.9 以降も追加禁止 (raw-migration 不変、reconciliation は別 Phase で議論)
- lane_work_menus は「lane detail 内 replace のみ」、独立 admin 画面禁止
- lane_working_hours は「lane detail 内 7 曜日 table のみ」、独立 admin 画面禁止
- lanes UI で store 変更は禁止 (新規 + 旧削除フロー)

### Phase 64-A.9 着手時の最初の判断

1. **次の MVP blocker 選定**: Phase 63 step2 §C 残候補:
   - **statuses マスタ CRUD** (表示順 / 色コード、seed `03_roles_statuses.sql` 既存に注意)
   - **roles マスタ CRUD** (admin/vendor role、auth 影響大、優先度後ろでも可)
   - **store_business_hours / store_holidays** (store detail 内サブ、A.8 と類似 per-store full-replace)
   - **vehicle_ownerships CRUD** (vehicles 詳細サブ、isPrimary trigger 未実装注意)
2. **Codex 委任の再試行**: A.2 で 3 連続 sandbox-blocked、A.3-A.8 はスキップ。A.9 でも再試行価値は低い見込み、Claude 直接実装デフォルトで OK
3. canonical mirror:
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし) → `lane-types.ts` / `work-categories.ts`
   - M:N 関連 → `lane-work-menus.ts` (A.7 replace transaction)
   - **親 1:N サブ (full-replace) → `lane-working-hours.ts` (A.8 で確立)**
   - seed 衝突回避必要 → statuses / roles で独自パターン要検討
4. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定
5. seed 既存マスタ (statuses, roles) は raw-migration `03_roles_statuses.sql` に注意、CRUD で seed 上書き衝突回避

### 想定規模 (Phase 64-A.9 例: store_business_hours)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1-2 (service + integration test、UI は store detail 拡張) |
| 想定行数 | 400-500 |
| 想定 tests 追加 | 6-8 ケース (A.8 と同パターン、店舗ベースに置換) |
| 完了後 tests 合計 | 257+ |
| 仕様判断量 | **低** (A.8 canonical をほぼ機械的に store に置換) |

### 注意点

- `store_business_hours` の schema を A.9 着手時に必ず確認 (UNIQUE / is_closed 有無 / day_of_week range)。drift 再発の可能性
- A.8 canonical 「per-lane full-replace」は親親子の `lane_id` を `store_id` に置換するだけで適用可能
- A.8 advisor 指摘事項 (handoff §107 の誤りなど) を seal 時点で訂正済、A.9 では本 handoff を信頼可能

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.8 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 2 既存拡張 (UI + actions) + 1 新規 test + 1 sealed = 5 files |
| 新規 service 関数 | 2 (listLaneWorkingHoursByLaneId / replaceLaneWorkingHours) + 2 error class |
| advisor 呼び出し | 1 (schema drift 発覚で方針確認) |
| Codex 委任 task 数 | 0 (handoff §85 推奨でスキップ) |
| Codex 採用率 | 0/0 (A.8 単体)、累積 1/8 (A.1-A.8) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.8 試行なし) |
| 新規 tests | 9 cases / 305 行 (advisor 指摘で soft delete 非対称 test +1) |
| invariants 維持 | typecheck clean / 252 tests / 33 test files |
| MVP blocker 消化 | 累積 10/24 (service_tickets + vehicles + customers + stores + work_categories + work_menus + lane_types + lanes + lane_work_menus + lane_working_hours) |

## 振り返りメモ

- **schema drift 発見の重要性**: A.7 handoff §107 の「UNIQUE(lane_id, day_of_week)、is_closed トグル」は spec §5.3 に依拠した推測だったが、raw-migration の実装と齟齬。advisor が「事前に raw を確認せよ」と指摘したことで発覚、設計変更前に検出できた。今後 A.9 以降の sub-table 系も着手時に raw-migration / spec / drizzle schema の 3 点突合を必須化推奨
- **per-lane full-replace canonical 確立**: max 行数小 (7) かつ設定変更頻度低の場合、diff 計算より delete-all + insert-all が単純で安全。store_business_hours / vendor_available_days 等の親 1:N サブで再利用可能
- **休業日 = 行なし表現**: is_closed カラムが無い schema での運用解。UI 側で「営業」checkbox を on/off することで暗黙的に休業を表現、ユーザビリティ犠牲なし
- **time 型のクライアント-サーバ変換**: `<input type="time">` は "HH:MM" / PG `time` は "HH:MM:SS" の非対称を zod regex + normalize で吸収。今後 time 系で再利用パターン
- **handoff §85 推奨の効果継続**: A.3-A.8 で Claude 直接実装 6 連続 1 ターン完遂。canonical mirror 確立済の MVP CRUD では Claude 直接実装が圧倒的に高効率 (A.9 以降も同方針継続)

---

*Phase 64-A.8 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.9 (候補: statuses / store_business_hours / roles / vehicle_ownerships、本 branch `phase-64-mvp-implementation` 継続)*
