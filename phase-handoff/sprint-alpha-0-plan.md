# Sprint α-0 着手計画書 v1.0

**対象 Sprint**: α-0 (2.5 日想定、roadmap.md §1.2 事実言及)
**前提状態**: Phase 3-env-bootstrap sealed (環境構築 + DB 初期化完了)
**スコープ確定 (ユーザー確認済み)**:
- #12 migration 順序 PoC: **骨格 DDL のみ** (FK 宣言の循環依存ゼロを確認、Full DDL は α-1)
- #5 レイテンシ PoC: **Raw DB roundtrip** (k6 で Shared Pooler に SELECT 1 を 60s × 100VU)
- k6 インストール状況: 別途確認中

---

## E. 前提・watchpoint

| # | 内容 |
|---|---|
| E-1 | α-0 は **スタブテーブル方式**。`_reservations_slice_test` パターン踏襲、本カラムは α-1 |
| E-2 | #12 は §17 順序の骨格 DDL のみ flow。Full DDL は α-1 |
| E-3 | #5 は raw DB roundtrip (SELECT 1) を k6 で測定 |
| E-4 | #11 Turnstile は Cloudflare 公式テストキー (`1x00000000000000000000AA`) 使用 |
| E-5 | #7 Resend webhook 受信は ngrok 必要のため α-1 に委ねる。本 PoC は送信成功のみ |
| E-6 | v2.4 追加 4 カラム (`phone_verified_at` / `quoted_amount_minor` / `tax_rate_bps` / `billing_status`) は α-0 影響なし、α-1 schema 作業で対応 |
| E-7 | #16 `redact_audit_payload()` 関数設計を Wave 4 先頭で実施 |

---

## A. 依存関係グラフ

### A-1. 既存スキャフォールドで即着手可能（前提ゼロ）
`companies` / `users` / `vendor_users` テーブル、RLS helper 3 関数 (`current_user_company_id` / `current_vendor_user_company_id` / `current_vendor_id`)、`_reservations_slice_test` (gist + tstzrange) が存在。

| PoC | 理由 |
|---|---|
| #4 tstzrange gist | `_reservations_slice_test` に EXPLAIN ANALYZE |
| #2 並列予約 | 同テーブルへの concurrent INSERT |
| #5 レイテンシ | k6 で DB pooler 直接、テーブル不問 |
| #9 shadcn/ui | UI 専用、DB 不要 |
| #10 FullCalendar | UI 専用、stub データ |
| #11 Turnstile | フロント + テストキー |

### A-2. スタブテーブル 1 枚追加
| PoC | 必要スタブ | 依存 |
|---|---|---|
| #13 楽観排他 | `users.version` 既存 or `_version_test` | なし |
| #15 先着受注 | `transport_order_invitations` + `accept_invitation_and_revoke_others` DB 関数 | なし |
| #14 業者対応不可 | `vendor_sla_overrides` skeleton | `vendors` skeleton |
| #1 RLS 漏洩 | `vendors` skeleton + RLS policy | `current_user_company_id()` 既存 |
| #6 vendor portal 認証 | `vendors` skeleton 共有 | RLS helper 既存 |

### A-3. outbox + Inngest 骨格
| PoC | 必要 | 依存 |
|---|---|---|
| #3 outbox retry | `notification_outbox` + Inngest function + SKIP LOCKED | outbox テーブル |
| #7 Resend メール | outbox 経由 Resend 呼び出し | #3 |
| #8 vendor_portal_inbox | `vendor_portal_inbox` skeleton + outbox → inbox | #3 |

### A-4. 設計フェーズ先行
| PoC | 設計 | 依存 |
|---|---|---|
| #16 PII redaction | `redact_audit_payload()` + `audit_logs` skeleton | 設計決定 |

---

## Wave 分け

```
Wave 1（即着手・並列）
  Main: #4, #2, #5
  Lane B: #9, #10, #11

Wave 2（スタブ 1 枚追加・並列）
  Main: #13, #15, #12
  Main: #1, #6 ← vendors stub 共有
  Lane A: #14

Wave 3（outbox 骨格前提・並列）
  Main + Lane A: #3 (L)
  Lane A: #7, #8 (#3 完成後)

Wave 4（設計後）
  Main: #16
```

---

## B. Day 別ブレークダウン (2.5 日想定)

> Claude はスケジュール予測を行わない。Day 区切りは roadmap §1.2 の 2.5 日を機械的に分割。

| バケット | レーン | PoC # | 規模 |
|---|---|---|---|
| Day 1 前半 | Main | #4 | S |
| | Main | #2 | M |
| | Lane B | #9 | M |
| | Lane B | #11 | S |
| Day 1 後半 | Main | #5 | M |
| | Main | #13 | S |
| | Lane B | #10 | M |
| | Main | #1 | M |
| Day 2 前半 | Main | #6 | M |
| | Main | #15 | M |
| | Lane A | #14 | M |
| | Main | #12 | M |
| Day 2 後半 | Main + Lane A | #3 | L |
| | Lane A | #7 | M |
| | Lane A | #8 | M |
| Day 3 (0.5) | Main | #16 | L |

規模: S=30 分以内 / M=1-2h / L=半日

---

## C. PoC ごとの実装方針

