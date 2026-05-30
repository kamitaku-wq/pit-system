# Phase 68: β-readiness 機能監査 (spec全章 × 実装 × confirmedデザイン 実体突き合わせ)

> 作成: 2026-05-31  
> 起点: β完走前の「やる/やらない」判断 + 核心デザイン乖離の可視化  
> 手法: Phase0スコープ + tenant整合 → 5エリア並列監査 (spec × 実装 × PNG 実読) → 敵対検証 → 統合  
> 状態凡例: `done` 実装完了 / `partial` 部分実装 / `stub` 骨格のみ / `missing` 未実装  
> ★ 検証後に finder 主張から変わったものは `(was: done)` を付記  
> ★ §6 の PDF 3 件 (admin-6.1/6.2/6.3) は finder/verifier による監査範囲外 — §8 参照

---

## 0. エグゼクティブサマリ

### 集計

| 状態 | 件数 |
|------|------|
| done | 13 |
| partial | 28 |
| stub | 3 |
| missing | 12 |
| **全項目** | **56** |

> ※ admin-6.1/6.2/6.3 は catalog 記載 (should/未実装) だが本監査の finder/verifier 対象外のため集計から除外。

| ラベル | 件数 |
|--------|------|
| beta_tag=must の残ブロッカー (未完または重大デザイン乖離) | **18** |
| must かつ verified=done | 13 |
| 「実装済だが demo 不可」(is_demo_ready=false) | 14 |

---

### β must ブロッカー一覧

以下はすべて `beta_tag=must` かつ「verified=done でない または is_demo_ready=false」のもの。

| # | 機能 | エリア | 状態 | is_demo_ready | 核心ギャップ |
|---|------|--------|------|---------------|-------------|
| 1 | ダッシュボード (1.1) | admin-business | partial | ✗ | 店舗別ピット稼働セクション・本日予約KPI・notification_outbox失敗KPI・タイムラインが完全欠落。業者通知3カードのみ |
| 2 | 今日の工場ボード (c6-floor) | admin-business | missing | ✗ | 実装ゼロ。ページもナビ動線も存在しない |
| 3 | ピット予約カレンダー (1.2) | admin-business | partial | ✗ | 縮小モード店舗カード grid・店舗/レーン/作業種別フィルタ・ステータス色分け・バッジがすべて欠落 |
| 4 | 予約作成画面 §2 全体 | admin-business | stub | ✗ | reservations テーブルへの管理側 INSERT パスが UI 上存在しない。§2.1–2.5 フロー全欠落 |
| 5 | ステータス設定 §3.10 — statuses.color | admin-settings | partial | ✗ | color カラムがスキーマにも UI にも存在しない。カレンダー色分けが DB レベルでブロックされる |
| 6 | 権限設定 §3.15 | admin-settings | partial | ✗ | 操作×ロール マトリクス UI 完全欠落。現実装はフラット list + UUID フィルタ |
| 7 | 通知失敗・運用画面 (1.8) | admin-business | partial | ✗ | テーブルヘッダが英字ハードコード。ステータスタブ・エスカレーションバナー・一括再送ボタン欠落 |
| 8 | 業者ポータル 通知 inbox (4.0) | vendor | missing | ✗ | 実装ゼロ。ナビ動線もなし |
| 9 | 業者ポータル 新規依頼一覧 (4.1) | vendor | partial | ✗ | 移動経路・距離・経路バッジ・回答期限残時間バッジが全列欠落。情報量が設計の30%程度 |
| 10 | 業者ポータル 依頼詳細 (4.2) | vendor | partial | ✗ | 店舗住所・車両情報・担当者連絡先・進行ステップ・緊急連絡先が全欠落。store/vehicle JOIN クエリが実装上存在しない |
| 11 | 業者ポータル 対応可否回答 (4.3) | vendor | partial | ✗ | 承諾時確認モーダル・同意チェックボックス欠落。UX がデザインと根本的に異なる |
| 12 | 業者ポータル 招待トークン受諾 (4.3.1) | vendor | partial | ✗ | ページロード直後に onboard を即実行。案件内容確認→同意→進む の 4 ステップ UX が全欠落 |
| 13 | 業者ポータル 進捗更新 (4.4) | vendor | partial | ✗ | ステップタイムライン・写真記録チェックリスト・段階的報告UI・トラブル報告ボタン欠落 |
| 14 | 業者ポータル ナビゲーション shell | vendor | partial | ✗ | ナビ1件のみ。通知inbox・対応中・完了済み・招待管理への動線が全欠落 |
| 15 | 通知 outbox 基盤 — email payload | cross-cutting | partial | ✗ | createTransportOrderAction が notificationPayload を渡さないため業者メールの to/subject/html が空文字列。業者通知が実質未機能 |
| 16 | 通知テンプレート React Email (§8) | cross-cutting | missing | ✗ | emails/ ディレクトリ存在しない。業者依頼メール・顧客予約完了メール等の全テンプレートが未実装 |
| 17 | 同時実行制御 — version 列 | cross-cutting | partial | ✗ | reservations / service_tickets / customers / vehicles に version カラムなし。transport_orders のみ実装済み |
| 18 | stale processing リカバリ | cross-cutting | partial (was: done) | ○ | invitation-expirer.ts は admin_vendor_invitations のみ対象。transport_order_invitations の期限切れ自動処理が未実装 |

---

### ★ デザイン乖離サマリ (実装済だが demo で見せると設計との差が露見する画面)

