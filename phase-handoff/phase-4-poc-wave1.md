# Phase 4-poc-wave1: Sprint α-0 PoC 7/16 完了 Handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 境界 | Phase 3-env-bootstrap (sealed) → 本 Phase (Wave 1 完了 + Wave 2 #1) → 残 9 PoC (#10, #6, #14, #12, #15, #3, #7, #8, #16) |
| 状態 | sealed |
| 担当 | Claude (Main/設計/レビュー) + Codex (boilerplate/UI/tests) |
| 完了 PoC | #4 / #2 / #5 / #9 / #11 / #13 / #1 (7 件) |
| 未 commit ファイル | `tests/integration/*.test.ts` ×3 / `tests/latency/db-roundtrip.k6.js` / `scripts/run-latency-test.ps1` / `src/app/(admin)/**` / `src/components/{layout,ui,forms}/**` / `src/app/api/auth/turnstile/verify/route.ts` / `src/lib/utils.ts` / `next.config.ts` / `.env.local` / `phase-handoff/sprint-alpha-0-plan.md` + 本 handoff |

## 達成したこと (PoC 別エビデンス)

- **#4 gist index**: EXPLAIN ANALYZE で `Bitmap Index Scan on no_overlap_within_store` 確認、exec 0.494ms (MCP 完結)
- **#2 並列予約**: 100 並列 INSERT → success=1 / conflict=99 / other=0、668ms (vitest, Codex `del-20260523-081105-bd93`)
- **#5 Tokyo レイテンシ**: p(95)=164.11ms < 200ms 閾値、55,395 req / 60s / 100 VU / 0 failures (k6 Docker grafana/k6)
- **#9 admin layout**: `/dashboard` HTTP 200, 54918 bytes、sidebar+header+Card 3 枚描画 (Codex `del-20260523-081629-612d`)
- **#11 Turnstile**: テストキー (`1x000...AA`) で verify API success=true、285ms (vitest)
- **#13 楽観排他**: 10 並列 UPDATE WHERE version=$x → success=1 / conflict=9 / error=0、final version=2 (vitest, Codex `af1a2751db618dd49` ※下記 watchpoint)
- **#1 RLS 漏洩 (両 variant)**: social_user A_context=2/B_context=1 + vendor_user A_context=2/B_context=1、全 4 context でテナント分離成立 (MCP 完結)

## Claude 側の主要設計判断

1. **#1 RLS の auth.uid() fake 手法**: `SET LOCAL ROLE authenticated; SET LOCAL request.jwt.claims = '{"sub":"<uuid>","role":"authenticated"}';` で `auth.uid()` を JWT claim sub から取得させる方式。Supabase の `auth.uid()` 実装が `current_setting('request.jwt.claims',true)::json->>'sub'` であることを利用。SECURITY DEFINER helper (`current_user_company_id` / `current_vendor_user_company_id`) を経由してテナント識別。**`public.users.id` / `vendor_users.id` への auth.users FK 不在** が判明、これにより MCP 直接 seed で RLS 検証が可能 (`auth.users` への INSERT 不要)。
2. **#13 楽観排他の検証方式修正 (advisor 介入)**: 当初 MCP CTE (data-modifying WITH) で逐次風検証を行ったが、Postgres docs に「single statement で同 row 二重 UPDATE は予測不能」と明記。**本物の concurrent transaction race を postgres-js 並列 UPDATE で検証** に切り替え。α-0 の「技術リスクのゼロ化」目的を優先。
3. **#5 計測対象**: pooler TCP 直接接続には xk6-sql extension 必要 (公式 grafana/k6 image にない) → PostgREST roundtrip (`GET /rest/v1/companies?select=id&limit=1`) 計測で代理。HTTP+Auth+RLS+Postgres 全層を含むため α-0 ベースラインとして十分厳しめ。業務 endpoint 計測は α-1 以降。
4. **#9 route group**: `src/app/(admin)/` を使用、Next.js 仕様で URL は `/dashboard` (admin prefix なし)。`/admin/*` prefix が要件なら α-1 で `src/app/admin/` に再構成。本 PoC は layout 動作確認が目的。
5. **stub テーブル方針**: α-0 はカラム骨格のみ、α-1 で full schema 展開 (planner 確定 / spec/CLAUDE.md §17 順序)。

## Codex 委任成果

