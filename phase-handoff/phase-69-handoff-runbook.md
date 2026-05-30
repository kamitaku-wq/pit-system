# Phase 69 引き継ぎ Runbook (自律セッション成果 + 起床後の手順)

> 作成: 2026-05-31 深夜 / 自律実行セッション (承認済: 完成まで自律進行・commit/push可)。
> 関連: phase-69-beta-parallel-plan.md (計画v2) / phase-68-feature-audit.md (監査) / phase-69-progress.md (進捗)。
> **この Runbook が最優先の読み物**。コードはすべて push 済 (main)。

---

## 0. このセッションで何をしたか (要約)

監査(phase-68)→ 並列計画v2 (advisor+Codexレビュー反映)→ **検証可能なバックボーンを実装**して main に green-gate 付きで commit/push した。

**環境制約 (重要)**: このPCに**ローカルDBが無い** (Docker未稼働 / supabase CLI無 / .env.local無)。
→ 緑ゲートは `tsc + unit + build(ダミーenv)` のみ実行可能。**migration適用 / integration実行 / 視覚確認は実行不可 → 起床後タスク**。

### 完了 (verified: tsc + unit + build 緑、push済)
| ストリーム | 内容 | 検証状態 |
|---|---|---|
| **S0a** statuses.color | 0034 migration + schema + status-color.ts (解決helper) + service配線 + unit5 | ✅ code-green / migration適用は要DB |
| **S1** 業者通知メール描画層 | vendor-emails.ts (純builder) + service payload配線 + dispatcher欠損ガード + unit7 + integration契約 | ✅ code-green / 実送信は要DB |
| **S2** 稼働率 service | pit-utilization.ts (純計算 + DB seam) + unit10 + integration | ✅ 純計算verified / DB seamはintegrationで要検証 |
| **S0c** invitation expirer | transport_order_invitations 期限切れ自動処理 + inngest統合 + unit+2 | ✅ code-green / 実動作は要DB |

### コミット (main, push済)
- c598207 docs: 監査+計画v2+レビュー+進捗
- f2fb7d3 feat: statuses.color (S0a)
- dad6c7a fix: 業者通知メール描画層 (S1) ← **spec最重要機能の修復**
- f542df3 feat: 店舗別ピット稼働 集計 service (S2 core)
- (S0c) feat: transport invitations 期限切れ
- (test) getStorePitUtilization integration
- 進捗docコミット数件

---

## 1. ★起床後の実行手順 (この順で)

### Step 1: DB環境を立てる
```bash
# 必要: Docker Desktop 起動 → ローカル Supabase
# (supabase CLI 未導入なら) npm i -g supabase  ※ または scoop/brew
supabase start              # ローカル Postgres 起動 (127.0.0.1:54321 等)
# .env.local を作成 (.env.example を参照)。最低限:
#   DATABASE_URL / DIRECT_URL = supabase start が出力する Postgres 接続 (127.0.0.1)
#   NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY / SUPABASE_SERVICE_ROLE_KEY
#   RESEND_API_KEY / RESEND_FROM_EMAIL (S1実送信確認に必要)
```

### Step 2: migration 適用 (★最優先・新規SQLの健全性確認)
```bash
pnpm db:setup     # raw(pre) → raw(alpha-1-public) → drizzle migrate → raw(post)
# 新規適用される post: 0034_statuses_color.sql (本セッション追加)
```
- **注意**: `0034` の backfill CASE は seed の key を推測している。**不一致でも color=NULL → フロント既定色 (status-color.ts) で正しく描画されるので「直さなくて良い」**。CASE を“修正”しないこと。
- statuses.color は会社が任意ステータスに色を指定する列。NULL は status-color.ts の既定色 (確定=緑/仮=黄/作業中=青) にフォールバック。

### Step 3: integration テスト (本セッション追加分が loud pass/fail)
```bash
pnpm test:integration
```
期待:
- `transport-orders.integration` の create テストで **payload.{to,subject,html} が非空** (S1回帰防止)。
- `pit-utilization.integration` で 稼働店舗33%/休業店舗0% (S2 seam: JST境界/dayOfWeek=0日/休業日/集計)。
- ※ dayOfWeek 規約は `DAY_LABELS=["日","月",…]`(0=日) と `jstDayOfWeek`(getUTCDay) が一致することを確認済。integration が green ならDBと整合。

### Step 4: S1 実送信確認 (spec最重要機能)
```bash
pnpm inngest:dev   # 別ターミナルで outbox-dispatcher を回す
pnpm dev
```
- 管理画面で **email を設定した業者** を用意 → 回送依頼を作成 (/admin/transport-orders/new)。
- outbox 行に payload が積まれ、dispatcher が Resend で**中身のある業者メール**を送ることを確認 (Inngest ログ / Resend ダッシュボード)。
- 業者に email が無い場合は dispatcher が `missing email payload field(s): to` で **failed** にする (運用画面に可視化)。これは仕様通り。
- **★想定内 (regressionではない)**: cancel / reopen / store_confirmed の業者メールは現状まだ to/subject/html を組んでいない (S1は初回招待のみ実装)。よってこれらイベントの outbox 行は `failed: missing email payload field(s): to` になる。**これは従来から業者メールが描画されていなかった既存ギャップが本変更の dispatcher ガードで可視化されただけ**で、本変更が壊したのではない (旧実装でも空メールで Resend エラー→failed だった)。§2E の S1追補で各テンプレを実装すれば解消。