以下は「partial または done だが confirmed デザイン PNG との乖離が重大」な画面。上位ほど demo インパクトが大きい。

1. **ダッシュボード (1.1) — c1-dashboard.png との乖離 [critical]**  
   デザイン: 本日予約24件・業者未確認3・対応不可1・通知失敗2の4KPIカード + 店舗別ピット稼働バー (渋谷75%/横浜50%/川崎87%/横須賀42%) + 仮予約期限切れ間近リスト + 今日のタイムライン  
   実装: 業者対応系3カード (未確認/対応不可/遅延) + PriorityTable3本のみ。**ピット稼働セクション完全欠落**

2. **ピット予約カレンダー 縮小モード (1.2) — c2-compact.png との乖離 [critical]**  
   デザイン: 12店舗×2列グリッド、各店舗カードに稼働率カラーバー・予約件数/容量・稼働時間・店間件数・要対応バッジ。詳細表示でレーン別タイムライン+確定=緑/仮=黄/作業中=青の色分け  
   実装: 全予約を単一週ビューで単色表示。縮小モード・フィルタ・色分け・バッジが全欠落

3. **業者ポータル 新規依頼一覧 (4.1) — d2-new-list.png との乖離 [critical]**  
   デザイン: 移動経路・引取予定・距離・経路バッジ (指名/招待経由)・回答期限残時間 (赤バッジ)・エリア/期日フィルタ  
   実装: orderNumber/invitedAt/expiresAt/statusLabel のみ。情報量が設計の30%程度

4. **業者ポータル 依頼詳細 (4.2) — d3-detail.png との乖離 [critical]**  
   デザイン: 引取/搬入店舗の住所・電話・担当者、車両情報セクション (車種/ナンバー/車台番号/自走可否)、進行ステップ表示、緊急連絡先  
   実装: movementType/canDrive/希望日時/備考のシンプルdlグリッド。store/vehicle JOIN クエリが存在しない

5. **業者ポータル 進捗更新 (4.4) — d6-progress.png との乖離 [critical]**  
   デザイン: 縦型ステップタイムライン・写真記録チェックリスト (外観4方向/内装/メーター/キズ)・段階的報告ボタン  
   実装: datetime-local 3フィールドが横並びのシンプルフォームのみ

6. **通知失敗・運用画面 (1.8) — c8-ops.png との乖離 [demo 不可]**  
   デザイン: 日本語カラムヘッダ・ステータスタブ・エスカレーションバナー・一括再送ボタン  
   実装: テーブルヘッダが英字ハードコード ('eventType', 'target' 等) でそのままブラウザ表示

7. **整備伝票一覧 (1.6) — c6-tickets.png との乖離 [visible]**  
   デザイン: ステータスバッジに statuses.color 対応色 (緑/黄/青/赤)、フリーテキスト検索バー、印刷・CSV ボタン  
   実装: 全件 bg-blue-100 固定バッジ。フリーテキスト検索なし (statuses.color がスキーマにないため構造的ブロック)

8. **業者ポータル ナビゲーション shell — d1-inbox.png との乖離 [critical]**  
   デザイン: 5ナビアイテム (通知一覧バッジ/新規依頼バッジ/対応中/完了済み/招待管理)、ブランド名「段取りくん」  
   実装: 「依頼一覧」1件のみ。ブランド名「ピットマネ Vendor」

9. **業者ポータル 対応可否回答 (4.3) — d4-accept.png との乖離 [critical]**  
   デザイン: 承諾時モーダル (引取/搬入予定日時入力 + 同意チェックボックス)  
   実装: 承諾/辞退の2ボタン + 拒否理由 textarea のみ。モーダル形式が全くない

10. **権限設定 §3.15 — f15-perms.png との乖離 [demo 不可]**  
    デザイン: 操作×ロール マトリクスグリッド (本部管理者/店長/現場スタッフ/業者ユーザー/顧客 の列)  
    実装: flat list テーブル + UUID roleId フィルタ。IA が根本的に異なる

---

### demo_flow readiness チェックリスト

| # | demo ステップ | 判定 | 理由 |
|---|--------------|------|------|
| 1 | ログイン (Google OAuth / 許可ドメインゲート) | ○ | Phase 66 実装済み。本番 Google 設定待ちだが機能は完成 |
| 2 | 管理ダッシュボード確認 (店舗別ピット稼働カード・業者未確認バッジ・通知失敗バッジ) | ✗ | 店舗別ピット稼働セクション・本日予約KPI・通知失敗KPI が完全欠落 |
| 3 | 今日の工場ボード (c6-floor: レーンごとのリアルタイム稼働状況) | ✗ | 実装ゼロ |
| 4 | ピット予約カレンダー縮小モード (店舗カード grid: 稼働率バー・件数・店間件数・要対応バッジ) | ✗ | 縮小モード未実装。単一週ビュー単色表示のみ |
| 5 | カレンダー詳細表示トグル → レーン別タイムライン + ステータス色分け | ✗ | レーン別フィルタなし・ステータス色分けなし (statuses.color がスキーマにない) |
| 6 | 整備伝票の作成/確認 (/admin/service-tickets/new) | △ | 基本 CRUD は動作。ステータス色が全件青固定・フリーテキスト検索なし |
| 7 | 車両検索・紐付け (/admin/vehicles) | △ | 基本 CRUD は動作。現所有者・整備履歴件数カラムなし |
| 8 | 店間整備依頼の作成 → 業者選択 → 予約+伝票+transport_order+invitations 一括確定 (outbox 自動エンキュー) | △ | UI は動作するが outbox に email payload が渡らないため業者へのメール通知が実質未送信 |
| 9 | 業者通知・回送管理 (/admin/transport-orders) → 業者未確認一覧・招待管理ビュー確認 | △ | 一覧・詳細・フォールバックアクションは動作。右ペインスライドオーバー・CSV・緊急バッジは欠落。**outbox 送信不全により業者への通知が届かない可能性** |
| 10 | 業者ポータルに切替ログイン → 通知 inbox 確認 (d1-inbox) | ✗ | inbox 画面が実装ゼロ。ナビ動線なし |
| 11 | 業者 依頼詳細閲覧 → 対応可否回答 (対応可) → 引取/搬入/返却予定日時入力 | ✗ | 詳細に店舗住所・車両情報なし。対応可否モーダルUXがデザインと根本的に異なる |
| 12 | 管理側で業者対応確認・店舗確定 (store_confirmed_at) | △ | confirmTransportOrderAction は実装済み。詳細 UI は詳細ページで可能 |
| 13 | 業者ポータル 進捗更新 → 引取完了報告 → 搬入完了報告 | ✗ | ステップタイムライン・写真記録・段階的報告 UI が欠落 |

