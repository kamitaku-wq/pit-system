# 検証・受入チェックリスト（改訂版 v2.2）

> 改訂日: 2026-05-22
> v2.1 → v2.2: Codex 最終レビューを反映。未登録業者招待・先着受注 DB 関数・通知配送 KPI・通知失敗エスカレーション・業者責任分界・承諾証跡の受入テストを追加。

このファイルは以下 3 つの役割を持つ：

1. **要件反映の照合**（v1 と同じ役割、削除や勝手な変更がないか）
2. **受入テスト**（MVP / 各 Phase の完了基準）
3. **異常系シナリオの網羅**（通知失敗・業者拒否・予約競合・権限境界・キャンセル）

---

# A. 要件反映の照合（v1 継承）

## A.1 初回要件

- [x] 整備ピットの空き状況を店間で共有する
- [x] 顧客が空き日時を確認して来店予約できる
- [x] 顧客が来店予約できる
- [x] 店舗側は整備ピットがない店舗から店間移動整備の予約ができる
- [x] 店舗側は陸送・回送業者への発注・通知ができる
- [x] レイアウトはシンプルにする
- [x] 今後拡張性を持たせやすい形で設計する

## A.2 レーン要件

- [x] レーン数はプルダウンで選択できるようにする
- [x] 作業内容はプルダウンで選択できるようにする
- [x] メンテナンス専用レーンを管理できる
- [x] 重整備専用レーンを分けて管理できる
- [x] 汎用レーンも扱える
- [x] 重整備はフリー入力もできる
- [x] 作業内容詳細を自由入力できる
- [x] 想定作業時間を自由入力できる
- [x] 使用レーンを調整できる
- [x] 注意事項、必要部品、整備士への申し送りを入力できる

## A.3 予約枠自動確保

- [x] メニューによって自動で枠が埋まる
- [x] 作業メニューごとに標準作業時間を持つ
- [x] 作業メニューごとに使用レーン種別を持つ
- [x] 作業メニューごとにバッファ時間を持つ
- [x] 作業メニュー選択時に必要なレーン種別を自動判定する
- [x] 空き枠を自動検索する
- [x] 予約確定で該当時間をブロックする
- [x] **DB レベル排他制御（exclusion constraint）で二重確定を防ぐ**（v2 追加）

## A.4 整備伝票

- [x] 車両を整備伝票ごとに管理する
- [x] 予約や作業内容を整備伝票番号に紐づける
- [x] 予約作成時に整備伝票番号を入力できる
- [x] 車両情報を入力できる
- [x] 顧客情報を入力できる
- [x] 作業内容を入力できる
- [x] **過去整備履歴を車両単位で遡れる**（v2 追加）

## A.5 設定画面

- [x] 全て設定画面から変更できる
- [x] 会社設定（v2 追加）
- [x] 店舗設定
- [x] 店舗営業時間 / 休日（v2 分離）
- [x] レーン設定
- [x] レーン稼働時間（v2 分離）
- [x] レーン種別設定
- [x] 作業カテゴリ設定
- [x] 作業メニュー設定
- [x] 予約枠設定
- [x] ステータス設定
- [x] 状態遷移ルール設定（v2 追加）
- [x] 回送・陸送業者マスター
- [x] 業者ユーザー管理（v2 追加）
- [x] 通知ルール設定
- [x] 権限設定
- [x] 表示項目設定
- [x] 顧客本人確認設定（v2 追加）
- [x] 監査ログ設定（v2 追加）

## A.6 店間移動・業者通知

- [x] 店間移動が発生した場合、マスター登録業者にメール通知
- [x] 店間移動が発生した場合、業者マイページに通知
- [x] 自動通知（手動発注ではない）
- [x] 業者マスターにメールアドレスを登録
- [x] 業者マスターにログイン用アカウントを登録
- [x] 業者マスターに通知方法を設定
- [x] 通知方法（メール / マイページ / 両方）
- [x] 予約確定時にメール通知
- [x] 予約確定時に業者マイページに新規依頼表示
- [x] 業者はマイページで依頼内容を確認
- [x] 業者は対応可否を回答
- [x] 業者は引取予定日時を入力
- [x] 業者は搬入予定日時を入力
- [x] 業者は返却予定日時を入力
- [x] 業者は引取完了報告
- [x] 業者は搬入完了報告
- [x] 業者は返却完了報告
- [x] 業者は備考入力
- [x] 店舗側で通知送信日時を確認
- [x] 店舗側で業者確認日時を確認
- [x] 店舗側で対応可否を確認
- [x] 店舗側で現在ステータスを確認
- [x] **業者対応不可時のフォールバック**（v2 追加：次候補打診 / 希望日時変更 / 手動切替 / キャンセル）
- [x] **移動パターン 4 種すべてサポート**（v2 追加：one_way / round_trip / pickup_only / three_point）
- [x] **走行可否 → tow_required 自動**（v2 追加）
- [x] **確定モード（auto / manual）**（v2 追加）
- [x] **店舗確定タイムスタンプ管理（store_confirmed_at）**（v2 追加）

