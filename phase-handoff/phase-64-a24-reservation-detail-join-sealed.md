# Phase 64-A.25 入力契約: Phase 64-A.24 reservation detail join sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 64-A.24 (前: 64-A.23 TokenizedReservationFlow skeleton sealed) |
| 状態 | **sealed** (getReservationDetailViaServiceRole + cross-tenant filter in joins + confirm-form 詳細 6 種 UI + 4 integration tests / 408 tests PASS) |
| 完了日時 | 2026-05-29 (自律進行中、ユーザー就寝中) |
| 担当 | Claude 自実装 (advisor §A.24 framing + ガードレール (schema 事前確認 / cross-tenant join filter / read-only / 停止条件 / scope 規律) に従い完遂、22 連続 1 ターン完遂継続、Codex 試行スキップ) |
| 前 handoff | `phase-64-a23-tokenized-reservation-flow-sealed.md` |
| Branch | `phase-64-mvp-implementation` (継続、+1 commit 予定) |
| **/clear 推奨** | 推奨せず (A.25 で `A.24 候補 3` spec drift 解消 phase に進む or 顧客 session 設計をユーザー復帰時に確認、本 phase の詳細 join canonical を引き継ぐ) |

## 達成したこと (Phase 64-A.24)

- 1 ファイル新規 service (`customer-reservation-detail.ts` 約 195 行: `getReservationDetailViaServiceRole(reservationId, opts)` + `ReservationDetail` type + `GetReservationDetailOptions` type、cross-tenant filter を leftJoin の `AND <table>.company_id = <reservation.company_id>` に明示)
- 1 ファイル actions 拡張 (`src/app/r/[token]/actions.ts` ConfirmReservationByTokenResult を `reservation: {...}` から `detail: ReservationDetail` に拡張、consume 成功後に詳細 join 取得)
- 1 ファイル UI 拡張 (`src/app/r/[token]/confirm-form.tsx` 詳細 6 セクション render: 店舗 / レーン / メニュー / 車両 / 顧客 / ステータス + 備考、null 安全表示「—」)
- 1 ファイル新規 integration test (`customer-reservation-detail.integration.test.ts` 4 cases: 全 6 種 join 取得 / nullable FK null 許容 / reservation 存在しない / **cross-tenant safety: corrupt FK 2 種 (workMenu/vehicle/customer/status) + corrupt storeId が join filter で null に落ちる**)
- 既存 schema / RLS / raw-migration 変更 **0**
- typecheck clean (tsc --noEmit 通過、exit=0)
- **408 tests PASS** (404 + 新規 4、51 test files、advisor §目標値 408+ クリア)

## Claude 側の主要設計判断

