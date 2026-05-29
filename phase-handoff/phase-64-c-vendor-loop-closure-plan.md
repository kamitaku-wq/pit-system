# Phase 64-C 業者ループ閉鎖 — 設計 / 分解計画 (plan)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-C (業者ループ閉鎖, α 必須 / MVP blocker #3) |
| 種別 | **plan** (実装は後続サブフェーズで sealed)。本書は次セッションの唯一文脈源 |
| 前提 | A.34 sealed + CI green 確定済み。transport_order TX 基盤は **ready** (下記 §依存判定) |
| Branch | `phase-64-mvp-implementation` 継続 |
| スコープ | 業者対応の残ロジック: 予定入力 (L2-11) / 完了報告 (L2-12) / 確定モード auto·manual (L3-7/L3-8) / fallback 4 種 (L3-3/L3-4/L3-5/L3-6) |
| 調査 | dynamic workflow 5 並列 read-only マップ (`wf_e1cba0f1-9de`) + spec 精読 (requirements §14-17 / data-model §9,§15.5,§15.6) |
| adversarial gate | **該当 (raw-migration)**: C.0 で status seed + status_transitions 追加。実装 seal 前に Codex adversarial / advisor 2 回目を「cross-tenant / status-machine 整合 / 二重通知」フレームで必須 |

## 依存判定: ready

5 マップが収束。C が依存する transport_order TX 基盤は実装・テスト済み:

- `createTransportOrderWithNotification` (Phase 16-B, `transport-orders.ts:65`) — 4 テーブル atomic TX + idempotency_key
- `respondToTransportOrder` + `respond_to_transport_order` RPC (16-C, `24_vendor_rpcs.sql`) — accept/reject
- `closeTransportOrderOnAllRejected` (16-E, `close-transport-order.ts`)
- `cancelTransportOrder` (`transport-orders.ts:412`) — 楽観排他 + cancelled 遷移 + invitation revoke + change_logs + outbox
- transport_orders スキーマ: scheduled_pickup/delivery/return_at, picked_up/delivered/returned_at, confirmation_mode CHECK('auto','manual'), store_confirmed_at, store_confirmed_by_user_id **全列実装済み** (`12_transport.sql`, composite FK は post/0021)
- column-level GRANT UPDATE (vendor portal が scheduled_*/picked_up_at 等を書ける) `19_rls_policies.sql:341`
- 基盤テーブル schema: transport_order_vendor_attempts (attempt_seq), vendor_selection_logs (selection_method), transport_order_change_logs (change_type CHECK) — **schema のみ、service 層は空**
- outbox dispatcher (Inngest cron, FOR UPDATE SKIP LOCKED) 稼働中。**channel は email のみ実送信** (他は markFailed → C で enqueue する通知は payload.channel='email' を明示)
- status_transitions DB trigger (`enforce_status_transition`, §15.5) — 最終防衛線

> 注: 元計画の "64-B sealed handoff" は存在しないが、64-B が指す reservation→transport_order 上流 TX の中核 (`createTransportOrderWithNotification`) は Phase 16-B で完成。`reservation_id` は nullable で C 着手の障害にならない。

## 重要な spec 発見 (マップ想定の修正)

実装着手前に確定すべき 3 点。マップ (workflow) の初期想定を spec 精読で修正:

### 修正1: manual 確定に新 status は不要

マップは L3-7/L3-8 に新 status `pending_store_confirmation` の seed が必要と想定したが、**spec §15.1 は status ではなく `store_confirmed_at` の NULL 有無で確定を表現**:

| モード | accept 後の状態 |
|---|---|
| `auto` (default) | status=`accepted` + **`store_confirmed_at` = vendor 回答時刻を自動セット** |
| `manual` | status=`accepted` + **`store_confirmed_at` = NULL (未確定)** → 店舗 confirmAction が手動セット |

→ **新 status seed 不要**。確定/未確定は `store_confirmed_at IS NULL` で判定。L3-7 は「auto 時に store_confirmed_at を同 TX で now() セット」する低判断量 fix。L3-8 は「manual 時に店舗が store_confirmed_at をセットする楽観排他 action」。

### 修正2: vendor status_type には history/trigger が無い → 完了進捗は timestamp 列で追跡