**判定基準**: ○ = 今すぐ demo 可能 / △ = 機能するが設計との乖離あり / ✗ = 実装が必要

---

### tenant_policy_note 要約

Phase 66 で「一社専用シンプル方式 + Google OAuth ドメインゲート」へ pivot したが、**DB 内部の company_id スコープおよび RLS は廃止されていない**。「一社専用」はプロダクト能力の選択 (マルチ社セルフサインアップをしないこと) であり、全テーブルの company_id NOT NULL + RLS policy は内部不変条件として維持されている。ADR-0001 は依然有効。β 期間中に「2社目を追加する機能」を実装する必要はない。service_role 経由アクセス (顧客 token 検証・vendor invitation callback・Google OAuth provisioning) は ADR-0010 の許可済み境界。

---

## 1. エリア別マトリクス — 管理画面・業務 (screen-list §1)

| 機能 | spec参照 | βタグ | 状態(検証後) | nav | action | tenant | デザイン乖離 | 証拠/ギャップ |
|------|---------|-------|-------------|-----|--------|--------|------------|-------------|
| ダッシュボード (1.1) | §1.1 c1-dashboard.png | must | partial | ○ | ○ | yes | **critical**: ピット稼働セクション・本日予約KPI・通知失敗KPI・タイムライン・期限切れ一覧が全欠落。業者対応3カードのみ | AdminDashboardMetrics に reservation/pit/outbox 集計なし |
| 今日の工場ボード (c6-floor) | §1.1/§1.2系 c6-floor.png | must | missing | ✗ | n/a | unknown | **critical**: 実装ゼロ | Glob 'src/app/admin/floor*/**' → No files found |
| ピット予約カレンダー (1.2) | §1.2 c2-calendar/compact.png | must | partial | ○ | ○ | yes | **critical**: 縮小モード・フィルタ・ステータス色分け・バッジ全欠落。全イベント単色表示 | calendar-client.tsx は color プロパティを fcEvents にマップしていない。selectable 未設定 |
| カレンダー空き枠ドラッグ予約作成 (1.2操作) | §1.2 roadmap β-1 | should | stub | ○ | ✗ | unknown | — | interactionPlugin 読込済だが selectable/select handler 未設定 |
| 顧客予約一覧 (1.3) | §1.3 c3-cust-res.png | should | missing | ✗ | n/a | unknown | — | /admin/reservations も /admin/customer-reservations も存在しない |
| 店間整備依頼 フル atomic (1.4) | §1.4 c4-transfer.png | should | partial | ○ | ○ | yes | c4-transfer.png: 3ステップウィザード・業者選択モード3択・スポット招待。実装はフラットフォーム単一フォーム | createTransportOrderAction 配線済み。ウィザード構造・複数打診・スポット招待なし |
| 業者通知・回送管理 (1.5) | §1.5 c5-vendor-notify.png | must | partial | ○ | ○ | yes | c5-vendor-notify.png: 右ペイン詳細スライドオーバー・緊急バッジ・CSVが欠落。通知履歴タイムラインは /[id] で実装済みを確認 | cancelAction/confirmAction/nextVendorAction/rescheduleAction/switchVendorAction 全配線済み |
| 整備伝票一覧/詳細/作成 (1.6) | §1.6 c6-tickets.png | must | partial | ○ | ○ | yes | ステータスバッジ全件 bg-blue-100 固定 (statuses.color なし)。フリーテキスト検索なし。印刷/CSVなし | listServiceTickets でページネーション・フィルタ実装済み。基本 CRUD 動作 |
| 車両一覧/詳細/作成 (1.7) | §1.7 c7-vehicles.png | must | partial | ○ | ○ | yes | 現所有者・整備履歴件数・CSV 取込なし。管理番号 (V-XXXXXX 形式) 未採用 | listVehicles キーワード検索・companyId スコープ実装済み。基本 CRUD 動作 |
| 通知失敗・運用画面 (1.8) | §1.8 c8-ops.png | must | partial (was: ✅ in phase-67) | ○ | ○ | yes | **demo不可**: テーブルヘッダが英字ハードコードでブラウザに表示。ステータスタブ・エスカレーションバナー・一括再送・担当割当なし | notifications/page.tsx のヘッダ列 ['eventType','target','attempts'...] を直接確認 |
| 監査ログ閲覧UI (1.9) | §1.9 c9-audit.png | should | missing | ✗ | n/a | unknown | — | audit_logs テーブルへの書込は存在するが閲覧 UI なし |
| 予約作成画面 §2 全体 | §2.1-2.5 | must | stub | ✗ | ✗ | unknown | — | reservations テーブルへの管理側 INSERT パスが UI 上存在しない。transport-orders/new は transport_orders のみ作成 |