## A.7 通知ルール

- [x] 店間移動ありで予約確定時に通知
- [x] 仮予約時点では通知しない
- [x] 予約確定時のみ通知
- [x] 業者変更時に再通知
- [x] 日時変更時に通知
- [x] キャンセル時に通知
- [x] 前日リマインド通知
- [x] 未確認の場合の再通知
- [x] 通知方法を設定画面で選択
- [x] **DB outbox + idempotency_key で恒久重複防止**（v2 追加）
- [x] **失敗時のリトライ（指数バックオフ）**（v2 追加）
- [x] **通知失敗の運用画面で手動再送可能**（v2 追加）

## A.8 業者通知の内容

- [x] 依頼番号、整備伝票番号
- [x] 引取店舗、搬入店舗、返却先店舗
- [x] 車両情報（車種・ナンバー・車台番号）
- [x] 走行可否
- [x] **レッカー要否**（v2 追加）
- [x] 希望引取 / 搬入 / 返却日時
- [x] 注意事項
- [x] 担当店舗、担当者、連絡先
- [x] マイページ確認 URL
- [x] **移動パターン**（v2 追加）
- [x] **変更時の差分情報**（v2 追加）

## A.9 ステータス

予約 / 整備 / 店間移動 / 業者 全 4 種類が `statuses` でテーブル管理されている。

- [x] 仮予約 / 予約確定 / 入庫待ち / 入庫済み / 作業中 / 作業完了 / キャンセル
- [x] 業者通知済み / 業者確認済み / 業者対応可 / 業者対応不可
- [x] 回送手配中 / 移動中 / 返却移動中 / 納車完了
- [x] 未確認 / 確認済み / 対応可 / 対応不可
- [x] 引取予定 / 引取済み / 搬入済み / 返却予定 / 返却済み / 完了
- [x] **状態遷移ルール（status_transitions）で許可遷移のみ実行**（v2 追加）
- [x] **状態履歴（*_status_history）が append-only で残る**（v2 追加）

## A.10 拡張性

- [x] LINE 予約
- [x] SMS 通知
- [x] 顧客マイページ
- [x] 請求管理
- [x] 売上管理
- [x] 整備士別作業負荷管理
- [x] 部品発注管理
- [x] 外注管理
- [x] 納車前管理
- [x] 車検証 OCR
- [x] 在庫車両管理
- [x] 自社ローン審査管理
- [x] ダッシュボード分析
- [x] API 連携
- [x] 多店舗展開
- [x] **販売会社単位 SaaS マルチテナント**（v2 追加）

---

# B. v2 で追加された要件の照合

## B.1 5 設計判断

- [x] テナント単位：販売会社（法人）→ `companies` + `company_id` FK
- [x] 業者：デフォルト専属 + 将来共有 → `vendors.company_id` + `vendor_company_memberships`
- [x] 業者対応可後：依頼種別切替、デフォルト自動 → `confirmation_mode` enum
- [x] 移動パターン：4 種すべて → `movement_type` enum
- [x] 顧客予約：MVP に含む → `customer_reservation_tokens` で本人確認

## B.2 技術スタック確定

- [x] Next.js (App Router) + TypeScript
- [x] PostgreSQL (Supabase, Tokyo)
- [x] Drizzle ORM
- [x] Supabase Auth（社内・業者のみ）
- [x] Resend + React Email
- [x] Inngest（outbox 配送 worker）+ Vercel Cron
- [x] shadcn/ui + Tailwind + FullCalendar

## B.3 致命的補強