| Delegation ID | PoC | 成果 | 状態 |
|---|---|---|---|
| `del-20260523-081105-bd93` | #2 | `tests/integration/poc-02-parallel-reservation.test.ts` | applied + 緑 |
| `del-20260523-081629-612d` | #9 or #11 (推定) | shadcn/ui layout + Turnstile + .env.local 編集 | applied + 緑 |
| `del-20260523-082622-925a` | #5 (推定) | k6 script + ps1 wrapper | applied + 緑 (P95=164ms) |
| `af1a2751db618dd49` (Agent ID) | #13 | `tests/integration/poc-13-optimistic-locking.test.ts` (再委任) | applied + 緑 |

**ledger noise watchpoint**: 初回 #13 委任の `del-20260523-082622-925a` (?) は auto-apply 通知が来たが実際にはファイルが書かれなかった。再委任 `af1a2751db618dd49` で作成成功。次回 ledger grep 時に phantom ID に注意。

## 主要ファイル (next phase reference)

- `tests/integration/poc-02-parallel-reservation.test.ts` (83 行) — 並列予約 race パターンの参照実装
- `tests/integration/poc-11-turnstile.test.ts` — Cloudflare verify API テスト雛形
- `tests/integration/poc-13-optimistic-locking.test.ts` (74 行) — postgres-js 並列 UPDATE race パターン
- `tests/latency/db-roundtrip.k6.js` + `scripts/run-latency-test.ps1` — k6 Docker 経路
- `src/components/layout/admin-shell.tsx` + `src/components/ui/{button,card}.tsx` + `src/lib/utils.ts` — UI 骨格
- `src/app/api/auth/turnstile/verify/route.ts` + `src/components/forms/turnstile-widget.tsx` — Turnstile 雛形
- `next.config.ts` — `typedRoutes` top-level 移動済 (phase-3 watchpoint 消化)
- `.env.local` — TURNSTILE_* テストキー追加 (env vars 14)

## DB スキーマ変更 / 残置 stub テーブル

| テーブル | 状態 | α-1 対応 |
|---|---|---|
| `public._reservations_slice_test` | Phase 3 既存、PoC #4/#2 で使用、未変更 | DROP → `reservations` 置換 (data-model.md §6.2) |
| `public._version_test` | 本 Phase 新規、PoC #13 row cleanup 済テーブル残置 | DROP |
| `public.vendors` | 本 Phase 新規 skeleton (id/company_id/name)、RLS policy 2 種 (`vendors_select_same_company` + `vendors_select_vendor_user`) | ALTER で v2.4 spec column 追加、policy 拡張 |

## 既知の懸念・watchpoint

1. **#9 route group**: `/admin/*` prefix が要件なら α-1 で `(admin)` → `admin/` に再構成
2. **#5 max=4.01s outlier**: avg=111ms vs max=4010ms (single tail-event)。cold connection / TCP retransmit パターンの可能性。α-1 で reservation 系業務 endpoint 計測時に再観察
3. **#7 Resend webhook 受信** は ngrok 必要のため α-1 に委ねる (planner 計画通り)
4. **#13 ledger phantom ID** (前項参照)
5. **k6 winget 不在**: ローカルインストール不可、Docker `grafana/k6` 経由のみ。CI で k6 を使う場合も Docker 経由設計が安全
6. **Context-mode MCP 中断**: 本 Phase 中に context-mode plugin が disconnect、以降の作業に影響なし。次 Phase でも再接続不要

## 次 Phase (Sprint α-0 残 9 PoC) 入力契約

