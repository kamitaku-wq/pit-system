# spec 構造整合性監査 v1 (2026-05-23)

## メタ

- 監査対象: 13 ファイル / 7,002 行
- 実施: Codex (Lane 1) + Claude Code
- 判定基準: 致命 (Critical) / 重要 (High) / 補強 (Medium) / 情報 (Low)
- 監査日: 2026-05-23

---

## A. テーブル名照合

### A.1 data-model.md 定義テーブル一覧 (46 件)

data-model.md 見出しパターン から機械抽出:

1. companies
2. users
3. user_store_memberships
4. roles
5. permissions
6. vendor_users
7. customer_reservation_tokens
8. stores
9. store_business_hours
10. store_holidays
11. lane_types
12. lanes
13. lane_working_hours
14. lane_work_menus
15. work_categories
16. work_menus
17. service_tickets
18. reservations
19. reservation_status_history
20. vehicles
21. vehicle_ownerships
22. customers
23. vendors
24. vendor_company_memberships
25. vendor_service_areas
26. vendor_available_stores
27. vendor_available_days
28. vendor_sla_overrides
29. transport_orders
30. transport_order_status_history
31. transport_order_change_logs
32. transport_order_vendor_attempts
33. transport_order_invitations
34. notification_outbox
35. notification_deliveries
36. notification_rules
37. vendor_portal_inbox
38. statuses
39. status_transitions
40. reservation_settings
41. audit_logs
42. pii_anonymization_jobs
43. attachments
44. lane_utilization_daily
45. vendor_response_kpi_daily
46. notification_delivery_kpi_daily

Total: 46 テーブル (3 件は v2.2 追加: vendor_sla_overrides, pii_anonymization_jobs, notification_delivery_kpi_daily)

---

### A.2 他 spec で参照されているが data-model.md に存在しないテーブル

| ファイル | 行 | 参照テーブル | 推定原因 | 影響度 |
|---|---|---|---|---|
| requirements.md | 1007 | store_settings | codex-review-decisions で不在と明記済みだが参照残存 | Critical |
| decisions-draft-2026-05-23.md | 19 | store_settings | 撤回済みとして言及されるが残存 | Critical |
| roadmap/roadmap.md | 166 | service_slots | 旧設計アイデアの残存、data-model.md に未定義 | Critical |
| roadmap/roadmap.md | 194 | billing_records | ビュー/テーブルとして言及されるが未定義 | High |
| decisions-draft-2026-05-23.md | 16 | vendor_selection_logs | 実装計画で言及されるが §3-§13 に定義なし | High |
| implementation-plan.md | 632 | vendor_selection_logs | 同上 | High |
| data-model.md 本文 | 1247 | audit_logs_cleanup_log | 本文テキストで言及されるが独立した定義なし | Medium |
| decisions-draft-2026-05-23.md | 19 | user_table_view_settings | Phase 5 予定として言及、未定義 (将来テーブル) | Low |

補足: store_settings.display_columns_json は codex-review-decisions-2026-05-23.md で
「store_settings テーブル不在、reservation_settings のみ存在、新規テーブル設計が必要になるリスク」
と明記済みにもかかわらず requirements.md L1007 に残存。修正未完了。

---

### A.3 data-model.md にあるが他で全く言及されないテーブル (孤立候補)

| テーブル | 想定理由 |
|---|---|
| notification_delivery_kpi_daily | v2.2 追加の新規テーブル。roadmap/implementation-plan の Sprint タスクに未反映 |
| pii_anonymization_jobs | v2.2 追加。implementation-plan §3 Phase 1 タスクには記載あるが roadmap Sprint タスクには未反映 |
| lane_utilization_daily | マテビュー。requirements.md の集計要件と対応するが screen-list.md に対応画面なし |
| vendor_response_kpi_daily | 同上 |

---

## B. 関数名・helper 照合

### B.1 data-model.md 定義関数

data-model.md §14.2 より:
- current_user_company_id() — DDL 定義あり (CREATE OR REPLACE FUNCTION current_user_company_id())
- current_vendor_id() — 定義あり
- RLS ポリシー内で current_user_company_id() を使用

