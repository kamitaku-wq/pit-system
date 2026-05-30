# Phase 64-A.31a public availability read surface (顧客公開予約フロー step1-3 server コア) sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-A.31a (前: A.30 reservation availability engine) |
| 状態 | **sealed** (公開 read surface + lane 集約 + GET slots route / 460 tests PASS / build green) |
| 担当 | Claude (advisor 3 回: 着手前設計 + ユーザー判断 3 点 + #1/#5 adversarial gate、自実装) |
| Branch | `phase-64-mvp-implementation` |
| **/clear 推奨** | **強く推奨** (A.31b = multi-step UI + POST gate→create。UI 実装は既存 admin パターン直接、fresh context 望ましい) |

## スコープ判断 (ユーザー判断で確定)

A.30 handoff は「A.31 = 顧客予約フロー UI + 公開 route」と広く括っていたが、ユーザー判断で **A.31a (server コア) / A.31b (UI + POST)** に分割した (A.30 を分割したのと同じ理由):

- **A.31a (本 phase)** = lane 集約 service + 公開 stores/menus 列挙 + GET slots route + integration tests。**server・UI 非依存・完全テスト可**。
- **A.31b (次)** = multi-step UI (step1-5) + POST gate→create 配線。UI は既存 admin パターン (素の Tailwind input、`button`/`card`) で直接実装 (ユーザー判断: モックフロー不使用)。

ユーザー判断 3 点:
1. スコープ → A.31a/A.31b 分割
2. `visible_to_customers` → 列を今追加 (migration あり)
3. UI 手法 → 既存 admin パターンで直接実装 (Codex Image モックフロー不使用)

## 達成したこと

spec/requirements.md §12.1 step1-3 (店舗→メニュー→空き日時) の公開 (匿名) read surface を実装。顧客は lane を選ばないため、A.30 の per-lane エンジン上に lane 集約レイヤを積んだ。

- **migration** `post/0024_work_menus_visible_to_customers.sql` (新規): `work_menus.visible_to_customers boolean NOT NULL DEFAULT false` を冪等追加。data-model §5.6 が既に列を規定済み (spec 先行) のため drift 解消方向。既定 false = opt-in 可視性 (既存 seed メニューは false backfill = 非公開 = fail-safe)。drizzle `work_menus.ts` にも `visibleToCustomers` 追加。`pnpm db:apply-raw:post` で適用済み。
- **service** `src/lib/services/customer-reservation-public.ts` (新規):
  - `listPublicStores(companyId)` — active/not-deleted 店舗 (name 昇順)。company inactive/不在 → `company_not_found`。
  - `listPublicWorkMenus(companyId, storeId)` — `visible_to_customers=true` かつ「その店舗の active lane が `lane_work_menus` で提供可能」なメニューのみ (dead-end メニュー除外)。`selectDistinct` で重複 collapse。
  - `listAvailableSlotsForStoreMenu({companyId, storeId, workMenuId, date})` — 候補 lane (`lanes.store_id` ∧ active ∧ not-deleted ⋈ `lane_work_menus.workMenuId`) を列挙し、各 lane に A.30 `listAvailableSlots` を呼んで union。各 slot を具体的 `laneId` に bind、同一時刻が複数 lane で空くと**決定論的に最小 laneId へ collapse** (gate→create の同一性を保つ鍵)。
  - **テナント境界**: 公開 URL の `companyId` (UUID) が唯一の company scope。全 read で `companyId` と store/menu/lane の `company_id` 一致を検証 (URL 改竄防御)。menu 可視性は slots でも独立検証 (非公開メニューの枠直取り防止、defense-in-depth)。
- **route** `src/app/r/reserve/[companyId]/slots/route.ts` (新規): GET = `?storeId=&workMenuId=&date=` を zod 検証し service へ委譲、`{ ok, slots: [{startAt, endAt, laneId}] }` を JSON 返却。`force-dynamic`、純 read (GET-safe、A.23 規律踏襲)。
- **tests** (+14) `tests/integration/services/customer-reservation-public.integration.test.ts` (新規):
  - listPublicStores 4: active/inactive/deleted filter + name 昇順 / cross-tenant (他社店舗非漏洩) / company inactive → company_not_found / malformed UUID → company_not_found
  - listPublicWorkMenus 3: visible+linked のみ (非公開・dead-end 除外) / inactive・deleted menu 除外 / cross-tenant store → store_not_found
  - listAvailableSlotsForStoreMenu 7: 単一 lane bind (17 枠) / 2 lane union + 重複 collapse to min laneId / **既存予約で塞いだ lane の時刻を空き lane に bind して surface** (slot→laneId bind) / cross-tenant companyId 不一致 → store_not_found / 非公開 menu → work_menu_not_found (defense-in-depth) / 提供 lane なし → 空 / company inactive → company_not_found
- **spec drift 解消**: data-model §5.6 (work_menus 実装列 + visible_to_customers の A.31a 実装注記) + §10 (顧客公開 read surface + lane 集約の解説、GET route、A.31b 予告)。

## adversarial gate チェックリスト (#1 + #5 該当、advisor #1/#5 gate 実施済)

| # | 条件 | 該当する具体的変更 |
|---|---|---|
| 1 | raw-migration 変更 | **該当**: `post/0024` work_menus.visible_to_customers 列追加 (冪等・`NOT NULL DEFAULT false`・PG fast-default で table rewrite なし) |
| 2 | 新規署名鍵 / session 機構 | なし |
| 3 | 手書き RLS / Storage bucket policy 新規 | なし |
| 4 | 金銭計算 / billing | なし (price_minor は read 返却のみ、計算なし) |
| 5 | 既存 canonical 外の cross-tenant boundary | **該当**: 匿名公開 read surface (stores/menus/slots)。URL companyId が唯一 scope の新 surface |

→ #1/#5 gate: advisor 敵対的パス (enumerate cross-tenant / GET-safety / auth-bypass) で **クリーン判定**。
- cross-tenant: company-active → store.companyId==companyId → menu.companyId==companyId(+visible) → 候補 lane を companyId∧storeId で filter の全段検証。`listAvailableSlots` の store-first company 導出は store を先に ==companyId 検証済みのため一致。cross-company link 行があっても両 filter を同時に満たせない。漏洩面なし。
- GET-safety: 純 SELECT (INSERT/UPDATE/audit ゼロ) → 構造的に GET-safe。
- auth-bypass: 設計上の匿名公開 read。返却は store 名/住所/電話 (公開連絡先)・menu 名/duration/price・時刻+laneId (opaque UUID)。個人 PII なし。
- migration: 既存行 false backfill = fail-safe、DEFAULT 保持で新規 insert も非公開側。

## invariants (A.31b で壊さない)

- typecheck clean / **460 tests PASS** (446 + 14) / **`pnpm build` green** (新 route `/r/reserve/[companyId]/slots` = ƒ Dynamic で登録、`/r/[token]` と共存)
- **gate→create は同一 laneId 必須 (最重要、A.30 invariant の具体化)**: picker (`listAvailableSlotsForStoreMenu`) が返す `{startAt, endAt, laneId}` を A.31b の UI はそのまま返送し、POST route は**その laneId** で `checkReservationSlotAvailable` → 同じ laneId で `createCustomerReservation` を呼ぶこと。集約値で gate して別 lane で create、が最大の罠。slot を laneId に bind したのはこのため。
- `listPublicWorkMenus` と `listAvailableSlotsForStoreMenu` は共に `lane_work_menus` ベースで候補 lane を導出し続けること (片方だけ別ロジックにすると「一覧に出るが枠が出ない」drift)。
- `visible_to_customers` 既定 false は維持 (opt-in 可視性、社内専用メニューの匿名漏洩防止)。
- 公開 read は `companyId` first 検証を全段で維持 (URL 改竄防御)。menu 可視性は slots でも独立検証。

## seal の誠実性 (advisor #5 gate 指摘、verdict は変えないが明記必須)

- **GET slots route handler はテストなしの薄い shim**。cross-tenant 保証は service 層テスト (14 件) に依存し、route は `pnpm build` 通過のみで検証 (route 整合・handler signature・server-only import chain)。「GET route 検証済み (実行テスト済み)」とは読まないこと。route の入出力テストは A.31b で UI/POST と併せて追加可。
- **GET slots route も A.33 (Turnstile + rate 制限、spec §12.3) まで production 露出禁止**。現状は live・unauth・N+1 (候補 lane 数分 `listAvailableSlots`)・rate-limit なし。POST だけでなく GET surface も同じ制約下にある。

## 記録された assumption / 既知ギャップ (A.31b/後続で訂正可能)

- **date regex ゆるさ**: `^\d{4}-\d{2}-\d{2}$` は `2026-13-45` 等の不正暦日を通す → 下流 `jstDateTimeToUtc` の挙動未定義。route で暦日妥当性を 400 にするのは A.31b で足せる。
- **dead-end store 非対称**: `listPublicStores` は active/not-deleted のみ列挙。`accepts_reservations` 営業時間ゼロの店舗も出る (menu は dead-end 除外したが store は未対称)。UX dead-end だが correctness 問題なし。
- **cross-company-menu + same-company-store の直接テスト未追加**: store 版 cross-tenant はテスト済みで filter は対称に存在。対称性のため 1 ケース足すと完全だが必須ではない (A.31b で追加可)。
- **N+1 クエリ**: lane 集約は候補 lane 数だけ `listAvailableSlots` を呼ぶ (各々が store/settings/windows/既存予約を再 SELECT)。店舗あたり lane 数が小さい MVP 前提。lane 数が増えたら共有 `computeDayWindows` を 1 回呼んで lane 横断で再利用する最適化余地あり。

## A.31b 着手時の選択肢 (推奨順)

- **A.31b = multi-step UI (step1-5) + POST gate→create 配線**: 公開ページ `/r/reserve/[companyId]` 等で店舗→メニュー→空き日時 picker (GET slots 消費) →顧客→車両を実装。UI は既存 admin の素 Tailwind パターン直接 (ユーザー判断)。POST = picker が返した laneId で `checkReservationSlotAvailable` → 同一 laneId で `createCustomerReservation` (本 phase 最重要 invariant)。route 入出力テスト + 公開ページの GET-safe テストも追加。
- **A.32 = email 6 桁コード検証 + 予約確定 (step6-7)**: create-on-confirm の認証 gate を `createCustomerReservation` 前に差し込む。
- **A.33 = 予約完了通知メール + Turnstile + rate 制限 (step8 + spec §12.3)**: GET/POST 公開 surface の production 露出解禁条件。

## メトリクス

| 指標 | 値 |
|---|---|
| commit | 本 seal 1 |
| 変更ファイル | migration 1 (新規) + drizzle schema 1 + service 1 (新規) + route 1 (新規) + test 1 (新規) + data-model 1 = 6 |
| 新規 tests | +14 → 460 (内 stores 4 / menus 3 / slots 集約 7) |
| advisor | 3 (着手前設計 1 + #1/#5 adversarial gate 1、+ 別途ユーザー判断 1 回) |
| ユーザー判断 | 3 (スコープ分割 / visible_to_customers 列追加 / UI 直接実装) |
| Codex 委任 | 0 (cross-tenant 境界 + gate→create invariant の設計密度高 / test は仕様解釈要のエッジケース設計、Claude 自実装。block override 2 件記録: service + test) |

*Phase 64-A.31a sealed / Generated by Claude 2026-05-29 / 次: A.31b (要 /clear。multi-step UI + POST gate→create 同一 laneId invariant、UI 既存 admin パターン直接)*