### 前提として完了済み
- 設計凍結 (v2.4 / v2.3 / ロードマップ v1.1)
- 環境構築 + DB 初期化 (Phase 3)
- Wave 1 全完了 (#4, #2, #5, #9, #11) + Wave 1 末 #10 のみ残 + Wave 2 #1, #13 完了
- 検証ハーネス確立 (vitest integration / k6 Docker / MCP execute_sql + JWT claim fake)

### 最初に読むべきファイル (順)
- `CLAUDE.md` — メタルール (日付禁止)
- `phase-handoff/phase-4-poc-wave1.md` — 本ファイル
- `phase-handoff/sprint-alpha-0-plan.md` — Wave 別計画書 (200 行)
- `phase-handoff/phase-3-env-bootstrap.md` — 環境契約
- `spec/roadmap/roadmap.md` §1.2 — 残 PoC 完了基準
- `tests/integration/poc-02-parallel-reservation.test.ts` — vitest 参照実装

### 絶対に壊してはいけないもの (新規追加)
- `vendors` stub の 2 RLS policy (social_user + vendor_user variant)
- `_version_test` テーブル (α-1 まで残置)
- `vendors_select_vendor_user` policy が `current_vendor_user_company_id()` 経由
- Phase 3 から継承の不変ルール全て (dotenv 2 段読み等)
- `next.config.ts` の `typedRoutes` top-level 配置

### 残 9 PoC の Wave 別着手指針

| Wave | PoC | 着手指針 | 種別 |
|---|---|---|---|
| 1 末 | #10 FullCalendar | `pnpm add @fullcalendar/{react,daygrid,timegrid}` → Codex 委任 (UI 統合 boilerplate) | Boilerplate |
| 2 | #6 vendor portal 認証 | `vendors` stub 既存、middleware/route protection を Codex 委任 | Boilerplate + 設計 |
| 2 | #14 業者対応不可 | `vendor_sla_overrides` skeleton + 不可期間 INSERT、アプリ層 or DB CHECK 判断 → Codex 委任 | Boilerplate + 設計 |
| 2 | #12 migration 順序 | §17 順序の骨格 DDL ファイル群を Claude 設計、`pnpm db:apply-raw:post` で push エラー 0 件確認 | Design + MCP |
| 2 | #15 先着受注 | **設計先行**: `accept_invitation_and_revoke_others` PL/pgSQL 関数を Claude 設計 → 50 並列 vitest を Codex 委任 | Design-first |
| 3 | #3 outbox retry | **設計先行**: SKIP LOCKED SQL + Inngest function 構造を Claude 設計 → tests/concurrency/ を Codex 委任 | Design-first |
| 3 | #7 Resend メール | #3 outbox 完成後、send 経路と sandbox 動作 (`onboarding@resend.dev`) を Codex 委任 | Boilerplate |
| 3 | #8 inbox フロー | #3 outbox 完成後、`vendor_portal_inbox` skeleton + outbox → inbox を Codex 委任 | Boilerplate |
| 4 | #16 PII redaction | **設計先行**: `redact_audit_payload(table, payload jsonb) RETURNS jsonb` 関数を Claude 設計 (`customers.email` SHA-256, `customers.phone` null) → trigger 適用 → MCP で検証 | Design-first |

### 推奨着手手順
1. 新セッションで `phase-handoff/phase-4-poc-wave1.md` + `sprint-alpha-0-plan.md` を Read
2. TaskList で残 9 PoC の依存状態 (#6/#14 は #1 解除済) を再確認
3. `pnpm dev` 再起動 (前 background PID 34540 は kill 済)
4. Wave 順に: #10 → #12 → #14/#6 (並列) → #15 → #3 → #7/#8 (並列) → #16
5. **Design-first PoC (#12/#15/#3/#16) は planner サブエージェントで設計確定してから Codex 委任**

## Codex ledger refs

`del-20260523-081105-bd93` (#2) / `del-20260523-081629-612d` (#9 or #11) / `del-20260523-082622-925a` (#5 推定、#13 phantom 注意) / `af1a2751db618dd49` (Agent ID, #13 再委任で実ファイル化)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 完了 PoC | 7 / 16 (43.75%) |
| 新規 vitest | 3 (poc-02 / poc-11 / poc-13) |
| 新規 stub テーブル | 2 (`_version_test` / `vendors`) |
| 新規 RLS policy | 2 (`vendors_select_same_company` / `vendors_select_vendor_user`) |
| 新規 Next.js routes | 1 (`/dashboard`) + 1 API (`/api/auth/turnstile/verify`) |
| Codex 委任件数 | 5 (うち 1 件 phantom + 1 件再委任) |
| advisor 介入 | 2 (#13 検証方式修正 + 本 seal タイミング指示) |
| dev server | killed (PID 34540) |

## Phase 振り返りメモ

- うまくいった: planner サブエージェントによる初期 16 PoC 計画立案が Wave/依存/委任候補を構造化し、本 Phase の意思決定コストを最小化
- うまくいった: MCP execute_sql + JWT claim fake で RLS 検証が auth.users 経由なしで完結 (key finding)
- 改善余地: #13 で context 節約を理由に検証方式を弱めた → advisor 指摘で修正。**「効率優先で検証スコープを縮めない」を学習**
- 改善余地: Codex `del-20260523-082622-925a` の auto-apply 通知と実ファイル化の乖離 → ledger 信頼性に課題、次 Phase は委任後に必ず Glob で実ファイル存在確認

---

*Generated by phase-handoff skill (seal mode) at Sprint α-0 Wave 1 + Wave 2 partial seal*
