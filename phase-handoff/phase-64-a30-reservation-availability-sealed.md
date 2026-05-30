# Phase 64-A.30 reservation availability engine (空き枠 picker + 公開 route gate コア) sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-A.30 (前: A.29 customer reservation create) |
| 状態 | **sealed** (availability engine + gate + picker / 446 tests PASS) |
| 担当 | Claude (advisor 2 回: 着手前設計 + #5 adversarial gate、自実装) |
| Branch | `phase-64-mvp-implementation` |
| **/clear 推奨** | **強く推奨** (A.31 = 顧客予約フロー UI + 公開 route。UI モックフロー発火 + fresh context 望ましい) |

## スコープ判断 (advisor 着手前レビューで確定)

A.29 handoff は「A.30 = 顧客予約フロー UI + availability」と広く括っていたが、**本セッションは server 側コア (availability engine + gate + tests) に限定**した:

- 必須 invariant は **gate** (server 側・UI 非依存・完全テスト可能)。UI picker は global ルールの UI モックフロー対象で、かつ context が既に重い (/clear せず継続)。
- → 本 phase = availability engine + route gate 関数 + integration tests を seal。**picker UI + 公開 route は A.31 で /clear 後に fresh で**実装 (UI モックフローも正しく発火)。

ユーザー判断「このまま A.30 着手」を満たしつつ context 衛生を保つ分割。

## 達成したこと

spec/data-model.md §10.0 (service_slots を持たず既存テーブル組み合わせで空き枠計算) を実装。A.29 invariant の availability gate を提供。

- **tz util** `src/lib/tz/jst.ts` (新規): JST (Asia/Tokyo 固定、DST なし) ⇔ UTC 変換を 1 箇所に集約。`jstDayOfWeek` (0=日..6=土、spec 規約) / `jstDateString` / `jstMinutesOfDay` / `jstDateTimeToUtc` / `timeStringToMinutes`。machine TZ 非依存に `date-fns-tz` の `formatInTimeZone`/`fromZonedTime` を使用 (`toZonedTime`+local getter は machine TZ 依存のため不使用)。将来 `companies.time_zone` 参照への置換点。
- **service** `src/lib/services/reservation-availability.ts` (新規):
  - **共有コア** `computeDayWindows`: `store_business_hours` (accepts_reservations=true) ∩ `lane_working_hours` − `store_holidays` (is_closed) を JST 壁時計分で交差計算 + マージ。複数行 (午前/午後等) 許容。picker と gate が同一コアを呼び drift 防止。
  - **gate** `checkReservationSlotAvailable(input, opts)` (service_role): 特定 start/end を検証。失敗理由 = `store_not_found`/`lane_not_found`/`work_menu_not_found`/`lane_menu_unsupported`/`duration_mismatch`/`too_soon`/`too_far`/`closed`/`outside_business_hours`。**workMenu 指定時は client endAt を信用せず menu.duration と一致を強制** (untrusted client の極小窓 footgun 対策)。
  - **picker** `listAvailableSlots(input, opts)` (service_role): 指定 JST 暦日の空き枠を列挙。slot_interval 刻み、既存予約 (not-deleted) を buffer で pad して除外。`{ startAt, endAt }[]`。
  - cross-tenant: store-first company 導出 → lane/workMenu を companyId+active+not-deleted で検証、lane_work_menus M2M で lane↔menu 対応を確認 (A.29 create には無かった検証)。
  - settings 解決: per-store 行 → company default (`store_id IS NULL`) → schema default (`reservation_settings` は auto-seed されないため「行なし」は正常)。
  - **overlap は gate では検証しない**: EXCLUDE 制約 (reservations) が最終防衛線 (gate→create 間で racy なのは overlap のみ、敗者を slot_unavailable で clean に弾く = A.29 実証)。
- **tests** (+16) `tests/integration/services/reservation-availability.integration.test.ts` (新規):
  - gate 12: happy(09:00 JST=00:00 UTC アンカー) / 開店前(08:00) / 閉店後(18-19時) → outside / 定休日 → closed / lead前 → too_soon / advance外 → too_far / duration不一致 → duration_mismatch / duration一致 → ok / lane非対応menu → lane_menu_unsupported / cross-tenant lane → lane_not_found / unknown store → store_not_found / **dow アンカー(07-15 open / 07-16 closed)**
  - picker 4: 09-18時 30分刻み60分枠=17枠 (JST↔UTC アンカー) / 既存予約 overlap 除外 (境界含む) / store∩lane 交差 (13-18時→first 13:00 JST) / 定休日 → 空
  - **JST↔UTC は明示ペアでアンカー** (09:00 JST=00:00 UTC、13:00 JST=04:00 UTC)。**dow 変換は SUT 非依存に算出した曜日で 1 本アンカー** (advisor #5 gate で追加、全曜日一律 seed だと変換誤りを取り逃す穴を塞ぐ)。
- **spec drift 解消**: data-model.md §10.1 を実装スキーマ (slot_interval/lead/advance/buffer、store_id nullable) に訂正 + availability 解決順を追記。初期 morning/afternoon 案は「未実装(参考)」として保持。§18.1 の availability deferral 注記を「A.30 で実装済み」に更新。

## adversarial gate チェックリスト (#5 該当、advisor #5 gate 実施済)

| # | 条件 | 該当する具体的変更 |
|---|---|---|
| 1 | raw-migration 変更 | **なし** (本 phase は read service + tz util + test + doc のみ、migration 0 件) |
| 2 | 新規署名鍵 / session 機構 | なし |
| 3 | 手書き RLS / Storage bucket policy 新規 | なし |
| 4 | 金銭計算 / billing | なし |
| 5 | 既存 canonical 外の cross-tenant boundary | **該当**: customer-facing service_role read (availability、store-first company 導出)。A.29 create / ADR-0010 規律踏襲だが新規 read surface |

→ #5 gate: advisor 敵対的パス (enumerate cross-tenant / auth-bypass / GET-safety) で **クリーン判定**。
- cross-tenant: 全 read が company 検証済み entity に scope、返却は時刻のみ (PII なし)。`computeDayWindows` の companyId 非 filter は join でなく scoped read のため漏洩面なし。
- auth-bypass / GET-safety: 純 read (INSERT/UPDATE/audit ゼロ) → **構造的に GET-safe**。service_role は ADR-0010 境界内、pre-auth picker 表示が設計。
- 唯一の穴 (dow 未アンカー) は advisor 指摘で test 1 本追加して塞いだ。

## invariants (A.31 で壊さない)

- typecheck clean / **446 tests PASS** (445 + 1; 内 availability 16)
- **gate→create は同一パラメータ必須 (太字・最重要)**: gate は現状どこからも呼ばれない production code。セキュリティ価値は **A.31 の公開 route が `createCustomerReservation` の前に `checkReservationSlotAvailable` を、create と同一の `startAt`/`endAt`/`workMenuId` で呼ぶことに完全依存**する。create service は duration==menu.duration を再検証しないため、gate を飛ばす / 別パラメータで呼ぶと duration footgun がそのまま通る。A.29 invariant を「同一パラメータで gate→create」まで具体化。
- picker と gate は `computeDayWindows` を共有し続けること (片方だけ別ロジックにすると「picker が出す枠を gate が拒否」drift)。
- JST は `src/lib/tz/jst.ts` 経由のみ (+9h 手計算禁止)。day_of_week は 0=日..6=土。
- gate は overlap を検証しない (EXCLUDE 委譲)。これを gate に足すと TOCTOU を再導入。

## 記録された assumption / 既知ギャップ (A.31 で訂正可能)

- **buffer 非対称**: picker は buffer_before/after で枠を除外するが、gate も EXCLUDE も buffer を強制しない。default 0 で moot だが、将来 buffer>0 時に「picker が隠す枠を直 POST で取れる」。buffer を強制したいなら gate に overlap+buffer 検証を足す (TOCTOU は残る) か、EXCLUDE 範囲に buffer を織り込む migration が要る。
- **menu 無し時の duration 自由**: workMenuId 未指定時、window 内なら client が任意長を取れる (full-day 予約で lane 占有の DoS 余地)。認証 gate (A.31 email 6 桁) が後段にある前提で MVP 許容。
- **`closed` reason の粒度**: 「店舗休/曜日休」と「lane 当日稼働なし」を `closed` に混同。correctness 問題なし、UX 改善は将来。
- **キャンセル予約の除外**: picker の既存予約除外は not-deleted 全件。cancel transition 未実装 (status は confirmed のみ) のため現状問題なし。cancel 実装時に「cancelled status を picker block から除外」を追加。
- **spec §10.1 morning/afternoon 案は不採用** (本 phase で doc 訂正済)。`allow_double_booking`/`allow_manager_override`/`tentative_expiration_minutes` (仮予約) は将来要件として保持。

## A.31 着手時の選択肢 (推奨順)

- **A.31 = 顧客予約フロー UI + 公開 route (spec §12.1 step1-5)**: 店舗→メニュー→空き日時 picker (`listAvailableSlots` 消費) →顧客→車両。公開 route は GET=picker (safe)、POST=**gate (`checkReservationSlotAvailable`) → `createCustomerReservation` を同一パラメータで** (本 phase 最重要 invariant)。UI モックフロー (global ルール) 発火。
- **A.32 = email 6 桁コード検証 + 予約確定 (step6-7)**: create-on-confirm の認証 gate。
- **A.33 = 予約完了通知メール + Turnstile (step8 + spec §12.3)**。

## メトリクス

| 指標 | 値 |
|---|---|
| commit | 本 seal 1 |
| 変更ファイル | tz util 1 (新規) + service 1 (新規) + test 1 (新規) + data-model 1 = 4 |
| 新規 tests | +16 → 446 (内 availability gate 12 / picker 4) |
| advisor | 2 (着手前設計 1 + #5 adversarial gate 1、後者で dow アンカーテスト追加指摘) |
| ユーザー判断 | 1 (A.30 スコープ「このまま着手」) |
| Codex 委任 | 0 (untrusted gate + cross-tenant + 設計密度高 / test は仕様解釈要のエッジケース設計、Claude 自実装。block override 3 件記録) |

*Phase 64-A.30 sealed / Generated by Claude 2026-05-29 / 次: A.31 (要 /clear。顧客予約フロー UI + 公開 route、gate→create 同一パラメータ invariant)*