---

## 2. エリア別マトリクス — 管理画面・設定マスター (screen-list §3)

| 機能 | spec参照 | βタグ | 状態(検証後) | nav | action | tenant | デザイン乖離 | 証拠/ギャップ |
|------|---------|-------|-------------|-----|--------|--------|------------|-------------|
| 設定トップ (§3.0) | §3 f0-settings.png | should | stub | ○ | ○ | n/a | f0-settings.png: カード形式ハブ (セクション別カード+レコード数バッジ)。実装は「（後続 Phase で実装予定）」テキストのみ | admin/settings/page.tsx 確認 |
| 会社設定 (§3.1) | §3.1 f1-company.png | should | stub | ✗ | ✗ | unknown | f1-company.png: ブランド/連絡先/免責文言3セクションフォーム。実装なし | 専用ページ不在 |
| 店舗設定 (§3.2) | §3.2 | must | done | ○ | ○ | yes | — | listStores()/createStore/updateStore/deleteStore 全配線済み |
| 店舗営業時間/休日 (§3.3) | §3.3 f3-hours.png | must | partial | ○ | ○ | yes | f3-hours.png: 全店舗×全曜日クロスマトリクス+統合休業日リスト。実装は stores/[id] 内単一店舗フォームのみ | replaceStoreBusinessHoursAction/createHolidayAction 実装済み。クロス店舗比較ビューなし |
| レーン設定 (§3.4) | §3.4 f4-lanes.png | must | partial | ○ | ○ | yes | f4-lanes.png: インラインモーダル編集 (鉛筆アイコン+toggle)。実装は別ページ遷移 (/admin/lanes/[id]) | listLanes()/CRUD/replaceLaneWorkMenusAction 実装済み。機能的同等だが UX 異なる |
| レーン稼働時間 (§3.5) | §3.5 | must | done | ○ | ○ | yes | — | replaceLaneWorkingHoursAction 実装済み |
| レーン種別設定 (§3.6) | §3.6 | must | done | ○ | ○ | yes | — | listLaneTypes() CRUD 実装済み |
| 作業カテゴリ設定 (§3.7) | §3.7 | must | done | ○ | ○ | yes | — | work-categories.ts 実装済み |
| 作業メニュー設定 (§3.8) | §3.8 f8-menus.png | must | partial | ○ | ○ | yes | f8-menus.png: カテゴリ折り畳みツリー+月間利用数+インライン編集パネル。実装は通常テーブル+別ページ遷移 | visibleToCustomers カラムがスキーマにあるが新規作成フォームに露出していないという追加ギャップを検証で確認 |
| 予約枠設定 (§3.9) | §3.9 | should | missing | ✗ | ✗ | n/a | — | スキーマは存在するが専用 UI ページなし |
| ステータス設定 §3.10 — statuses.color | §3.10 f11-status.png | must | partial (was: ✅ in phase-67) | ○ | ○ | yes | **critical blocker**: color/icon カラムがスキーマにも UI にも存在しない。カレンダー色分けが DB レベルでブロック | statuses.ts に color カラム確認 → 0件。phase-68 schema precheck でも指摘済みの唯一のスキーマギャップ |
| 状態遷移ルール設定 (§3.11) | §3.11 f13-states.png | must | partial | ○ | ○ | yes | f13-states.png: DAG グラフビジュアライゼーション+インライン右パネル。実装はフラットテーブル+別ページ遷移 | listStatusTransitions() CRUD 実装済み。グラフ可視化なし |
| 回送・陸送業者マスター (§3.12) | §3.12 f10-vendors.png | must | partial (was: ✅ in phase-67) | ○ | ○ | yes | f10-vendors.png: エリア/対応店舗数/対応曜日/実績件数/達成率列あり。実装一覧は招待管理に特化 (業者名/招待ステータス/招待メール/送信日時のみ) | vendors/[id] でエリア・対応店舗・対応曜日の管理は実装済み |
| 業者ユーザー管理 (§3.13) | §3.13 | must | partial (was: done) | ○ | ○ | yes | — | vendors/[id]/page.tsx 全文確認 → vendor_users ロスター (メール/名前/最終ログイン/有効無効) テーブルが存在しない。招待送信/再送/取消は動作 |
| 通知ルール設定 (§3.14) | §3.14 f14-rules.png | should | partial | ○ | ○ | yes | f14-rules.png: ルール名日本語/トリガー説明/チャネルアイコン+インライン編集パネル。実装は event_type キー生文字列テーブル | CRUD 実装済み。管理者向け UX が developer-facing で操作困難 |
| 権限設定 §3.15 | §3.15 f15-perms.png | must | partial (was: ✅ in phase-67) | ○ | ○ | yes | **critical**: f15-perms.png の操作×ロール マトリクスグリッドが完全欠落。現実装は flat list + UUID フィルタで IA が根本的に異なる | permissions/page.tsx 確認。f15-perms.png 画像実読で マトリクス形式を確認 |
| 表示項目設定 (§3.16) | §3.16 | later | missing | ✗ | ✗ | n/a | — | 実装なし |
| 顧客本人確認設定 (§3.17) | §3.17 f17-kyc.png | should | partial | ○ | ○ | yes | f17-kyc.png: 認証コード設定フォーム+個人情報保持期間設定。実装は customer-reservation-tokens の token 管理リスト (全く別用途) | KYC 設定フォームが実装上存在しない |
| 監査ログ設定 (§3.18) | §3.18 | later | missing | ✗ | ✗ | n/a | — | 実装なし |
| 社内ユーザー管理 (admin/users, Phase 66) | phase-66 | must | done | ○ | ○ | yes | — | listInternalUsers()/updateInternalUserAction 実装済み。companyId スコープ確認 |