- [x] DB outbox 必須（`notification_outbox`）
- [x] idempotency_key UNIQUE（恒久重複防止）
- [x] exclusion constraint + tstzrange + gist（予約排他）
- [x] service 関数 + `drizzle.transaction()`（TX 境界）
- [x] `*_status_history` append-only
- [x] 顧客は Auth user にせず token table
- [x] `vendor_users` 分離
- [x] RLS helper function + service_role 直叩き禁止
- [x] 監査ログ（`audit_logs`）

---

# C. 受入テスト（Phase 別、MVP 完了基準）

## Phase 0：基盤 PoC

- [ ] `companies` / `users` / `vendor_users` の最小スキーマ動作
- [ ] **RLS 漏洩テスト**：会社 A 所属ユーザーで会社 B のデータ 0 件
- [ ] **RLS 漏洩テスト**：業者 X ユーザーで業者 Y 案件 0 件
- [ ] **RLS 漏洩テスト**：顧客 token A で他予約 0 件
- [ ] **並列予約確定**：50 並列 INSERT で 1 件のみ成功、残り business error
- [ ] **TX + outbox**：予約 + outbox が同一 TX で commit
- [ ] **Inngest 配送**：outbox `pending` を pickup → Resend 送信 → `notification_deliveries` 記録
- [ ] **Inngest retry**：Inngest 停止中に outbox 蓄積 → 復旧後 1 度だけ送信
- [ ] **idempotency_key**：同じキーで 2 度 insert すると UNIQUE 違反
- [ ] **業者ポータル権限**：専属 / 共有 / 案件単位招待を RLS で表現
- [ ] **Vercel runtime**：Node.js runtime 固定、Supabase pooler で接続数破綻なし
- [ ] **監査ログ**：主要テーブル変更が `audit_logs` に before/after JSON で記録
- [ ] **TZ**：UTC 保存 / JST 表示の往復ロスなし
- [ ] **マイグレーション順序検証（v2.1）**：`data-model.md` §17 通りに 01〜21 を流して FK 依存エラーなし
- [ ] **outbox FOR UPDATE SKIP LOCKED（v2.1）**：dispatcher を 2 並列起動して同じ row を取らない / 二重送信なし
- [ ] **楽観排他（v2.1）**：同一 reservation を異なる version で 2 並列更新 → 1 件成功 / 1 件 OptimisticLockError
- [ ] **案件単位招待の先着受注（v2.1）**：3 業者へ同時招待 → 2 業者同時 accept → 1 業者のみ winning_bid、他は revoked
- [ ] **PII redaction（v2.1）**：customers の UPDATE で audit_logs に元の電話・メールが残らない（マスク済み）
- [ ] **movement_type CHECK（v2.1）**：pickup_only なのに delivery_store_id を入れた INSERT が DB で拒否
- [ ] **status_transitions trigger（v2.1）**：未許可遷移の INSERT が `*_status_history` で拒否
- [ ] **audit_logs append-only（v2.1）**：authenticated user で UPDATE / DELETE が拒否
- [ ] **stale processing リカバリ（v2.1）**：processing_started_at > 15min の row が pending に戻る

## Phase 1：マスター・認証

- [ ] 会社作成 → 初期マスター（lane_types / statuses / status_transitions / notification_rules）が自動シード
- [ ] Supabase Auth で社内ユーザー招待 → ロール割当
- [ ] 店舗 / 営業時間 / 休日設定の CRUD
- [ ] レーン / 稼働時間 / 対応メニュー（M2M）の CRUD
- [ ] 作業カテゴリ / 作業メニューの CRUD
- [ ] 予約枠設定の編集
- [ ] ステータス追加・変更 + 状態遷移ルール編集
- [ ] 業者マスター + vendor_users の CRUD
- [ ] 業者の対応エリア / 店舗 / 曜日（M2M）設定
- [ ] 通知ルールの編集

## Phase 2：店間移動 + 業者通知（最重要 MVP）

