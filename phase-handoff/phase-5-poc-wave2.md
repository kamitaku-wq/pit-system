# Phase 5-poc-wave2: Sprint α-0 PoC 9/16 完了 Handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 境界 | Phase 4-poc-wave1 (sealed, 7/16) → 本 Phase (Wave 1 末 #10 + Wave 2 #12, 計 +2) → 残 7 PoC (#6, #14, #15, #3, #7, #8, #16) |
| 状態 | sealed |
| 担当 | Claude (Main/設計/レビュー) + Codex (boilerplate/SQL DDL/UI) |
| 完了 PoC | #10 (FullCalendar) / #12 (migration §17) — 計 9/16 (56.25%) |
| dev server | killed |

## 達成したこと (PoC 別エビデンス)

- **#10 FullCalendar**: `/calendar` HTTP 200, `.fc`=1, `.fc-event`=4, header="2026年5月17日 – 23日", locale=ja, console errors=0. v6 + dayGrid/timeGrid/interaction + month/week/day 切替, shadcn/ui Card wrap (Codex `agentId=ad95ad440b1521812`)
- **#12 migration §17**: pit_v24_poc schema 隔離で 22/22 apply エラー 0 件. table=42, FK=95, 主要 5 テーブル RLS=true, helper 関数 12 種 (必須 7 + bonus 5), `reservations_no_overlap` EXCLUSION, RLS USING 句で helper 参照成立 → v2.3 順序修正 (helper→RLS→trigger) の意図実証 (Codex `agentId=a8422e69541920487 / del-20260523-104949-d91e`)

## Claude 側の主要設計判断

1. **#10 client component 配置**: `src/app/(admin)/calendar/page.tsx` 単一ファイルで `"use client"` 化。SSR/CSR 境界の `next/dynamic ssr:false` は不採用 (Server Component から Client Component 通常パターンで hydration 成立)。Codex 出力に対し p-6 削除 (admin-shell main の p-8 と二重 padding 解消) と quote 統一 (prettier) を Claude 微修正
2. **#12 検証戦略の fallback 採択**: `mcp__supabase__create_branch` が project_ref permission エラーで利用不可 → `CREATE SCHEMA pit_v24_poc` 隔離 fallback。検証強度は branch より弱い (auth.uid()/auth.users は global schema、helper 関数の本物動作は α-1 で再実施) が、§17 順序検証 + 全 DDL syntax 検証としては十分
3. **#12 cleanup 分離設計**: `apply-raw-sql.ts` は dir 内全 .sql を sort apply する仕様 → `poc12_99_cleanup.sql` を同 dir に置くと schema drop が他ファイルと一緒に流れる構造的問題。`poc-12-cleanup/` 別 dir 分離で apply 混入回避 + DELETE FROM _raw_migrations 追記
4. **#12 schema 残置判断**: pit_v24_poc は α-1 本実装の叩き台になるため残置。cleanup script は手動 apply 用に保持
5. **HMR 404 回避運用**: Next.js 15.5 + (admin) route group で**ファイル編集後に /calendar が 404 化する症状を 2 回再現**。`.next` clean + dev restart で復活。次 PoC で UI 触る際は **編集後 visual 確認は dev restart を挟む**

## Codex 委任成果

| Delegation | PoC | 成果 | 状態 |
|---|---|---|---|
| `ad95ad440b1521812` (Agent) | #10 | `src/app/(admin)/calendar/page.tsx` 62 行 | applied + 緑 |
| `a8422e69541920487` (Agent) → `b16di7njz` (bg) / ledger `del-20260523-104949-d91e` | #12 | `src/lib/db/raw-migrations/poc-12-schema-isolation/*.sql` 22 ファイル + cleanup 1 (合計 788 行) | applied + 緑 |