### B.2 不整合・誤記一覧

| ファイル | 行 | 参照名 | data-model.md 正式名 | 影響度 |
|---|---|---|---|---|
| roadmap/dod-checklist.md | 58 | current_company_id() | current_user_company_id() | Critical |
| roadmap/roadmap.md | 107 | current_company_id | current_user_company_id() | Critical |
| roadmap/risks.md | 60 | current_company_id | current_user_company_id() | High |
| data-model.md 本文 | 583, 714, 1237 | current_company_id() | current_user_company_id() (§14.2 定義) | Medium |
| roadmap/dod-checklist.md | 58 | is_vendor_user() | data-model.md §14 に未定義 | High |
| roadmap/roadmap.md | 107 | is_vendor_user | data-model.md §14 に未定義 | High |
| requirements.md | 228 | current_user_company_id() | 一致 OK | — |

まとめ: current_company_id() と current_user_company_id() の混在が 5 箇所以上。
§14.2 DDL は current_user_company_id() が正式名。is_vendor_user() は dod-checklist と
roadmap で参照されるが data-model.md §14 に定義なし。

---

## C. Phase 番号・ADR 番号一致

### C.1 Phase 番号定義 (implementation-plan.md)

| Phase | 内容 |
|---|---|
| Phase 0 | 技術 PoC (項目 0.1 から 0.16 = 16 件) |
| Phase 1 | マスター設定・業者基盤 |
| Phase 2 | 車両受注 + 車両移動 + 業者通知 (MVP コア) |
| Phase 3 | カレンダー + ラウンジ + 車両管理 |
| Phase 4 | 顧客予約 + 本人確認 + リマインド |
| Phase 5 | 拡張機能 (LINE/SMS、月次 CSV 他) |

### C.2 Phase 番号不一致

| 不一致 | ファイル | 記述 | 正式定義 | 影響度 |
|---|---|---|---|---|
| LINE/SMS Phase | requirements.md L655 | 「LINE 通知 (Phase 4)」 | Phase 5 (v2.2 変更) | High |
| カレンダー Phase | requirements.md §28.1 | 「Phase 4 へ繰り延べ」残存 | Phase 3 末確定 (decisions 変更) | High |
| Phase 0 PoC 件数 | implementation-plan.md L577 | 「PoC 11 項目」 | 実際は 16 項目 (0.1 から 0.16) | Critical |
| Phase 0 PoC 件数 | roadmap/roadmap.md L69 | 「Phase 0 PoC 11 項目」 | 実際は 16 項目 | Critical |
| Phase 0 PoC 件数 | decisions-draft-2026-05-23.md L62 | 「11 項目」 | 実際は 16 項目 | High |

Phase 0 PoC 件数詳細: implementation-plan.md タイムライン表と roadmap は「11 項目」と記載。
しかし §3 Phase 0 の実際の表は 0.1 から 0.16 の 16 項目。
v2.1 追加の 0.12 から 0.16 (5 件) が件数更新されていない。

### C.3 ADR 番号照合

| ADR | タイトル | 主要参照ファイル | 不整合 |
|---|---|---|---|
| ADR-0001 | テナントモデル (会社単位、RLS) | CLAUDE.md, implementation-plan.md, codex-review-decisions | 一致 |
| ADR-0002 | 通知配送 (DB outbox + Inngest) | CLAUDE.md, implementation-plan.md | 一致 |
| ADR-0003 | 状態遷移管理 (status_transitions + trigger) | CLAUDE.md, implementation-plan.md, data-model.md §3 | 一致 |
| ADR-0004 | 業者ポータル認証 (vendor_users + helper) | CLAUDE.md, implementation-plan.md | 一致 |
| ADR-0005 | 顧客本人確認 (token table) | CLAUDE.md, implementation-plan.md | 一致 |
| ADR-0006 | 予約重複防止 (exclusion constraint) | CLAUDE.md, implementation-plan.md | 一致 |
| ADR-0007 | 楽観排他 (version + IF MATCH) | CLAUDE.md, implementation-plan.md | 一致 |
| ADR-0008 | 再配車単位照合と先着枠 | CLAUDE.md, implementation-plan.md | 一致 |
| ADR-0009 | PII redaction + 監査ログ append-only | CLAUDE.md, implementation-plan.md, data-model.md §11.2 | 一致 |
| ADR-0010 | 未定義 | 全 spec ファイルで定義・参照なし | Low |