- [ ] 整備伝票作成（手動 + 既存検索）
- [ ] 車両情報作成 + 所有履歴記録
- [ ] 店間整備予約作成（type=inter_store）
- [ ] 作業メニュー選択 → 標準時間 + バッファ自動反映
- [ ] **TX 内で予約 + 整備伝票 + transport_order + outbox を atomic に生成**
- [ ] 移動パターン 4 種すべてで予約作成・通知送信可能
- [ ] 走行可否 false → tow_required 自動
- [ ] 業者選択 UI で対応エリア / 店舗 / 曜日フィルタ動作
- [ ] 業者メール送信（idempotency_key 付き）
- [ ] 業者マイページに新規依頼表示（他社・他業者には非表示）
- [ ] 業者：対応可否回答 + 引取/搬入/返却予定入力
- [ ] 業者：完了報告
- [ ] 店舗側：業者状況確認画面
- [ ] **状態遷移制約**：許可されない遷移は DB / アプリ両方で拒否
- [ ] **業者対応不可フォールバック**：次候補打診で attempt_seq++ で新 outbox 生成
- [ ] **業者対応不可フォールバック**：希望日時変更 → 同業者へ再依頼（change_logs 記録 + 再通知）
- [ ] **業者対応不可フォールバック**：手動切替（店舗側で完結）
- [ ] **業者対応不可フォールバック**：依頼キャンセル → 関連予約もキャンセル状態
- [ ] 確定モード auto / manual 両方で動作
- [ ] manual 時：業者「対応可」→ 店舗確定ボタン押下で store_confirmed_at セット
- [ ] **通知失敗運用画面**：outbox `failed` 一覧 + 手動再送
- [ ] **案件単位招待（v2.1）**：複数業者一斉打診 UI、先着受注ロジック動作
- [ ] **スポット業者招待トークン（v2.1）**：招待 URL から未登録業者が受諾 → vendor_users 登録 → 通常フロー
- [ ] **vendor_portal_inbox（v2.1）**：通知が inbox に届き、未読/既読/アーカイブで管理
- [ ] **楽観排他競合 UI（v2.1）**：他スタッフが先に更新した場合のモーダル表示と再読込

## Phase 3：カレンダー + 一覧

- [ ] ピット予約カレンダー（日・週）
- [ ] 店舗別 / レーン別 / 作業種別表示切替
- [ ] 整備伝票一覧 + 検索 + CSV エクスポート
- [ ] 車両一覧 + 過去整備履歴
- [ ] ダッシュボード優先タスク（未確認 / 不可 / 失敗）
- [ ] 整備伝票 / 回送依頼書 PDF 印刷

## Phase 4：顧客予約 + 通知拡張

- [ ] 顧客予約フロー（店舗 → メニュー → 日時 → 顧客 → 車両）
- [ ] email 認証コード（6 桁 / 5 分有効）で本人確認
- [ ] 予約完了メール（modify / cancel 署名 URL 付き）
- [ ] modify トークンで予約変更可能（旧トークン失効）
- [ ] cancel トークンでキャンセル可能
- [ ] レート制限（1 IP / email / 電話で過剰予約防止）
- [ ] 前日リマインド送信（Inngest scheduled）
- [ ] 業者未確認再通知（`retry_after_minutes` 経過時）
- [ ] LINE / SMS チャネル追加可能（channel 抽象化）
- [ ] 月表示カレンダー

---

# D. 異常系シナリオ（必ず通すこと）

## D.1 予約競合

- [ ] 同一 lane / 同一時間に 2 ユーザーが同時 INSERT → 1 件成功 / 1 件 business error
- [ ] `is_double_booking = true` で店長権限上書きすると DB は受け入れる
- [ ] `is_double_booking = true` 予約は exclusion constraint から除外
- [ ] 仮予約期限切れ後の再予約が可能

## D.2 通知信頼性

- [ ] Resend API ダウン → outbox `failed` で停留、復旧後手動再送で送信成功
- [ ] 同一 idempotency_key で 2 度 outbox 生成試行 → UNIQUE 違反、業務エラー
- [ ] Inngest function 失敗 → attempts++ / next_attempt_at 更新 / 指数バックオフ
- [ ] max_attempts 超過 → status='failed' で運用画面表示
- [ ] 業者メアド誤入力 → Resend bounce → notification_deliveries に result='bounced'

## D.3 業者対応不可

- [ ] 業者 A 拒否 → status='業者対応不可' へ遷移
- [ ] 店舗が「次候補打診」→ 業者 B へ新 outbox（attempt_seq=2）
- [ ] 業者 B も拒否 → 同様に attempt_seq=3
- [ ] 手動切替 → transport_order がキャンセル状態、自社対応へ
- [ ] 依頼キャンセル → 関連 reservation もキャンセル、通知配信（vendor / customer 双方）

