# Phase 64-A.31b-1 public reservation write core (顧客公開予約 確定 server コア) sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-A.31b-1 (前: A.31a public availability read surface) |
| 状態 | **sealed** (createPublicReservation wrapper + POST/GET 2 route + 完全 service テスト / 484 tests PASS / build green) |
| 担当 | Claude (advisor 2 回: 着手前設計 + #5 adversarial gate、自実装。block override 4 件記録) |
| Branch | `phase-64-mvp-implementation` |
| **/clear 推奨** | **強く推奨** (A.31b-2 = multi-step wizard UI。UI 実装は既存 admin パターン直接、fresh context 望ましい) |

## スコープ判断 (ユーザー判断で確定)

A.31a handoff は「A.31b = multi-step UI + POST gate→create」と 1 単位で予告していたが、advisor 敵対的レビューで **POST path に重大な境界穴**が判明 (後述) し、ユーザー判断で **A.31b-1 (server コア) / A.31b-2 (UI)** に分割した (A.30→A.31a/b と同型、リスクが集中する write 境界を先にテストで固める)。

- **A.31b-1 (本 phase)** = `createPublicReservation` wrapper (境界チェック→gate→create) + POST/GET 2 route + 完全 service テスト + #5 adversarial gate。**server・UI 非依存・完全テスト可**。
- **A.31b-2 (次)** = multi-step wizard UI (step1-5、店舗→メニュー→空き日時 picker→顧客→車両)。UI は既存 admin パターン直接 (ユーザー判断、A.31a で確定済み)。

## 達成したこと: gate→create だけでは塞げない write 境界穴を service 層で塞いだ

advisor #5 adversarial gate で判明した核心: **A.31a の GET surface が守るテナント/可視性境界は POST path の gate→create に転送されない**。`checkReservationSlotAvailable` (gate) も `createCustomerReservation` (create) も store-first で company を導出し、以下を検証しない:

1. **`visible_to_customers`** — どちらも未検証 → 非公開 (社内専用) メニューを直接 POST で予約できる穴。
2. **URL `companyId`** — 両者とも store から company 導出し URL companyId を無視 → 別会社の store を他社 URL で POST しても通る。
3. **lane↔store 所属** — gate の `resolveContext` は lane↔company のみ検証、lane↔store は未検証 → 同一 company の別店舗 lane を bind 可能 (picker は `lanes.storeId==storeId` で絞るのに)。
4. **`workMenuId` optional** — create で省略するとメニュー検証ごとスキップ → 公開 path で必須化が必要。

### 実装 (変更ファイル 6)

- **service** `src/lib/services/customer-reservation-public.ts` (A.31a read surface に co-locate、+write orchestration):
  - `resolvePublicReservationTarget(db, {companyId, storeId, workMenuId, laneId})` (内部) — read surface (`listAvailableSlotsForStoreMenu`) と**同一の境界チェーン**を write 前段で再強制: company active → store=URL company + active + not-deleted → menu=URL company + active + not-deleted **+ visible_to_customers=true** → lane=その store + company + active + not-deleted + 当該 menu を `lane_work_menus` で提供。失敗は `company_not_found`/`store_not_found`/`work_menu_not_found`/`lane_not_found`。
  - `createPublicReservation(input, options)` — 境界チェック → `checkReservationSlotAvailable` (gate) → `createCustomerReservation` (create) を順に呼び、最初に失敗した段の reason を返す discriminated union。`workMenuId` **必須** (schema)。`durationMinutes` は窓 (= menu.duration) から導出。**laneId を一切書き換えず gate と create に素通し** (gate→create 同一 laneId invariant の実体)。
  - read の boundary を変える際は本 write boundary も対称に変える旨をヘッダーに明記 (drift 防止のため co-locate)。
- **create service** `src/lib/services/customer-reservation-create.ts` — `customerInputSchema` / `vehicleInputSchema` を export (wrapper と route が再利用、顧客/車両入力契約の単一源化)。ロジック変更なし。
- **route** `src/app/r/reserve/[companyId]/reservations/route.ts` (新規) — POST。薄い shim。body (storeId/workMenuId/laneId/startAt ISO/endAt ISO/customer/vehicle/notes?) を zod 検証 → `createPublicReservation` へ委譲 → reason→HTTP status 写像 (201 / 400 invalid_body / 404 不在 / 409 availability・二重予約 / 500 status_not_seeded)。`force-dynamic`。
- **route** `src/app/r/reserve/[companyId]/menus/route.ts` (新規) — GET `?storeId=`。step2。`listPublicWorkMenus` へ委譲、純 read GET-safe。
- **tests** `tests/integration/services/customer-reservation-public.integration.test.ts` (+12) + `tests/integration/app/customer-reservation-public-routes.integration.test.ts` (新規 +12)。
- **spec drift 解消**: data-model §10 に「顧客公開予約フローの write orchestration (A.31b-1)」節を追加 (境界 3 段・invariant・route・未配線を明記)。

## adversarial gate チェックリスト (#5 該当、advisor #5 gate 実施済)

| # | 条件 | 該当する具体的変更 |
|---|---|---|
| 1 | raw-migration 変更 | なし (A.31a の `post/0024` を流用、本 phase は新 migration なし) |
| 2 | 新規署名鍵 / session 機構 | なし |
| 3 | 手書き RLS / Storage bucket policy 新規 | なし |
| 4 | 金銭計算 / billing | なし (priceMinor は read 返却のみ) |
| 5 | 既存 canonical 外の cross-tenant boundary | **該当**: 匿名公開 **write** surface (予約作成)。read より高 stake (副作用あり)。URL companyId が唯一 scope |

→ #5 gate: advisor 敵対的パス (enumerate cross-tenant / GET-safety / auth-bypass) で **境界穴 4 件を捕捉 → 全件 service 層で塞ぎ + テスト固定** したことを確認。

- cross-tenant write: `createPublicReservation` が company→store→menu+visible→lane membership の全段で URL companyId と一致検証。別会社 store / 別店舗 lane / 非公開 menu はいずれも create 前に弾く (テスト 4 件: store_not_found / lane_not_found×2 / work_menu_not_found)。
- POST safety: POST は意図的な mutation (GET ではない)。create-on-confirm の email 認証 gate は A.32 で前段に差し込む (本 phase 未配線、production 露出は A.33 まで禁止)。
- auth-bypass: 設計上の匿名公開 write。可視性 gate (visible_to_customers) を write でも独立強制し、社内専用メニューの匿名予約を遮断。

## invariants (A.31b-2 / 後続で壊さない)

- typecheck clean / **484 tests PASS** (460 + 12 service + 12 route) / **`pnpm build` green** (3 route = ƒ Dynamic: `/r/reserve/[companyId]/{slots,menus,reservations}`) / prettier clean。
- **gate→create 同一 laneId (最重要)**: `createPublicReservation` は picker の `laneId` を gate と create で書き換えない。A.31b-2 の wizard は GET slots が返した `{startAt, endAt, laneId}` をそのまま POST body に乗せること。集約値で gate して別 lane で create、が最大の罠。
- **write 境界 = read 境界の鏡**: `resolvePublicReservationTarget` は `listAvailableSlotsForStoreMenu` の候補導出と対称。read の boundary 変更時は write も対称に変える (co-locate 理由)。
- **`workMenuId` は公開 path で必須**: optional に戻すと create が menu 検証ごとスキップし visible_to_customers gate が外れる。
- **境界チェーンの可視性検証を維持**: menu は `visible_to_customers=true` を read/write 両方で独立検証。
- 公開 GET/POST surface は A.33 (Turnstile + rate 制限) まで production 露出禁止。

## seal の誠実性

- **route handler は意図的に薄い shim、service mock で I/O test**。cross-tenant/可視性/gate→create invariant の保証は service 層 integration tests (11 件、実 DB + rollback) に集約。route test (12 件) は path companyId 強制・body/query zod 検証・引数受け渡し・reason→status 写像のみを mock service で検証する (DB 不要)。「route が境界を守る」とは読まないこと — 境界は service が守り route は写像のみ。
- **`createCustomerReservation` 単体は依然 visible_to_customers を見ない**。admin 経路 (社内スタッフが任意メニューで予約) は正当なので create 自体は可視性非依存のまま。公開予約の可視性は **`createPublicReservation` 経由でのみ**保証される。公開 write は必ず wrapper を通すこと (create 直叩き禁止)。
- **lint 未実行**: `next lint` が flat-config 不在で対話式化する既存ツール問題のため未実行 (本 phase 起因ではない)。typecheck + prettier + tests で代替検証。

## 記録された assumption / 既知ギャップ (A.31b-2/後続で訂正可能)

- **TOCTOU (境界チェック / gate / create 間)**: 3 段とも再 SELECT するが間に並行削除/可視性変更が起きると稀に gate/create reason が出る (defensive に素通し)。二重予約のみ EXCLUDE が最終防衛線で clean に弾く。MVP 許容。
- **N+1 (picker)**: A.31a から継続 (候補 lane 数だけ `listAvailableSlots`)。write 側は単一 slot なので gate 1 回 + create 1 tx。
- **date regex ゆるさ**: route の startAt/endAt は `z.string().datetime()` (ISO 厳格) のため A.31a の `YYYY-MM-DD` ゆるさ問題は POST 側には波及しない。GET menus の storeId は uuid 厳格。
- **email 認証未配線**: 本 phase の POST は step6-7 (6 桁コード) を経ずに confirmed 予約を作る。A.32 で `createPublicReservation` 呼び出し前に検証 gate を差し込むまで production 露出禁止 (A.33)。
- **off-grid 予約が gate を通る (advisor #5 観測、非ブロッキング・修正保留)**: 例 `09:17-10:17` は duration + 営業時間 + lead/advance を満たすため、picker が 30 分 grid しか提示しなくても予約成立し、EXCLUDE range で隣接 grid 枠を断片化し得る。cross-tenant でも auth-bypass でもなく行は valid・company 正当なので #5 スコープ外。A.33 (rate 制限 + Turnstile) + A.32 (email 認証) の露出禁止に内包される。strict grid 整合 (`startMin % slotInterval == 0`) を**製品要件**として望むなら A.30 gate 側の設計判断 (本 phase の blocker ではない)。
- **重い test の timeout**: 「books the lane...」test は 2 lane picker + 3 write 操作でリモート DB 既定 5s を超えるため 30s に延長済み (5712ms 実測)。デッドロックではない。

## A.31b-2 着手時の選択肢 (推奨順)

- **A.31b-2 = multi-step wizard UI (step1-5)**: 公開ページ `/r/reserve/[companyId]/page.tsx` (Server Component、`listPublicStores` を server-side ロード) + client wizard。店舗 (server props) → メニュー (GET `/menus` fetch) → 空き日時 picker (GET `/slots` fetch) → 顧客 → 車両 → POST `/reservations`。**GET slots が返した `{startAt,endAt,laneId}` をそのまま POST body に乗せる** (gate→create 同一 laneId invariant)。UI は既存 admin の素 Tailwind パターン直接。page.tsx の GET-safe test 追加。
- **A.32 = email 6 桁コード検証 + 予約確定 (step6-7)**: `createPublicReservation` 呼び出し前に認証 gate を差し込む。
- **A.33 = 予約完了通知メール + Turnstile + rate 制限 (step8 + §12.3)**: GET/POST 公開 surface の production 露出解禁条件。

## メトリクス

| 指標 | 値 |
|---|---|
| commit | 本 seal 1 |
| 変更ファイル | service 1 (public 拡張) + create service 1 (export) + route 2 (新規) + test 2 (public +12 / route 新規 +12) + data-model 1 = 6 (+ handoff) |
| 新規 tests | +24 → 484 (service 12 / route 12) |
| advisor | 2 (着手前設計 1 + #5 adversarial gate 1) |
| ユーザー判断 | 1 (A.31b-1/b-2 スコープ分割) |
| Codex 委任 | 0 (cross-tenant write 境界 + gate→create invariant の設計密度高、Claude 自実装。block override 4 件記録: service / route×1 + test×2) |

*Phase 64-A.31b-1 sealed / Generated by Claude 2026-05-29 / 次: A.31b-2 (要 /clear。multi-step wizard UI、GET slots の laneId をそのまま POST body に乗せる invariant、UI 既存 admin パターン直接)*