---

## 3. エリア別マトリクス — 業者ポータル (screen-list §4)

| 機能 | spec参照 | βタグ | 状態(検証後) | nav | action | tenant | デザイン乖離 | 証拠/ギャップ |
|------|---------|-------|-------------|-----|--------|--------|------------|-------------|
| 業者ログイン (vendor/login) | §4 vendor_users認証 | must | done | n/a | ○ | yes | — | signInWithPassword/logoutAction/withAuthenticatedDb RLS発火 確認 |
| 業者ポータル 通知 inbox (4.0) | §4.0 d1-inbox.png | must | missing | ✗ | ✗ | unknown | **critical**: d1-inbox.png の severity バッジ付き通知カード・未読/すべて/アーカイブタブが実装ゼロ | vendor_portal_inbox スキーマは存在。/vendor/inbox ページなし。vendor-shell ナビ動線なし |
| 業者ポータル 新規依頼一覧 (4.1) | §4.1 d2-new-list.png | must | partial | ○ | ○ | yes | **critical**: 移動経路・距離・経路バッジ・回答期限残時間バッジが全列欠落。情報量が設計の30%程度 | response='pending' 単一フィルタ。.limit(50) でページネーションなし。タブ切替なし |
| 業者ポータル 依頼詳細 (4.2) | §4.2 d3-detail.png | must | partial | ○ | ○ | yes | **critical**: 引取/搬入店舗の住所・電話・担当者、車両情報セクション、進行ステップが全欠落 | SELECT に stores/vehicles JOIN が存在しない |
| 業者ポータル 対応可否回答 (4.3) | §4.3 d4-accept.png | must | partial | ○ | ○ | yes | **critical**: d4-accept.png の承諾時確認モーダル (日時入力+同意チェック) が未実装。2ボタン+textarea のみ | respondAction → DB永続化は確認。同意チェックボックス・競合通知・拒否理由 label が sr-only のみ |
| 業者ポータル 招待トークン受諾 (4.3.1) | §4.3.1a-d d5-invite.png | must | partial | n/a | ○ | yes | **critical**: d5-invite.png の4ステップフロー (依頼内容確認→業者情報→パスワード設定→受注完了) が全欠落。即 onboard 実行 | invitations/[token]/page.tsx はページロード直後に onboardSpotInvitationAction を即実行 |
| 業者ポータル 進捗更新 (4.4) | §4.4 d6-progress.png | must | partial | ○ | ○ | yes | **critical**: ステップタイムライン・写真記録チェックリスト・段階的報告UI・トラブル報告ボタンが全欠落 | schedule-form/complete-form は datetime-local 3フィールド横並びのみ。DB 永続化は確認 |
| 業者ポータル ナビゲーション shell | §4 d1-inbox.png | must | partial | ✗ | n/a | n/a | **critical**: ナビ1件のみ。5アイテム中4動線欠落。ブランド名「ピットマネ Vendor」vs 設計「段取りくん」 | vendor-shell.tsx navigationItems = [{label:'依頼一覧', href:'/vendor/requests', icon:ClipboardList}] のみ |

---

## 4. エリア別マトリクス — 顧客公開予約 (screen-list §5)

| 機能 | spec参照 | βタグ | 状態(検証後) | nav | action | tenant | デザイン乖離 | 証拠/ギャップ |
|------|---------|-------|-------------|-----|--------|--------|------------|-------------|
| 顧客予約フロー 6ステップ (5.1) | §5.1 e1-step1~6.png | should | partial | n/a | ○ | yes | step1: 「段取りくん」ブランド/ステップカウンタ/検索/距離なし。step4: ToSチェックなし・電話番号 optional。完了画面: R-XXXX-XXXX フォーマットなし・QRコードなし・変更/キャンセル導線なし | reservation-wizard.tsx 741行確認。listPublicWorkMenus/listAvailableSlots/createPublicReservation は実 DB 操作済み。rate limit 値が spec §5.5「1分1回・1日5回」と不一致 (実装: per-IP 5/10分) |
| 顧客予約確認 token URL (5.2) | §5.2 e2-confirm.png | should | partial | n/a | ○ | yes | e2-confirm.png: 変更/キャンセルボタン・予約番号フォーマット (R-XXXX)・店舗電話番号が欠落。GET-safe 消費ボタン方式は ADR 意図的差異 | confirm-form.tsx 128行確認。変更/キャンセルへの導線ゼロ。予約番号フィールドが Row リストに存在しない |
| 顧客予約変更 (5.3) | §5.3 e3-modify.png | should | missing | n/a | ✗ | unknown | — | modify トークン経由フロー完全未実装。token_purpose='modify' はスキーマに定義済み |
| 顧客予約キャンセル (5.4) | §5.4 e4-cancel.png | should | missing | n/a | ✗ | unknown | — | cancel トークン経由フロー完全未実装。token_purpose='cancel' はスキーマに定義済み |
| 認証コード再送 (5.5) | §5.5 e5-resend.png | should | partial | n/a | ○ | yes | e5-resend.png: 専用画面・残回数カウンタ・カウントダウン・マスク表示が全欠落。wizard step7 内の1ボタンのみ | rate limit 値: vcode per-IP 5/600s。e5-resend.png フッタ「1分につき1回、1日5回」と不一致 |

