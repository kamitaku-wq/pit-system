# Phase 42 入力契約: Phase 41 recon sealed (Codex 真因解明 + vendor callback fix + bug 5 regression 強化)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 41 (前: 40 sealed) |
| 状態 | **sealed** (typecheck clean / unit 35 / integration 84 PASS) |
| 完了日時 | 2026-05-26 |
| 担当 | Claude (plan + probe + audit + 検証) / Codex (3 件委任: seed-admin-dev / probe-invite-link / vendor callback fix / test 強化) |
| 前 handoff | `phase-40-recon-sealed.md` |
| Branch | `phase-26-ci-verify` (commit 未) |

## 達成したこと (Phase 41)

- **T1 Codex sandbox 真因解明**: probe (single + multi-file) で `apply_patch` は機能・shell spawn が `spawn setup refresh` で失敗と確定。「sandbox-blocked」誤診の真因は Codex 内 shell 経由書込の失敗
- **T1 ルール文書化**: `~/.claude/rules/common/codex-collaboration.md` §2.5 d 追加 (Windows shell-spawn vs apply_patch 切り分け、post-delegation 実体確認)
- **T2 invite flow empirical 確定**: `scripts/probe-invite-link.ts` 新規作成、`pattern: IMPLICIT_FRAGMENT` を生 location_header で確認。Phase 40 の「未確定」を解消
- **T3 vendor/invitations/callback 修正**: bug 7 同型脆弱性確定 → bug 7 fix の mirror 構造で client page + finalize route に書き換え + integration test を finalize endpoint 用に書き換え
- **T4 bug 5 regression 強化**: `admin-vendors.integration.test.ts` test 1 を mock → real DB (withFixture) に書き換え、真の postgres-js timestamptz 挙動を validate
- **付随成果物**: `scripts/seed-admin-dev.ts` (local dev 用 admin seed, 305 行) も作成

## Claude 側の主要設計判断

1. **probe で sandbox 真因確定 (advisor 的中)**: 当初「`[windows] sandbox = elevated`」を疑ったが、direct + subagent probe で apply_patch 機能を確認。真因は shell spawn 不可で「sandbox-blocked」は誤診ラベルと判明
2. **T2 スコープ再定義**: 本番未デプロイ (Site URL=localhost) 判明後、Supabase ダッシュボード確認から probe script (UI 不要、Supabase Admin API 直叩き) に方針変更
3. **T3 修正を本 Phase で実施 (advisor 的中)**: 「audit のみで seal すると再 onboarding cost」「bug 7 fix の mirror なので確実」で本 Phase に含めた
4. **T4 は #1 のみ修正**: bug 5 regression が mock で空振りという self-contradiction を最優先、#2-#4 は新規 test 拡充になるため Phase 42 todo へ送る
5. **Codex 既存パターン違反検出**: 自動生成された script で `SUPABASE_URL` 使用 (規約は `NEXT_PUBLIC_SUPABASE_URL`)、Claude が修正。T1 ルール「post-delegation 実体確認」が機能
6. **probe-invite-link.ts は実 SMTP 送信不要**: `generateLink` は internal で同じ action_link を生成、`inviteUserByEmail` も同形式 → empirical 確定に十分

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260526-033713-511a | T1 probe: subagent 書込テスト | applied (apply_patch 機能・shell spawn 失敗を可視化) |
| del-20260526-034048-db95 | T1 probe: multi-file 書込テスト | applied (同上 multi-file 確認) |
| del-20260526-052700-a32d | scripts/seed-admin-dev.ts 新規 | applied (305 行、env 名 Claude 修正) |
| del-20260526-054345-5838 | scripts/probe-invite-link.ts 新規 | applied (env 名 Claude 修正、IMPLICIT_FRAGMENT empirical 確定) |
| del-20260526-062516-a411 | T3 vendor/invitations/callback fix | applied (route.ts 削除 + page.tsx + finalize/route.ts 新規 + integration test 書換) |
| del-20260526-063554-0fa8 | T4 bug 5 regression test real DB 化 | applied (test 1 を withFixture ベースに書換) |

**Codex sandbox 状態**: shell spawn は依然失敗だが apply_patch + Claude 側検証ループで安定運用可能と確認。Phase 40 の「broken」評価は撤回。

## Phase 41 + Phase 40 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-7 | Phase 31-A/B/C/D | 39-40 | (handoff phase-40-recon-sealed.md 参照) |
| 8 | Phase 25 (spot-onboarding) | **41** | vendor/invitations/callback 同型脆弱性 (query 期待 → fragment 対応) |
| 9 | Phase 40 (test infra) | **41** | admin-vendors test 1 mock → real DB (regression cover 機能化) |

## 残課題 / Phase 42 todo

- **T4 audit 未修正の 3 件**:
  - #2 (Medium): resend 時 outbox 再生成確認なし
  - #3 (Medium): accepted/revoked への state transition test なし
  - #4 (Low): revoked_at timestamp 確認なし