- `enforce_status_transition` trigger (§15.5) は **`reservation_status_history` と `transport_order_status_history` の 2 つのみ**に張られる。`status_type='vendor'` 用の history テーブル・trigger は実装に存在しない。
- `transport_orders.status_id` は **`status_type='transport'`** を指す。現状 seed (post/0015) = `requested`(initial) / `accepted` / `rejected`(terminal) / `cancelled`(terminal) の 4 件 + 5 遷移。
- spec §17.1 の 'vendor' ステータス (引取予定/引取済み/搬入済み/返却予定/返却済み/完了) は **実装上どこにも配線されていない spec 概念**。完了進捗 (引取/搬入/返却) は transport_orders の `picked_up_at`/`delivered_at`/`returned_at` **timestamp 列**で追跡するのが実装の現実。

### 修正3: idempotency_key §15.6 は C 用に拡張が必要

現状定義済み 6 パターン (`to:{id}:confirmed:v{ver}` / `:changed:{change_log_id}` / `:invite:{inv_id}` / `:cancelled:v{ver}` / `cr:...` / `reminder:...`)。C で新規発生する event を追加定義 (spec/data-model.md §15.6 への追記が C.0 の一部):

| event_type | idempotency_key (提案) | 用途 |
|---|---|---|
| `transport_order.scheduled` | `to:{id}:scheduled:v{ver}` | L2-11 予定入力 (店舗通知, 任意) |
| `transport_order.completed` | `to:{id}:completed:v{ver}` | L2-12 完了報告 → 店舗通知 |
| `transport_order.store_confirmed` | `to:{id}:store_confirmed:v{ver}` | L3-8 manual 確定 → 業者通知 |
| `transport_order.invitation.sent` (既存再利用) | `to:{id}:invite:{newInvitationId}` | L3-3 次候補打診 / L3-4 再依頼の新 invitation 通知 |
| `transport_order.changed` (既存再利用) | `to:{id}:changed:{change_log_id}` | L3-4 datetime_changed / L3-5 vendor_changed の変更通知 |

→ store_confirmed (L3-8) と completed (L2-12) のみ新パターン。次候補/再依頼/手動切替の通知は既存 `:invite:` / `:changed:` を再利用でき衝突しない。

## C.0 status-model 設計 (D1 確定: 案 A 最小)

完了報告 (L2-12) で transport_orders.status_id を進めるため。現状 transport seed は 4 件で `completed` が無く、accepted からの完了遷移が status_transitions に無いため **completeAction が status_id を更新しようとすると trigger が遷移先不在で reject する** (DB-layer blocker)。

**D1 確定 = 案 A (MVP 最小)** [ユーザー決定 2026-05-29]:
- transport status に `completed`(key=`completed`, name=`完了`, is_terminal=true) を 1 件追加 + 遷移 `accepted → completed` を seed。
- 引取/搬入/返却の granular 進捗は timestamp 列 (`picked_up_at`/`delivered_at`/`returned_at`) で追跡し、status は coarse (`requested`→`accepted`→`completed`、reject 時 `rejected`、cancel 時 `cancelled`)。
- 確定/未確定は `store_confirmed_at IS NULL` で判定 (新 status 不要、修正1)。
- 案 B (spec §17.1 full の 回送手配中/移動中/返却移動中) は不採用。後日「店舗が引取済み等フェーズ status を見たい」要求が出れば別 phase で additive 拡張可。

### C.0 具体実装 (next session が迷わないための確定仕様)

既存 per-company seed 機構を拡張する (新規 status を直接 INSERT せず、既存パターンに合流):

- 既存: `seed_transport_statuses_for_company()` SECURITY DEFINER 関数 (`post/0015`) が status_type='transport' の 4 status + 5 transition を per-company で seed。`companies` AFTER INSERT trigger (`post/0013`) + backfill で全社適用。冪等 `ON CONFLICT DO NOTHING` (spec data-model.md:1860)。
- **C.0 migration = `post/0028_seed_transport_completed_status.sql`** (post/0027 が最新ゆえ次番):
  1. `seed_transport_statuses_for_company()` を `CREATE OR REPLACE` で更新し `completed` status (is_terminal=true) + transition `accepted→completed` を追加 (既存 4+5 は維持、`ON CONFLICT DO NOTHING` で冪等)。
  2. **backfill**: 既存全 company に対し関数を呼ぶ (新規行のみ INSERT、既存は no-op)。`0015` の backfill 作法を踏襲。