---

## 5. エリア別マトリクス — 横断要件 (非画面)

| 機能 | spec参照 | βタグ | 状態(検証後) | nav | action | tenant | デザイン乖離 | 証拠/ギャップ |
|------|---------|-------|-------------|-----|--------|--------|------------|-------------|
| 認証基盤 (Google OAuth + ドメインゲート + vendor_users パスワード) | ADR-0010 phase-66 | must | done | n/a | ○ | yes | — | signInWithOAuth/provisionInternalUserByEmail/allowed_email_domain 照合/middleware リダイレクト全確認 |
| テナント分離 (company_id 全テーブル + RLS + current_user_company_id()) | ADR-0001 data-model §2 | must | done | n/a | n/a | yes | — | 18_helper_functions.sql/19_rls_policies.sql 確認。43テーブルに tenant_isolation policy |
| 通知 outbox 基盤 — email payload が空 | ADR-0002 requirements §18 | must | partial | n/a | ○ | yes | — | **critical**: createTransportOrderAction が notificationPayload を渡さない。payload={} でメール to/subject/html が空文字列 → 業者通知実質未送信 |
| 通知テンプレート React Email (§8) | requirements §18 screen-list §8 | must | missing | n/a | ✗ | n/a | — | emails/ ディレクトリ存在しない。業者依頼/顧客予約完了/前日リマインド等の全テンプレート未実装。outbox-dispatcher は payload.html 直読み |
| 監査ログ書込・PII redaction | ADR-0009 requirements §19 | must | done | n/a | ○ | yes | — | 15_audit.sql/23_record_audit_log.sql/18_helper_functions.sql 確認。9テーブルへの AFTER INSERT/UPDATE/DELETE トリガー。redact_audit_payload() 動作確認 |
| 同時実行制御 — version 列 | ADR-0006/ADR-0007 data-model §2 | must | partial | n/a | ○ | yes | — | exclusion constraint (11_reservations.sql) は実装済み。transport_orders の version 実装済み。reservations/service_tickets/customers/vehicles に version カラムなし → spec §10.2.2 違反 |
| stale processing リカバリ / エッジケース | requirements §18.1 | must | partial (was: done) | n/a | ○ | yes | — | outbox stale recovery (outbox-dispatcher.ts) は確認。invitation-expirer.ts は admin_vendor_invitations のみ対象 → transport_order_invitations の自動期限切れ処理が未実装 |
| モバイル対応方針 (§7) | requirements §30 screen-list §7 | should | stub | n/a | n/a | n/a | — | Tailwind+shadcn使用確認。業者ポータル/顧客向けのレスポンシブクラス詳細確認は本監査未実施 |
| LINE/SMS 通知チャネル拡張 | roadmap §2.4 β-4 | later | missing | n/a | ✗ | n/a | — | outbox-dispatcher で channel !== 'email' は明示的 unsupported。Phase 5 移動確定 |
| 経理証跡 view / billing_records | roadmap §2.4 spec/CLAUDE.md Tier2 | later | missing | n/a | ✗ | n/a | — | quoted_amount_minor/tax_rate_bps/billing_status は schema 存在。billing_records テーブルは Phase 5 |

---

## 6. phase-67 inventory との差分

以下は本監査の finder/verifier が、phase-67 inventory の判定と異なることを確認した項目。

| 機能 | phase-67 inventory | 本監査の判定 | ソース根拠 |
|------|-------------------|------------|-----------|
| 通知失敗・運用画面 (1.8) | ✅ 実装済み | **partial** (demo不可) | notifications/page.tsx のテーブルヘッダが英字ハードコード ['eventType','target','attempts','lastError','nextAttemptAt','createdAt','requeue-button'] をブラウザ表示することを verifier が実ファイル確認 |
| ステータス設定 §3.10 | ✅ 実装済み | **partial** (is_demo_ready=false) | statuses.ts スキーマに color/icon カラムが存在しないことを verifier が直接確認。phase-68-schema-precheck でも「唯一のスキーマギャップ」として記録済み |
| 回送・陸送業者マスター §3.12 | ✅ 実装済み | **partial** | vendors/page.tsx 一覧が招待管理特化 (業者名/招待ステータス/送信日時のみ)。f10-vendors.png が要求するエリア/対応店舗数/実績件数列を表示していないことを verifier が確認 |
| 権限設定 §3.15 | ✅ 実装済み | **partial** (is_demo_ready=false) | permissions/page.tsx が flat list であることと、f15-perms.png が操作×ロール マトリクスグリッドであることを verifier が双方実読確認 |
| 業者ユーザー管理 §3.13 | ✅ 実装済み | **partial (was: done)** | vendors/[id]/page.tsx を全文実読 → vendor_users ロスター (メール/名前/最終ログイン/有効無効) テーブルが存在しないことを確認。招待管理は機能するが §3.13 の要件全体は未充足 |
| stale processing リカバリ | ✅ (finder) | **partial (was: done)** | invitation-expirer.ts を実読 → admin_vendor_invitations のみ対象。transport_order_invitations の expires_at 超過行を自動 expired 化する Inngest function が存在しないことを verifier が確認 |
| 顧客予約 §5 全体 | ✅ 実装済み (一括) | §5.1=partial, §5.2=partial, §5.3=missing, §5.4=missing, §5.5=partial | reservation-wizard.tsx/confirm-form.tsx/src/app/r/ 配下の Glob を finder が実確認。5.3/5.4 は UI ページが存在しない |
| 業者ポータル §4 全体 | ✅ 実装済み (一括) | inbox=missing, 4.1–4.4=partial, shell=partial | 各 page.tsx を finder/verifier が実読。inbox 画面ゼロ・store/vehicle JOIN クエリなし等を確認 |
| 通知テンプレート (§8) | 記載なし | **missing** | emails/ ディレクトリが存在しないことを finder が Glob 確認。cross-cutting として本監査で初めて記録 |
| 楽観排他 — reservations 等の version 列 | 記載なし | **partial** | schema/reservations.ts 等で 'version' 文字列 0 件を finder が確認。transport_orders のみ実装済みという状況を初めて記録 |

