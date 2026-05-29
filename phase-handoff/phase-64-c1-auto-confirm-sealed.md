# Phase 64-C.1 auto 確定 (L3-7 auto 側) — sealed handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-C.1 (業者ループ閉鎖 / auto 確定, α 必須) |
| 種別 | implementation (raw-migration: trigger 追加) |
| Branch | `phase-64-mvp-implementation` |
| 前提 | C.0 sealed + CI green |
| 入力文脈 | `phase-64-c-vendor-loop-closure-plan.md` / `phase-64-c0-transport-completed-status-sealed.md` |
| 次タスク | **C.2** (manual 確定 / L3-8) |

## スコープ確定 (重要な plan 修正)

plan は C.1 = 「auto 確定 + L3-6 cancel→reservation 連動」だったが、調査の結果スコープを変更:

- **C.1 = auto 確定 (L3-7 auto 側) のみ実装**。
- **L3-6 (cancel→reservation 連動) は L2-3 と同時実装へ relocate** (理由は下記)。

## 実装したこと: auto 確定 (post/0029)

`transport_orders` の `BEFORE UPDATE OF status_id` trigger `trg_auto_confirm_on_accept` を追加。
`confirmation_mode='auto'` の order が accepted へ遷移したとき、`store_confirmed_at=now()` を同 UPDATE 内で自動セット (`store_confirmed_by_user_id` は NULL = system 確定)。

### 設計判断 (なぜ trigger か)

- accept は `respond_to_transport_order` RPC (24_vendor_rpcs.sql, SECURITY DEFINER) の `UPDATE ... SET status_id=accepted` で実行。RPC は **touch 不可 invariant**。
- `store_confirmed_at` は vendor の column-level GRANT UPDATE (19_rls_policies.sql:348-361) に**含まれない** → vendor session の直接 UPDATE で書けない。SECURITY DEFINER 経路が必須。
- 選択肢: (a) RPC を post-migration で CREATE OR REPLACE / (b) 新 trigger / (c) TS service。
  - (a) は 140 行の critical RPC を二重定義し **stale-shadow drift** を生む (C.0 gate が 0013 で指摘した型)。
  - (c) は vendor が store_confirmed_at を書けない (column grant 外)。
  - → **(b) trigger を採用**。RPC を改変せず behavior を追加、NEW 列書込は column grant の制約を受けない。advisor 是認。

### trigger 関数の最終形 (adversarial gate 反映後)

- `SECURITY DEFINER` + `search_path` 固定 (statuses key 解決 SELECT が呼び出し文脈非依存)。
- 発火条件: `confirmation_mode='auto'` AND `store_confirmed_at IS NULL` AND **`status_id IS DISTINCT FROM OLD.status_id`** (no-op UPDATE 誤発火防止, enforce と同ガード)。
- SELECT は `company_id` 突合 + **`is_active=true`** (RPC・全 key 解決 SELECT と対称, soft-disable 誤発火防止) で key='accepted' を確認。
- key='accepted' のとき `store_confirmed_at=now()` + `store_confirmed_by_user_id=NULL` を明示セット。
- `REVOKE EXECUTE FROM PUBLIC, anon, authenticated` / `DROP TRIGGER IF EXISTS`→`CREATE` で冪等。

## adversarial gate 結果 (raw-migration, 発火条件 #1)

### 発火条件チェック

1. **raw-migration**: `post/0029_auto_confirm_transport_on_accept.sql` (新 trigger + 関数 + REVOKE)。
2-4. 署名鍵/RLS新規/billing: なし。
5. cross-tenant boundary 新規: なし (NEW 列のみ書込, company 突合 SELECT)。

### レビュー手段

- **advisor 2 回 (pre-impl + BLOCK reconcile)**。
- **workflow `wf_0e798bd1-cf9`** (3 frame find→verify): 確定 3 件すべて LOW。
- **Codex adversarial (異モデル)**: BLOCK 1 + WARN 3 + INFO 1。**workflow が捕捉しなかった BLOCK/WARN を Codex が捕捉**。

### 対応した指摘

| 出所 | severity | 指摘 | 対応 |
|---|---|---|---|
| WF #1 | LOW | statuses SELECT に `is_active=true` 欠如 (RPC と非対称) | **`AND s.is_active=true` 追加** |
| Codex WARN | WARN | no-op UPDATE (`SET status_id=status_id`) で誤発火 | **`NEW.status_id IS DISTINCT FROM OLD.status_id` ガード追加** |
| Codex WARN | WARN | `store_confirmed_by_user_id` を NULL に明示しない (誤帰属) | **`NEW.store_confirmed_by_user_id := NULL` 追加** |
| Codex WARN | WARN | test が RPC/RLS 経路を踏まない | **既存 respond accept 統合 test に `storeConfirmedAt not null` + `storeConfirmedByUserId null` を bolt-on** (RPC 経路検証) |

### BLOCK の裁定 = C.1 を block しない / C.3 への hard checkpoint へ

