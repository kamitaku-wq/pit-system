# Phase 64 入力契約: Phase 63 verification-checklist scope 仕分け + 実装状態判定 sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 63 (前: 62 sealed) |
| 状態 | **sealed** (4 step 完了: 仕分け / 実装状態 / staging 計画 / 優先順位確定) |
| 完了日時 | 2026-05-27 |
| 担当 | Claude (scope 確定 + 統合 + sanity check + seal) + Codex 3 lane (L1 マスター / L2 中核 / L3 業者ループ 並列 read-only 調査) + advisor 1 件 |
| 前 handoff | `phase-62-release-preflight-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (Phase 63 = plan 4 + sealed 1 = +5 file 想定 commits) |

## 達成したこと (Phase 63)

- **verification-checklist 全 ~94 項目を 3 区分に再仕分け** (業務必須 35 / β 移行 18 / quality gate 41+)
- **業務必須 35 件の実装状態 4 区分マッピング完了** (A 実装+E2E 3 件 / B 実装+E2E なし 8 件 / C 未実装 24 件)
- **Phase 62 sealed §release path 健全度 の誤認を訂正** (実装率 32%、未実装 68%)
- **staging 環境構築 12 ステップ + ユーザー/Claude 分業表確定** (外部設定 6 件はユーザー別セッションで進行中)
- **Phase 64-66 分割確定** (64-A 整備伝票/車両 → B 予約 TX → C 業者ループ閉鎖 → D マスター UI → E 業務効率 → 65 staging → 66 5/29 レビュー)

## Phase 63 step 1-4 サマリ

### step 1: scope 仕分け (`phase-63-scope-classification-plan.md`)

- verification-checklist 25 件 (Phase 62 sealed L82 推定) は実数で Section C 75 + Section D 19 ≒ 94+
- 業務必須 35 件 / β 移行 18 件 / quality gate 41+ 件
- §4 ユーザー確認 3 件 = すべて β 降格で確定 (案件単位招待 / D.17 / D.18)

### step 2: 実装状態マッピング (`phase-63-step2-implementation-state.md`)

| 区分 | 件数 | % |
|---|---|---|
| A) 実装済 + E2E 緑 | 3 件 | 9% |
| B) 実装済 + E2E なし (integration 一部) | 8 件 | 23% |
| C) 未実装 / schema のみ / UI stub | 24 件 | 68% |

未実装 24 件は α 必須 16 件 (業者ループ閉鎖 9 + マスター 4 + 望ましい 3) + β 移行 8 件に再仕分け。

### step 3: staging 構築 (`phase-63-step3-staging-setup-plan.md`)

- 必要 env vars 13 種特定 (Supabase 5 / Resend 2 / Inngest 2 / Turnstile 2 / App URL 2)
- 12 ステップ × ユーザー作業 8 / Claude 作業 6 で分業表確定
- §9 外部設定 6 件はユーザー **別セッションで進行中**

### step 4: Phase 64-66 分割 (`phase-63-step4-implementation-priority-plan.md`)

| Phase | 内容 | 規模 | 委任率 |
|---|---|---|---|
| 64-A 整備伝票/車両 | service_tickets + vehicles CRUD | 8-12 files | 70% |
| 64-B 予約 TX | reservation 4 テーブル atomic + 移動 4 パターン | 5 files | 30% |
| 64-C 業者ループ閉鎖 | 完了報告 + 予定入力 + fallback 4 種 + manual | 6-8 files | 20% |
| 64-D マスター UI | 自動シード + 店舗/レーン/通知ルール CRUD UI (フル) | 8-12 files | 70% |
| 64-E 業務効率 | カレンダー DB 接続 + 業者選択フィルタ + inbox UI | 3-5 files | 60% |
| 65 staging | step 3 実行 | 4-6 files | 30% |
| 66 5/29 レビュー + 5/31 判断 | 進捗報告 + 判断材料 | 0-2 files | - |

**全体: 34-48 files / 1900-2900 行 / 19-29 commits**

## Claude 側の主要設計判断

1. **「25 件」固執を捨て alpha-core 視点で逆算**: advisor 助言 (Phase 62 estimate の誤認指摘) を採用、verification-checklist 全 94+ を再仕分け
2. **2 軸分類採用** (feature vs verification item × 業務必須 vs β): Phase 0 PoC + Section D 異常系を「release 前 quality gate」として feature 仕分けから分離
3. **3 lane 並列 read-only 調査 (Codex)**: Phase 62 と同じ pattern、L3 出力空 issue 回避のため調査項目を具体的に 10 件明示
4. **Phase 62 sealed §release path 健全度 の誤認を sealed で訂正**: 「コード品質緑」は実装率 32% で誤認、deployment 環境ゼロと併せて 5/31 第一次納品材料を正確化
5. **UI フル実装 (Phase 64-D)**: ユーザー判断「UI 盛り込みたい」採用、seed + 手動投入 fallback は却下
6. **着手順序 A→B→C→D→E 直列 + 新 branch + advisor 事前レビュー**: 推奨判断で確定、Phase 64-B TX 設計に着手前 advisor / codex:adversarial-review 挟む

## Codex 委任成果

| del id | task | 結果 |
|---|---|---|
| L1 del-20260527-124548-c42f | Phase 1 マスター 10 + Phase 3 一覧 3 | 完了 / 13 件全項目 / `.tmp/phase-63-lane1-master-list.md` 書込成功 / scope 外 0 |
| L2 del-20260527-124613-5fea | Phase 2 中核 12 | 完了 / 12 件全項目 / sandbox apply_patch denied → Claude 側 `.tmp/phase-63-lane2-phase2-core.md` 保存 / scope 外 0 |
| L3 del-20260527-1248xx-? | Phase 2 業者ループ + UI 10 | 完了 / 10 件全項目 (6 件「推定不可」明記) / sandbox apply_patch denied → Claude 側 `.tmp/phase-63-lane3-vendor-loop.md` 保存 / scope 外 0 |

**採用率**: 3/3 (Phase 62 L3 出力空 issue 再発せず) / sandbox-blocked: 2/3 で apply_patch denied (報告内容自体は復元可能、override 不要)

## 残課題 / Phase 64 todo

### MVP blocker

- #1: 解消済 ✓ (Phase 50+51)
- #2: reservation feature β scope (Phase 63 で β 移行確定)
- #3: 業者ループ閉鎖必須 9 件 = **Phase 64-C で実装**
- #4: 解消済 ✓ (Phase 53+55)

### Phase 64-66 ブランチ戦略

- **Phase 64**: 新 feature branch `phase-64-mvp-implementation` 切り出し (`phase-42-t4-test-coverage` からブランチ)
- **Phase 65**: staging 構築は同 branch で継続
- **Phase 66**: 5/29 Sprint レビュー前に main へ rebase + E2E 再確認

### staging 外部設定 (step 3 §9 ユーザー回答待ち)

ユーザー別セッションで進行中。Phase 65 着手時に必要:

1. Vercel アカウント / 2. Supabase project / 3. Inngest / 4. Resend ドメイン認証 / 5. Turnstile (α 段階 optional) / 6. カスタムドメイン

## Phase 64 入力契約

### 参照すべきファイル

- 本 handoff (`phase-63-overall-sealed.md`)
- `phase-63-step2-implementation-state.md` (実装状態 4 区分マッピング)
- `phase-63-step3-staging-setup-plan.md` (staging 12 ステップ、Phase 65 で実行)
- `phase-63-step4-implementation-priority-plan.md` (Phase 64-66 分割詳細)
- `.tmp/phase-63-lane{1,2,3}-*.md` (実装ファイル path 一覧、grep 起点)
- `spec/verification-checklist.md` v2.2 (受入テスト基準)
- `spec/data-model.md` §17 (migration 順序、4 テーブル atomic INSERT 順)

### 絶対に壊してはいけないもの (invariants)

- 既修正 31 bug/機能すべてに retrogression なし
- typecheck clean / 23 test files / 188 tests PASS
- CI E2E 7/7 PASS (`phase-42-t4-test-coverage`)
- 既存 invariants 全件 (Phase 43-62 確定)
- RLS policy 65 件 + helper function 5 件
- outbox dispatcher + inbox worker + invitationExpirer 稼働
- Phase 63 は実装変更 0 (調査 + plan Phase)

### Phase 64-A 着手時の最初の判断

1. 新 branch `phase-64-mvp-implementation` 作成 (`git checkout -b phase-64-mvp-implementation phase-42-t4-test-coverage`)
2. service_tickets CRUD から着手 (Codex 委任率 70% で並列化可能)
3. spec/data-model.md §10 service_tickets schema + §17 migration 順序確認

### Phase 64-B 着手前のゲート

- advisor または codex:adversarial-review を必ず挟む (ユーザー §12-4 判断)
- reservation + service_ticket + transport_order + outbox の 4 テーブル atomic 設計レビュー
- spec §17 migration 順序での INSERT 順検証

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 63 commit 数 | 1 予定 (4 plan + 1 sealed) |
| 変更ファイル | 5 phase-handoff (src 0) |
| 修正済 latent bug / 機能追加 | 0 (調査 + 計画 Phase) |
| advisor 呼び出し | 1 (step 1 approach 確認) |
| Codex 委任 task 数 | 3 (L1/L2/L3 read-only 並列) |
| Codex 採用率 | 3/3 (100%) |
| Codex sandbox apply_patch denied | 2/3 (報告内容は復元成功) |
| Codex scope 外変更 | 0 (Phase 61-62 教訓継承) |
| 業務必須項目 | 35 件 (A 3 / B 8 / C 24) |
| 業務必須実装率 | 32% (A+B = 11/35) |
| 未実装 α 必須 | 16 件 (Phase 64-A-E で実装) |
| β 移行確定 | 18 件 |
| 全体 verification-checklist | 94+ 件 |
| MVP blocker 解消 | 0 (Phase 63 は計画 Phase) |

## 振り返りメモ

- **Phase 62 sealed の §release path 健全度 誤認 を Phase 63 で訂正**: 「コード品質緑」評価は実装率 32% で誤認、advisor 助言で「Phase 62 sealed L82 の 25 件は estimate」と気付き、再仕分けで実体が明らかに。Phase 62 Addendum (deployment 環境ゼロ) + 本訂正で 5/31 第一次納品判断材料を正確化
- **Codex 3 lane 並列 read-only 調査の有効性**: Phase 62 と同じ pattern を踏襲、調査項目を 13/12/10 件具体明示で L3 空出力 issue 再発なし。sandbox apply_patch denied 2 件は報告内容自体に影響なし
- **Claude sanity check の重要性**: Codex 結果を盲信せず admin/ + vendor/ ディレクトリの実体を Glob で再確認、L1/L2/L3 の発見と整合確認できた (admin UI 不在、vendor actions = respond のみ)
- **「業務で使える α 版」の現実**: 業務必須 35 件のうち未実装 24 件、α 必須 16 件 + deployment 構築 + 残 4 日 (5/27-5/31)。日数 vs 実装規模はユーザー経営判断 (Claude は予測しない)、5/29 Sprint レビューで議題化予定

---

*Phase 63 sealed / Generated by Claude 2026-05-27 / Phase 64 = `phase-64-mvp-implementation` branch / staging 外部設定はユーザー別セッション進行中 / 5/29 Sprint レビューで進捗報告予定*