ADR 番号の内容不一致は検出されず。ADR-0010 は未使用 (番号予約のみ)。

---

## D. ロードマップ × spec 整合

### D.1 Sprint × Phase 対応

| Sprint | 期間 | ロードマップ記述 | implementation-plan Phase | 整合 |
|---|---|---|---|---|
| α-0 | 5/23-25 | Phase 0 PoC 11 項目 | Phase 0 PoC (実際 16 項目) | 不一致 Critical |
| α-1 | 5/26-27 | マスター確認 | Phase 1 前半 | OK |
| α-2 | 5/28-29 | 業者ループ完成 | Phase 2 | OK |
| α-3 | 5/30-31 | 整理 + リリース | Phase 2 完成 + タグ | OK |
| β-1 | 6/2-8 | Phase 3 カレンダー UI | Phase 3 | OK |
| β-2 | 6/9-15 | Phase 3 ラウンジ + 車両管理 | Phase 3 | OK |
| β-3 | 6/16-22 | Phase 4 顧客予約 | Phase 4 | OK |
| β-4 | 6/23-29 | Phase 4 通知拡張 + リリース | Phase 4 | OK |

Sprint α-1 の migration タスク記述「35 テーブル」は data-model.md v2.2 の実数 46 テーブルと乖離。

### D.2 dependency-graph.md テーブル名 vs data-model.md

dependency-graph.md は Mermaid ノード名として機能ラベルを使用 (具体テーブル名は少数)。

| 記述 | dependency-graph.md | data-model.md | 不整合 |
|---|---|---|---|
| migration 件数 | 「35 テーブル」(Sprint α-1 ノード) | 46 テーブル定義 (v2.2) | High |
| vendor_sla_overrides | 記載なし | §7.5b 定義 (v2.2 追加) | Medium |
| pii_anonymization_jobs | 記載なし | §11.2b 定義 (v2.2 追加) | Medium |

### D.3 dod-checklist.md vs verification-checklist.md

| dod-checklist.md 項目 | verification-checklist.md 対応 | 整合 |
|---|---|---|
| RLS company_id 境界テスト (§2.2) | RLS テスト項目あり | OK |
| migration 35 テーブル完了 (§2.1 L56) | migration 受入あり | 不一致 — 実際は 46 テーブル |
| current_company_id() helper 動作確認 (§2.1 L58) | verification-checklist 対応あり | 名称不一致 — 正式は current_user_company_id() |
| is_vendor_user() helper 動作確認 (§2.1 L58) | verification-checklist 対応あり | 未定義 — data-model.md §14 に定義なし |
| Playwright E2E 全パス (§1.2) | E2E 受入項目あり | OK |
| Vercel + Supabase 本番 migration (§3.2) | verification-checklist 対応あり | OK |

### D.4 PoC 11 項目 vs implementation-plan.md §3 Phase 0 一致確認

dependency-graph.md Sprint α-0 ノード (11 件) と implementation-plan.md §3 (16 件) の対応:

| PoC ノード (dependency-graph) | implementation-plan 対応項目 | 整合 |
|---|---|---|
| S0_RLS | 0.3 RLS コンカレントテスト | OK |
| S0_excl | 0.4 / 0.5 予約重複 exclusion | OK |
| S0_outbox | 0.6 / 0.7 outbox + Inngest retry | OK |
| S0_optlock | 0.14 楽観排他 (v2.1) | OK |
| S0_vendor_auth | 0.8 vendor_users 認証 PoC | OK |
| S0_ui_base | 0.1 shadcn + layout | OK |
| S0_capture | 0.8 内包 (明示番号なし) | Medium |
| S0_audit | 0.10 audit_logs redact | OK |
| S0_status_trig | §15.5 status_transitions trigger | OK |
| S0_token | customer token hash (独立番号なし) | Medium |
| S0_runtime | 0.9 Vercel runtime PoC | OK |
| — | 0.11 TZ テスト | dependency-graph 未記載 |
| — | 0.12 マイグレーション全通し (v2.1) | dependency-graph 未記載 |
| — | 0.13 outbox SKIP LOCKED (v2.1) | dependency-graph 未記載 |
| — | 0.15 再配車先着枠 PoC (v2.1) | dependency-graph 未記載 |
| — | 0.16 PII redaction (v2.1) | dependency-graph 未記載 |