---

## 7. やる/やらない 判断材料

> 重さ感: **大** = 設計・DB変更・複数コンポーネント横断 / **中** = 単一画面の機能追加 / **小** = UI 修正・ラベル修正  
> 委任適性: 「Codex 委任向き」= 仕様明確・独立性高 / 「Claude 核心」= 設計判断・複数コンテキスト依存

### β でやるべき (must で未完 または 重大デザイン乖離)

| # | 機能 | 重さ感 | 独立性 / 仕様明確性 | 委任適性 |
|---|------|--------|---------------------|---------|
| 1 | statuses.color — migration (ALTER TABLE + UI) | 小 | 独立高・仕様明確 | **Codex 委任向き**: migration 1本 + statuses フォームに color picker 追加 |
| 2 | 通知 outbox — email payload 修正 | 中 | 独立高・仕様明確 | **Codex 委任向き**: createTransportOrderAction で vendor email を解決して payload に渡す。outbox-dispatcher との契約が仕様書で明確 |
| 3 | 通知テンプレート React Email (§8) 最小セット | 中 | 独立高・仕様明確 | **Codex 委任向き**: 業者依頼メール (to/subject/html の3フィールド) のみ先行。React Email テンプレート生成は仕様が明確 |
| 4 | 通知失敗・運用画面 (1.8) — テーブルヘッダ日本語化 + ステータスタブ | 小 | 独立・仕様明確 | **Codex 委任向き**: notifications/page.tsx の UI 修正。ラベルと状態フィルタの追加 |
| 5 | 業者ポータル ナビゲーション shell 拡張 | 中 | 独立高 | **Codex 委任向き**: vendor-shell.tsx に4アイテム追加 + 対応するページ routing。仕様は d1-inbox.png で視覚確定済み |
| 6 | 業者ポータル 通知 inbox (4.0) | 大 | 独立中 | Claude 核心判断あり (severity 表示ロジック・既読管理の状態設計) + Codex 画面実装委任の併用 |
| 7 | 業者ポータル 新規依頼一覧 (4.1) — 情報密度向上 | 中 | 独立中・仕様明確 | **Codex 委任向き**: requests/page.tsx の SELECT に移動経路・距離・回答期限残時間を追加。d2-new-list.png で仕様確定 |
| 8 | 業者ポータル 依頼詳細 (4.2) — store/vehicle JOIN | 中 | 独立高・仕様明確 | **Codex 委任向き**: requests/[id]/page.tsx の SELECT に stores/vehicles JOIN を追加。d3-detail.png で仕様確定 |
| 9 | 業者ポータル 対応可否回答 (4.3) — 承諾確認モーダル + 同意チェック | 中 | 独立高 | **Codex 委任向き**: respond-form.tsx にモーダル + 日時入力 + 同意チェックを追加。d4-accept.png で仕様確定 |
| 10 | 業者ポータル 招待トークン受諾 (4.3.1) — 4ステップ UX 実装 | 大 | 独立中 | **Claude 核心**: onboard フローの状態設計・spec §4.3.1a-d の4ルート分岐判断を含む |
| 11 | 業者ポータル 進捗更新 (4.4) — ステップタイムライン + 段階的報告 | 大 | 独立中・仕様明確 | Codex 委任向き (d6-progress.png で視覚仕様確定)。写真記録は storage 設計判断が必要なため Claude 核心 |
| 12 | ダッシュボード (1.1) — 店舗別ピット稼働セクション | 大 | 独立低 (reservation/lane/計算ロジックを横断) | **Claude 核心**: 稼働率計算 (予約済分/稼働可能分) のクエリ設計は service 層設計判断を含む |
| 13 | ピット予約カレンダー (1.2) — 縮小モード + 色分け | 大 | 独立中 | Claude 核心 (稼働率計算・店舗カード設計) + Codex 委任 (カラーバー/バッジ UI 実装) の分業を推奨 |
| 14 | 今日の工場ボード (c6-floor) | 大 | 独立中 | Claude 核心: Kanban ボードの状態設計・vehicle_reservation との結合クエリ設計を含む |
| 15 | 予約作成画面 §2 全体 | 大 | 独立低 (reservations/service_tickets/transport_orders 横断) | **Claude 核心**: 複数エンティティ横断の atomic 作成フロー設計 |
| 16 | 権限設定 §3.15 — 操作×ロール マトリクス UI | 大 | 独立高・仕様明確 | **Codex 委任向き**: f15-perms.png で UI 仕様確定。データは既存 permissions テーブルから集計するだけ |
| 17 | reservations/service_tickets/customers/vehicles への version 列追加 | 中 | 独立高・仕様明確 | **Codex 委任向き**: migration 4本 + OptimisticLockError ハンドリング追加。spec §10.2.2 で仕様確定 |
| 18 | transport_order_invitations 期限切れ自動処理 (Inngest function 追加) | 小 | 独立高・仕様明確 | **Codex 委任向き**: invitation-expirer.ts を transport_order_invitations にも対応させる。admin_vendor_invitations 版をテンプレートにできる |

