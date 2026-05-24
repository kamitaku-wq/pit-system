# Phase 16: 業者ループ最小実装 計画 v2 (Codex adversarial review 反映)

> Generated: 2026-05-24 / planner draft → Codex adversarial review → Claude 統合
> Status: **APPROVED for execution** (user 承認 2026-05-24)
> Predecessor: phase-15-alpha-3-reconciliation.md (sealed, commit 11333a9)

## 0. v1 → v2 改訂サマリ

Codex adversarial review (4 点採用) により以下を反映:
1. **A0 大幅拡張**: seed drift (statuses/status_transitions/notification_rules) + helper drift (vendor_accessible_company_ids + accept_invitation_and_revoke_others) を全件 reconcile
2. **invitations 薄実装追加**: roadmap α-3 Day 1 要件 (`transport_orders + invitations 生成 service 関数`) を遵守
3. **vendor response は SECURITY DEFINER RPC 化**: RLS 制約 (vendor authenticated は status_history INSERT 不可) を解決
4. **changed_by_user_id は NULL + audit_logs で actor 記録**: FK (users(id)) 維持

## 1. R-H-000 incident: seed/helper drift 全件 (A0 reconcile 対象)

### Drift 1: `21_seed_master.sql` statuses INSERT
- 現状: `(company_id, domain, code, name, sort_order, is_terminal)` with `company_id=NULL`
- 現行 DDL (`03_roles_statuses.sql:28-41`): `company_id NOT NULL`, `status_type` (not domain), `key` (not code), `display_order` (not sort_order)
- 影響: migration full apply 失敗
- **要決定**: status は per-tenant か system-global か? spec §X.Y 照合必須

### Drift 2: `21_seed_master.sql` status_transitions INSERT
- 同じ `company_id=NULL, domain` 旧 schema 利用
- 同じく要対応

### Drift 3: `21_seed_master.sql` notification_rules INSERT
- 旧: `(event_key, channel, target_type, template_key)`
- 現行 DDL: `(event_type, channel, target_type)` — `template_key` 列削除済み
- ON CONFLICT 句も書き換え必要

### Drift 4: `18_helper_functions.sql:51-68` vendor_accessible_company_ids
- 旧: `vendor_company_memberships.starts_on/ends_on` 参照
- 現行 DDL: `is_enabled/contract_started_at/contract_ended_at` (Phase 15 で reconcile)
- 影響: vendor portal RLS が実行時に column not found

### Drift 5: `18_helper_functions.sql:165-217` accept_invitation_and_revoke_others
- helper が `transport_order_invitations.deleted_at/bound_at/updated_at` を参照
- 現行 DDL (`12_transport.sql:84-101`): これらの列は **存在しない**
- 影響: invitations 機能が実行時に column not found
- **要決定**: helper を現行 DDL に合わせるか、DDL に列追加 (spec §7.10.2 と照合)

### Drift 6: roles / lane_types seed — 軽微確認
- `lane_types(company_id=NULL, code, name, sort_order)` — DDL 列名 audit 必要
- `roles(company_id=NULL, code, name, is_system)` — DDL 列名 audit 必要

## 2. Sub-Phase 分割 v2

### 16-A0: R-H-000 drift 全件 reconcile (前提修正)

| 項目 | 内容 |
|---|---|
| DoD | full migration apply 成功 + `pnpm test` 36/36 + helper smoke test + spec 1 行照合完了 |
| ファイル | `21_seed_master.sql` 全面書換 / `18_helper_functions.sql` 2 helper / `12_transport.sql` (invitations 列追加判断後) |
| 委任 | **Codex 強制委任** (SQL drift reconcile 100+ 行) |
| 注意 | Phase 14/15 と同じ pattern: spec § 1 行ずつ照合 prompt 必須 |
| risks.md | R-H-000 に「Phase 16-A0 で seed/helper drift 6 件発見」追記 |

**Sub-step**:
- A0.1: spec §X.Y 照合で statuses の company_id NULLability 確定
- A0.2: spec §7.10.2 照合で transport_order_invitations 列セット確定
- A0.3: 21_seed_master.sql 全面書換 (Drift 1-3 + Drift 6 audit)
- A0.4: 18_helper_functions.sql 2 helper 書換 (Drift 4-5)
- A0.5: 必要なら 12_transport.sql に invitations 列追加
- A0.6: 検証 `pnpm test` + migration full apply

### 16-B: createTransportOrderWithNotification + invitations 1 件生成

| 項目 | 内容 |
|---|---|
| DoD | transport_order + status_history + invitation + outbox を 1 TX で原子的作成、unit test PASS |
| ファイル (新規) | `src/lib/services/transport-orders.ts` (~120 行) + `tests/unit/services/transport-orders.test.ts` (~60 行) |
| 依存 | 16-A0 |
| 委任 | Codex 強制委任 |
| idempotency_key | spec §X.Y に従う (要照合) — plan v1 の `transport_order:{id}:created:v1` は spec と不一致の可能性 |
| roadmap 整合 | line 159 `transport_orders + invitations 生成 service 関数` を満たす |

