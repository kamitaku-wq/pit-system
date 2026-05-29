# Phase 64-A.29 customer reservation create (顧客予約作成 write core) sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-A.29 (前: A.28 attachment signed URL) |
| 状態 | **sealed** (顧客予約作成 service + reservation status seed / 430 tests PASS) |
| 担当 | Claude (advisor 3 回: 順序 reconcile + gate #2 + soft-delete blocker、自実装) |
| Branch | `phase-64-mvp-implementation` |
| **/clear 推奨** | **推奨** (A.30 = 顧客予約フロー UI / availability。fresh context 望ましい) |

## 当初予定からの変更 (順序反転・重要)

A.28 handoff / セッション冒頭の仮説は「A.29 = reservation status model 単独先行」だったが、**advisor reconcile で投機アンチパターンと判明し順序を反転**:

- status model を全 transition 込みで単独先行すると、その transition を行使する **present な consumer が居ない** (vendor/staff workflow 未実装、cancel は defer 済み)。= A.28 で「避ける」と決めた「状態機械を consumer 不在で焼き込む」投機の再演。
- roadmap β-3 が挙げるのは「顧客予約フロー」であって status model ではない。status model は作成 (後に cancel/workflow) の実装詳細。
- **結論**: A.29 = 顧客予約作成 (唯一 present な正当 consumer)。status 足場は作成フローが実際に行使する分 = 初期 status 1 件のみ最小で引き込む。

## 達成したこと

spec §12.1 顧客予約フロー (真の源) の **write core** + reservation status の per-company seed。

- **migration** `src/lib/db/raw-migrations/post/0023_seed_reservation_statuses.sql` (新規): `seed_reservation_statuses_for_company(uuid)` (SECURITY DEFINER) + companies AFTER INSERT trigger `trg_seed_reservation_statuses_on_company_insert` + 既存 company backfill。**`confirmed` (is_initial=true) 1 件のみ seed、transition なし**。0015 transport seed をミラー。
- **service** `src/lib/services/customer-reservation-create.ts` (新規): `createCustomerReservation(input, opts)` (service_role)。
  - store-first で companyId 導出 → lane / workMenu の同一 company **かつ** not-deleted / active を cross-tenant 検証
  - 顧客・車両を入力値から新規作成 (MVP: dedup なし)
  - reservations を初期 'confirmed' で INSERT、status history (from=null→confirmed)、audit_logs (`action='create'`, `actor_kind='customer'`, PII 非格納) を 1 tx
  - 二重予約 = EXCLUDE 制約 (23P01) を **tx 外**で捕捉 → `slot_unavailable` (tx 内 catch は aborted-tx で COMMIT 失敗するため)
  - 戻り型: `{ ok:true; reservationId; customerId; vehicleId; statusId } | { ok:false; reason }` discriminated union
- **test helper** `tests/_helpers/seed-reservation-statuses.ts` (新規、SELECT-only、trigger 前提)
- **tests** (+11) `tests/integration/services/customer-reservation-create.integration.test.ts` (新規): happy / workMenu 同 company / 二重予約→slot_unavailable / 隣接枠 OK / cross-tenant lane→lane_not_found / cross-tenant workMenu→work_menu_not_found / **soft-deleted lane→lane_not_found** / **inactive store→store_not_found** / unknown store→store_not_found / status_not_seeded / 時間逆転→throw
- **spec drift 解消**: data-model.md §18.1 に実装済み per-company status seed (transport/reservation) + 顧客予約作成 service 境界 + availability deferral を追記

## A.29 ユーザー判断 (記録)

**予約行生成タイミング = 「認証後に confirmed で作成」(create-on-confirm)**:
- email 6 桁コード検証を通ってから INSERT。spec §12.3 の spam 懸念に直接対応 (未認証予約が枠を占有しない)。
- status は `confirmed` 1 件のみ、pending→confirmed transition / cleanup cron 不要 → A.29 最小。
- 欠点 (認証中の二重予約 race) は EXCLUDE 制約が敗者を clean に拒否 (slot_unavailable) で許容。

## 主要設計判断

1. **順序 creation-first** (上記)。status 足場は最小 (confirmed のみ)。
2. **enforce_status_transition trigger は BEFORE UPDATE OF status_id のみ** (20_triggers.sql) → INSERT は transition 検証を受けず、作成に transition 行不要。cancel/workflow transition は present consumer と共に別 phase。
3. **defense-in-depth (cross-tenant + not-deleted/active)**: FK は company も削除状態も保証しない → store/lane/workMenu lookup で companyId + `isNull(deletedAt)` + `isActive=true` を全て service 強制 (advisor gate #2 blocker を反映)。
4. **EXCLUDE violation を tx 外で map**: postgres は statement error で tx を abort、tx 内 catch では COMMIT 失敗。`baseDb.transaction()` の外側 try/catch で 23P01 → slot_unavailable。test では injected outerTx の savepoint が outer を保護 (slot test で実証)。
5. **顧客・車両は新規作成 (dedup なし)**: customers/vehicles に UNIQUE 制約なし。requirements §12.1 (真の源) の「情報入力」を新規作成と解釈。roadmap 「車番入力」は省略表記と解釈 (下記 assumption 参照)。
6. **availability deferral (記録)**: 営業時間/定休日/lane 稼働時間/reservation_settings のサーバ側検証は本 service に**含めない**。EXCLUDE は二重予約のみ保証。

## adversarial gate チェックリスト (#1+#5 該当、advisor #2 gate 実施済)

| # | 条件 | 該当する具体的変更 |
|---|---|---|
| 1 | raw-migration 変更 | **該当**: `post/0023` 新規 (seed function + companies trigger + backfill) |
| 2 | 新規署名鍵 / session 機構 | なし |
| 3 | 手書き RLS / Storage bucket policy 新規 | なし |
| 4 | 金銭計算 / billing | なし |
| 5 | 既存 canonical 外の cross-tenant boundary | **該当**: 顧客 facing service_role write 新規 (store-first company 導出)。A.23/A.24 の service_role + cross-tenant 規律を踏襲 |

→ #1+#5 gate: advisor 3 回 (順序 reconcile / gate #2 enumerate cross-tenant・auth-bypass・GET-safety → soft-delete blocker 1 件捕捉・修正 / —)。確認軸: cross-tenant lane/menu→not_found / soft-deleted lane→not_found / inactive store→not_found / 二重予約→slot_unavailable を test で固定。**cross-tenant / auth-bypass / GET-safety はクリーン (write のみ、auth gate は route 層 defer)**。

## invariants (A.30 で壊さない)

- typecheck clean / **430 tests PASS** (419 + 11)
- **availability gate は A.30 の責務 (太字・必須)**: 公開 route で `createCustomerReservation` を露出する際、空き枠 picker と共有する availability 検証 (営業時間/定休日/lane 稼働時間/reservation_settings) を **service 呼び出し前に必ず gate** すること。untrusted client が任意 datetime を POST できるため。A.28 の read/write prefix footgun と同型。
- reservation status seed は `confirmed` 1 件 (is_initial=true)、transition なし。cancel/workflow transition は consumer と共に追加 (投機禁止)。
- bucket 名 / seed 値 SSOT: seed 関数 (`post/0023`) と test helper の `confirmed` 整合維持。
- 顧客 facing は service_role 利用境界 (ADR-0010 補項) / use-case service canonical (ADR-0011) 踏襲。

## 記録された assumption / drift (A.30 で訂正可能)

- **customer/vehicle 毎回新規作成 (dedup なし)**: requirements 真の源解釈。roadmap 「車番入力→…」は plate-lookup (既存車両照合) 解釈もあり得る。違えば A.30 で訂正。
- **`visible_to_customers` 列が work_menus schema に無い** (spec §12.1 step2 ↔ schema drift)。現状強制不能。A.30 の menu 一覧 read で可視性を扱う前提。
- **spec §15.5 の `reservation_status_history` BEFORE INSERT trigger は実装と乖離**: 実際の 20_triggers.sql は `reservations` BEFORE UPDATE のみ。history INSERT (from=null→confirmed) はテストで通過を裏取り済み。scope 外。

## A.30 着手時の選択肢 (推奨順の続き)

- **A.30 = 顧客予約フロー UI + availability**: 空き枠 picker (営業時間/定休日/lane 稼働時間/reservation_settings) + 公開 route。availability 検証を createCustomerReservation 前に gate (本 phase invariant)。spec §12.1 step1-5。
- **A.31 = email 6 桁コード検証 + 予約確定**: step6-7。create-on-confirm の認証 gate。
- **A.32 = 予約完了通知メール + Turnstile**: step8 + spec §12.3 spam 対策。
- customer modify/cancel は依然 reservation status model (cancel transition) 確立後。

## メトリクス

| 指標 | 値 |
|---|---|
| commit | 本 seal 1 |
| 変更ファイル | migration 1 (新規) + service 1 (新規) + test helper 1 (新規) + test 1 (新規) + data-model 1 = 5 |
| 新規 tests | +11 → 430 |
| advisor | 3 (順序 reconcile 1 + gate #2 blocker 1 + 着手前 1) |
| ユーザー判断 | 2 (A.29 スコープ推奨順 / 予約行生成タイミング create-on-confirm) |
| Codex 委任 | 0 (高 stake cross-tenant + raw-migration + 設計密度高、Claude 自実装。block override 4 件記録) |

*Phase 64-A.29 sealed / Generated by Claude 2026-05-29 / 次: A.30 (要 /clear。顧客予約フロー UI + availability gate)*