### やると良い (should で未完)

| 機能 | 重さ感 | 委任適性 |
|------|--------|---------|
| 店間整備依頼 フル atomic §1.4 — 3ステップウィザード | 大 | Codex 委任向き (仕様は c4-transfer.png で視覚確定) |
| 業者通知・回送管理 §1.5 — 右ペインスライドオーバー | 中 | Codex 委任向き |
| カレンダー空き枠ドラッグ予約作成 | 中 | Codex 委任向き (FullCalendar select handler の追加) |
| 作業メニュー §3.8 — visibleToCustomers UI 露出 | 小 | Codex 委任向き |
| 設定トップ §3.0 — カード形式ハブ | 小 | Codex 委任向き |
| 会社設定 §3.1 | 中 | Codex 委任向き |
| 予約枠設定 §3.9 専用 UI | 中 | Codex 委任向き |
| 顧客予約フロー §5.1 — デザイン仕上げ (ブランドヘッダ/QR/フォーマット済み予約番号) | 中 | Codex 委任向き (仕様は PNG で確定) |
| 顧客予約確認 §5.2 — 変更/キャンセルボタン追加 | 小 | Codex 委任向き |
| モバイル対応確認 (業者ポータル) | 中 | E2E ランナーで視覚確認後に修正 |

### β ではやらない (later)

| 機能 | 理由 |
|------|------|
| 表示項目設定 §3.16 | Phase 5 確定。β 運用上必須度低 |
| 監査ログ設定 §3.18 | Phase 5 確定 |
| 監査ログ閲覧 UI §1.9 | β-4 相当。書込基盤は done |
| 顧客予約変更 §5.3 | β-3 スコープ |
| 顧客予約キャンセル §5.4 | β-3 スコープ |
| LINE/SMS 通知チャネル拡張 | Phase 5 確定 |
| 経理証跡 / billing_records | Phase 5 確定 |
| 整備伝票 PDF §6.1 / 回送依頼書 PDF §6.2 / 店間移動指示書 PDF §6.3 | β-2 以降候補。本監査の finder/verifier 範囲外 (カタログ記載のみ) |

---

## 8. 監査の限界・未検証事項

### 静的検査の限界

1. **本番 DB・実データ依存の検証未実施**: RLS policy・outbox dispatch・楽観排他エラー挙動はすべて実 DB を使った E2E テストが必要。本監査はスキーマ SQL と Drizzle schema ファイルの静的確認に留まる。`current_user_company_id()` が実際に正しい値を返すかは本番データで確認要。

2. **outbox payload の実動作**: `createTransportOrderWithNotification` が `notificationPayload={}` で呼ばれている事実はコード確認済みだが、実際の Resend API 呼び出しでエラーになるのか・ゴミメールが送られるのかは E2E または Inngest ログで確認要。

3. **Google OAuth 本番設定**: 認証基盤のコードは完成しているが Client ID/Secret の本番 provisioning は環境変数依存。seed に `viewer` role が存在しない場合は `no_viewer_role` で弾かれる可能性あり (seed 実行確認要)。

4. **PNG 比較の主観性**: デザイン乖離の判定は finder/verifier による画像実読に基づくが、「どこまでが必須でどこまでが polish か」はユーザーの判断に委ねる。本マトリクスは **demo で一目瞭然な差異** を critical として記録した。

5. **admin-6.1/6.2/6.3 (PDF 印刷系)**: β スコープ catalog に should として記載されているが、本監査のいずれの finder/verifier も担当していない。カタログ記載の「未実装」のみ信頼できる情報とする。

6. **モバイルレスポンシブ確認**: vendor-shell.tsx / requests/page.tsx 等に Tailwind の `sm:/md:` クラスが実際に使われているかの詳細調査は未実施。業者がスマホで操作するシナリオがデモに含まれる場合は事前確認推奨。

7. **§5 顧客予約フロー の rate limit 実動作**: `per-IP 5/600s` と spec の「1分1回・1日5回」の差がデモ環境で問題になるかは負荷条件次第。β-3 着手前に仕様値を合意・コード修正が必要。

8. **pg_cron の本番適用**: `purge_expired_reservation_rows` は `manual/0007` として手動適用が必要。rate_limit_counters / reservation_verification_codes の purge はこれに依存する。本番セットアップ手順書への記載確認要。

9. **work_menus.visibleToCustomers の管理側露出**: verifier が work-menus/new/page.tsx フォームに `visibleToCustomers` チェックボックスが存在しないことを確認した。DB スキーマには存在するが管理者が値を変更する手段がない状態。β-3 顧客予約フローの前に修正要。

10. **vendor_portal_inbox テーブルのデータ整合性**: inbox-worker.ts が書き込みを行っているが、inbox 閲覧 UI が存在しないため業者側から見たデータ状態 (未読件数・severity) が正しく積まれているかは未確認。inbox 画面実装時に worker の出力と照合推奨。