## D.4 状態遷移制約

- [ ] 「未確認」→「返却済み」のような飛び遷移は DB / アプリ両方で拒否
- [ ] 終端ステータス（is_terminal=true）からの遷移は拒否
- [ ] 権限不足ユーザーによる遷移試行は authorization error
- [ ] 業者ユーザーは業者側ステータスのみ遷移可、予約ステータスは触れない

## D.5 RLS / 権限境界

- [ ] 業者 X が他業者 Y の依頼 URL を直叩き → 403 / 0 件
- [ ] 業者 X が共有業者で会社 B の案件のみ閲覧可、A の案件は不可
- [ ] 顧客 token A で顧客 B の予約 URL を直叩き → 403
- [ ] 顧客 token が expires_at 超過 → 失効エラー
- [ ] modify トークンを 2 度使用しようとする → used_at 立ってる、新トークン要求エラー
- [ ] 店舗スタッフが他店舗の権限 API を叩く → permissions チェックで拒否
- [ ] service_role が Server Actions から直叩きされていない（コード規約 + テスト）

## D.6 同時編集競合（v2.1：楽観排他で確定）

- [ ] 2 スタッフが同じ予約を同時編集 → **楽観排他で 1 件成功 / 1 件 OptimisticLockError**
- [ ] エラー時 UI で「他のスタッフが更新しました」モーダル + 再読込ボタン表示
- [ ] 業者進捗更新と店舗キャンセルが同時 → status_transitions で矛盾遷移は拒否
- [ ] `version` カラムが UPDATE ごとに 1 ずつ増加
- [ ] 設定画面など重要度の低い画面では last-write-wins でも可（明示）

## D.7 キャンセル / 変更通知

- [ ] 店舗側でキャンセル → vendor / customer 双方に通知（rules に従う）
- [ ] 業者側でキャンセル → 店舗側に通知
- [ ] 日時変更 → 業者へ change_logs 含む再通知（前後の差分明示）
- [ ] 業者変更 → 旧業者にキャンセル通知 + 新業者に新規通知

## D.8 顧客本人確認

- [ ] 認証コード誤入力 5 回 → ロック
- [ ] 認証コード期限切れ → 再送可能、レート制限あり
- [ ] modify トークン期限切れ → 新規発行（再認証）

## D.9 TZ / 日時整合

- [ ] DB が UTC 保存、画面が JST 表示で時刻ズレなし
- [ ] 夏時間影響なし（日本は対象外）
- [ ] 日跨ぎ予約（23:00 - 翌 01:00）で日表示が正しい
- [ ] 月跨ぎリマインド（月末予約の前日通知）が正しい時刻

## D.10 監査ログ

- [ ] 予約作成 / 変更 / キャンセル → audit_logs に before/after 記録
- [ ] 業者進捗更新 → actor_kind='vendor_user' で記録
- [ ] システム自動遷移 → actor_kind='system' で記録
- [ ] soft delete → action='delete' で記録、データは残る

## D.11 配送 / インフラ

- [ ] Supabase メンテナンス → 再接続でリカバリ
- [ ] Inngest 停止中の outbox 蓄積上限と運用フロー
- [ ] Vercel cron 重複起動 → advisory lock or idempotency で副作用なし

## D.12 移動パターン整合（DB CHECK で強制）

- [ ] one_way：pickup + delivery 必須、return_store_id が null
- [ ] round_trip：pickup + delivery + return 3 つすべて必須
- [ ] pickup_only：pickup のみ必須、delivery / return が null
- [ ] three_point：pickup + delivery + return が**すべて別店舗**（同一だと DB CHECK 違反）
- [ ] **不整合 row（pickup_only なのに delivery 入り等）の INSERT が DB で拒否**（v2.1）

## D.13 案件単位招待（v2.1, v2.2 で未登録業者対応強化）