1. **cross-tenant filter を join 条件に明示** (advisor §最重要ガードレール準拠): `getReservationDetailViaServiceRole` は RLS bypass のため、FK 制約は同 companyId を保証しない (raw migration ミスや手動 INSERT で漏洩する余地)。各 leftJoin に `AND <table>.company_id = <reservation.company_id>` を組み込み、corrupt FK 経由の cross-tenant 漏洩を test 1 ケースで固める (workMenu/vehicle/customer/status の corrupt FK + corrupt storeId 全 5 種が null に落ちることを assert)
2. **read-only / no audit** (advisor §ガードレール準拠): 詳細閲覧は consume を伴わず audit_logs INSERT もしない。consume は A.23 で確立した verifyAndConsumeTokenViaServiceRole の wrap で済ます。閲覧監査が必要になったら audit_logs.action CHECK 制約 (`'create'`,`'update'`,`'delete'`,`'restore'`) の範囲で `after_json.kind` 命名を増やす設計判断 → ユーザー判断待ちのため次 phase 持ち越し
3. **schema 事前確認** (advisor §schema 起因 typecheck 戻り予防): 実装前に Glob で stores/lanes/work_menus/vehicles/customers/statuses の field 名を一括確認 → `scheduledStart` vs `startAt` (A.23 で踏んだ class) の再発防止に成功。typecheck 1 発で通過
4. **戻り型を構造化** (`{ reservation, store, lane, workMenu, vehicle, customer, status }`): flat ではなく nested。Client Component の UI が section 単位で扱いやすい + nullable 判定が `detail.store !== null` で素直
5. **2 段 query 構成**: Step 1 reservation の companyId を取得 → Step 2 cross-tenant filter 付きの 6 join を 1 SQL。1 SQL 化 (subquery + AND companyId = (SELECT ...)) も検討したが drizzle で表現が複雑になるため、明示的な 2 step が読みやすく保守性が高い
6. **vehicle 表示は maker+model + registrationNumber を組み合わせ**: display helper `vehicleDisplay` を Client Component 側に置き、`Toyota Corolla (品川 300 あ 1234)` のような結合表示。全 null 時は `—` (advisor §中 stake UI 安全表示)
7. **A.24 scope 規律維持** (advisor §scope 規律準拠): 顧客 session / cookie 設計 → A.25+ 持ち越し / attachments Storage 連携 → A.25+ 候補 2 / 変更/キャンセル server action → A.25+ / PR 作成 → ユーザー復帰時。詳細 join + UI 拡張のみで scope 限定
8. **`statuses.statusType='reservation'` 固定**: A.24 test fixture で reservation 用 status を seed する際、CHECK 制約 (`statuses_status_type_check IN ('reservation', 'service', 'transport', 'vendor')`) に合わせる
9. **`workMenus.code` notNull / `lanes.code` nullable**: schema の field NOT NULL 差を test fixture に正しく反映 (workMenus は `code` を必ず指定)

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| (なし) | A.24 reservation detail join + UI 拡張 | **Claude 自実装 (advisor §A.24 framing + ガードレール準拠、schema 事前確認で 1 発 typecheck 通過、22 連続 1 ターン完遂継続)** |

→ A.24 も Codex 試行ゼロで Claude 完遂。block override 記録 4 件 (service + actions + UI + test)。advisor 1 回 (A.24 framing + ガードレール)。

## Phase 64-A.25 入力契約 (継続セッションで使用)

### 参照すべきファイル

- 本 handoff (`phase-64-a24-reservation-detail-join-sealed.md`)
- `phase-64-a23-tokenized-reservation-flow-sealed.md` (GET-safe + token-first company 導出 canonical)
- `phase-64-a22-attachments-sealed.md` (multi-FK polymorphic canonical)
- `src/lib/services/customer-reservation-detail.ts` (cross-tenant filter in leftJoin の新 canonical)
- `src/app/r/[token]/confirm-form.tsx` (consume 後の詳細表示 UI canonical)
- `spec/CLAUDE.md` ADR-0010 補項 Phase 64-A.23 セクション (顧客 facing 全体)
- 残 MVP blocker: 24/24 完了 + Phase 4 顧客統合 縦切り 2 件 (A.23 token verify + A.24 詳細表示) 完成

### 絶対に壊してはいけないもの (invariants)

- 既修正 33 bug/機能 + Phase 64-A.1〜A.24 機能すべてに retrogression なし
- typecheck clean / **51 test files / 408 tests PASS**
- CI E2E 7/7 PASS (未確認、commit 後 PR で確認)
- 既存 invariants 全件 (Phase 43-63a / 64-A.1-A.23 確定)
- Vercel staging URL live (`https://pit-system-jade.vercel.app/vendor/login` 200 維持)
- branch: `phase-64-mvp-implementation` (Phase 65 まで継続)
- **GET-safe invariant (A.23 確立)**: `/r/[token]/page.tsx` (Server Component) は token consume パスを import しない。`tests/unit/customer-r-token-get-safe.test.ts` が静的検査
- **cross-tenant filter in joins invariant (A.24 新規確立)**: 顧客 facing の service_role 経由 join では FK だけに頼らず、各 leftJoin 条件に `AND <table>.company_id = <reservation.company_id>` を明示。新規 join 追加時もこのパターンを守る
- audit_logs.action CHECK 制約 (`'create','update','delete','restore'`) 不変、`actor_kind` CHECK (`'user','vendor_user','customer','system'`) 不変
- 詳細 join は read-only / no audit (閲覧監査追加は仕様判断「中」、ユーザー確認後)