v2.1 追加の 5 項目 (0.12 から 0.16) が dependency-graph Sprint α-0 に未反映。

---

## E. 総評

- 致命的不整合 (Critical): 5 件
  - store_settings 参照残存 (requirements.md L1007)
  - service_slots 未定義テーブル参照 (roadmap/roadmap.md L166)
  - current_company_id() 名称不一致 (dod-checklist.md L58, roadmap.md L107)
  - Phase 0 PoC 項目数 11 vs 実際 16 (implementation-plan.md L577, roadmap.md L69)
  - migration テーブル数 35 vs 実際 46 (roadmap, dod-checklist)

- 重要不整合 (High): 8 件
  - billing_records 未定義参照 (roadmap.md L194)
  - vendor_selection_logs 未定義参照 (decisions-draft L16, implementation-plan L632)
  - is_vendor_user() 未定義参照 (dod-checklist L58, roadmap.md L107)
  - LINE/SMS Phase 4 → Phase 5 未修正 (requirements.md L655)
  - カレンダー Phase 4 残存 (requirements.md §28.1)
  - dependency-graph migration 件数 35 vs 46
  - current_company_id() 名称不一致 (risks.md L60)
  - Phase 0 PoC 件数 (decisions-draft L62)

- 補強推奨 (Medium): 7 件
  - audit_logs_cleanup_log 定義不明確
  - data-model.md 本文の current_company_id() 混在 (L583, L714, L1237)
  - vendor_sla_overrides が dependency-graph 未反映
  - pii_anonymization_jobs が dependency-graph 未反映
  - 孤立テーブル候補 4 件のロードマップ反映
  - PoC dependency-graph の capture / token ノード番号未割当
  - PoC 5 項目 (0.11 から 0.16) が dependency-graph Sprint α-0 に未記載

- 情報 (Low): 2 件
  - ADR-0010 未定義・未使用
  - user_table_view_settings (Phase 5 将来テーブル) は未定義だが意図的

- 全体評価 (1-5): 3 — ADR は全件整合。主要テーブル定義と Phase 構造は概ね正確だが、
  v2.1/v2.2 の追加変更に伴う関数名・PoC 件数・旧テーブル参照の未更新箇所が複数残存。

### 修正推奨優先順位 Top 5

| 優先 | 件名 | 修正対象ファイル | 修正内容 |
|---|---|---|---|
| 1 | store_settings 旧参照削除 | requirements.md L1007 | MVP は固定表示、Phase 5 で user_table_view_settings 追加、に書き換え |
| 2 | current_company_id → current_user_company_id 統一 | roadmap/dod-checklist.md L58, roadmap.md L107, risks.md L60, data-model.md 本文 | 正式名 current_user_company_id() に統一。is_vendor_user() は §14.2 に定義追加または削除 |
| 3 | Phase 0 PoC 件数を 11 → 16 に修正 | implementation-plan.md L577, roadmap.md L69, dependency-graph.md | v2.1 追加 5 項目を Sprint α-0 ノードに追記し件数を 16 に統一 |
| 4 | migration テーブル数を 35 → 46 に修正 | roadmap.md, dod-checklist.md, dependency-graph.md | v2.2 追加テーブル (vendor_sla_overrides, pii_anonymization_jobs, notification_delivery_kpi_daily) を反映 |
| 5 | LINE/SMS とカレンダーの Phase 番号修正 | requirements.md L655, §28.1 | LINE/SMS を Phase 5 に、カレンダーを Phase 3 末確定に修正 |

---

監査ツール: PowerShell Get-Content + Select-String, rg (ripgrep)
次回更新: Sprint α-1 完了後 (2026-05-28 予定)