- [ ] 1 transport_order に複数 invitations 作成 → 各 vendor に outbox 通知
- [ ] 2 業者同時 accept → **`accept_invitation_and_revoke_others()` DB 関数で先着 1 業者のみ winning_bid**（v2.2）
- [ ] partial unique index `WHERE is_winning_bid = true` で 2 件目以降が DB 拒否（v2.2）
- [ ] 残り業者の invitation は `response='revoked'` で自動失効 → revoke 通知が outbox に追加
- [ ] 招待トークン期限切れ（`expires_at`）→ Cron で `response='expired'`
- [ ] 招待トークン URL を異なる業者が叩く → 拒否（hash 不一致）
- [ ] **未登録業者の招待**（v2.2）：`vendor_id IS NULL` + `invitee_email` で招待作成 → URL アクセス → 業者情報入力 → Supabase Auth 招待 → vendor_users 登録 → bound_vendor_id 紐付け → winning_bid セット
- [ ] **integrations_target_check CHECK**（v2.2）：`vendor_id` も `invitee_email` も NULL の INSERT が DB 拒否
- [ ] 店舗側でキャンセル → 全 invitations が revoked、関連 outbox も cancelled

## D.17 業者責任分界・承諾証跡（v2.2 新規）

- [ ] 業者「対応可」時に同意チェックボックス必須
- [ ] 同意なしの「対応可」回答は API レベルで拒否
- [ ] 同意時刻・IP・User-Agent が audit_logs に記録
- [ ] 引取予定 + 3 時間経過で未更新 → 店舗側に outbox アラート
- [ ] 24 時間以上未更新 → 本部管理者にエスカレーション
- [ ] 回送依頼書 PDF に免責文言が動的反映（`companies.transport_disclaimer_text`）
- [ ] 業者完了報告後の店舗側「ステータス差戻し」が可能、理由必須、業者通知 + 監査記録
- [ ] 差戻し時に写真添付（attachments）が可能

## D.18 通知失敗エスカレーション（v2.2 新規、Phase 2 必須）

- [ ] 連続失敗 N 件（会社設定）で本部管理者へエスカレーション通知
- [ ] エスカレーション通知が outbox を介さず直接 Slack / メールへ送信される代替経路
- [ ] 失敗案件を運用担当者に割り当て可能
- [ ] 手動再送成功率の KPI 表示

## D.19 通知配送 KPI（v2.2 新規）

- [ ] `notification_delivery_kpi_daily` ビューが集計
  - 配送成功率
  - 平均配送遅延（秒）
  - 失敗内訳（bounced / max_attempts_exceeded）
  - 平均再送回数
- [ ] 日次 Cron で `REFRESH MATERIALIZED VIEW CONCURRENTLY` 実行
- [ ] 営業資料で訴求する「99% 配送成功」「30 秒以内配送」の数値が見える

## D.14 PII redaction（v2.1 新規）

- [ ] customers UPDATE → audit_logs の before_json / after_json で `phone` が `***1234`、`email` が `u***@example.com`
- [ ] vehicles UPDATE → `vin` が `***LAST6`
- [ ] customer_reservation_tokens INSERT → `token_hash` が監査ログから完全削除
- [ ] redaction なしの生 PII が監査ログに残らないことを CI でテスト

## D.15 outbox ロック（v2.1 新規）

- [ ] dispatcher 並列 2 起動 → 同じ row を取らない（`FOR UPDATE SKIP LOCKED`）
- [ ] processing 中の row は他 dispatcher から不可視
- [ ] processing_started_at > 15min の row が Cron で pending に戻る
- [ ] 二重送信が 100 件中 0 件（負荷試験）

## D.16 service_role 監査（v2.1 新規）

- [ ] Inngest worker 起動時に audit_logs へ `actor_kind='system'` で記録
- [ ] 監査ログクリーンアップ Cron も同様
- [ ] 通常の Server Actions / Route Handlers で service_role が使われていないことを CI で検出

---

# E. パフォーマンス / 非機能テスト

- [ ] カレンダー画面初期描画 < 2 秒（100 予約 / 日）
- [ ] 主要 API レスポンス < 500ms（p95）
- [ ] 同時 100 接続で破綻なし（Supabase pooler）
- [ ] 通知配送遅延 < 30 秒（outbox insert → Resend 送信）
- [ ] 印刷 PDF 生成 < 3 秒
- [ ] **稼働率ビュー REFRESH（v2.1）** < 10 秒（日次 1 万予約規模）
- [ ] **outbox dispatcher スループット** > 100 件/分

# E.5. KPI / 分析検証（v2.1 新規）