### Phase 64-A.25 着手時の最初の判断

1. **A.25 候補** (ユーザー復帰時の方針確認推奨):
   - **候補 1 (handoff 当初推奨)**: 顧客 session / cookie 設計 (consume 1 回 → HttpOnly cookie で 30 分 session → 同じ token で何度でも詳細閲覧可能)。仕様判断量「中-高」 (cookie scope / SameSite / 署名鍵 / DB session table vs stateless JWT)
   - **候補 2 (advisor §自律進行で許容)**: spec drift 解消 phase (§3.7 customer_reservation_tokens / §12.1 attachments / §3.10 reservations を DB 真実に追従)。仕様判断量「低」、純粋ドキュメント更新で自律進行に最適
   - **候補 3**: attachments Storage 連携 (Supabase Storage bucket policy + signed URL)。仕様判断量「高」
   - **候補 4**: 顧客 facing 変更/キャンセル server action (詳細閲覧後の next step)。session 設計と密結合のため候補 1 後
2. **自律進行で A.25 を選ぶなら**: 候補 2 (spec drift 解消) を推奨。session/Storage はユーザー判断待ち
3. **A.25 着手時の重要 task**:
   - 候補 2 採用なら: spec/data-model.md §3.7 / §3.10 / §12.1 を実 DDL に追従、`event_type` 等の誤記を訂正、A.23/A.24 で確立した canonical を反映、ADR-0011 (use-case service canonical) 起票検討
4. canonical mirror 状況 (A.24 で 16 種類カバー):
   - 単純 CRUD / hard delete 群 / M:N / 親 1:N 系 14 種 (A.1-A.20)
   - use-case service (atomic verify+consume + hash) → `customer-reservation-tokens.ts` (A.21)
   - use-case service (multi-FK polymorphic parent + cross-tenant) → `attachments.ts` (A.22)
   - 顧客 facing wrapper (token-first company 導出 + GET-safe + audit_logs action='update' + after_json.kind) → `customer-reservation-tokens.ts verifyAndConsumeTokenViaServiceRole` (A.23)
   - **顧客 facing read-only join (cross-tenant filter in leftJoin + 6 entity 構造化戻り型 + read-only) → `customer-reservation-detail.ts getReservationDetailViaServiceRole` (A.24 新 canonical)**
5. test 配置は `tests/integration/services/<name>.integration.test.ts` 固定
6. **cross-tenant join filter pattern**: 顧客 facing で新規 service_role 経由 join を追加する場合は `customer-reservation-detail.ts` の pattern (各 leftJoin の `AND <related>.company_id = <reservation.company_id>` 明示) を踏襲。corrupt fixture test で 1 ケース固める

### 想定規模 (Phase 64-A.25 候補別)

| 候補 | 新規ファイル | 想定行数 | tests | 仕様判断量 |
|---|---|---|---|---|
| 候補 1 (session 設計) | 2-3 service + 1-2 route + 2 test = 5-7 files | 350-600 | 6-10 | **中-高** |
| 候補 2 (spec drift 解消) | spec 3 files 改定 + 1 ADR 新規 = 4 files | 200-400 | 0 (doc only) | **低** |
| 候補 3 (Storage 連携) | 1-2 service + bucket policy + 2 test = 4-6 files | 300-500 | 5-8 | **高** |
| 候補 4 (変更/キャンセル) | 1-2 service + 1 route + 2 test = 4-5 files | 250-450 | 5-7 | **中** (session 完成後) |

### 注意点

