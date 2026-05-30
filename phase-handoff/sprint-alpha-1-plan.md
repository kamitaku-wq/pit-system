# Sprint α-1 実装計画 v1.1

**対象 Sprint**: α-1 (roadmap.md §1.3 事実言及)
**前提**: Sprint α-0 全 16/16 PoC 緑 (phase-6-poc-final.md sealed)
**設計ベース**: spec/data-model.md v2.4 / spec/roadmap/roadmap.md v1.1 (凍結)
**v1.1 補正理由**: Codex adversarial-review (alpha-1-plan-review.md) + schema reconciliation (alpha-1-schema-reconciliation.md) 反映

---

## 依存グラフ

```
Phase A (DDL 46 テーブル + reconciliation)
  └──→ Phase B (Helper Functions)
         └──→ Phase C (RLS + Triggers + Seed)
  └──→ Phase D (Inngest Workers)        ← A 完了後並走可
  └──→ Phase E (RLS 統合テスト)          ← B 完了後並走可
```

Phase A は全 Phase の起点。Phase B は Phase C を blocking (§17 順序)。D は A 後並走可、E は B 後並走可。

---

## Phase A: DDL 基盤 — public スキーマ 46 テーブル展開

### A-0 (新規, Critical): schema reconciliation 適用
- `alpha-1-schema-reconciliation.md` の差異 (RENAME 6 / NOT NULL 多数 / ADD/DROP 多数 / Index 7) を Codex 委任時のプロンプトに **明示** 必須