- [ ] `lane_utilization_daily` の稼働率計算が `lane_working_hours` × `store_holidays` を反映
- [ ] キャンセル予約が稼働率分母から除外
- [ ] `vendor_response_kpi_daily` の応答時間平均・対応可率が正しい
- [ ] マテリアライズドビューの `REFRESH CONCURRENTLY` が日次 Cron で実行

---

# F. セキュリティチェック

- [ ] HTTPS 強制
- [ ] CSRF 対策（Next.js Server Actions の標準保護）
- [ ] XSS 対策（React 標準 + dangerouslySetInnerHTML 監査）
- [ ] SQL インジェクション（Drizzle parameterized + 生 SQL レビュー）
- [ ] SPF / DKIM / DMARC 設定（Resend 経由）
- [ ] 認証コード総当たり対策（5 回ロック）
- [ ] レート制限（顧客予約 / 認証コード再送）
- [ ] PII を含むログ出力の禁止（電話・メール・VIN）
- [ ] 監査ログの改ざん防止（append-only / RLS）
- [ ] 添付ファイルは Supabase Storage 署名 URL 経由のみ

---

# G. 照合結果

会話で出た要件は、`requirements.md` v2.1、`implementation-plan.md` v2.1、`data-model.md` v2.1、`screen-list.md` v2.1 に反映済み。

**v2 で追加した重要事項**:

1. 販売会社単位テナント + RLS
2. 業者 vendor_users 分離 + 専属/共有
3. 移動パターン 4 種 + tow_required
4. 確定モード auto/manual + store_confirmed_at
5. 業者対応不可フォールバックフロー
6. DB outbox + idempotency_key + retry
7. exclusion constraint で予約排他
8. 状態遷移ルール + append-only 履歴
9. 監査ログ全件
10. 顧客本人確認（email 認証コード + 署名 token）
11. 営業時間 / レーン稼働時間の構造化
12. M2M 正規化（lane_work_menus / vendor_service_areas 等）
13. TZ UTC 保存 / JST 表示
14. 金額の minor 保存 + currency + tax_included
15. 通知失敗運用画面 + 監査ログ閲覧画面
16. モバイル対応 + 印刷レイアウト
17. PoC 5 項目を Phase 0 必須化
18. MVP 順序を「業者通知ループ縦切り」優先に組み直し

**v2.1 で追加した重要事項**:

19. MVP の定義明確化（Phase 0-4 全体 = MVP、Phase 2 = MVP コア）
20. 案件単位招待 `transport_order_invitations`（複数業者打診 / スポット業者）
21. 楽観排他（`version` カラム + IF MATCH UPDATE）
22. マイグレーション順序の全面修正（FK 依存解消）
23. 全テーブルに `company_id` 必須化（M2M / 履歴含む）
24. `vendor_users` の company_id 同期 trigger
25. movement_type の DB CHECK 制約（パターン整合）
26. outbox `FOR UPDATE SKIP LOCKED` + stale processing リカバリ
27. PII redaction policy + audit_logs append-only 保護
28. `notification_deliveries` を配送ログ専用、`vendor_portal_inbox` を inbox 専用に分離
29. `is_shared = false` vendor の他社利用禁止 trigger
30. status_transitions DB trigger（最終防衛線）
31. 稼働率 / 業者応答 KPI のマテリアライズドビュー定義
32. service_role 使用範囲の明文化 + Inngest worker 監査
33. ER 図 cardinality 修正（`service_tickets }o--|| vehicles`）

修正が必要になった場合は、要件を削除せず、追記・補足で対応する（v1 と同じ方針）。

---

# H. 未確定事項（要対応）

要件 §33 / 実装計画 §16 と同じ TODO リスト。各項目は実装着手前に決定する：

- [ ] 顧客 SMS 認証を MVP に含めるか
- [ ] 業者 SLA を業者マスターか依頼種別か
- [ ] 自動マッチングレコメンドの MVP 範囲
- [ ] 月表示カレンダーを Phase 3 か Phase 4 か
- [ ] 表示項目設定の初期実装範囲
- [ ] reCAPTCHA 導入タイミング
- [ ] Supabase Realtime の活用範囲
- [ ] 検索用全文インデックス対象
- [ ] PII 匿名化の自動化スケジュール
- [ ] 業者の見積金額機能の実装フェーズ
- [ ] 多言語対応の優先度