- **session 設計 (候補 1)** は cookie 署名鍵が必要。`NEXTAUTH_SECRET` を新規導入 vs Supabase JWT 流用 vs `crypto.randomBytes` based opaque session の選択 → ユーザー判断推奨
- **Storage 連携 (候補 3)** は Supabase Storage bucket policy が主軸。RLS 設計が複雑、別 phase
- **A.24 でユーザー復帰時に確認推奨**: A.23 + A.24 の縦切り (token verify + 詳細表示) を実機で確認 (Vercel staging に push 後、`/r/[token]/...` 動作確認)
- 顧客 facing 詳細表示時、reservation の `serviceTicketId` も join するか (現状未取得) → 顧客本人に見せるべき内部情報か判断必要、A.25 で再考
- **token-in-URL の security 強化** (POST landing + cookie session) は候補 1 と密結合、それまで MVP は force-dynamic のみ

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 64-A.24 commit 数 | 1 予定 (本 seal commit) |
| 変更ファイル | 1 新規 service + 1 actions 拡張 + 1 UI 拡張 + 1 新規 test + 1 sealed = **5 files** |
| 新規 service 関数 | 1 (getReservationDetailViaServiceRole) + 1 type (ReservationDetail) + 1 type (GetReservationDetailOptions) |
| advisor 呼び出し | 1 (A.24 framing + ガードレール) |
| Codex 委任 task 数 | 0 (advisor で方針確定後、Claude 自実装) |
| Codex 採用率 | 0/0 (A.24 単体)、累積 1/24 (A.1-A.24) |
| sandbox-blocked | 累積 3 件 (A.2 までの記録、A.3-A.24 試行なし) |
| 新規 tests | 4 cases / 約 280 行 (全 6 種 join / nullable FK null / 存在しない / cross-tenant safety 2 種) |
| invariants 維持 | typecheck clean / 51 test files / 408 tests |
| MVP blocker 消化 | 累積 24/24 + Phase 4 顧客統合 縦切り 2 件 (A.23 token verify + A.24 詳細表示) 完成 |

## 振り返りメモ (詳細 join 完了を経て)

- **schema 事前確認の効果**: advisor §schema 起因 typecheck 戻り予防に従い、Glob で 6 schema を一括確認 (Read より cheap) → field 名 / nullable / CHECK 制約まで把握 → typecheck 1 発通過。A.23 で踏んだ `scheduledStart` vs `startAt` class を予防
- **cross-tenant filter in joins canonical**: app 層で FK を信用せず company_id を join 条件に明示する pattern を確立。Phase 5 billing / vendor_billings の polymorphic / 多階層 join でも再利用可能
- **2 段 query の保守性**: subquery で 1 SQL 化より 2 段の方が drizzle 表現が clean。読みやすさ優先
- **A.23 + A.24 で顧客 facing 縦切り 2 件**: token verify (A.23) + 詳細表示 (A.24) で MVP 顧客 facing の最小骨格完成。変更/キャンセル は session 設計 (A.25 候補 1) と密結合
- **22 連続 1 ターン完遂継続**: A.3-A.24 で 22 phase 連続 1 ターン完遂、advisor 1-2 回 + handoff + 自律進行の効果実証継続中
- **自律進行ガードレールの価値**: 停止条件 (schema 不一致 2 回 / cross-tenant test 漏れ / spec 触る範囲拡張 / typecheck 3 ラウンド戻り) を事前定義したことで、ユーザー復帰待ちなしで A.24 を完遂。深刻な判断が混入する候補 1 / 候補 3 は scope 外に明示

## /clear 推奨タイミング (本 Phase 完了時)

**推奨せず**。理由:
- A.25 は本 phase の cross-tenant filter pattern や顧客 facing canonical を引き継ぐ
- 候補 2 (spec drift 解消) なら spec 改定で別ドメインだが、context 維持の方が drift 範囲特定に有利
- /clear 推奨は MVP 完遂 + Phase 4 統合の中盤 (A.26-A.27 想定) で再評価

継続セッション開始時: 本 handoff §「Phase 64-A.25 着手時の最初の判断」を参照して候補選択 (自律進行なら候補 2 spec drift 解消推奨、ユーザー復帰時は候補 1 session 設計の方針確認推奨)。

---

*Phase 64-A.24 sealed / Generated by Claude 2026-05-29 (自律進行中) / 次セッション: Phase 64-A.25 (推奨: 候補 2 spec drift 解消 [自律進行] or 候補 1 session 設計 [ユーザー復帰時]、本 branch `phase-64-mvp-implementation` 継続)*