### A-1: `src/lib/db/raw-migrations/alpha-1-public/` 21 ファイル生成
- **Codex 委任** (機械的列追加 + reconciliation 反映、~1500 行)
- 入力: `poc12_*.sql` + `spec/data-model.md` §3-§13 + `alpha-1-schema-reconciliation.md`
- 特に注意 (Claude review 必須):
  - `01_extensions`: btree_gist / pgcrypto / pg_trgm
  - `11_reservations`: exclusion constraint full WHERE clause
  - `12_transport`: 25 列 + movement_type/tow CHECK (§7.6)
  - `13_notifications`: reconciliation Table 1+2 全項目反映 (RENAME 3 / NOT NULL 7 / Index 3)
  - `15_audit`: reconciliation Table 4 反映 (audit_logs 列大幅刷新) + reconciliation Table 3 反映 (pii_anonymization_jobs 新規 — ただし **Phase B-1 で Claude 単独実装に分離**)
  - `15_audit`: append-only `REVOKE UPDATE, DELETE ON audit_logs FROM authenticated, anon` (§11.3)
  - `17_analytics`: 3 MATERIALIZED VIEW
  - **α-2 送り**: `audit_logs_cleanup_log` (spec 未定義、Codex review #B.4) / `v_accounting_audit_trail` VIEW (service_tickets 完備依存)

### A-2: Drizzle schema 43 新規 + 3 更新 (Codex ~1300 行)
### A-3: 適用 + DoD: `count(public.tables) >= 46` (Claude)

---

## Phase B: Helper Functions + Critical Functions

### B-1a (Codex 委任): 5 helper 関数
- §14.2 移植: current_user_company_id / current_vendor_id / current_vendor_user_id / vendor_accessible_company_ids / vendor_invited_transport_order_ids

### B-1b (**Claude 単独**, Codex review #E.4 反映): pii_anonymization_jobs 構造 + state machine
- A-1 から分離。reconciliation Table 3 全 15 列 + EXCLUDE + 2 index + state machine semantics を Claude が実装
- 状態遷移: pending → verified → scheduled → processing → (completed | failed | legal_hold)
- v_accounting_audit_trail VIEW は α-2 (service_tickets 完備依存)

### B-1c (Claude 単独): redact_audit_payload(p_entity, p_data) public 移植
- PoC #16 の 2 引数版を public にコピー (5 entity 対応済)

### B-1d (Claude 単独): accept_invitation_and_revoke_others advisory lock 化
- `pg_try_advisory_xact_lock(hashtext(v_transport_order_id::text))` + 55P03 RAISE + transport_orders.vendor_id バインド + version++ (§7.10.2 lines 919-921)
- 返り値 `RETURNS TABLE(transport_order_id uuid, version int)`

### B-2 (Claude): smoke test
- helper 関数群動作確認 + pii state machine 遷移 1 ループ確認

---

## Phase C: RLS + Triggers + Seed

### C-1 (Codex ~300 行): RLS policies 46 テーブル
- 標準 tenant_isolation FOR ALL TO authenticated
- 特殊 (Claude 仕様確認):
  - transport_orders: vendor_portal_select/update + column-level GRANT (§14.4)
  - vendor_portal_inbox: **二重防衛** `vendor_id = current_vendor_id() AND (recipient_vendor_user_id IS NULL OR recipient_vendor_user_id = current_vendor_user_id())` (Codex review #B.6 反映)
  - audit_logs: §11.3 REVOKE は A-1 で適用済、ここでは RLS SELECT のみ
  - pii_anonymization_jobs: service_role のみ UPDATE/DELETE、authenticated は SELECT のみ (state machine 不変)

### C-2a (Codex ~150 行): 標準 trigger 5 種
- set_updated_at / enforce_status_transition / enforce_vendor_user_tenancy / enforce_membership_shared / sync_user_delete

### C-2b (**Claude 単独**, Codex review #C.1/#D.1/#E.2 反映): record_audit_log trigger
- **Critical risk**: 1 defect で audited 全テーブル書込破壊。**Codex 委任不可**
- 必須設計要素:
  1. **Recursion 防止**: `IF pg_trigger_depth() > 1 THEN RETURN COALESCE(NEW, OLD); END IF;` 関数先頭
  2. **audit_logs 自己監査回避**: AFTER trigger を audit_logs 自身に張らない
  3. **対象テーブル明示**: 「主要 9 テーブル」を spec から確定して列挙 (foreach AFTER trigger 個別作成)
  4. **redact entity 未対応時のフォールバック**: redact_audit_payload が unknown entity を受けた時 passthrough (PoC #16 で確認済)
  5. **table-by-table test matrix**: 9 テーブル全件 INSERT/UPDATE/DELETE × redaction 期待値 で merge 前テスト
- prevent_vendor_selection_logs_modification も Claude 単独 (audit に近い性質)

### C-3 (Codex ~80 行): seed master
- lane_types 6 / statuses 16 / status_transitions / notification_rules / roles 6 (§18)

---

## Phase D: Inngest Workers (A 後並走可)

### D-1 (Codex ~30 行): client.ts + serve route
### D-2 (Codex + Claude review): outbox-dispatcher (PoC #3 移植、backoff/stale recovery、prepare:false)
### D-3 (Codex ~80 行): inbox-worker (PoC #8 reflective INSERT 移植、recipient_vendor_user_id セマンティクス考慮)

---

## Phase E: RLS 統合テスト (B 後並走可)

### E-1 (Codex tests/ 強制 ~150 行): tenant-isolation.test.ts (PoC #6 verify.sql 5 assertion 移植)
### E-2 (新規, Claude 単独): record_audit_log test matrix (Phase C-2b と対)
- 9 テーブル × 3 action (INSERT/UPDATE/DELETE) × redaction 期待値 = 27 assertion

---

## Risk 表 v1.1 (Codex review #D 反映)

| リスク | 深刻度 | 対策 |
|---|---|---|
| **record_audit_log trigger 設計欠陥** | **Critical** ⬆️ | Claude 単独実装 + recursion 防止 + per-table contract + E-2 test matrix 必須 |
| **pii_anonymization_jobs state machine 欠落** | **High** ⬆️ | Claude 単独実装、EXCLUDE constraint + 7 状態遷移完全実装 |
| **schema drift (outbox/inbox/audit 全列)** | High | A-0 reconciliation で全件突合済、A-1 委任時に明示 |
| RLS helper/policy ordering (§17 強制) | High | DoD ではなく Phase B → C blocking として強制 |
| audit_logs_cleanup_log spec 未定義 | Medium | α-2 送り (本 plan で明示) |
| advisory lock hashtext 衝突 | Low | 64bit hash、実運用無視可 |
| DIRECT_URL 15 接続上限 | Medium | apply-raw-sql.ts 順次シングル接続 |
| Inngest signing key 運用 | Medium | env 設定 + serve route 認証確認 (D-1 で対応) |

**棄却**: drizzle-kit `db push` (trigger/policy 制御困難) / accept_invitation を ON CONFLICT 書換 (advisor 判断で advisory lock 優位) / 1 generic `record_audit_log` (Codex review #C.1 で per-table contract に変更)

---

## Codex 委任境界 v1.1 (review #E 反映)

✅ **Valid**: A-1 DDL / A-2 Drizzle / B-1a helper 5 関数 / C-1 RLS / C-2a 標準 trigger 5 種 / C-3 seed / D-1/D-2/D-3 Inngest / E-1 tests

❌ **Claude 単独に移動** (委任不可): B-1b pii_anonymization_jobs state machine / B-1c redact_audit_payload public 移植 / B-1d accept_invitation advisory lock 化 / **C-2b record_audit_log trigger** / E-2 audit test matrix

---

## DoD

- [ ] `count(public.tables) >= 46`
- [ ] helper 7 関数 smoke test 緑 (B-2)
- [ ] RLS 漏洩 0 (E-1)
- [ ] **record_audit_log test matrix 27/27 緑 (E-2)**
- [ ] **pii_anonymization_jobs state machine 1 ループ動作確認 (B-2)**
- [ ] outbox-dispatcher 起動 + stale recovery 動作
- [ ] `pnpm typecheck` / `pnpm lint` 0
- [ ] roadmap.md line 95 文言修正 (vendor_sla_overrides → vendor_available_days)
- [ ] `rtk git status` clean + commit + seal phase-7-alpha-1.md

---

*Sprint α-1 計画 v1.1 (Codex adversarial-review + schema reconciliation 反映後)*
