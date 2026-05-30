# Phase 63 Plan: verification-checklist scope 仕分け (step 1)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 63 (前: 62 sealed) |
| 状態 | **plan (step 1 仕分け叩き台)** |
| 作成日時 | 2026-05-27 |
| 担当 | Claude (仕分け叩き台) → ユーザー (承認/微修正) → Claude (確定後 step 2 へ) |
| Branch | `phase-42-t4-test-coverage` (継続) |
| ファイル変更 | 1 (本 plan のみ) |

## 仕分け方針 (Phase 62 sealed Addendum L246-251 ベース)

**判断軸**: 5/31 第一次納品 = (a) URL を顧客に渡して業務で使える α 版

**3 区分**:
1. **業務必須 (alpha-core)**: 中古車販売会社が店間整備の業務として実運用するために必須
2. **業務任意 (β scope)**: 6/2 以降の β-1 で追加可、α 段階では未提供で OK
3. **Release 前 quality gate**: feature ではなく test / 検証項目、production 前に通す必要あり

**「25 件」訂正**: Phase 62 sealed L82 の「25 件」は estimate。実数は Section C 75 件 (Phase 0=22 / 1=10 / 2=27 / 3=6 / 4=10) + Section D 異常系 19 グループ ≒ 94+ 項目。本 plan は alpha-core release path から逆算で 3 区分に再分類する。

## §1 Feature 仕分け (Section C, 53 件)

### 1.1 業務必須 (alpha-core release path に直結)

**Phase 1 マスター・認証 (10/10 件すべて必須)** — 業務運用の前提
- 会社作成 + 初期マスター自動シード / Supabase Auth 社内招待 / 店舗・営業時間・休日 CRUD / レーン・稼働時間・対応メニュー CRUD / 作業カテゴリ・メニュー CRUD / 予約枠設定 / ステータス + 状態遷移ルール / 業者マスター + vendor_users CRUD / 対応エリア・店舗・曜日 / 通知ルール

**Phase 2 店間移動 + 業者通知 (22/27 件 必須)** — alpha-core 縦切りの中核
- 整備伝票作成 / 車両 + 所有履歴 / 店間整備予約 (inter_store) / 作業メニュー → 標準時間 + バッファ / TX atomic (予約+伝票+transport_order+outbox) / 移動パターン 4 種 / 走行可否 → tow_required / 業者選択 UI フィルタ / 業者メール (idempotency_key) / 業者マイページ依頼表示 / 業者: 対応可否 + 引取・搬入・返却 / 業者: 完了報告 / 店舗側: 業者状況確認 / 状態遷移制約 / 業者対応不可 (次候補 / 希望日時変更 / 手動切替 / キャンセル 4 種) / 確定モード auto/manual / manual 時 store_confirmed_at / 通知失敗運用画面 / vendor_portal_inbox / 楽観排他競合 UI

**Phase 3 一覧 (3/6 件 必須)** — 業務必須の最低限視認性
- ピット予約カレンダー (日・週) / 店舗別・レーン別表示切替 / ダッシュボード優先タスク (未確認・不可・失敗)

**小計: 35 件**

### 1.2 業務任意 (β scope, 6/2 以降)

**Phase 2 残 5 件**
- 案件単位招待 複数業者一斉打診 (実装済だがフル UI 運用は β) / スポット業者招待トークン (D5 fk まで完了済、運用磨きは β)

**Phase 3 残 3 件**
- 整備伝票一覧 + CSV エクスポート / 車両一覧 + 過去整備履歴 / 整備伝票・回送依頼書 PDF 印刷

**Phase 4 顧客予約 全 10 件すべて β**
- 顧客予約フロー / email 認証コード / 予約完了メール (modify/cancel) / modify トークン / cancel トークン / レート制限 / 前日リマインド / 業者未確認再通知 / LINE・SMS チャネル / 月表示カレンダー

**小計: 18 件**

## §2 Release 前 quality gate (Phase 0 PoC + Section D, 41 項目)

### 2.1 既に通過済 (Phase 1-61 sealed で確認)

- **Phase 0 PoC 22 件**: 全件 Phase 4-6 PoC で消化済、Phase 14-61 sealed で retrogression なし
- **D.4 状態遷移制約 4 件**: Phase 57-58 status_history FK sealed で構造強化済
- **D.5 RLS / 権限境界 7 件**: tenant-isolation.test.ts 11 tests + spot-rls 1 test で緑
- **D.6 楽観排他 5 件**: version カラム + IF MATCH 実装済、Phase 25-26 で E2E 検証
- **D.10 監査ログ 4 件**: Phase 24-25 audit_logs append-only sealed
- **D.12 移動パターン整合 5 件**: DB CHECK 制約 Phase 6 で投入
- **D.13 案件単位招待 9 件**: Phase 16-22 transport_order_invitations + spot-rls で実装済
- **D.14 PII redaction 4 件**: Phase 24 で redact_audit_payload 投入
- **D.15 outbox ロック 4 件**: outbox dispatcher FOR UPDATE SKIP LOCKED 実装済
- **D.16 service_role 監査 3 件**: ADR-0010 + Phase 24-25 で範囲確定

