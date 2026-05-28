# Phase 64-A.21 入力契約: Phase 64-A.20 notification_rules sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.20 (前: 64-A.19 permissions sealed) |
| 状態 | **sealed** (notification_rules マスタ per-row CRUD + UNIQUE(company_id, event_type, target_type, channel) + Zod enum 値域強制 + admin UI list/new/detail + integration tests / 373 tests PASS) |
| 完了日時 | 2026-05-28 |
| 担当 | Claude 自実装 (handoff §76 推奨 notification_rules 採用、18 連続 1 ターン完遂継続、Codex 試行スキップ) |
| 前 handoff | `phase-64-a19-permissions-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |
| **/clear 推奨** | **本 Phase 完了後、A.20 で master 系 11 種類目を積み終え、A.21 で Phase 4 系 (customer_reservation_tokens) もしくは MVP blocker 仕上げの自然な境界、`/clear` 推奨を発出** |

## 達成したこと (Phase 64-A.20)

- 1 ファイル新規 service (`notification-rules.ts` 約 230 行、per-row CRUD with UNIQUE(4 列) + companyId NOT NULL + Zod enum 値域 (target_type 3 値 / channel 5 値) + 任意 int フィールド 3 列 (timing_minutes_offset / retry_after_minutes / max_reminders))
- 5 ファイル新規 UI (`admin/notification-rules/page.tsx` 一覧 / `new/page.tsx` + `new/actions.ts` 作成 / `[id]/page.tsx` + `[id]/actions.ts` 詳細・編集・削除)
- 1 ファイル新規 integration test (8 cases: create with defaults / list cross-tenant 除外 / 4 種フィルタ (q + targetType + channel + isEnabled) / update + cross-tenant null / UNIQUE 衝突 + 異 channel OK + 別 company OK / hard delete + cross-tenant + 二回目 false + getById null / Zod 4 種無効値 / nullable optional 3 列の null 設定とクリア)
- 既存 schema / RLS / raw-migration 変更 **0** (drizzle schema 既存 `notification_rules.ts` をそのまま利用、spec §8.3 / DDL / drizzle 完全一致を確認)
- 既存 service / admin-shell ナビ変更 **0** (settings ハブ経由想定)
- typecheck clean (tsc --noEmit 通過、exit=0)
- **373 tests PASS** (365 + 新規 8、46 test files、handoff §102 想定 371+ クリア)

## Claude 側の主要設計判断

1. **3 点突合で完全一致確認**: spec/data-model.md §8.3 vs raw-migration `13_notifications.sql` vs drizzle schema → 完全一致。drift なし
2. **enum 値域の二重防御**: DDL CHECK 制約 (`target_type IN (...)`, `channel IN (...)`) と service 層 Zod `z.enum()` の二重で防御。Zod failed は 400 相当のクリーンなエラー、CHECK failed は DB 例外 fallback
3. **event_type は text フリー入力**: spec/DDL とも CHECK 制約なし。実運用 (`transport_order.invited` 等) との整合は別途仕様で管理。`z.string().trim().min(1).max(120)` で軽い検証のみ
4. **UNIQUE 衝突 wrap**: `NotificationRuleConflictError` で wrap (UNIQUE(companyId, eventType, targetType, channel))。stores.ts の `isUniqueViolation()` canonical 流用
5. **hard delete**: notification_rules に deletedAt 列なし、子テーブル参照なし (`notification_outbox` / `notification_deliveries` は独立した outbox エンジンで rules 削除と無関係)。soft delete 不要、FK 違反 wrap も不要
6. **system seed なし**: company_id NOT NULL のためテナント完全独立。permissions/roles のような cross-tenant 可視性は不要、`stores.ts` mirror で十分
7. **任意 int 3 列の Zod refine**: `retryAfterMinutes >= 0` / `maxReminders >= 0` を `.refine()` で値域チェック。`timingMinutesOffset` は負値許容 (-1440 = 前日)
8. **list 並び (eventType asc, targetType asc, channel asc, createdAt desc)**: 一覧での視認性最大化、ユーザーは event 単位でルールを束ねて見たい想定
9. **list 4 種フィルタ**: q (event_type ILIKE) + targetType (enum) + channel (enum) + isEnabled (boolean、'' / '1' / '0' tri-state)
10. **update での nullable explicit clear**: `"timingMinutesOffset" in parsed` を判定して `??= null` で明示クリア対応。test で空値→値→null の遷移を検証

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.20 notification_rules マスタ | **Claude 自実装 (handoff §76 推奨 notification_rules 採用、18 連続 1 ターン完遂継続)** |

→ A.20 も Codex 試行ゼロで Claude 完遂。block override 記録 6 件 (service + UI 3 + actions 2 + test)。

## Phase 64-A.21 入力契約 (新セッションで使用)

### 参照すべきファイル

- 本 handoff (`phase-64-a20-notification-rules-sealed.md`)
- `phase-64-a19-permissions-sealed.md` (permissions canonical: 親 role ownership 検証 + leftJoin)
- `src/lib/services/notification-rules.ts` (per-row CRUD with UNIQUE(複合 4 列) + Zod enum 値域強制 + 任意 int refine の child master 系で参照)
- `phase-63-overall-sealed.md` §2 Phase 64-A 分割詳細
- 残 MVP blocker 累積 **22/24** (A.20 で notification_rules 消化、残り 2 件)

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.20 機能すべてに retrogression なし
- typecheck clean / 46 test files / **373 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.19 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- `notification_rules` schema は UUID PK + companyId NOT NULL (RESTRICT) + event_type/target_type/channel NOT NULL + target_type CHECK in 3 値 + channel CHECK in 5 値 + UNIQUE(company_id, event_type, target_type, channel) のまま不変
- notification_rules 削除は hard delete (子テーブルなし、FK 違反 wrap 不要)
- target_type / channel の値域変更は spec 改定 + DDL 改定 + Zod enum 更新の 3 点同時

### Phase 64-A.21 着手時の最初の判断

1. **次の MVP blocker 選定** (残候補):
   - **customer_reservation_tokens** (Phase 4 顧客本人確認、token hash + email 検証、新規 token 生成 logic 必要、仕様判断量「中-高」)
   - **attachments** (画像/PDF upload、Supabase Storage 連携必要、外部依存、仕様判断量「高」、MVP 後送り推奨)
2. **A.21 推奨**: `customer_reservation_tokens` (Phase 4 顧客本人確認の中核、state machine 寄り、`issueToken` / `verifyToken` / `revokeToken` 関数設計が新規)。代替推奨: `attachments` (Storage 外部依存ありで MVP 範囲を要相談)
3. **A.21 着手時の重要 task**:
   - customer_reservation_tokens: spec の本人確認 flow / token hash 方式 (crypto.randomBytes + sha256 推奨) / TTL / 失効方針 (single-use vs N-use) / verify 時の rate limit 要否を最初に整理
   - state machine 寄りなので per-row CRUD canonical だけでは不足、`issueToken(reservationId, email)` → `verifyToken(token, email)` → `revokeToken(id)` の use-case 関数を設計
4. canonical mirror 状況 (A.20 で 12 種類カバー、master 系で行ける範囲ほぼ完):
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 単純 CRUD without UNIQUE → `vendors.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete (deletedAt なし、FK SET NULL or 子なし) → `lane-types.ts` / `work-categories.ts` / `vendor-sla-overrides.ts` / `vendor-service-areas.ts`
   - hard delete + FK 違反 wrap (子テーブル参照中) → `statuses.ts`
   - hard delete + leftJoin で関連 name 取得 + nullable FK 許容 → `status-transitions.ts`
   - hard delete + 二重ガード (is_system + companyId NULL) + system seed 行のクロステナント可視性 → `roles.ts`
   - hard delete + 親 role ownership 検証 + leftJoin で role 名取得 + system seed の可視性 (操作不可) → `permissions.ts`
   - **hard delete + 複合 UNIQUE(4 列) + Zod enum 値域強制 + nullable optional int refine → `notification-rules.ts` (A.20 新規 canonical)**
   - M:N 関連 (full diff replace) → `lane-work-menus.ts` / `vendor-available-stores.ts`
   - 親 1:N サブ (full-replace, UNIQUE 有) → `lane-working-hours.ts` / `store-business-hours.ts`
   - 親 1:N サブ (per-row CRUD with UNIQUE) → `store-holidays.ts` / `vendor-sla-overrides.ts`
   - 親 1:N サブ (per-row CRUD with ends_on=NULL 排他) → `vehicle-ownerships.ts`
   - 親 1:N サブ (full-replace, UNIQUE 不在 → wipe + bulk insert) → `vendor-available-days.ts`
   - 親 1:N サブ (per-row CRUD without UNIQUE, 重複許容) → `vendor-service-areas.ts`
5. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定

### 想定規模 (Phase 64-A.21 例: customer_reservation_tokens)

| 指標 | 値 |
|---|---|
| 新規ファイル | 1 service + 1 test + (UI 0-3) = 2-5 files (UI は token 発行/検証は admin UI ではなくシステム側 use-case の可能性) |
| 想定行数 | 300-500 |
| 想定 tests 追加 | 6-10 ケース (issueToken / verifyToken happy / verifyToken expired / verifyToken wrong email / revokeToken / Zod / cross-tenant / single-use) |
| 完了後 tests 合計 | 379+ |
| 仕様判断量 | **中-高** (token 方式 / TTL / 失効方針 / verify rate limit の仕様確定が必要、master 系より複雑) |

### 注意点

- customer_reservation_tokens は per-row CRUD canonical だけでは不足、use-case 関数設計が主軸
- attachments を選ぶ場合は Supabase Storage 連携でローカル test が困難 (mock 設計が必要)、MVP 後送り推奨
- spec / raw-migration / drizzle の 3 点突合継続 (handoff §146 推奨)
- 仕様判断量「中-高」なので Codex 委任前に Claude が仕様を確定させてから委任 (handoff §2.0)
- 残 MVP blocker 2 件で master 系 phase は実質完了、A.21 以降は Phase 4 統合に踏み込む節目

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.20 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 5 新規 UI (page + new/page + new/actions + [id]/page + [id]/actions) + 1 新規 test + 1 sealed = **8 files** |
| 新規 service 関数 | 5 (list/create/update/delete/getById) + 1 error class (Conflict) + 1 helper (selectListColumns) + 1 helper (isUniqueViolation) |
| advisor 呼び出し | 0 (stores canonical + enum 値域強制 + hard delete pattern 既知のため直接実装) |
| Codex 委任 task 数 | 0 (handoff §76 推奨でスキップ) |
| Codex 採用率 | 0/0 (A.20 単体)、累積 1/20 (A.1-A.20) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.20 試行なし) |
| 新規 tests | 8 cases / 約 280 行 (per-row CRUD + UNIQUE 衝突 + cross-tenant + 4 種フィルタ + Zod 4 種無効値 + nullable 3 列 null 設定/クリア) |
| invariants 維持 | typecheck clean / 373 tests / 46 test files |
| MVP blocker 消化 | 累積 22/24 (A.1-A.19 + notification_rules) |

