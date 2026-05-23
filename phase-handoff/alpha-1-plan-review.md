# Sprint α-1 Plan Adversarial Review (Codex, --sandbox read-only)

**実行**: `codex exec --sandbox read-only --skip-git-repo-check --profile fast` (job buvptbnma)
**取得範囲**: 末尾 50 行のみ (tail -50 経由、Verdict + A.1 は標準出力で欠落)
**取得元**: Codex は read-only sandbox で local fs read 可、file write 不可のため標準出力経由で中継

---

## B. Missing items (Codex 取得済 #2-#7)

2. `record_audit_log` がどう recursion / trigger cascades / `audit_logs` 自己監査を回避するか不明 (spec [data-model.md:1216-1222])
3. `redact_audit_payload()` が redaction matrix 未対応 entity を受けた時の挙動が未指定
4. `audit_logs_cleanup_log` 相当の cleanup audit trail が計画に欠落 (spec [data-model.md:1310-1315] が cron/service_role による cleanup を要求)
5. company_id を持つ全テーブルへの RLS 標準ポリシー要件 (audit / notification / history 系含む) を計画が明示していない (spec [data-model.md:1429-1431])
6. `vendor_portal_inbox` が `vendor_id = current_vendor_id()` + `recipient_vendor_user_id` セマンティクスで RLS 二重防衛されるべきと明記なし (spec [data-model.md:1087-1105, 1477-1507])
7. `pii_anonymization_jobs` が ADR-0009 [data-model.md:1248-1251] の GIN/partial-index hygiene と統合される必要

## C. Re-evaluate rejected alternatives

1. **audit path を entity-specific に分割** vs 1 generic `record_audit_log` (current). spec coverage set が広く [data-model.md:1593-1595]、generic TG_TABLE_NAME dispatch は payload バグの blast radius を増大
2. **pii_anonymization_jobs を state machine として** vs pure queue (current). spec は `status` / `processed_at` / `retry_count` / `legal_hold_reason` を使う [data-model.md:1260-1287] — 既に state machine
3. **PoC 残置 schema を本実装前に完全 freeze** vs narrow risk 表 (current). phase-6 が PoC residue を既に文書化 [phase-6-poc-final.md:55-64]、silent drift が migration バグの温床

## D. Risk priority correction

1. **`record_audit_log` を High → Critical**: 1 defect で audited 全テーブルの書込を破壊/ブロック可能 [data-model.md:1593-1595]
2. **`pii_anonymization_jobs` schema completeness を Medium → High**: live-state 列 / exclusion semantics 欠落で duplicate execution / legal-hold 失敗 [data-model.md:1253-1287]
3. **outbox `idempotency_key` issue を維持 High かつ範囲拡大**: 名指し 2 列だけでなく outbox/inbox 全列の drift [phase-6-poc-final.md:57-62]
4. **RLS helper/policy ordering を DoD checkbox → High**: spec [data-model.md:1429-1431] が company_id 持つ全テーブルで RLS 必須化、roadmap α-1 が helper → policy 順序依存 [roadmap.md:111-118]

## E. Codex delegation boundary validity

1. ✅ Valid: 既知テーブルへの mechanical DDL expansion (spec §3-§13 / §17 への locked diff 前提)
2. ❌ Invalid as framed: audited 全テーブルに影響する trigger logic 委任 — recursion / redaction completeness / table coverage の Claude-owned contract が前提
3. ✅ Valid: helper function scaffolding + 標準 RLS policy boilerplate
4. ❌ Invalid as framed: `pii_anonymization_jobs` の human-reviewed state model なしの委任 — spec で terminal/hold/retry semantics 既定義
5. ✅ Valid: inbox/outbox worker boilerplate (schema freeze 後)
6. ❌ Invalid as framed: `notification_outbox` / `vendor_portal_inbox` が spec-complete と仮定する委任 — 計画は 2 列差異しか名指ししていない

## Recommended actions (Codex 抽出)

1. A-1 着手前に `notification_outbox` / `vendor_portal_inbox` / `pii_anonymization_jobs` の **schema reconciliation checklist** を明示作成
2. `record_audit_log` を per-table contract に分割するか、table-by-table test matrix を merge 前に必須化
3. `pii_anonymization_jobs` セクションを「service_role only」だけでなく **全必須列 + live-state exclusion rule** を列挙
4. Risk 表を更新: audit-trigger recursion/data-loss を Critical、PoC drift を first-class migration risk として追跡
5. **spec-to-migration diff review** を Codex 出力から独立して 1 パス必須 (特に trigger / RLS 影響テーブル)

---

## 欠落セクション (再取得時の TODO)

- ## Verdict (3 lines)
- ## A. Critical breakages (#1 のみ欠落、#2-#7 は B として取得済)

理由: Bash `2>&1 | tail -50` でパイプ末尾のみ保存。codex exec の出力 size を考慮し次回は `--output-file` or stdout redirect で全文保存する。

---

*Codex adversarial-review by codex-1 (gpt-5.5), 2026-05-23*