- **本番デプロイ前の Supabase URL Configuration 更新**: Site URL を local → 本番 URL に変更、Redirect URLs に `/vendor/admin-invite-callback` `/vendor/invitations/callback` を追加
- **`probe-invite-link.ts` を CI に組み込むか?** invite flow regression 検出に有用
- **UI 未実装**: 別 Phase で着手 (Phase 41 scope 外)
- **Codex shell spawn 制約**: plugin upstream の Windows 制約、Claude 側で fix scope 外

## Phase 42 入力契約

### 推奨される次 Phase スコープ
1. **T4 残 3 件 (#2-#4) の test 拡充**: resend outbox 再生成 / state transition / revoked_at 検証
2. **vendor 側 E2E 拡張**: 現在 password login で callback skip しているが、`probe-invite-link.ts` パターンで callback も叩く E2E を追加
3. **UI 実装着手** (別 phase の可能性)
4. **本番デプロイ準備** (Supabase URL Configuration + Vercel/host 設定)

### 参照すべきファイル
- 本 handoff (`phase-41-recon-sealed.md`)
- `phase-40-recon-sealed.md` (前 Phase)
- `~/.claude/rules/common/codex-collaboration.md` §2.5 d (T1 新ルール)
- `scripts/probe-invite-link.ts` (T2 empirical 検証ツール)
- `scripts/seed-admin-dev.ts` (local dev admin seed)
- `src/app/(vendor-portal)/vendor/invitations/callback/page.tsx` + `finalize/route.ts` (T3 fix)
- `tests/integration/services/admin-vendors.integration.test.ts:42-69` (T4 修正後)

### 絶対に壊してはいけないもの (invariants)
- 既修正 9 bug すべてに retrogression なし
- typecheck clean / vitest unit 35 PASS / integration 84 PASS
- CI E2E 7/7 PASS (Phase 42 で初 CI 確認時に維持)
- 公開 API シグネチャ不変 (invitations/callback URL は同じ `/vendor/invitations/callback`、内部実装のみ変更)

### 注意点・コンテキスト
- branch: `phase-26-ci-verify`、Phase 41 の変更は **未 commit** (ユーザー判断待ち)
- 変更ファイル: 2 modified (test) + 1 deleted (route.ts) + 4 untracked (scripts × 2, callback page/finalize)
- Phase 41 で **E2E は走らせていない** (CI 走行時に green 確認推奨)
- Codex sandbox は shell spawn 失敗だが apply_patch 経路で運用可能と確認 → Phase 40 の「broken」評価は誤診

## Codex ledger refs

- del-20260526-033713-511a (T1 probe single, applied)
- del-20260526-034048-db95 (T1 probe multi, applied)
- del-20260526-052700-a32d (seed-admin-dev, applied)
- del-20260526-054345-5838 (probe-invite-link, applied + Claude env 名修正)
- del-20260526-062516-a411 (T3 vendor callback fix, applied)
- del-20260526-063554-0fa8 (T4 test 1 real DB 化, applied)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 41 commit 数 | 0 (未 commit) |
| 変更ファイル | 2 M + 1 D + 4 ?? = 7 files |
| 新規ファイル | 4 (scripts × 2 + callback page + finalize/route.ts) |
| 削除ファイル | 1 (invitations/callback/route.ts) |
| 修正済 latent bug | 2 (#8 vendor callback / #9 test cover gap) — 累積 9 |
| advisor 呼び出し | 3 回 (T1 着手前 / T2 結果後 / T4 修正範囲判断) |
| Codex 委任 task 数 | 6 (probe 2 + script 2 + fix 1 + test 1) |
| Codex sandbox-blocked 率 | 0/6 (全て applied、apply_patch 経路で安定) |
| Claude 側修正 (Codex 出力) | 2 (env 名規約違反) |

## 振り返りメモ

- **advisor の貢献**: 3 回呼び出しで (1) T1 probe 射程拡張 (background + multi-file) で誤診回避、(2) T3 修正を本 Phase 化 + Codex 委任時 mirror 指示、(3) T4 #1 のみ修正で scope creep 防止
- **T1 ルール「post-delegation 実体確認」が機能**: Codex が「sandbox spawn で typecheck/vitest 実行不可」と報告した T3/T4 委任後、Claude が手元で `tsc --noEmit` + `vitest run --project integration` を代行実行し green 確認。委任完了 notification を盲信せず実体検証する運用が定着。env 名規約違反 (`SUPABASE_URL` vs `NEXT_PUBLIC_SUPABASE_URL`) は probe 実行失敗をトリガーに発見、Codex 出力 2 件で同一違反していた点が後続の課題
- **Phase 40「Codex broken」評価は誤診**: probe で apply_patch 機能を確認、real な制約は shell spawn のみ。委任プロンプトで shell 書込を指示しなければ問題なく機能
- **empirical の威力**: T2 で「Supabase 設定次第」と曖昧だった点を probe 1 回で `IMPLICIT_FRAGMENT` に確定。Phase 40 の advisor 指摘「実 invite で magic link inspect」が結実
- **UI 未実装の事実が surface**: Phase 41 で初めて UI/login ページ未実装が判明。次 Phase の重要 input

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-26 (Phase 41 完了、accumulated 9 bug 全消化 + Codex 真因解明)*
