# Phase 63 入力契約: Phase 62 α-3 release pre-flight 並列調査 sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 62 (前: 61 sealed) |
| 状態 | **sealed** (実装変更 0 / 調査 Phase / 6 lane 並列) |
| 完了日時 | 2026-05-27 |
| 担当 | Claude (scope 確定 + plan + dispatch + 統合 + seal) + Codex (6 lane 並列 read-only 調査、L3 のみ Claude 引き取り) |
| 前 handoff | `phase-61-store-confirmed-by-user-fk-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 61 から +1 commit 予定: 本 plan + seal) |

## 達成したこと (Phase 62)

- **release path 健全度の事実列挙完了** (α-3 5/31 release 判断・5/29 Sprint レビューインプット)
- 6 lane Codex 並列 dispatch (L1-L6)、L3 のみ Codex 出力空 → Claude 引き取り
- 全 lane 実装変更 0 (read-only) でユーザー時間温存 + Claude token 節約
- Phase 61 sealed §推奨スコープ候補の wake-up 領域 (D/E) vs 未消化 TODO (C) vs preventive (A/B) の **事実ベース判断材料**確保

## 6 lane 調査結果サマリ (詳細は各 lane 個別)

### L1 business path E2E status

- **E2E ファイル 3 件 / 計 7 tests**: `vendor-portal-loop.spec.ts` (2) / `admin-vendor-invite.spec.ts` (3) / `vendor-portal-spot-loop.spec.ts` (2)
- **直近 CI**: Phase 61 sealed handoff = `CI E2E 7/7 PASS` 記録、Phase 52 sealed = `CI E2E 7/7 PASS`、Phase 30 sealed = `4 passed / 0 failed`
- **alpha-core verification-checklist 25 件中 E2E カバー 2 件のみ** (業者マイページ表示・スポット業者招待)、23 件 ✗
- **main branch の E2E 緑は未確認** (Phase 26 sealed で「CI 初回未実行」記録、その後 phase-42-t4-test-coverage で 7/7 PASS 維持)

### L2 migration drift 詳細

- **drift 2 件**: D6 `attachments.uploaded_by_user_id` / D7 `vendor_selection_logs.selected_by_user_id`、両方とも単独 FK 残存 + **active 経路 0 件** (preventive 性質)
- raw-migrations: post/ 0002-0021 (0001 / 0009 欠番)、alpha-1-public/ spec §17 順序整合 ✓
- D6/D7 解消は Phase 56-60 D pattern 6 回目、Phase 61 sealed が marginal 警戒明示

### L3 RLS cross-tenant 漏洩 (Claude 引き取り、Codex 出力空)

- **RLS integration test 2 ファイル / 計 12 tests**: `tenant-isolation.test.ts` (11 tests = admin/vendor cross-tenant + admin_vendor_invitations isolation + audit masking + helper function 動作) + `spot-rls-reproduce.integration.test.ts` (1)
- **RLS policy 定義 65 件**: alpha-1-public/19_rls_policies.sql 51 (主要 table 全 tenant_isolation + vendor_portal_select/update + vendor_portal_inbox) + post/ 11 修正 + alpha-1-public/26-28 計 3
- **helper function 5 件全実装** (spec §14.2): `current_user_company_id` / `current_vendor_id` / `current_vendor_user_id` / `vendor_accessible_company_ids` / `vendor_invited_transport_order_ids`
- **spec §14 vs migration 整合 ✓** (社内 tenant_isolation + 業者ポータル特殊 policy)

### L4 outbox / worker / dispatcher 健全性

- **dispatcher 稼働済**: `outboxDispatcher` (cron */1) + `inboxWorker` (cron */1) + `invitationExpirer` (hourly)
- **retry logic 実装済**: max 5 attempts / exponential backoff 30s→3600s cap / `FOR UPDATE SKIP LOCKED` 3 箇所利用
- **実装済 handler**: `transport_order.invitation.sent` / `transport_order.cancelled` / `admin_vendor_invitation.sent` (但し inbox mapping 不整合疑い)
- **MVP blocker #3 主体 = `transport_order.changed` 完全未実装**: outbox producer なし / Inngest worker なし / `transport_order_change_logs.requires_notification` scanner なし / `notified_at` 更新なし

### L5 admin invite + vendor portal token path

- **admin invite path**: `src/app/admin/vendors/invite/` (page + form + actions) + `createAdminVendorInvitation` service 実装済
- **vendor portal token path**: `vendor/invitations/[token]` + `vendor/invitations/callback/finalize` + `vendor/admin-invite-callback` + `verifyAndOnboardSpotInvitation` service 実装済
- **mock 整備状況**: `listUsers` / `inviteUserByEmail` / `deleteUser` / `generateLink` / `getUserByEmail` mocked、**`createUser` 未 mock** (実利用あり)
- **Phase 60 BLOCK-2 詳細**: 阻害 test = `admin-vendor-invitations-fk.integration.test.ts` の BLOCK-2 simulate test、必要 mock = createUser + inviteUserByEmail + generateLink + outbox、差分量未確認
- admin_vendor_invitations integration test = 計 32 it (5 ファイル)

### L6 reservation feature wake-up 詳細

- **reservation schema 実装済**: `reservations` / `reservation_status_history` / `customer_reservation_tokens` / `reservation_settings`
- **reservation service 全関数未実装**: createReservation / cancelReservation / updateReservation / confirmReservation / customer token 全 missing (`src/lib/services/reservations/` ディレクトリ自体なし)
- **reservation status seed 未実装** (transport は 0012/0013/0015 で実装済、reservation 版なし)
- **`trg_reservation_transition` migration 未適用** (spec §15.5 定義あるが raw-migration なし、Phase 58 sealed が未適用確認済)
- **MVP blocker #2 着手 entry point**: `transport-orders.ts:cancelTransportOrder` を参照実装、reservation 版 service 新規作成 + migration 2 本 (status seed + trigger) + fixture 拡張が必要
- customer_reservation_tokens schema partial 不整合 (spec §7: `customer_id` NOT NULL 要求 / 実 schema = nullable)

## release path 健全度 (5/29 Sprint レビュー材料)

### 緑判定可能項目 (roadmap §1.5 Day 2 release 条件照合)

| 条件 | 状態 | 根拠 |
|---|---|---|
| critical 7 reconcile 完了 | ✓ | Phase 14 reconciliation sealed (α-2 v1.2) |
| 業者ループ最小動作 | ✓ | Phase 28-B/C sealed + Spot E2E 2 passed |
| E2E 緑 (`phase-42-t4-test-coverage`) | ✓ | Phase 61 sealed `CI E2E 7/7 PASS` |
| RLS 漏洩テスト緑 | ✓ | tenant-isolation.test.ts 11 tests + spot-rls-reproduce 1 test |
| outbox dispatcher 稼働 | ✓ | outboxDispatcher / inboxWorker cron 稼働済 |

### 注意点 (release blocker / non-blocker 仕分け)

| 項目 | release blocker | 理由 |
|---|---|---|
| verification-checklist 25 件中 23 件 E2E 未カバー | **業者ループ最小は OK / 全業者ループ詳細は NG** | roadmap §1.5 release 条件は「業者ループ最小動作」+「E2E 緑」のみ、verification-checklist 全消化要求なし |
| `transport_order.changed` worker 未実装 (MVP blocker #3) | **alpha-core release 非 blocker** | alpha-core は「invitation.sent」「cancelled」で業者ループ最小成立、`transport_order.changed` は変更通知の拡張機能 |
| reservation feature 全未実装 (MVP blocker #2) | **alpha-core release 非 blocker** | alpha-core scope は店間整備 (transport_orders) 縦切り、reservation feature は β-1 (6/2-) スコープ |
| D6/D7 drift 残 | **release 非 blocker** | active 経路 0、preventive 性質 |
| Phase 60 BLOCK-2 未消化 | **release 非 blocker** | createAdminVendorInvitation 経路は test simulate level で BLOCK-2 残、本番経路は actions.ts 経由で稼働中 |
| main branch E2E 緑未確認 | **release 判断時に main rebase 後再確認要** | phase-42-t4-test-coverage は緑、release GO 時は main へ rebase → E2E 再実行 |

### release 判断インプット (5/29 Sprint レビュー)

**alpha-core release GO 条件**: 上記緑判定 5 項目 + main rebase 後 E2E 再緑 + Supabase production migration 順序確認 + Vercel domain 切替準備 + Inngest production 接続確認

## Claude 側の主要設計判断

1. **Phase 62 を release pre-flight 調査 Phase として固定**: advisor 助言で「推奨で進める」を option 1 内 F (pre-flight) に commit、D/E (wake-up entry) destabilization 回避
2. **6 lane 並列 Codex dispatch + read-only 強制**: scope 外ファイル変更厳禁 + apply_patch 禁止 + shell 書込禁止を全 prompt に明示 (Phase 61 教訓継承)
3. **L3 Codex 出力空 → Claude 引き取り**: codex-collaboration §5.5 「1 回フィードバックで改善しなければ Claude 引き取り」適用、再 dispatch 無限ループ回避
4. **release blocker / non-blocker 仕分けを sealed に明記**: 5/29 Sprint レビューで意思決定者 (ユーザー) が直接判断できる形に整形
5. **日付・確度予測の自発禁止遵守**: 5/29 / 5/31 は roadmap §0 §5 事実言及のみ、Claude 算出予測は記載なし

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| L1 a3f1f877 | E2E status 調査 | 完了 / 列挙 + alpha-core 照合 + 1 行サマリ / scope 外変更 0 |
| L2 a736da83 | migration drift 詳細 | 完了 / drift 2 件 + raw-migrations 一覧 + D 候補評価 / scope 外変更 0 |
| L3 a3f40122 | RLS 漏洩 | **失敗 (出力空・メタ報告のみ)** → Claude 引き取り完了 |
| L4 a7991b8d | outbox / worker | 完了 / 3 cron + retry logic + handler 種別 + MVP blocker #3 詳細 / scope 外変更 0 |
| L5 adc39122 | admin invite path | 完了 / 全 path + mock 整備 + BLOCK-2 詳細 / scope 外変更 0 |
| L6 abb56aa9 | reservation wake-up | 完了 / schema / service / status seed / trigger / entry point / scope 外変更 0 |

**Codex 出力品質**: 6/6 dispatch 中 5/6 採用 (scope 外変更 0 件、read-only 強制有効)、1/6 (L3) は出力空で Claude 引き取り。Phase 61 教訓 (scope 外 destructive) は再発なし。

## Phase 41-62 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-31 | Phase 31-A〜61 | 39-61 | (前 sealed.md 参照) |
| **(Phase 62 は調査 Phase、実装変更 0、累積 fix なし)** | - | 62 | release pre-flight 健全度可視化のみ |

## 残課題 / Phase 63 todo

### MVP blocker

- #1: 解消済 ✓ (Phase 50+51)
- #2: reservation cancel 遷移 (wake-up 領域、L6 で entry point 確定)
- #3: Worker handler = `transport_order.changed` 完全未実装 (L4 で詳細確定)
- #4: 解消済 ✓ (Phase 53+55)

### Phase 63 推奨スコープ候補 (Phase 62 6 lane 結果ベース)

1. **5/29 Sprint レビュー対応**: 本 sealed handoff をユーザー提示、release 判断 (GO / slip) を受領
2. **release GO の場合: main rebase + E2E 再実行 + Supabase production migration**
3. **release slip の場合 (5/29 判断次第)**:
   - MVP blocker #3 `transport_order.changed` worker 実装 (L4 entry point: `src/lib/inngest/functions/transport-order-changed-worker.ts` 新規 + `transport-orders.ts` outbox insert 追加)
   - Phase 60 BLOCK-2 緩和 (L5 detail: createUser mock 追加 + direct call 化)
   - D6/D7 preventive (同 pattern 6 回目で marginal 警戒、後回し推奨)
4. **β-1 (6/2-) scope の reservation feature wake-up**: L6 entry point + migration 2 本 + service 全関数新規

### 一般 todo

(Phase 47-61 sealed 参照、変化なし)

## Phase 63 入力契約

### 参照すべきファイル

- 本 handoff (`phase-62-release-preflight-sealed.md`)
- `phase-61-store-confirmed-by-user-fk-sealed.md` (前 sealed)
- `phase-62-release-preflight-plan.md` (本 Phase plan)
- `spec/roadmap/roadmap.md` §1.5 §5 (release 判断条件)
- `spec/verification-checklist.md` (alpha-core 必須項目)
- `spec/data-model.md` §14 (RLS) §15.5 (trg_reservation_transition 定義)
- L4 entry point: `src/lib/inngest/functions/outbox-dispatcher.ts` + `src/lib/services/transport-orders.ts`
- L5 entry point: `tests/integration/db/admin-vendor-invitations-fk.integration.test.ts` BLOCK-2 simulate test
- L6 entry point: `src/lib/services/transport-orders.ts:cancelTransportOrder` (reservation cancel 参照実装)

### 絶対に壊してはいけないもの (invariants)

- 既修正 31 bug/機能すべてに retrogression なし
- typecheck clean / 23 test files / 188 tests PASS
- CI E2E 7/7 PASS (`phase-42-t4-test-coverage`)
- 既存 invariants 全件 (Phase 43-61 確定)
- **Phase 62 は実装変更 0**: 既存ファイル一切無変更を維持
- RLS policy 65 件 + helper function 5 件
- outbox dispatcher + inbox worker + invitationExpirer 稼働

### 注意点

- branch: `phase-42-t4-test-coverage` (Phase 62 plan + seal で +1 commit、feat commit なし)
- Phase 62 変更ファイル: 0 src + 2 phase-handoff (plan + sealed) = 2 files
- Codex 委任 6 件 (read-only 並列調査)、advisor 呼び出し 1 件 (option 1 解釈確認)
- **release 判断は 5/29 Sprint レビュー予定** (roadmap §5 事実)、本 sealed を意思決定材料として提示
- 日付・確度予測の自発禁止 (CLAUDE.md Meta Rules) 遵守、本 sealed は事実ベース整理のみ

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 62 commit 数 | 1 予定 (plan + seal を 1 commit に統合) |
| 変更ファイル | 2 (plan + sealed handoff のみ、src 0) |
| 修正済 latent bug / 機能追加 | 0 (調査 Phase) |
| advisor 呼び出し | 1 (option 1 内 F commit 確認) |
| Codex 委任 task 数 | 6 (read-only 並列、L3 失敗 → Claude 引き取り) |
| Codex sandbox-blocked | 0 (read-only 中心、apply_patch 不要) |
| Codex scope 外変更 | 0 (Phase 61 教訓有効) |
| Codex 出力 採用率 | 5/6 (L3 のみ Claude 引き取り) |
| RLS test 件数 | 12 (tenant-isolation 11 + spot-rls 1) |
| RLS policy 件数 | 65 (alpha-1-public 54 + post/ 11) |
| E2E test 件数 | 7 (3 spec ファイル) |
| Inngest function 件数 | 3 (outboxDispatcher + inboxWorker + invitationExpirer) |
| reservation service 実装率 | 0% (全関数未実装) |
| verification-checklist alpha-core E2E カバー率 | 2/25 (8%) |
| drift | 2 → 2 (調査のみ、変更なし) |
| MVP blocker 解消 | 0 (調査 Phase) |

## 振り返りメモ

- **release pre-flight 調査 Phase の有効性**: 5/29 Sprint レビュー 2 日前のタイミングで事実列挙を完了、ユーザーが意思決定する材料を構造化提供。advisor が「F = α版進捗確認とそのまま重なる」と指摘した通り、ユーザー prompt と完全一致
- **Codex 並列 6 lane の token 効率**: Claude token 節約 (read-only 調査委任で 6 並列実行 + 結果統合のみ Claude 担当)。Codex 委任 quota 集中投下で実装変更 0 を達成
- **L3 Codex 出力空の教訓**: Codex が meta 報告 (「launched in the background」) を返して終了した。同型 prompt でも個体差あり、引き取り判断 (codex-collaboration §5.5) の機械的適用が有効
- **release blocker / non-blocker 仕分けの構造化**: roadmap §1.5 release 条件と 6 lane 結果の照合で「業者ループ最小は緑」「verification-checklist 全消化は要求外」「MVP blocker #2/#3 は β scope」を明示。ユーザーは 5/29 でこれをそのまま意思決定に使える
- **連続 16 Phase 完走 (47-62)**: 1-31 累積機能追加 (Phase 47-61) + 1 release pre-flight 調査 (Phase 62)。Phase 63 は 5/29 Sprint レビュー結果次第で release GO 動作 or slip 動作に分岐

## Addendum (2026-05-27 同日追記、ユーザー指摘反映)

### 見落としていた重大事項: deployment 環境ゼロ

Phase 62 sealed の §release path 健全度 は **コード品質緑のみ** を確認しており、**「実際に動かせる環境があるか」を見落としていた**。ユーザー指摘で判明。

**現状の deploy / 環境状態 (事実)**:

| 項目 | 状態 |
|---|---|
| Vercel project | 未設定 (vercel.json / .vercel/ なし) |
| Supabase production project | 未設定 (config.toml は local dev only) |
| Production migration 適用 | 未実施 |
| Inngest production 接続 | 未設定 (CI で test_dummy) |
| Resend production | 未設定 (CI で re_dummy_test_key) |
| Cloudflare Turnstile production | 未設定 |
| `.github/workflows/deploy.yml` | 存在しない (e2e.yml のみ) |
| Production seed (admin user / vendor user / 業者マスター) | 未実施 |

**Phase 20 推奨 5 項目との照合 (advisor reconcile 後)**:

- `src/middleware.ts`: **実装済 (78 行)**
- `src/lib/supabase/server.ts`: **実装済 (36 行)**
- `src/lib/supabase/browser.ts`: **実装済 (19 行)**
- `src/lib/db/with-auth.ts` (`withAuthenticatedDb`): **実装済 (22 行、Phase 20 推奨仕様準拠)**
- vendor onboarding/admin seed path: **production seed 未実施**

→ **auth path は閉じている**。本当の gap は **deployment 環境ゼロ** であり、5/31 第一次納品で「URL を顧客に渡せる α版」を成立させるには Vercel/Supabase production project 作成（ユーザー作業）+ middleware/server.ts は既に存在するので env 配線 + production migration + seed + Inngest/Resend production 接続が必要。

### release 判断材料の訂正

旧表 (上記 §release path 健全度) は「コード品質緑」までは正しいが、**「release 可能」と読める表現は誤り**。正しい読み:

- **コード品質**: release レディ (緑判定 5 項目 ✓)
- **deployment 環境**: release レディに **遠い** (上記 8 項目全て未設定)

### ユーザー判断と Phase 63 方向 (確定)

ユーザー回答 (2026-05-27): 「5/31 第一次納品 = 全機能でなくても業務で使える状態」
→ (a) URL を顧客に渡して業務で使える α 版で、機能 scope は alpha-core 縦切り + 業務必須機能のみ。

**Phase 63 方向 (再設定)**:
1. verification-checklist 25 件を「業務必須」「業務任意 (β scope)」に仕分け
2. 業務必須機能の実装状態確認 (実装済+E2E / 実装済+E2E なし / 未実装 / production-only gap)
3. staging 環境構築のステップ列挙 + ユーザー作業 (Vercel/Supabase project 作成) との分業確定
4. 残作業の優先順位確定 → 着手

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-27 (Phase 62 完了、release pre-flight 6 lane 並列調査、実装変更 0、α-3 release 判断材料確保、5/29 Sprint レビュー材料整形完了) + Addendum (同日、deployment 環境ゼロ正直記録 + auth path 閉鎖確認 + Phase 63 方向確定)*