### 16-C: respondToTransportOrder (SECURITY DEFINER RPC)

| 項目 | 内容 |
|---|---|
| DoD | DB 関数 `respond_to_transport_order(p_invitation_id, p_response, ...)` + service 関数ラッパー + unit test PASS |
| ファイル | `18_helper_functions.sql` (RPC 追加) または `24_vendor_rpcs.sql` 新規 + `src/lib/services/transport-orders.ts` (ラッパー) + tests |
| 依存 | 16-B + A0.5 (invitations 列確定) |
| 委任 | Codex 強制委任 |
| 設計 | SECURITY DEFINER で RLS を bypass し、内部で `current_vendor_user_id()` 検証 + 1 TX で `accept_invitation_and_revoke_others` 呼び出し + status 遷移 + status_history append (changed_by_user_id=NULL) + audit_logs INSERT (actor 記録) |

### 16-D: vendor portal UI

| 項目 | 内容 |
|---|---|
| DoD | vendor user ログイン → `/vendor/requests` 一覧 + 詳細 → accept/reject submit が DB に反映 |
| ファイル (新規) | `src/app/(vendor-portal)/{layout,vendor-login/page,requests/page,requests/[id]/page,requests/[id]/actions}.{tsx,ts}` |
| 依存 | 16-C |
| 委任 | Codex 委任 (`codex exec --profile-v2 frontend`) |
| 認証 | `vendor_users.auth_user_id = auth.uid()` で解決 (plan v1 の同一視は誤り) |
| RLS | `current_vendor_id()` / `current_vendor_user_id()` helper 利用 (`current_user_company_id()` は社内 user 用、vendor では使わない) |
| URL | `/vendor/requests` に固定 (roadmap 117 行) |

### 16-E: integration test + staging smoke

| 項目 | 内容 |
|---|---|
| DoD | E2E happy path (create → outbox → dispatcher → inbox → portal SELECT → accept → status 遷移) + RLS 漏洩テスト |
| ファイル (新規) | `tests/integration/vendor-loop-e2e.test.ts` (~100 行) |
| 依存 | 16-B + 16-C + 16-D |
| 委任 | Codex 強制委任 |
| staging smoke | Resend テスト疎通含む (Sub-Phase として確認) |

## 3. クリティカルパス

```
16-A0 (drift 6 件 reconcile) ─→ 16-B (create + invitation) ─→ 16-C (RPC + service) ─→ 16-D (UI)
                                                                                      └─→ 16-E
```

16-A0 は最低 1 セッション (Phase 14/15 規模)。
16-B + 16-C で 1 セッション。
16-D + 16-E で 1 セッション。**合計 3 セッション見通し**。

## 4. リスク

- **R1**: A0 で statuses の company_id NULLability 判定を spec と不一致のまま進めると Phase 16-B 以降の fixture が全壊
- **R2**: invitations 列追加なら Drizzle schema 再生成 + 既存 fixture 影響確認必須
- **R3**: vendor RPC は SECURITY DEFINER のため GRANT EXECUTE TO authenticated 必須、誤ると業者が呼べない
- **R4**: 36/36 維持: fixtures が seed bypass で独自 INSERT してるか要確認 (現状 36/36 PASS なので結果論的に bypass されている)
- **R5**: R-H-000 watchpoint: A0 drift 6 件以外に発見されてない drift が残ってないか、他 helper/seed/RLS の audit が望ましい (Codex 委任で audit pass)

## 5. Phase 16 sealed 条件

- [ ] A0: seed + helper drift 6 件全 reconcile、full migration apply 成功、36/36 維持
- [ ] B: createTransportOrderWithNotification + invitation 1 件作成が 1 TX で原子的
- [ ] C: respond_to_transport_order RPC が authenticated vendor から呼べる、status 遷移が trg_enforce_status_transition で守られる
- [ ] D: vendor portal で accept/reject 操作が DB に反映、RLS 漏洩なし
- [ ] E: integration test + RLS 漏洩テスト全 PASS、Resend staging 疎通確認
- [ ] roadmap α-3 Day 1/2 要件と整合 (transport_orders + invitations service 関数 / status_transitions trigger / staging smoke / E2E)
- [ ] Drift B (transport_order_change_logs) は β 繰越、risks.md 追記

## 6. 次セッション着手手順 (16-A0)

1. spec/data-model.md v2.4 §X.Y で statuses の company_id NULL/NOT NULL 確定
2. spec/data-model.md v2.4 §7.10.2 で transport_order_invitations 列セット確定
3. lane_types / roles 現行 DDL を audit (drift 追加検出)
4. Codex 委任で seed + helper 全面 reconcile (1 セッション完結目標)
5. `pnpm test` 36/36 維持確認
6. risks.md R-H-000 追記
7. Phase 16-A0 完了 → 16-B へ
