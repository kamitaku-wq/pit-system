# Phase 64-A.31b-2 public reservation wizard UI (顧客公開予約 multi-step wizard) sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-A.31b-2 (前: A.31b-1 public reservation write core) |
| 状態 | **sealed** (page.tsx Server Component + 5-step client wizard + 純ロジック分離 + 3 unit test / typecheck clean / unit 46 files PASS / build green 0/0 / prettier clean) |
| 担当 | Claude (advisor 2 回: 着手前設計 + plan 確認、自実装。block override 4 件記録。code-reviewer + Codex 並走レビュー) |
| Branch | `phase-64-mvp-implementation` |
| **/clear 推奨** | **推奨** (A.32 = email 6 桁コード検証 step6-7。service/route 層作業に戻るため fresh context 望ましい) |

## スコープ (A.31b-1 で確定済みの分割に従う)

A.31b-1 (server コア) で `createPublicReservation` wrapper + POST/GET 3 route + 完全 service テストを固めた。本 A.31b-2 は **その上の UI 配線のみ**:

- **A.31b-2 (本 phase)** = multi-step wizard UI (step1-5)。店舗 (server props) → メニュー (GET `/menus`) → 空き日時 picker (GET `/slots`) → 顧客情報 → 車両情報・備考 → POST `/reservations`。UI は既存 admin の素 Tailwind パターン直接 (ユーザー判断、A.31a で確定済み)。境界ロジックは service 層に集約済みのため UI には一切再実装しない。

## 達成したこと: gate→create 同一 laneId invariant を client 側で構造的に保証

最重要は「picker が返した枠を verbatim に POST する」こと。A.31b-1 §invariants が「集約値で gate して別 lane で create」を最大の罠と名指しており、本 phase ではその罠が**起きえない構造**で実装した:

- **純ロジック分離 (`reservation-payload.ts`, React 非依存)**: `buildReservationPayload({store, menu, slot, customer, vehicle, notes})` が POST body を組み立てる唯一の地点。`laneId`/`startAt`/`endAt` を slot から**再計算せず verbatim** に取り、`endAt` を `durationMinutes` から再導出しない。空 optional の省略 (`trimOrUndefined`) と modelYear の number-or-omit (`parseModelYear`) もここに集約。reason→JP 文言写像 (`reasonToMessage`) と slot 回復可否 (`reasonIsSlotRecoverable`) も同居。
- **wizard が slot を丸ごと保持**: `selectSlot` で slot オブジェクトを state に置き、submit 時に `buildReservationPayload` へ素通し。store/menu を変える全遷移が下流 (slot/slots/date) を null/空にリセットするため stale-slot で POST する経路がない。
- **slot key = `laneId+startAt`**: 時刻だけの key 化を避け、同時刻・別 lane 枠の取り違え/衝突を防ぐ。

### 実装 (変更ファイル 7 = 新規 6 + spec 1)

- **pure** `src/app/r/reserve/[companyId]/reservation-payload.ts` (新規) — POST body 組み立て純ロジック。React/server 非依存。上記 invariant の集約点。
- **client** `src/app/r/reserve/[companyId]/reservation-wizard.tsx` (新規) — "use client" 5-step wizard。A.31b-1 の公開 route を fetch で消費 (Server Action ではなく fetch — 検証済み route を経由する設計のため)。`import type { PublicStore }` のみで server コードを引き込まない。menus/slots fetch は世代カウンタ (`useRef`) で stale レスポンスを破棄 (レビュー指摘 HIGH 対応)。
- **page** `src/app/r/reserve/[companyId]/page.tsx` (新規) — Server Component エントリ。`force-dynamic` + `listPublicStores` のみ呼び client wizard に props 渡し。**write/consume 系を一切 import しない** (GET-safe)。不在時は error main で早期 return。
- **test** `tests/unit/customer-reserve-companyid-get-safe.test.ts` (新規, +2) — page.tsx import を `readFileSync` で静的検査 (A.23 手法踏襲)。write 系非 import + read 系存在を assert。
- **test** `tests/unit/reservation-payload.test.ts` (新規, +7) — 純ビルダー単体。37 分 sentinel slot で「endAt 再計算なし」を証明、空 optional の wire 省略、modelYear 変換、reason 写像。
- **test** `tests/unit/customer-reserve-wizard.test.tsx` (新規, +1) — render テスト。**同時刻・別 lane の 2 枠を返し 2 番目 (lane-B) を選択** → POST body の laneId/startAt/endAt が verbatim (37 分窓) であることを click 経由で end-to-end 弁別。
- **spec** `spec/data-model.md` §10 — 「顧客公開予約フローの wizard UI 配線 (A.31b-2)」節を追加 (GET-safe / invariant / fetch レース防護 / test を明記)。

## adversarial gate チェックリスト (Phase 64-A.26 #1 フレーム)

| # | 条件 | 該当する具体的変更 |
|---|---|---|
| 1 | raw-migration 変更 | なし |
| 2 | 新規署名鍵 / session 機構 | なし |
| 3 | 手書き RLS / Storage bucket policy 新規 | なし |
| 4 | 金銭計算 / billing | なし (priceMinor は表示のみ未使用) |
| 5 | 既存 canonical 外の cross-tenant boundary | **新規なし** (A.31b-1 で sealed 済みの公開 write 境界を UI が消費するのみ。新しい境界は追加しない) |

