# 段取りくん 依存関係グラフ v1 (2026-05-23)

## 0. メタ
- 目的: クリティカルパス可視化と Sprint × Lane 並列化判断の根拠
- 凡例: 🔴 直列必須 (クリティカルパス) / 🟢 並列可能 / 🟡 Lane 内で直列
- 関連: roadmap.md §1 タスク表、risks.md §1 R-H-001 (PoC 未消化リスク)、dod-checklist.md §2 alpha-core 固有 DoD

## 1. クリティカルパス (alpha-core)

下記タスクのいずれか 1 つでも遅延 → alpha-core 5/31 達成不可:

🔴 Sprint α-0 PoC (RLS / 並列予約 / outbox / 楽観排他)
  ↓
🔴 Sprint α-1 migration 46 テーブル (Lane Main 専管) (※ alpha-core 必須サブセット (実装 priority P0/P1) は Tier 2 で別途確定予定)
  ↓
🔴 Sprint α-1 outbox dispatcher (Inngest function)
  ↓
🔴 Sprint α-2 業者通知 (Resend + outbox)
  ↓
🔴 Sprint α-2 vendor portal (vendor_users 認証 + capture)
  ↓
🔴 Sprint α-3 E2E (Playwright)
  ↓
🔴 Sprint α-3 Vercel 本番デプロイ + smoke

並列化不可。各タスクは前段完了後に着手。

## 2. Mermaid グラフ: Sprint × Lane × Phase

```mermaid
graph LR
  classDef critical fill:#ffcccc,stroke:#d00,stroke-width:2px
  classDef parallel fill:#ccffcc,stroke:#0a0,stroke-width:1px
  classDef lane_internal fill:#ffffcc,stroke:#cc0,stroke-width:1px

  subgraph S0["Sprint α-0 (5/23-25 PoC)"]
    S0_RLS["Main: PoC RLS 漏洩"]:::critical
    S0_excl["Main: PoC 並列予約 exclusion"]:::critical
    S0_outbox["Main: PoC outbox retry"]:::critical
    S0_optlock["Main: PoC 楽観排他 version"]:::critical
    S0_vendor_auth["A: PoC vendor_users 認証"]:::parallel
    S0_ui_base["B: PoC shadcn + layout"]:::parallel
    S0_capture["A: PoC capture 同意フロー"]:::parallel
    S0_audit["Main: PoC audit_logs redact"]:::critical
    S0_status_trig["Main: PoC status_transitions trigger"]:::critical
    S0_token["Main: PoC customer token hash"]:::critical
    S0_runtime["Main: PoC Vercel + Supabase + Inngest 動作"]:::critical
  end

  subgraph S1["Sprint α-1 (5/26-27 基盤)"]
    S1_mig["Main: migration 46 テーブル"]:::critical
    S1_rls_helper["Main: RLS helper functions"]:::critical
    S1_outbox_disp["Main: outbox dispatcher Inngest"]:::critical
    S1_sla["Main: vendor_sla_overrides + pii_anonymization_jobs"]:::critical
    S1_portal_skel["A: vendor portal route + middleware"]:::parallel
    S1_admin_skel["B: 社内画面 layout + sidebar + redirect"]:::parallel
  end

  subgraph S2["Sprint α-2 (5/28-29 業者ループ)"]
    S2_notify["A: transport_orders + invitations + 通知送信"]:::critical
    S2_portal_resp["A: 業者対応可否 + 予定入力 UI"]:::critical
    S2_capture["A: capture 同意取得フロー"]:::lane_internal
    S2_status["Main: status_transitions trigger + audit append-only"]:::critical
    S2_fallback["Main: 業者対応不可 4 パス fallback"]:::critical
    S2_admin_ui["B: 通知履歴 + 業者状況 + 進捗ステッパー"]:::parallel
    S2_staging_deploy["Main: staging deploy (Vercel preview + Inngest + Resend + smoke)"]:::parallel
  end

  subgraph S3["Sprint α-3 (5/30-31 検収)"]
    S3_e2e["Main: E2E Playwright 全パス"]:::critical
    S3_cutover["Main: Day 1 production cutover (Vercel domain / Supabase migration / Inngest / Resend)"]:::critical
    S3_hardening["Main: Day 2 hardening (smoke / verification-checklist / release notes / v0.1.0-alpha tag)"]:::critical
    S3_vendor_doc["A: 業者向け onboarding docs"]:::parallel
    S3_admin_doc["B: 社内 onboarding / FAQ"]:::parallel
  end

  %% 依存
  S0_RLS --> S1_mig
  S0_excl --> S1_mig
  S0_outbox --> S1_outbox_disp
  S0_optlock --> S1_mig
  S0_audit --> S1_mig
  S0_status_trig --> S1_mig
  S0_token --> S1_mig
  S0_runtime --> S1_mig
  S0_vendor_auth --> S1_portal_skel
  S0_ui_base --> S1_admin_skel
  S0_capture --> S2_capture

  S1_mig --> S1_rls_helper
  S1_mig --> S1_sla
  S1_rls_helper --> S2_notify
  S1_outbox_disp --> S2_notify
  S1_sla --> S2_notify
  S1_portal_skel --> S2_portal_resp
  S1_admin_skel --> S2_admin_ui

  S2_notify --> S2_portal_resp
  S2_portal_resp --> S2_capture
  S2_capture --> S2_status
  S2_status --> S2_fallback
  S2_notify --> S2_admin_ui

  S2_fallback --> S3_e2e
  S2_admin_ui --> S3_e2e
  S2_staging_deploy --> S3_cutover
  S3_e2e --> S3_cutover
  S3_cutover --> S3_hardening
  S2_portal_resp --> S3_vendor_doc
  S2_admin_ui --> S3_admin_doc
```