- **Codex BLOCK**: vendor は column GRANT(status_id) (19_rls:358) + `vendor_portal_update` policy (同:341-344) により RPC を介さず `status_id=accepted` を直接 UPDATE 可能 (RPC の招待 revocation/履歴 side-effect をスキップ)。本 trigger により、その経路でも auto 行の `store_confirmed_at` がセットされる。
- **裁定 (advisor reconcile)**: このバイパスは **C.1 以前から存在** (grant+RLS は既存)、C.1 は新設しない。trigger は **auto-gate** されており、auto は「店舗が自動確定を事前承認」したモードゆえ accept 経路に依らず store_confirmed_at セットは意図どおり。**manual 行には発火しない**ため店舗の手動確定権限は保全。→ C.1 の限界的 escalation ≈ nil。
- **正直なトレードオフ**: RPC 内 auto-confirm 案より bypass 露出は広い (RPC 経路でない直接 UPDATE でも発火)。これは (a) の stale-shadow drift を避けるための**意図的選択**であり、auto-gate ゆえ無害。migration コメントに明記済み。
- **★ C.3 への hard checkpoint**: vendor の status 書込機構を確定する際、`status_id` を vendor GRANT から外し status 遷移を **RPC-only** にできれば、この accept バイパス (store_confirmed_at + 招待 revocation skip の両方) を根本的に塞げる。C.3 `completeAction` が status→completed をどう書くか (直接 UPDATE か SECURITY DEFINER RPC か) と結合するため C.1 では実施しない。**C.3 着手時に必ず判断すること**。

## L3-6 (cancel→reservation 連動) を relocate した理由

- `transport_orders.reservation_id` は createTransportOrderWithNotification を含め**どの経路からも書き込まれず常時 NULL** (repo-wide grep 確認済)。reservation→transport 連携 (L2-3, Phase 64-B) が未実装ゆえ。→ L3-6 連携は現状 **dead code**。
- reservation 状態機械は `confirmed` のみ seed・transition 皆無 (A.29「consumer 不在の状態機械を投機 seed するな」)。L3-6 実装には reservation `cancelled` status + `confirmed→cancelled` 遷移の per-company seed (新 raw-migration) + cancelTransportOrder の分岐が必要。
- spec **requirements.md:599「依頼キャンセル（関連予約もキャンセル状態へ遷移）」** が振る舞いを規定済 = 製品判断ギャップではなく純粋な sequencing。
- → **L2-3 (reservation→transport 上流連携) を実装する phase で L3-6 をまとめて実装する**。C-plan doc の進捗ログにも記録。

## 検証状態

- **ローカル**: `tsc --noEmit` 緑 / prettier 緑。
- **CI gate**: `db:setup` (post/0029 適用) + `test:integration`。新 test (`transport-auto-confirm-on-accept`: auto→セット / manual→NULL) + 既存 respond accept test の RPC 経路 assertion。**manual→NULL の assertion が auto-gate が効いている証左** (最重要 watch)。

## follow-up (別 phase)

1. **★ C.3 checkpoint (上記)**: vendor の status_id 直接 UPDATE バイパス封鎖 (RPC-only status 遷移)。C.3 着手時に判断。
2. **L3-6 + L2-3 同時実装**: reservation cancelled status seed + cancelTransportOrder reservation 連動 (req:599)。
3. C.0 由来 follow-up (0023 reservation seed REVOKE / triggers_notification 系統的監査 / _raw_migrations basename / 0013 stale comment) は継続。

## invariants (維持確認済み)

- `24_vendor_rpcs.sql` touch せず (trigger で behavior 追加)。
- enforce_status_transition と独立 (disjoint 列: store_confirmed_at vs status_id, 発火順非依存)。
- audit AFTER UPDATE trigger は auth.uid()=NULL でも 'system' actor で動作 (C.0 で確認済)。
- A.21-A.34 + C.0 invariants 全件維持。

## 次セッション (C.2) の最初の手順

1. 本 handoff + C.0 handoff + C-plan を読む。
2. **C.3 checkpoint を意識**: C.2/C.3 で vendor/store の status 書込機構を設計する際、status_id vendor GRANT の扱いを判断。
3. **C.2 = manual 確定 (L3-8)**: `confirmTransportOrder` service + admin `confirmAction`。store 側が store_confirmed_at/by をセット (楽観排他 IF MATCH version, 業者へ outbox `to:{id}:store_confirmed:v{version}`)。store admin も store_confirmed_at の column grant を持たない (19_rls 確認) ため SECURITY DEFINER RPC か別経路が必要 — C.2 着手時に機構を確定。
4. cancelTransportOrder の reservation 連動 (L3-6) は C.2 ではなく L2-3 phase。

*Phase 64-C.1 sealed / Generated by Claude 2026-05-30 / gate: advisor×2 + workflow wf_0e798bd1-cf9 + Codex / auto-confirm trigger (is_active+DISTINCT+by_user_id NULL) / L3-6 relocate / BLOCK→C.3 checkpoint / 次: C.2*
