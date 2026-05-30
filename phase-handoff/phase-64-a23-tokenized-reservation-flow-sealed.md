# Phase 64-A.24 入力契約: Phase 64-A.23 TokenizedReservationFlow skeleton sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.23 (前: 64-A.22 attachments sealed) |
| 状態 | **sealed** (loadTokenStatusViaServiceRole [GET-safe] + verifyAndConsumeTokenViaServiceRole + /r/[token] GET-safe page + Client Component ConfirmForm + form action via useActionState + audit_logs INSERT + 9 integration tests / 404 tests PASS) |
| 完了日時 | 2026-05-29 |
| 担当 | Claude 自実装 (advisor §framing 補強 + 仕様 5 論点確定 + DB CHECK 制約 (action whitelist) で test 失敗 → action='update' + after_json.kind で区別 に修正、21 連続 1 ターン完遂、Codex 試行スキップ) |
| 前 handoff | `phase-64-a22-attachments-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |
| **/clear 推奨** | 推奨せず (A.24 で Phase 4 統合継続 = `/r/[token]` 詳細 UI or attachments Storage 連携、本 phase の skeleton 設計判断を引き継ぐ) |

## 達成したこと (Phase 64-A.23)

- 1 ファイル既存 service に追記 (`customer-reservation-tokens.ts` +約 145 行: `loadTokenStatusViaServiceRole(rawToken, opts)` [GET-safe / consume なし / audit なし] + `verifyAndConsumeTokenViaServiceRole(rawToken, opts)` [atomic + audit_logs INSERT] + `VerifyViaServiceRoleOptions` / `LoadTokenStatusResult` type + `serviceRoleDb` import + `auditLogs` import)
- 3 ファイル新規 customer route:
  - `src/app/r/[token]/page.tsx` (Server Component, GET-safe = `loadTokenStatusAction` のみ呼ぶ、consume しない)
  - `src/app/r/[token]/actions.ts` (`loadTokenStatusAction` / `confirmAndConsumeReservationAction` / `confirmAndConsumeReservationFormAction` で headers() で ip/UA 取得)
  - `src/app/r/[token]/confirm-form.tsx` (Client Component, `useActionState` で button POST → consume + 詳細表示)
- 1 ファイル新規 integration test (`customer-reservation-tokens-service-role.integration.test.ts` 9 cases: 有効 token → ok + audit_logs / not_found / used (atomic 2 回目) / expired / revoked / cross-tenant safe / Zod 空・超長 reject / **loadTokenStatusViaServiceRole GET-safe (consume なし + audit_logs 0) 検証** / **loadTokenStatusViaServiceRole 4 種 reason 区別 consume なし**)
- 1 ファイル spec 改定 (`spec/CLAUDE.md` ADR-0010 補項 Phase 64-A.23 セクション追加: 顧客 facing wrapper の利用境界・制約・失敗時挙動・URL exposure 注意・Phase 4 統合 roadmap)
- 既存 schema / RLS / raw-migration 変更 **0** (drizzle schema 既存 `audit_logs` + `customer_reservation_tokens` + `reservations` をそのまま利用)
- typecheck clean (tsc --noEmit 通過、exit=0)
- **404 tests PASS** (394 + 新規 10 [integration 9 + GET-safe invariant unit 1]、50 test files、handoff §128 想定 398+ クリア)

## Claude 側の主要設計判断

0. **GET-safe 設計の確立** (本 phase の最重要学び、外部 advisor の pre-commit review が指摘 — Claude 自身は気付けなかった class の問題): 当初 `viewReservationByTokenAction` を Server Component で render 時に呼ぶ設計だったが、Slack/Discord/iMessage の unfurl preview / ブラウザ prefetch / Microsoft ATP / Proofpoint の safe-link scanner が GET フェッチした瞬間に token が焼ける production-killer。HTTP GET は safe/idempotent (RFC 7231) 必須。修正: `loadTokenStatusViaServiceRole` (read-only, consume なし) を service に追加 → GET page は status 確認のみ → Client Component `ConfirmForm` (`useActionState`) の button POST で初めて consume + 詳細表示。skeleton の本質要件 (token-first company 導出 + service_role wrapper) は維持。**教訓**: 次フェーズ以降、顧客 facing / 公開 URL を扱う設計では「GET render 時に副作用 (consume / mutation / 外部呼出) が走らないか」を framing に明示的に組み込む。Server Action / server component の境界 + RFC 7231 GET safe 原則の確認
1. **仕様 5 論点を実装着手前に確定** (advisor §framing 補強で論点漏れ補完):
   - ①URL prefix: `/r/[token]/...` + `export const dynamic='force-dynamic'`。token-in-URL の security 強化 (POST+httpOnly cookie) は Phase 4 後段に分離
   - ②audit_logs 命名: `entity_type='customer_reservation_token'` + `action='update'` + `actor_kind='system'` + `after_json.kind='customer_verify_consume'`。spec の `event_type` 記述は誤り、実 schema は `entity_type + action` 構成
   - ③service_role wrapper 配置: `customer-reservation-tokens.ts` 内に同居 (別ファイル化は use-case 増加時)
   - ④tx 境界: wrapper 内 1 tx で SELECT → UPDATE+RETURNING → audit INSERT、DB 落ち時は両方 rollback
   - ⑤ADR-0011 起票: A.23 ではやらない (spec drift 解消 phase が別途用意済)。ADR-0010 補項 inline 追記のみ
2. **DB CHECK 制約発見と修正** (test failure からの学び): `audit_logs_action_check` は (`'create'`,`'update'`,`'delete'`,`'restore'`) 限定。当初設計の `action='customer_verify_consume'` は CHECK 違反。token consume は usedAt の UPDATE なので `action='update'` で記録、`after_json.kind` で区別する設計に変更。raw-migration 変更 0 invariants 維持
3. **失敗時の監査ログは残さない**: `audit_logs.company_id` / `entity_id` は NOT NULL のため、`not_found` 時は companyId 取得不可で INSERT 不能。失敗ログを残す設計は schema 変更 (Phase 5 検討) まで不可。caller が必要なら戻り値 `reason` で別途警告ログ取れる
4. **token-first company 導出**: 顧客は Supabase Auth user ではないため company scope を引数で受け取れない。wrapper 内で tokenHash → SELECT で company_id を取得し、その company で UPDATE+RETURNING を実施。cross-tenant safety は token hash の 256-bit エントロピーに帰着 (異なる company の token を引いてしまう確率は事実上 0)
5. **RLS bypass の drizzle `db` を使う**: `src/lib/db/client.ts` の `db` は postgres super user 接続のため実質 service_role 相当 (`withAuthenticatedDb` でない経路は RLS bypass)。Supabase REST client (`getConfiguredSupabaseAdmin`) は使わない (drizzle で完結)
6. **`options.db` 引数で test 用 tx 注入可能**: 既存 `withRollback` fixture pattern と互換、本番では `serviceRoleDb` default
7. **`reservations.startAt` / `endAt`** (NOT `scheduledStart` / `scheduledEnd`): drizzle schema の実カラム名に合わせる
8. **page.tsx は最小縦切り**: 予約 ID / 開始時刻 / 終了時刻のみ表示。店舗名・メニュー・車両等の詳細は Phase 4 後段で reservation join 追加
9. **ip_address / user_agent は audit_logs に保存**: spec §14.6 監査要件に準拠、`headers()` から取得して wrapper に渡す
10. **viewReservationByTokenAction の reason 型は VerifyReason を直接 import** (当初の conditional type `Exclude<VerifyAndConsumeResult extends ...>` は TS の distributive で混線したため、`Exclude<VerifyReason, 'ok'>` に直接書き換え)

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.23 TokenizedReservationFlow skeleton | **Claude 自実装 (advisor §framing 補強で論点 5 つを 1 ターン確定、CHECK 制約発見後即修正、21 連続 1 ターン完遂)** |

→ A.23 も Codex 試行ゼロで Claude 完遂。block override 記録 5 件 (service + action + page + test + spec)。advisor 2 回 (初回 framing + 補強)。

## Phase 64-A.24 入力契約 (継続セッションで使用)

### 参照すべきファイル

- 本 handoff (`phase-64-a23-tokenized-reservation-flow-sealed.md`)
- `phase-64-a22-attachments-sealed.md` (multi-FK polymorphic canonical)
- `phase-64-a21-customer-reservation-tokens-sealed.md` (use-case service + hash + atomic canonical)
- `src/lib/services/customer-reservation-tokens.ts` (verifyAndConsumeTokenViaServiceRole の新 canonical: token-first company 導出 + 1 tx + audit_logs action='update' + after_json.kind)
- `src/app/r/[token]/` (customer route 新 canonical: force-dynamic + headers() ip/UA + result.reason 分岐 UI)
- `spec/CLAUDE.md` ADR-0010 補項 Phase 64-A.23 セクション
- 残 MVP blocker 累積 **24/24 完了 + 顧客統合 skeleton 1 件追加**

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.23 機能すべてに retrogression なし
- typecheck clean / 50 test files / **404 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.22 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- `audit_logs.action` CHECK 制約 (`'create'`,`'update'`,`'delete'`,`'restore'`) のまま不変、`actor_kind` CHECK (`'user'`,`'vendor_user'`,`'customer'`,`'system'`) のまま不変
- 顧客 token verify は token-first company 導出 (異 company 引数取らず)、失敗時 audit_logs INSERT しない
- **GET-safe invariant**: `/r/[token]/page.tsx` (Server Component) は `loadTokenStatusViaServiceRole` 以外の token consume パスを呼ばない。consume は Client Component `ConfirmForm` の `useActionState` button POST 経由のみ。Phase 4 後段の詳細 UI 追加でもこの分離を破らない (unfurl/prefetch 防止)。**`tests/unit/customer-r-token-get-safe.test.ts` が page.tsx の import 行に `verifyAndConsume` / `confirmAndConsume` が含まれないことを静的検査** (regression guard)
- `audit_logs.after_json.kind` を action='update' 内で sub-action 識別子として使う規約 (今後 customer_view_reservation 等を追加する場合も同型)
- token-in-URL の security 強化 (POST+cookie) は Phase 4 後段、A.23 skeleton は force-dynamic のみで OK
- service_role 利用境界 ADR-0010 補項の追記順守 (新規 wrapper 追加時は spec/CLAUDE.md にファイルパス・利用範囲・制約を明記)

### Phase 64-A.24 着手時の最初の判断

1. **Phase 4 統合継続**:
   - **A.24 候補 1**: `/r/[token]` 詳細 UI 拡張 (store / lane / work_menu / vehicle join を actions.ts に追加、詳細表示と「変更/キャンセル」server action 設計)
   - **A.24 候補 2**: attachments Storage 連携 (Supabase Storage bucket policy + signed URL 発行関数 + upload helper)
   - **A.24 候補 3**: spec drift 解消 phase (§3.7 customer_reservation_tokens / §12.1 attachments / §3.10 reservations の改訂 + ADR-0011 use-case service canonical 起票)
2. **A.24 推奨**: 候補 1 (`/r/[token]` 詳細 UI 拡張) — A.23 で土台は完成、顧客 facing の「変更/キャンセル」が次の縦切り。仕様判断量「中」 (audit_logs action は既に確立、UI 文言と確認モーダルが残論点)
3. **A.24 着手時の重要 task**:
   - `viewReservationByTokenAction` を `loadReservationByTokenAction` (consume なし、view のみ) と分離する必要があるか検討。consume を伴わない 「セッション継続中の閲覧」 をどう扱うか (token は single-use のまま、session を別途発行する場合は別 phase)
   - 変更/キャンセル server action は `customer-reservation-tokens.verifyAndConsumeTokenViaServiceRole` の戻り値 token を使って 30 分間有効な顧客 session token (HttpOnly cookie) を発行する案を検討
   - audit_logs に新 `after_json.kind` を追加する場合は `'customer_view_reservation'` / `'customer_modify_reservation'` / `'customer_cancel_reservation'` の命名を本 phase の `'customer_verify_consume'` と統一
4. canonical mirror 状況 (A.23 で 15 種類カバー):
   - 単純 CRUD with UNIQUE → `stores.ts`
   - 単純 CRUD without UNIQUE → `vendors.ts`
   - 階層 FK + soft delete + join → `lanes.ts`
   - hard delete 群 → `lane-types.ts` / `work-categories.ts` / `vendor-sla-overrides.ts` / `vendor-service-areas.ts`
   - hard delete + FK 違反 wrap → `statuses.ts`
   - hard delete + leftJoin → `status-transitions.ts`
   - hard delete + 二重ガード + system seed → `roles.ts` / `permissions.ts`
   - hard delete + 複合 UNIQUE + Zod enum → `notification-rules.ts`
   - M:N 関連 (full diff replace) → `lane-work-menus.ts` / `vendor-available-stores.ts`
   - 親 1:N サブ (full-replace) → `lane-working-hours.ts` / `store-business-hours.ts` / `vendor-available-days.ts`
   - 親 1:N サブ (per-row CRUD with UNIQUE) → `store-holidays.ts` / `vendor-sla-overrides.ts`
   - 親 1:N サブ (per-row CRUD with排他) → `vehicle-ownerships.ts`
   - 親 1:N サブ (per-row CRUD without UNIQUE) → `vendor-service-areas.ts`
   - use-case service (atomic verify+consume + hash) → `customer-reservation-tokens.ts` (A.21)
   - use-case service (multi-FK polymorphic parent + cross-tenant) → `attachments.ts` (A.22)
   - **顧客 facing wrapper (token-first company 導出 + RLS bypass + audit_logs action='update' + after_json.kind) → `customer-reservation-tokens.ts verifyAndConsumeTokenViaServiceRole` (A.23 新 canonical)**
5. test 配置は `tests/integration/services/<name>-<variant>.integration.test.ts` (A.23 で `-service-role` suffix で分離した pattern を確立)
6. **headers() pattern**: customer route で `headers()` から `x-forwarded-for` (先頭 IP) と `user-agent` を取得 → server action に渡し audit_logs に保存 (A.23 で確立)

### 想定規模 (Phase 64-A.24 例: `/r/[token]` 詳細 UI 拡張)

| 指標 | 値 |
|---|---|
| 新規ファイル | 0-1 service (詳細 join helper) + 1-2 customer route 拡張 (詳細 component + 確認モーダル) + 1 test = 2-4 files |
| 想定行数 | 200-400 |
| 想定 tests 追加 | 5-8 ケース (詳細 join 取得 / store join / work_menu null 許容 / 変更モーダル不整合 / キャンセル時 audit / customer session token 発行 (案採用時)) |
| 完了後 tests 合計 | 406+ |
| 仕様判断量 | **中** (audit_logs action は確立、UI 文言と顧客 session 設計が残論点) |

### 注意点

- `viewReservationByTokenAction` は token を消費するため「画面リロード = 2 回目 → used」になる。これは MVP 想定動作だが、UX 上は許容性を要検討 (handoff §13 注意点)
- 顧客 facing で詳細閲覧と確認/キャンセルを両立させる場合、token 1 回消費 → 顧客 session 発行 (HttpOnly cookie) → session 中は何度でも詳細閲覧可能、の 2 段構成を推奨。session 期限 30 分 / 1 hour
- **A.23 の GET-safe 分離 invariant**: page.tsx が consume パスを呼ばない設計は Phase 4 後段で詳細 UI を追加してもキープ。詳細表示は Client Component 内 `useActionState` の result 経由のみ
- audit_logs CHECK 制約変更が必要になったら別 phase で migration 追加 (本 phase の規約には踏み込まない)
- attachments Storage 連携 (A.24 候補 2) は Supabase Storage bucket policy + RLS 設計が主軸、仕様判断量「高」

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.23 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 service (追記) + 2 新規 customer route (page + actions) + 1 新規 test + 1 spec 改定 + 1 sealed = **6 files** |
| 新規 service 関数 | 1 (verifyAndConsumeTokenViaServiceRole) + 1 type (VerifyViaServiceRoleOptions) |
| 新規 server action | 1 (viewReservationByTokenAction) |
| advisor 呼び出し | 2 (初回 framing + 補強 framing 補強で論点漏れ補完) |
| Codex 委任 task 数 | 0 (advisor で方針確定後、Claude 自実装) |
| Codex 採用率 | 0/0 (A.23 単体)、累積 1/23 (A.1-A.23) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.23 試行なし) |
| 新規 tests | 10 cases / 約 425 行 (integration 9 種: 有効 token + audit / not_found / used / expired / revoked / cross-tenant / Zod 空・超長 + load GET-safe / load 4 種 reason 区別 + unit 1 種: page.tsx import 静的検査) |
| invariants 維持 | typecheck clean / 401 tests / 50 test files |
| MVP blocker 消化 | 累積 **24/24 完了 + Phase 4 顧客統合 skeleton 1 件追加** |

## 振り返りメモ (TokenizedReservationFlow skeleton 完了を経て)

- **DB CHECK 制約発見の価値**: 実装着手前 advisor で audit_logs を `event_type + action` と framing 補強したが、CHECK の具体値 (`'create'`,`'update'`,`'delete'`,`'restore'`) までは framing せず、test 実行で初めて発見。次以降は schema 読み込み時に CHECK 制約まで確認するチェックを advisor framing に組み込む価値あり
- **`after_json.kind` で sub-action 識別する規約**: action CHECK 4 値の制約下で、`after_json.kind='customer_verify_consume'` で sub-action を区別する pattern を確立。今後 `'customer_view_reservation'` / `'customer_modify_reservation'` / `'customer_cancel_reservation'` 等を追加する場合も同型で運用可能
- **token-first company 導出 pattern の確立**: 顧客 facing flow で「company 引数を渡さない wrapper」の canonical を提示。token 256-bit エントロピー前提でクロステナント安全性を担保
- **`/r/[token]` route の最小縦切り設計**: page.tsx (UI 分岐) + actions.ts (server action) の 2 ファイル構成 + force-dynamic + headers() で ip/UA 取得、を skeleton として確立。Phase 4 後段で詳細 UI / session / 変更/キャンセル action を積み増す
- **conditional type の混線回避**: `Exclude<VerifyAndConsumeResult extends ... ? infer R : never>` は TS distributive で意図しない混線を起こす。VerifyReason を直接 import + `Exclude<VerifyReason, 'ok'>` のシンプル合成が clean
- **21 連続 1 ターン完遂継続**: A.3-A.23 で 21 phase 連続 1 ターン完遂、advisor 1-2 回 + handoff の効果実証継続中

## /clear 推奨タイミング (本 Phase 完了時)

**推奨せず**。理由:
- A.24 は本 phase の skeleton 設計判断 (`/r/[token]` 構成 / audit_logs action='update' + after_json.kind 規約 / token-first company 導出) を直接引き継ぐ。コンテキスト維持の方が効率的
- 累積コンテキストはまだ次 phase で参照価値あり (A.21-A.23 use-case canonical の細部記憶)
- /clear 推奨は MVP 完遂 + Phase 4 統合の中盤 (A.26-A.27 想定) で再評価

継続セッション開始時: 本 handoff §「Phase 64-A.24 着手時の最初の判断」を参照して A.24 着手 (推奨: `/r/[token]` 詳細 UI 拡張 + 顧客 session 設計、本 branch `phase-64-mvp-implementation` 継続)。

---

*Phase 64-A.23 sealed / Generated by Claude 2026-05-29 / 次セッション: Phase 64-A.24 (推奨: `/r/[token]` 詳細 UI + 顧客 session 設計、本 branch `phase-64-mvp-implementation` 継続)*