## 3. 並列可能タスク (Lane A/B どちらでも)

各 Sprint で 🟢 マーク tasks は Lane A/B どちらでも実装可。担当決めは Sprint 開始時に Lane Main が指定:

- Sprint α-0: vendor_users 認証 PoC / shadcn UI PoC / capture 同意 PoC
- Sprint α-1: portal route 骨格 / 社内 UI layout
- Sprint α-2: 社内通知履歴 UI
- Sprint α-3: 業者 onboarding docs / 社内 onboarding docs

## 4. Lane 内直列タスク (🟡)

Sprint α-2 の capture フロー は Lane A 内で `portal_resp → capture` 直列。Lane B には影響しない。

## 5. mvp-release 依存関係 (概略)

Sprint β-1〜β-4 はそれぞれ独立しており、Sprint 内クリティカルパスは:

- β-1 Phase 3 カレンダー: reservation_settings → FullCalendar 設定 → 予約枠 UI → drag move + exclusion 検証
- β-2 Phase 3 整備伝票: service_tickets CRUD → 車両管理 → partial GIN 検索
- β-3 Phase 4 顧客予約: 顧客フロー → email 認証 → 署名 token → Turnstile + rate limit
- β-4 Phase 4 通知拡張 + 整理: LINE/SMS → PII 匿名化 cron → v_accounting_audit_trail → v1.0.0 release

各 Sprint は前 Sprint 完了後に着手 (Phase 3 → 3 → 4 → 4 の順)。Sprint 内では Lane 並列可。

## 6. クリティカルパス上の代替案 (リスク発火時)

各クリティカルタスクが Sprint 内で失敗した場合の代替案 (risks.md §1 と連動):

| Critical タスク | 失敗時の代替案 |
|---|---|
| S0_RLS PoC | RLS policy 単純化、Sprint α-1 で再検証 (DDL 維持) |
| S0_outbox PoC | retry 機構を pg-cron に切替、Inngest は Phase β で再評価 |
| S1_mig | 段階適用に変更 (テーブルグループ単位)、CRITICAL なグループのみ Sprint α-1 完了 |
| S2_notify | Resend → SES 緊急切替 (Phase 4 計画を先取り) |
| S3_deploy | Vercel preview を本番扱いで一時運用 |

## 7. 関連ドキュメント
- spec/roadmap/roadmap.md - Sprint × Lane タスク詳細
- spec/roadmap/risks.md - R-H-001 〜 R-L-006 (本グラフのクリティカルパス連動)
- spec/roadmap/dod-checklist.md - Sprint 検収ゲート
- spec/data-model.md §17 - migration 順序 (S1_mig 依存)
- spec/implementation-plan.md §3 Phase 0 - PoC 16 項目

---

*v1: 2026-05-23 Claude + Codex 協調作成*