### 2.2 production-first (staging 環境構築後に初検証)

- **D.1 予約競合 4 件**: 並列 INSERT は PoC で緑だが production scale は未検証
- **D.2 通知信頼性 5 件**: Resend bounce / Inngest 停止リカバリ / max_attempts は production Inngest/Resend 接続後
- **D.3 業者対応不可 5 件**: 4 種 fallback ロジックは実装済、E2E は staging で再検証
- **D.7 キャンセル・変更通知 4 件**: change_logs Phase 53-55 で実装済、E2E は staging
- **D.11 配送・インフラ 3 件**: Vercel / Supabase / Inngest 接続後のみ検証可能

### 2.3 業務任意 (β scope に押す quality gate)

- **D.8 顧客本人確認 3 件** (Phase 4 と同じく β)
- **D.9 TZ 4 件** (PoC で基本動作、月跨ぎ・日跨ぎ詳細は β)
- **D.17 業者責任分界・承諾証跡 8 件** (v2.2 新規、α 必須項目から外す候補、要ユーザー確認)
- **D.18 通知失敗エスカレーション 4 件** (v2.2 で Phase 2 必須宣言だが、本部管理者向けで α 後送り可)
- **D.19 通知配送 KPI 3 件** (v2.2 新規、営業資料用、α 段階では不要)

## §3 Phase 63 step 2 入力契約

step 1 (本仕分け) → step 2 (業務必須項目の実装状態確認) に渡すべき情報:

**§1.1 業務必須 35 件** を 4 区分でマッピング:
- A) 実装済 + E2E 緑
- B) 実装済 + E2E なし
- C) 未実装
- D) production-only gap (実装済だが production 環境がないため未検証)

**§2.2 production-first 21 件** は step 3 (staging 環境構築) と直接連動。

## §4 ユーザー確認ポイント (3 件)

1. **Phase 2 案件単位招待 (複数業者一斉打診 + スポット業者) を β scope に降格** で良いか?
   - 根拠: alpha-core 縦切りは「専属業者 1 社への通知ループ」で成立、複数招待はオプション
   - 反論ありえる: 既に Phase 16-22 で実装 + Phase 60 FK 投入済、運用は可能

2. **D.17 業者責任分界・承諾証跡 8 件 を α 必須から外す** で良いか?
   - 根拠: 営業資料の訴求点だが、業務として「URL を渡して使える」最低条件には不要
   - 反論ありえる: requirements v2.2 で新規追加、業者側責任明確化として α で出したい可能性

3. **D.18 通知失敗エスカレーション 4 件 を α 必須から外す** で良いか?
   - 根拠: 本部管理者向け運用支援、α は通常運用画面 (Phase 2 通知失敗運用画面) で代替可
   - 反論ありえる: requirements v2.2 で「Phase 2 必須」宣言、本部運用ニーズ次第

## §5 Phase 63 残ステップ (step 1 確定後)

- step 2: §1.1 業務必須 35 件の実装状態マッピング (Codex 委任候補、read-only 調査)
- step 3: staging 環境構築ステップ列挙 + ユーザー作業 (Vercel/Supabase project 作成) 分業確定
- step 4: 残作業の優先順位確定 → 着手 Phase に分割

## §6 想定残作業 (現時点 Claude 推定)

§1.1 業務必須 35 件のうち、Phase 62 sealed で「実装済」確認済みは:
- Phase 1 マスター CRUD 全 10 件 (Phase 8-11 で実装)
- Phase 2 店間移動 + 業者通知 22 件中 ~20 件 (Phase 14-22 で実装)
- Phase 3 カレンダー + 優先タスク 3 件 (Phase 43-49 で UI 実装)

**未確認 / 未実装の可能性が高い項目** (step 2 で検証):
- TX atomic (予約+伝票+transport_order+outbox) の手動 E2E 確認
- 業者対応不可 4 種 fallback の業務 E2E
- 通知失敗運用画面 (実装はあるが運用品質確認なし)
- vendor_portal_inbox 未読/既読/アーカイブ
- ピット予約カレンダー (Phase 43 transport-orders UI から派生確認要)

## §7 Invariants (Phase 62 から継承、Phase 63 でも維持)

- typecheck clean / 23 test files / 188 tests PASS
- CI E2E 7/7 PASS
- RLS policy 65 件 + helper function 5 件
- outbox dispatcher + inbox worker + invitationExpirer 稼働
- Phase 1-31 累積機能・bug fix retrogression なし

---

*Phase 63 step 1 plan / Generated by Claude 2026-05-27 / Awaiting user review on §4 (3 件確認)*