| # | 検証場所 | 成功判定 | MCP 完結 |
|---|---|---|---|
| 1 RLS 漏洩 | `vendors` stub + RLS policy | company A JWT で company B rows = 0 件 | ○ |
| 2 並列予約 | `_reservations_slice_test` | Promise.all 100 並列 INSERT → 1 件成功 | × (vitest) |
| 3 outbox retry | `notification_outbox` skeleton + Inngest | idempotency_key UNIQUE で 1 件のみ送信 | × |
| 4 gist index | `_reservations_slice_test` | EXPLAIN ANALYZE で GiST Index Scan | ○ |
| 5 レイテンシ | k6 → Shared Pooler | SELECT 1 P95 < 200ms | × (k6) |
| 6 vendor 認証 | `vendor_users` + middleware | auth.users 直接 SELECT → permission denied | ○ + middleware |
| 7 Resend メール | sandbox 経由 | Resend API レスポンス id 存在 | × |
| 8 inbox フロー | `vendor_portal_inbox` skeleton | outbox INSERT → inbox 行作成 | ○ |
| 9 shadcn/ui | `src/app/(admin)/dashboard/` | pnpm dev 200 OK + sidebar/header 描画 | × |
| 10 FullCalendar | `src/app/(admin)/pit-calendar/` | 週表示で stub データ描画 | × |
| 11 Turnstile | `src/app/(customer)/reserve/` | テストキーで verify success | × |
| 12 migration 順序 | §17 骨格 DDL | 適用エラー 0 件・全テーブル存在 | ○ |
| 13 楽観排他 | `users.version` or `_version_test` | 並列 UPDATE → 1 件成功・1 件 affected=0 | ○ |
| 14 業者対応不可 | `vendor_sla_overrides` skeleton | 不可期間中の予約 INSERT 拒否 | △ (アプリ層) |
| 15 先着受注 | `accept_invitation_and_revoke_others` 関数 | 50 並列 → 1 件 accepted / 49 件 revoked or serialization error | ○ |
| 16 PII redaction | `audit_logs` + `redact_audit_payload()` | UPDATE customers → audit_logs に hash, 平文なし | ○ |

---

## D. Codex 委任ポリシー

### 強制委任 (`tests/` 配下 10 行以上)
- `tests/rls/` (#1) / `tests/concurrency/` (#2, #3, #15) / `tests/latency/` k6 (#5) / `tests/unit/` (#13, #16)

### Codex 専担 (レーン指定済み)
- #6 middleware + route protection
- #7 Resend wrapper + React Email テンプレート
- #8 inbox フロー実装
- #9 shadcn/ui layout 一式
- #10 FullCalendar component 統合
- #11 Turnstile API route + フロント
- #14 `vendor_sla_overrides` CRUD stub

### Claude 専担
- 各 PoC の SQL (skeleton DDL / RLS policy / DB 関数 / trigger)
- 結果の assert ロジック設計
- #16 redact_audit_payload 関数設計

### 品質ガードレール (`CODEX_POLICY=max`)
- Codex 出力後に diff / test / lint レビュー
- `tests/` 配下は `pnpm test` グリーン確認
- #7 は Resend API レスポンス id 目視確認

---

## F. 技術補足

### F-1. スタブ naming
α-0 のスタブは本番テーブル名を使用 (`vendors` 等)、`_poc_` プレフィックスは使わない。α-1 で ALTER TABLE で本カラム追加。`_reservations_slice_test` は α-1 で DROP → `reservations` 置換。

### F-2. DB 接続使い分け
- `DIRECT_URL` : Drizzle migrate (transaction pooler 非対応 DDL)
- `DATABASE_URL` : runtime + SKIP LOCKED + k6 計測

### F-3. テストキー一覧 (Turnstile)
- SITE_KEY: `1x00000000000000000000AA` (always pass visible)
- SECRET_KEY: `1x0000000000000000000000000000000AA` (always pass)
- 詳細: https://developers.cloudflare.com/turnstile/troubleshooting/testing/

### F-4. PII redaction 設計 (#16 Wave 4 着手時の出発点)
- `customers.email` → SHA-256 hash (lowercase 後 hex 64 文字)
- `customers.phone` → null
- `vehicles` テーブル → 現状 PII なし、payload そのまま
- 実装: `redact_audit_payload(table_name text, payload jsonb) RETURNS jsonb` PL/pgSQL 関数 + テーブル別 UPDATE trigger

### F-5. 完了基準の共通原則
- 自動テスト緑 OR MCP `execute_sql` assert 成功
- 目視確認のみは UI PoC (#9 / #10) に限定

---

## 計画サマリ

| Wave | PoC 群 | 並列度 |
|---|---|---|
| Wave 1 | #4, #2, #5, #9, #10, #11 | 6 並列 (Main 3 + Lane B 3) |
| Wave 2 | #13, #15, #12, #1, #6, #14 | 6 並列 (Main 5 + Lane A 1) |
| Wave 3 | #3, #7, #8 | Wave 3 内で #3 先行 → #7/#8 並列 |
| Wave 4 | #16 | 単独 |

**Main / Lane A / Lane B の並列性**: Wave 1-2 で Day 1 を埋め、Wave 3 (outbox) を Day 2 後半に持ち越して Lane A 側の #14 完了で待機を吸収。Wave 4 (#16) は Day 0.5 で完結。

*Generated by phase-handoff sprint-α-0-plan at Sprint start. Source: planner subagent output 2026-05-23.*