### Step 5: 視覚適合 (デザイン乖離=本効果の起点の検証)
`pnpm dev` で各画面を confirmed PNG (docs/assets/screenshots) と比較:
- ダッシュボード ← c1-dashboard.png (※ピット稼働セクションは**未実装**=残作業)
- カレンダー ← c2-calendar/compact.png (※縮小モード/色分け=**未実装**=残作業)
- 整備伝票バッジ ← c6-tickets.png (statuses.color 適用は**未実装**=残作業)

---

## 2. 残作業 (本セッション未実装・精密仕様)

> 方針: UI は視覚確認が必須 (DB必須) のため、無人セッションでは**意図的に着手しなかった** (advisor判断: 認証不能なUIをmainに積むと「コード上done・デザイン乖離」の再発になる)。以下は DB が立った後に着手する。

### A. S0b version×4 (楽観排他, spec §10.2.2) — migration+配線を一括でDB検証
- migration: reservations / service_tickets / customers / vehicles に `version integer NOT NULL DEFAULT 1` (transport_orders は実装済が手本)。
- OptimisticLockError class + 各 update/delete service を `WHERE id=? AND version=?` + `SET version=version+1`、0行→throw に。detail page に hidden expectedVersion、action で parse。
- 委任適性: Codex (table毎分割)。ただし migration は main 専管。**DB検証必須なので一括で**。

### B. S2 UI (核心・最優先の残作業) — pit-utilization.ts を consume
- **今日の工場ボード** (新規 /admin/floor, c6-floor.png) ← getStorePitUtilization を使う。
- **ダッシュボード** ピット稼働セクション + 本日予約KPI + 通知失敗KPI (c1-dashboard.png)。**既存dashboardの編集は視覚確認しながら**慎重に。
- **カレンダー** 縮小モード(店舗カードgrid) + ステータス色分け(status-color.ts の resolveStatusColor/statusBadgeStyle) + フィルタ (c2-calendar/compact.png)。
- 委任適性: Claude核心(稼働率消費の設計) + Codex(カラーバー/バッジUI)。**視覚適合ゲート必須**。

### C. S3 業者ポータル (contract-first) — d1〜d6.png
- 3a: vendor-shell.tsx nav 5項目+「段取りくん」/ `vendor-portal-orders.ts` query service新設 / inbox contract (main先行)。
- 3b: 通知inbox(4.0) / 依頼詳細(4.2 store/vehicle JOIN)。
- 3c: 新規依頼一覧(4.1) / 対応可否モーダル(4.3) / 進捗更新(4.4) / 招待4ステップ(4.3.1)。
- ※ S3 は `transport-orders.ts`(2402行) を直接触らず vendor-portal-orders.ts 経由 (Codex#3衝突回避)。

### D. S4 設定/運用UI — f11/f15/c8.png
- 権限 操作×ロール マトリクス(f15) / 通知失敗運用UI日本語化+タブ+一括再送(c8) / statuses.color color picker(f11) / version IF MATCH配線(B依存)。
- 委任適性: Codex (独立・PNG確定)。

### E. S1 追補 — cancel/reopen/confirm の業者メール描画
- 本セッションは **初回招待(invite)のみ**実装。cancel/reopen/store_confirmed の outbox payload も to/subject/html を組む必要 (現状それらも空 → §1 Step4 の通り failed 表示)。vendor-emails.ts に buildVendorCancelEmail 等を追加し、transport-orders.ts の該当 payload 構築に to/subject/html を足す。
- **★注意 (advisor指摘)**: これらの構造化 payload (`invitee_email` / order snapshot) は **`inbox-worker.ts` (業者ポータル inbox 経路) が消費している可能性**がある。payload を**置換せず追加**で to/subject/html を足し、inbox-worker の消費を壊さないこと。着手前に inbox-worker.ts の payload 参照をトレースしてから。

### F. その他 (監査§8 / Codexレビュー)
- work_menus.visibleToCustomers の管理側UI露出 (顧客予約demo前提)。
- 顧客予約 rate limit 値 (実装 per-IP 5/600s vs spec 1分1回・1日5回) の合意・修正。
- 顧客予約 §5.1 仕上げ / §5.2 変更キャンセル導線 / 監査ログ閲覧UI 等 (should/later)。

---

## 3. 本セッションの判断 (ユーザー承認 or 私の裁量)
- statuses.color: **(B) migration採用**。NULL→フロント既定色フォールバック設計 (backfill不一致に強い)。
- メール描画: **render-at-enqueue** + **インライン文字列テンプレ** (計画のReact Emailから変更。repo規約=dispatcher直読み に統一。一貫性・単純性で優位)。
- 予約作成§2: **β must に復活**承認済 (未着手=残作業B/Cと並ぶ)。
- ナビIA全面刷新: **should保留**承認済 (floor/§2 の nav 追加のみ)。
- version×4: DB必須のため**一括をDB検証下で** (本セッションでは未着手、A参照)。

## 4. 緑ゲート補助
- build は env 必須 → `bash scripts/gate.sh pnpm build` (ダミーenv注入・**未追跡helper**・db:* には使うな)。
- 通常: `pnpm typecheck` / `pnpm test`(unit) はそのまま。

---
*Phase 69 Runbook / Claude 2026-05-31 自律セッション。検証可能なバックボーンを実装、UIはDB+視覚確認下で着手する残作業として精密仕様化。*