- transition の `triggers_notification`: **false** で seed (cancel と同様、完了通知は C.3 の completeAction が outbox を明示 enqueue する。trigger 経由通知に依存しない)。
- spec/data-model.md §15.6 に idempotency_key 2 行追記 (`transport_order.completed` / `transport_order.store_confirmed`)。spec §17.1 transport status 一覧は案 A に合わせ実装追従注記 (A.25 spec drift 作法、status を勝手に削除せず「MVP は completed のみ実装、回送手配中/移動中/返却移動中は将来」と明記)。
- **テスト**: integration で「accept 済み TO を completed に遷移 → status_history INSERT が trigger を通過」+「未 seed 時相当 (別 status へ) は reject」を withRollback 隔離で検証。CI green が gate (local Supabase 不可、A.34 precedent)。
- **adversarial gate (raw-migration)**: seal 前に Codex adversarial / advisor 2 回目を「seed 冪等性 / per-company 漏れ / 既存 transition 破壊 / cross-tenant」フレームで通す。

## スコープ確定 (docs から決定可)

- **未登録業者招待フロー (§2.28 / spot)**: **C スコープ外** (Phase 16-E 延期スコープ, phase-63-step4 §4 の C 項目にも非掲載)。C は登録済み業者の応答ループ閉鎖に限定。
- **業者承諾証跡の同意チェックボックス + IP/UA (§14.10.1)**: respond 既存。同意 UI/証跡は C.3 で respond form に最小追加可だが、IP/UA の audit 配線は判断量中。MVP 必須度を D2 で確認。
- **進捗未更新アラート Cron (§14.10.2) / 通知失敗アラート (§2.27)**: cron job 系。C スコープ外 (β / 別 phase)。

## 分解 (C.0 → C.4)

| サブ | 内容 | 依存 | 判断量 | Codex 委任 | adversarial gate |
|---|---|---|---|---|---|
| **C.0** | status-model 確定 (D1 反映): `completed` status + `accepted→completed` 遷移 seed (post 新規 migration) + §15.6 idempotency_key 追記 (spec) | なし | **高** (状態機械 + raw-migration) | NO | **該当** |
| **C.1** | auto 確定 fix (L3-7 の auto 側): accept 経路で confirmation_mode='auto' 時 store_confirmed_at=now() を同 TX セット + L3-6 cancel→reservation 連動 | C.0 不要 | 低〜中 | 部分 | reservation 連動は要確認 |
| **C.2** | manual 確定 (L3-8): `confirmTransportOrder` service + admin `confirmAction` (store_confirmed_* セット, 楽観排他 IF MATCH, 業者へ outbox) | C.1 | 中 | NO | — |
| **C.3** | vendor portal 完了系 (L2-11 予定入力 + L2-12 完了報告): scheduleAction/completeAction + service + UI (ScheduleForm/CompleteForm) + accepted 案件一覧フィルタ拡張 | C.0 (completed status) | 中 | 部分 (UI ボイラープレートは委任可) | — |
| **C.4** | fallback 3 種 (L3-3 次候補打診 / L3-4 希望日時変更再依頼 / L3-5 手動切替): service + admin action。vendor_selection_logs / vendor_attempts / change_logs INSERT + outbox | C.0 | 中〜高 | 部分 | — |

**canonical 踏襲**: outbox enqueue は cancelTransportOrder のパターン B (raw SQL tx 内 UPDATE→status_history→change_logs→outbox INSERT, idempotency_key 構造化, change_log.requires_notification=false で二重通知防止) を踏襲。再送のみ `re-` prefix key (`notifications.ts:48`)。

## 着手順の推奨

1. **C.0 を最初に実装** (他の hard blocker)。raw-migration ゆえ adversarial gate を必ず通す。
2. C.1 (auto fix + L3-6) は低判断量で C.0 と独立着手可。
3. C.2/C.3/C.4 は C.0 後に並列性あり (C.3 UI は Codex 委任候補)。

## 決定ログ

- **D1 確定 = 案 A** (最小 `completed`)。[2026-05-29 ユーザー]
- **D3 確定 = /clear して次セッションで C.0 実装** (本 plan handoff が唯一文脈源)。[2026-05-29 ユーザー]
- **D2 未決 (C.3 着手時に確認)**: §14.10.1 業者承諾証跡 (同意チェック + IP/UA audit) を C スコープに含めるか (MVP 必須度)。C.0/C.1/C.2 はブロックしないため後送り。

## 進捗ログ (実装中の確定事項)