**ledger 信頼性更新 (前 phase watchpoint #4 の続報)**:
- Task subagent 経由は `actual_paths: []` で paths tracking 不完全。`applied: true` は subagent 起動成功であって Codex 実装完了ではない
- 完了確認は **Glob で実ファイル存在確認** + **`wc -l` で内容ボリューム確認** が必須
- Subagent 完了通知後に Codex 本体 background task (b16di7njz 等) が引き続き動く 2 段構造

## 主要ファイル (next phase reference)

- `phase-handoff/poc-12-design.md` — #12 設計メモ (検証戦略 / 衝突マップ / 検証 SQL 6 種 / Codex 委任スコープ)
- `src/lib/db/raw-migrations/poc-12-schema-isolation/poc12_18_helper_functions.sql` (60 行) — α-1 本実装の helper 関数雛形
- `src/lib/db/raw-migrations/poc-12-schema-isolation/poc12_19_rls_policies.sql` (125 行) — 全テーブル tenant_isolation policy パターン
- `src/lib/db/raw-migrations/poc-12-schema-isolation/poc12_11_reservations.sql` (39 行) — EXCLUSION CONSTRAINT 参照
- `src/app/(admin)/calendar/page.tsx` (62 行) — FullCalendar 統合パターン、α-1 ドラッグ移動 #2 PoC の叩き台
- `scripts/screenshot-calendar.mjs` — Playwright (@playwright/test) smoke 再利用可能

## DB 残置物

| 場所 | 状態 | α-1 対応 |
|---|---|---|
| `public.{_raw_migrations,companies,users,vendor_users,_reservations_slice_test,_version_test,vendors}` | Phase 3/4 既存、未変更 | _reservations_slice_test と _version_test は α-1 で DROP |
| `pit_v24_poc.*` (42 テーブル + 12 関数 + RLS + EXCLUSION) | 本 Phase で apply、α-1 本実装の叩き台 | 本実装完了時に `pnpm exec tsx src/lib/db/apply-raw-sql.ts ./src/lib/db/raw-migrations/poc-12-cleanup` で DROP |
| `public._raw_migrations` 内の `poc12_*` 22 件 | apply 履歴、再 apply 防止 | cleanup 時に DELETE |

## 既知の懸念・watchpoint

1. **Next.js HMR 404**: ファイル編集後の (admin) route group で /calendar/(他)が 404 化。`.next` clean + dev restart 必須運用
2. **agent-browser 利用不可**: Chrome 未 install で `os error 10060` → Playwright 直接 (`scripts/screenshot-calendar.mjs` 雛形) を全 PoC で利用推奨
3. **next lint deprecated**: Next.js 15.5 でインタラクティブ起動 → ESLint CLI 移行は Phase 3 残作業として継続。typecheck (`pnpm typecheck`) は緑運用継続
4. **mcp__supabase__create_branch**: project_ref permission エラーで利用不可。schema 隔離 fallback の検証強度低下を受容
5. **Codex subagent 2 段構造**: Task agent 完了 ≠ Codex 実装完了。Glob + wc 確認を必須化
6. **context-mode MCP**: 本 Phase でも再 disconnect (前 Phase 既知)、作業影響なし

## 次 Phase (Sprint α-0 残 7 PoC) 入力契約

### 前提として完了済み
- 設計凍結 (v2.4 / v2.3 / ロードマップ v1.1)
- Wave 1 全完了 (#4, #2, #5, #9, #11) + Wave 1 末 #10 + Wave 2 #1, #13, #12 完了 (計 9/16)
- 検証ハーネス: vitest integration / k6 Docker / MCP execute_sql + JWT claim fake / Playwright smoke
- α-1 本実装 helper/RLS/migration の叩き台 (pit_v24_poc 内 42 テーブル + 12 関数)

### 最初に読むべきファイル (順)
- `CLAUDE.md` — メタルール (日付禁止)
- `phase-handoff/phase-5-poc-wave2.md` — 本ファイル
- `phase-handoff/poc-12-design.md` — #12 設計メモ
- `phase-handoff/phase-4-poc-wave1.md` — Wave 1 末状態
- `spec/roadmap/roadmap.md` §1.2 — 残 7 PoC 完了基準
- `src/lib/db/raw-migrations/poc-12-schema-isolation/` — α-1 本実装叩き台

### 絶対に壊してはいけないもの (新規追加)
- `pit_v24_poc` schema 全体 (α-1 まで残置、cleanup は手動)
- `poc-12-cleanup/poc12_99_cleanup.sql` (cleanup ロジック保持)
- `src/app/(admin)/calendar/page.tsx` の FullCalendar 統合パターン
- 前 Phase の不変ルール全て継承 (vendors 2 RLS / dotenv 2 段 / typedRoutes top-level 等)

### 残 7 PoC の Wave 別着手指針

| Wave | PoC | 着手指針 | 種別 |
|---|---|---|---|
| 2 | #6 vendor portal 認証 | `vendors` stub + middleware/route protection を Codex 委任 (`--effort high`) | Boilerplate + 設計 |
| 2 | #14 業者対応不可 | `vendor_sla_overrides` skeleton + 不可期間 INSERT、アプリ層 or DB CHECK 判断 → Codex 委任 | Boilerplate + 設計 |
| 2 | #15 先着受注 | **設計先行**: `accept_invitation_and_revoke_others` PL/pgSQL 関数を Claude 設計 (poc12_18 内 stub あり) → 50 並列 vitest を Codex 委任 | Design-first |
| 3 | #3 outbox retry | **設計先行**: SKIP LOCKED SQL + Inngest function 構造を Claude 設計 → tests/concurrency/ を Codex 委任 | Design-first |
| 3 | #7 Resend メール | #3 完成後、send 経路と sandbox 動作 (`onboarding@resend.dev`) を Codex 委任 | Boilerplate |
| 3 | #8 inbox フロー | #3 完成後、`vendor_portal_inbox` skeleton + outbox → inbox を Codex 委任 | Boilerplate |
| 4 | #16 PII redaction | **設計先行**: `redact_audit_payload(table, payload)` 関数を Claude 設計 (poc12_18 内 stub あり) → trigger 適用 → MCP で検証 | Design-first |

### 推奨着手手順
1. 新セッションで `phase-handoff/phase-5-poc-wave2.md` + `poc-12-design.md` を Read
2. TaskList で残 7 PoC の依存状態を再確認 (#6/#14 並列可能、#15/#3 設計先行、#7/#8 #3 依存、#16 単独)
3. Codex 委任は `--effort high` 統一 (新 CLAUDE.md 方針)、Glob で実ファイル確認必須
4. Wave 順に: #6/#14 (並列) → #15 → #3 → #7/#8 (並列) → #16

## Codex ledger refs (本 Phase)

- `ad95ad440b1521812` (Agent #10 FullCalendar, 62 行 page.tsx)
- `a8422e69541920487 / del-20260523-104949-d91e` (Agent #12 §17 DDL 22 ファイル + cleanup 1, 788 行)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 完了 PoC | 9 / 16 (56.25%) |
| 本 Phase 追加 | +2 (#10 / #12) |
| 新規ファイル | 26 (page.tsx + screenshot script + 22 DDL + cleanup + design memo) |
| 新規テーブル (隔離 schema) | 42 in pit_v24_poc |
| 新規 helper 関数 | 12 in pit_v24_poc |
| 新規 FK | 95 in pit_v24_poc |
| 新規 npm package | 5 (@fullcalendar/{react,core,daygrid,timegrid,interaction} @ ^6.1.20) |
| Codex 委任件数 | 2 (両件 applied + 緑) |
| advisor 介入 | 1 (#12 スコープ厳格化 + 検証 SQL 4→6 種補強 + ファイル数調整) |
| commits | 3 (chore mcp / feat #10 / feat #12) |

## Phase 振り返りメモ

- うまくいった: advisor 提案を採用して #12 のスコープを「骨格 DDL のみ」に絞った結果、Codex 1 タスクで 788 行 / 22 ファイル / table=42 / FK=95 を達成、検証 6 種全パス
- うまくいった: schema 隔離 fallback で create_branch 不可を回避、検証強度は弱まったが PoC 完了基準を満たした
- 改善余地: cleanup の dir 分離設計を Claude が当初見落とし、Codex 委任後に手戻り。次回は委任前に apply-raw-sql.ts の挙動を再確認して prompt に dir 構造を明示
- 改善余地: Codex Task subagent の 2 段構造 (subagent 完了 ≠ Codex 完了) を再認識。前 Phase の phantom ID 問題と同根、ledger 信頼性は引き続き弱い

---

*Generated by phase-handoff skill (seal mode) at Sprint α-0 Wave 1 末 + Wave 2 #12 完了*