## 振り返りメモ (notification_rules 完了を経て)

- **Zod enum 値域強制 canonical の確立**: DDL CHECK 制約と service 層 `z.enum()` の二重防御 pattern。`as const tuple` から `z.enum(TUPLE)` 構築する idiom が child master 系で再利用可能 (今後 attachments の mime_type 値域等で流用)
- **複合 UNIQUE(4 列) の衝突 wrap**: stores.ts の `isUniqueViolation()` + `XxxConflictError(...keys)` pattern が単一列 UNIQUE と全く同じ形で動く。drizzle の constraint 名取得不要、PostgreSQL error code 23505 で判定で十分
- **任意 int 3 列の Zod refine 流用性**: `optionalInt.refine((v) => v === undefined || v === null || v >= 0, ...)` の idiom が他 master 系の数値値域チェックで再利用可能
- **drift ゼロ確認の効果**: spec § / DDL / drizzle 完全一致時は実装が最短ルート (advisor 呼び出し不要)。逆に drift がある permissions ケースでは DB 真実採用判断が必要だった
- **新セッション 1 ターン完遂継続**: A.3-A.20 で 18 連続 1 ターン完遂、handoff の効果実証継続中。
- **master 系の出尽くし感**: 12 種類の canonical をカバーし、残 MVP blocker 2 件 (token / attachments) は state machine / 外部依存ありで master 系 phase は実質完了

## /clear 推奨タイミング (本 Phase 完了時)

**本 Phase A.20 完遂後、`/clear` 推奨を発出**。理由:
- notification_rules で master 系 12 種類完遂、A.21 では customer_reservation_tokens (state machine) もしくは attachments (Storage) で性質が大きく変わる
- master CRUD canonical 12 種類が確立、新セッションは canonical 参照と新 pattern (token / Storage) 設計に集中できる文脈刷新が望ましい
- 本セッション (A.20 単独 1 ターン完遂) はコンテキスト累積少だが、次 domain (Phase 4 統合) 移行で刷新推奨

新セッション開始時: `phase-64-a20-notification-rules-sealed.md` を読んで Phase 64-A.21 着手。

---

*Phase 64-A.20 sealed / Generated by Claude 2026-05-28 / 次セッション: Phase 64-A.21 (推奨: customer_reservation_tokens で Phase 4 顧客本人確認に着手、代替: attachments、本 branch `phase-64-mvp-implementation` 継続)*