- **C.0 sealed + CI green** [2026-05-29/30]: `post/0028` (completed status + accepted→completed 遷移 + SECURITY DEFINER 関数の REVOKE 是正) を実装、CI (db:setup + test:integration) green。`triggers_notification=true` 維持 (spec §637 で規定済だが未配線、systemic 監査は将来)。詳細は `phase-64-c0-transport-completed-status-sealed.md`。
- **C.1 スコープ確定 = auto 確定のみ。L3-6 は relocate** [2026-05-30]:
  - **C.1 = auto 確定 (L3-7 auto 側) のみ実装**: `post/0029` で `transport_orders` の BEFORE UPDATE OF status_id trigger (`trg_auto_confirm_on_accept`, SECURITY DEFINER) を追加し、confirmation_mode='auto' の accept で `store_confirmed_at=now()` を自動セット。store_confirmed_at は vendor の column GRANT 外で vendor session 直接 UPDATE 不可のため、RPC (touch 不可) を改変せず trigger で behavior を追加 (RPC 複製案より低 drift)。
  - **L3-6 (cancel→reservation 連動) は L2-3 と同時実装へ relocate**: `transport_orders.reservation_id` は createTransportOrderWithNotification を含め**どの経路からも書き込まれず常時 NULL** (repo-wide grep 確認済) ＝ reservation→transport 連携 (L2-3, Phase 64-B) が未実装。よって L3-6 連携は現状 **dead code**。さらに reservation 状態機械は `confirmed` のみ seed・transition 皆無 (A.29「consumer 不在の状態機械を投機 seed するな」)。L3-6 実装には ① reservation `cancelled` status + `confirmed→cancelled` 遷移の per-company seed (新 raw-migration) ② cancelTransportOrder に reservation_id 取得 + status 連動分岐、が必要。spec **requirements.md:599「依頼キャンセル（関連予約もキャンセル状態へ遷移）」** が振る舞いを規定済 (製品判断ギャップではなく純粋な sequencing)。→ **L2-3 (reservation→transport 上流連携) を実装する phase で L3-6 をまとめて実装する**。
  - **★ C.3 への hard checkpoint = vendor status 書込機構 / status_id grant** [2026-05-30, C.1 adversarial gate (Codex BLOCK) 由来]: vendor は column GRANT(status_id) (19_rls_policies.sql:358) + `vendor_portal_update` policy (同:341-344) により `respond_to_transport_order` RPC を介さず `status_id` を直接 UPDATE できる **既存バイパス** がある (RPC の招待 revocation/履歴 side-effect をスキップ可能)。C.1 の auto-confirm trigger はこのバイパス経路でも発火する (auto-gate ゆえ無害と裁定、詳細 `phase-64-c1-auto-confirm-sealed.md`)。**C.3 で `completeAction` の status→completed 書込機構を確定する際、status_id を vendor GRANT から外し status 遷移を SECURITY DEFINER RPC-only にできるか必ず判断すること** (できれば accept/complete バイパスを根本封鎖)。なお store admin も `store_confirmed_at` の column grant を持たない (19_rls 確認済) ため、C.2 manual 確定も SECURITY DEFINER RPC か別経路が必要 — C.2 着手時に機構確定。

## invariants (壊さない)

- `24_vendor_rpcs.sql` は **alpha-1-public = touch 不可 invariant**。L3-7 の confirmation_mode 分岐は RPC 編集ではなく **post-migration 新規 SQL または TS service 層**で追加。
- UPDATE は `WHERE id=? AND version=?` IF MATCH + `version=version+1` (ADR-0007)。
- 通知は必ず notification_outbox 経由 (Resend 直叩き禁止)、payload.channel='email' 明示 (dispatcher は email のみ)。
- status 遷移は status_transitions に seed 済みのもののみ (trigger 最終防衛線)。新 status/遷移は seed 関数 (post/0015 系) と整合させ per-company seed + backfill。
- A.21-A.34 invariants (顧客 surface / purge / rate limit) 全件維持。
- outbox idempotency_key は §15.6 規約準拠 (衝突回避)。

## 次セッション (C.0 実装) の最初の手順

1. 本 plan handoff を読む (唯一文脈源)。
2. `post/0028_seed_transport_completed_status.sql` を実装 (§C.0 具体実装)。
3. spec/data-model.md §15.6 + §17.1 追記。
4. integration test (accept→completed 遷移)。
5. **adversarial review (raw-migration gate)** 通過 → seal。
6. seal 後: C.1 (auto 確定 fix + L3-6 cancel→reservation 連動)。

*Phase 64-C plan / Generated by Claude 2026-05-29 / D1=案A・D3=/clear 確定 / 次セッション: C.0 実装 (post/0028 status seed + spec + test + adversarial gate)*
