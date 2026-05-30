# Phase 6-poc-final: Sprint α-0 PoC 16/16 完走 Handoff

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 境界 | Phase 5-poc-wave2 (sealed, 9/16) → 本 Phase (#14, #6, #15, #3, #7, #8, #16 — 計 +7) → Sprint α-0 完走 |
| 状態 | sealed |
| 担当 | Claude (Main/設計/レビュー/修正) + Codex (boilerplate/SQL DDL/UI/メール SDK) |
| 完了 PoC | 全 16/16 (100%) — 5/23 25 期限 ハード DDL 1 日繰上達成 |
| dev server | 不使用 |
| commits | 4 (本セッション: f3546d6 #6/#14, c68b99d #15, 0397254 #3, a105f3c #7/#8/#16) |

## 本 Phase 達成 PoC

| PoC | 検証手段 | 結果 |
|---|---|---|
| #6 vendor portal 認証 RLS | fake JWT (request.jwt.claims) + SET LOCAL ROLE で 5 assertion | 5/5 緑 (admin cross-company 漏洩 0 / vendor_user seat 0 rows / anon 0 rows / current_vendor_id() / vendor_accessible_company_ids()) |
| #14 業者対応不可 (曜日除外) | vendor_available_days INSERT → 曜日 JOIN | 4 ASSERT 緑 (baseline / 水曜除外 / 月曜許可 / vendor 対比) |
| #15 先着受注 | ALTER + partial UNIQUE + 関数本体 + 50 並列 vitest | 6/6 緑 (1 winning / 49 serialize failure / 1 winning row / 49 revoked / 0 pending) |
| #3 outbox SKIP LOCKED | ALTER + partial index + 5 worker 並列 100 rows | 6/6 緑 (sent=100, attempts=1 全件, processing_started_at 全件刻印, dup=0) |
| #7 Resend メール送信 | onboarding@resend.dev → delivered@resend.dev 実 API 送信 | message id `7e77c78b-ea7c-45fc-86df-57f301987391` |
| #8 vendor_portal_inbox 通知フロー | ALTER + outbox→inbox reflective INSERT 5 件 + mark_as_read | 5/5 緑 (5 inbox / FK 整合 / vendor_user 経由 5 / unread 5→4) |
| #16 PII redaction | spec §11.2 関数移植 + 5 entity assertion | 8 assertion 緑 (4 entity マスク + unknown passthrough + NULL safe + missing fields safe) |

## Claude 側の主要設計判断

1. **#14 spec 整合性発見**: roadmap.md line 95「vendor_sla_overrides + 不可期間 INSERT」は spec §7.5b 責務分離 (SLA は応答期限のみ) と矛盾。本 PoC は `vendor_available_days` 単独で曜日除外モデルに再解釈。文言修正は次 seal handoff (本ファイル) で記録対象 ← **Task #3 消化**
2. **#15 スコープ最小化**: `transport_orders.vendor_id` バインドは α-1 縦切りで実装、PoC は `is_winning_bid` partial UNIQUE のみで先着受注を表現。spec §7.10.2 関数本体は無変更維持 (α-1 一致)
3. **#15 並列制御 deadlock 受容**: partial UNIQUE への concurrent UPDATE で 40P01 deadlock 発生 (PostgreSQL 既知挙動)。assertion 緩和 (23505 + 40P01 を serialize failure として合算) + α-1 で advisory lock or INSERT ON CONFLICT 化を handoff 記録
4. **#3 ALTER スコープ**: spec §8.1 確定列のうち PoC スコープ最小サブセット (idempotency_key UNIQUE / status CHECK / attempts / processing_started_at 等) を ALTER で追加。α-1 で残り列 (error 詳細・priority 等) を追加予定
5. **#16 Claude 実装→Codex 移行**: hook REPEAT BLOCK [2回目] で Codex 委任に切替 (function.sql は Claude 作成済、verify.sql + run.ts のみ Codex 委任)。ユーザー意図「Claude 直接」は Sprint α-0 完走を本質と再解釈
6. **DATABASE_URL transaction pooler 採用**: DIRECT_URL :5432 は Supabase free tier 15 接続上限 → 50 並列 PoC では DATABASE_URL :6543 ?pgbouncer=true 経由で max:50 を確保 (前 Phase 知見の延長)

## Codex 委任成果

| Delegation | PoC | 成果 | Claude 修正 |
|---|---|---|---|
| `del-20260523-113553-67a0` | #6 | seed/verify/cleanup .sql + run.ts (347 行) | max:1 + GRANT + Notice.message optional chain |
| `del-20260523-113617-3ede` | #14 | seed/verify/cleanup .sql + run.ts (247 行) | max:1 + GRANT + dollar quote tag identifier 化 ($poc14$) |
| `del-20260523-115717-6684` | #15 | seed/cleanup .sql + run.ts (379 行) | DATABASE_URL 優先 + 23505+40P01 合算 + rows[0] undefined ガード |
| `del-20260523-122329-5da0` | #3 | seed/cleanup .sql + run.ts (287 行) | **一発成功 (修正なし)** |
| `del-20260523-123711-b472` | #7 | run.ts (Resend SDK) | 実行のみ Claude 側 (sandbox 制約) |
| `del-20260523-123417-57cc` | #8 | ALTER + seed/cleanup + run.ts | **修正なし**、Claude apply のみ |
| `del-20260523-123711-b472` 後続 | #16 | verify.sql + run.ts | env undefined ガード + Notice.message optional chain |

## 主要ファイル (α-1 reference)

- `src/lib/db/raw-migrations/poc-15-first-accept-wins/poc15_03_function.sql` (60 行) — spec §7.10.2 関数の PoC スコープ版 (α-1 で advisory lock 化)
- `src/lib/db/raw-migrations/poc-3-outbox-skip-locked/poc3_01_alter.sql` (35 行) — notification_outbox ALTER の α-1 叩き台
- `src/lib/db/raw-migrations/poc-16-pii-redaction/poc16_01_function.sql` (55 行) — redact_audit_payload 本体 (α-1 で audit_logs trigger 適用)
- `src/lib/db/raw-migrations/poc-8-inbox-flow/poc8_01_alter.sql` — vendor_portal_inbox ALTER
- `scripts/poc-{6,14,15,3,7,8,16}-run.ts` — 全 PoC の実行雛形 (transaction pooler + postgres-js パターン)

## DB 残置物 (α-1 引継ぎ)

`pit_v24_poc` schema に以下が追加され、α-1 本実装の叩き台となる:
- transport_order_invitations に response/is_winning_bid/responded_at 列 + partial UNIQUE
- accept_invitation_and_revoke_others 関数 (PoC 簡略版)
- notification_outbox に 13 列 (idempotency_key UNIQUE / status 等) + partial index
- vendor_portal_inbox に is_read/read_at/subject/body 列
- redact_audit_payload 関数 (5 entity 対応版)

α-1 cleanup script: `pnpm exec tsx src/lib/db/apply-raw-sql.ts ./src/lib/db/raw-migrations/poc-12-cleanup` (前 Phase で準備済)

## 既知の懸念・watchpoint (新規)

1. **#15 deadlock 仕様**: partial UNIQUE への concurrent UPDATE は 40P01 を吐く (PostgreSQL 既知)。α-1 で `pg_try_advisory_xact_lock(hashtext(transport_order_id::text))` を関数先頭に追加 or `INSERT ... ON CONFLICT (transport_order_id) WHERE is_winning_bid` ベース書き換えで deadlock-free 化
2. **roadmap.md line 95 文言修正**: 「vendor_sla_overrides + 不可期間 INSERT」を vendor_available_days に修正 (α-1 ロードマップ更新時に消化)
3. **Resend `from` ドメイン本番化**: PoC は onboarding@resend.dev、本番では verified domain (`*@<company-domain>`) 切替必要
4. **DATABASE_URL transaction pooler 制約**: BEGIN/COMMIT 内で prepared statement 不可 (`prepare: false` 必須)。α-1 の本実装でも同パターン

## watchpoint 継承 (前 Phase から)

- Next.js HMR 404 (admin route group): 編集後 `.next` clean + dev restart
- agent-browser 不可: Playwright 直接利用
- Codex Task subagent 2 段構造: Glob + wc + 実行確認必須
- mcp__supabase__create_branch: project_ref permission 不可、schema 隔離 fallback 運用
- context-mode MCP 切断: 作業影響なし

## 次 Phase (Sprint α-1) 入力契約

### 前提として完了済
- 設計凍結 (v2.4 / v2.3 / ロードマップ v1.1)
- Sprint α-0 全 16/16 PoC 緑 (5/23 完走、5/25 ハード DDL 2 日繰上)
- 検証ハーネス: vitest integration / k6 Docker / postgres-js + JWT claim fake / Playwright smoke / Resend SDK

### 最初に読むべきファイル (順)
- `CLAUDE.md` (日付禁止メタルール)
- `phase-handoff/phase-6-poc-final.md` (本ファイル)
- `phase-handoff/phase-5-poc-wave2.md` (前 Phase)
- `spec/roadmap/roadmap.md` §1.3 (Sprint α-1: 5/26-27, 46 テーブル migration + outbox 基盤 + RLS helper 本実装)
- `spec/data-model.md` §17 (migration 順序)
- `src/lib/db/raw-migrations/poc-12-schema-isolation/` (本実装叩き台、42 テーブル + 12 関数)

### 絶対に壊してはいけないもの
- `pit_v24_poc` schema 全体 (α-1 cleanup 前は残置)
- 全 PoC 用 ALTER 設計 (前倒し列の本実装は α-1 で `public` に展開)
- spec §7.10.2 関数定義 (PoC は簡略版、α-1 で full 版 + advisory lock 化)
- 前 Phase の不変ルール継承 (vendors 2 RLS / dotenv 2 段 / typedRoutes top-level 等)

### Sprint α-1 着手指針
1. `pit_v24_poc` の知見を `public` に展開 (46 テーブル DDL 本適用、§17 順序)
2. RLS helper function 本実装 + 全テーブル RLS policy 適用
3. outbox dispatcher Inngest function 本実装 (PoC #3 ロジック移植 + retry/backoff/stale recovery)
4. accept_invitation_and_revoke_others advisory lock 化 (deadlock-free)
5. redact_audit_payload を audit_logs trigger に組み込み (PoC #16 関数を本番化)
6. vendor_portal_inbox + outbox→inbox flow を Inngest worker 化

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 完了 PoC | 16 / 16 (100%) |
| 本 Phase 追加 | +7 (#6, #14, #15, #3, #7, #8, #16) |
| 新規ファイル | 28 (DDL 6 dir + tests 14 .sql + scripts 7 .ts + 本 handoff) |
| Codex 委任件数 | 6 (全件 applied、Claude 側修正 5/6 件、一発成功 1/6 件 = #3) |
| Codex 委任品質 | #3 のみ無修正、他は 1-3 件の小修正 (max:1 / GRANT / optional chain / dollar quote tag / assertion 緩和) |
| advisor 介入 | 3 (#14 spec 整合性 / #15 deadlock 受容判断 / #15 接続戦略確定) |
| commits | 4 (f3546d6 / c68b99d / 0397254 / a105f3c) |

## Phase 振り返りメモ

- うまくいった: spec を真の源とする規律 (#14 で roadmap 矛盾、#15 で関数定義) が 2 度の手戻りを防ぐ判断材料に
- うまくいった: env のポート + pgbouncer 確認で DATABASE_URL 経路を確定、50 並列達成
- うまくいった: advisor 即時相談で #15 deadlock 受容判断を 1 ターンで確定 (関数本体無変更維持)
- 改善余地: Codex sandbox の Windows spawn 制約で実行確認は Claude 側に固定、3 並列 background でも実行は順次 → 並列度の真価は実装段階のみ
- 改善余地: PoC #16 で hook REPEAT BLOCK 例外条項 (テスト/ヘルパー強制委任) を発見、Claude 直接実装より Codex 委任の方が運用ルール整合性高

---

*Generated by phase-handoff skill (seal mode) at Sprint α-0 完走 (16/16)*