→ gate #5 は「新規境界」では発火しないが、**公開・匿名 write surface の UI** であるため code-reviewer + Codex を並走させた (下記)。

## レビュー結果 (code-reviewer + Codex 並走、2 モデル独立)

両レビュアーが**独立して同一の HIGH 1 件のみ**を指摘 (CRITICAL 0、コア invariant 5 件すべて HOLD):

- **HIGH (両者一致) — slots/menus fetch レース**: date/店舗連打時に古いレスポンスが新しい slots を上書きし、表示中の選択と submit される slot が食い違う可能性。**修正済み**: `useRef` 世代カウンタで最新世代のレスポンスのみ state 反映。store/menu 変更でも in-flight slots を無効化。
- **LOW (code-reviewer) — render テストの endAt が偶然 60 分**: 修正済み。SLOT を 37 分窓 (非丸め) にして end-to-end でも「endAt 再計算なし」を独立証明。
- **LOW — Enter 二重送信**: A.33 のサーバ冪等性 + rate 制限で対処 (production 露出前)。client は `disabled={submitting}` でボタン経路を抑止。
- **HIGH (advisor 3 回目、レビュー後追加捕捉) — エラー時の行き止まり**: 回復可能 reason で `setSlot(null)` のみ行い step5 に留めると、確定ボタンが有効なまま no-op し、文言「別の空き枠を…」が車両画面と食い違う。**修正済み**: `reasonRequiresRestart` (boundary not_found) → 全リセット + step1、`reasonIsSlotRecoverable` → step3 へ戻す。submit エラーバナーを top-level に移動し着地ステップと文言を一致させ、forward 選択 (`selectStore`/`selectSlot`) で stale エラーをクリア。render テスト 1 件 (409 → step3 復帰 + 確定ボタン消失) で固定。

## invariants (A.32 / 後続で壊さない)

- typecheck clean / **unit 46 files PASS** (新規 +10 tests) / **`next build` green 0 errors 0 warnings** / prettier clean。
- **gate→create 同一 laneId/時刻 (最重要)**: `buildReservationPayload` が slot の `{startAt,endAt,laneId}` を verbatim に乗せる。再計算/再フォーマット/別 lane 混入を入れないこと。表示整形 (Asia/Tokyo) は送信値と別 path。
- **GET-safe**: page.tsx は read (`listPublicStores`) + wizard import のみ。write/consume/gate を import しない (`customer-reserve-companyid-get-safe.test.ts` が静的強制)。
- **client/server 境界**: wizard は `import type` のみで service モジュール (serviceRoleDb を持つ) の値 import をしない。build が境界を検証。
- **fetch は検証済み route 経由**: wizard は A.31b-1 の route を fetch で消費する (Server Action 並行路を作らない)。route が path companyId 強制 + zod 検証 + reason→status 写像を担う。
- 公開 GET/POST surface は A.33 (Turnstile + rate 制限) まで production 露出禁止。

## 記録された assumption / 既知ギャップ

- **email 認証未配線**: 本 wizard の POST は step6-7 (6 桁コード) を経ずに confirmed 予約を作る。A.32 で `createPublicReservation` 呼び出し前に検証 gate を差し込むまで production 露出禁止 (A.33)。
- **Enter 二重送信** (LOW): client closure では完全に防げない (state 経由)。A.33 サーバ冪等性で対処。
- **完了画面は reservationId のみ表示**: 確定日時/店舗の再掲は未実装。A.32 (確認ステップ) or A.33 (完了通知) で補強候補。
- **render テストが本プロジェクト初の component render test**: @testing-library/react + jsdom (既存 dep) で成立。今後 UI ロジックの弁別テストはこのパターンを踏襲可能。

## A.31b-2 着手時の選択肢 (推奨順)

- **A.32 = email 6 桁コード検証 + 予約確定 (step6-7)**: `createPublicReservation` 呼び出し前に認証 gate を差し込む。service/route 層作業。
- **A.33 = 予約完了通知メール + Turnstile + rate 制限 (step8 + §12.3)**: GET/POST 公開 surface の production 露出解禁条件。

## メトリクス

| 指標 | 値 |
|---|---|
| commit | 本 seal 1 |
| 変更ファイル | pure 1 + client 1 + page 1 + test 3 + spec 1 = 7 (+ handoff) |
| 新規 tests | +12 unit (payload 8 / get-safe 2 / wizard render 2)。unit 48 tests PASS。integration 未変更 (service/route 無改修) のため未再実行 |
| advisor | 3 (着手前設計 + plan/test 設計確認 + 完了前レビューで行き止まり UX 捕捉) |
| ユーザー判断 | 0 (A.31b-1 で分割確定済み、UI=admin パターン直接も確定済み) |
| 並走レビュー | code-reviewer + Codex (del-20260529-065356)、独立に同一 HIGH を捕捉 → 修正済み |
| Codex 委任 | レビューのみ (実装は laneId invariant の判断密度高で Claude 自実装、block override 4 件記録) |

*Phase 64-A.31b-2 sealed / Generated by Claude 2026-05-29 / 次: A.32 (要 /clear。email 6 桁コード検証 step6-7、createPublicReservation 呼び出し前に gate 差し込み、service/route 層作業)*
