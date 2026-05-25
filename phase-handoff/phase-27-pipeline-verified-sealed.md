# Phase 27 入力契約: ι workflow pipeline-verified (Phase 26-A sealed)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 27 (前: 26 → 26 sealed) |
| 状態 | sealed (pipeline 部分のみ) |
| 完了日時 | 2026-05-25 (PR #1 上 4 cycle 後) |
| 担当 | Claude (CI verify / 3 件 fix / scope 判断) |
| 関連 PR | https://github.com/kamitaku-wq/pit-system/pull/1 |
| 前 handoff | `phase-26-sprint-beta-day2-sealed.md` |

## 達成したこと (Phase 26-A: pipeline-verified)

- **PR #1 作成 + feature branch `phase-26-ci-verify` push**
- **3 件の latent state 修正** (CI 初実行で初顕在):
  1. `pnpm-lock.yaml` specifier `inngest ^3.26.0` → `^3.27.0` (package.json と乖離、frozen-lockfile fail)
  2. `actions/setup-node` v20 → v22 (`@supabase/realtime-js@2.106.1` が Node 20 で native WebSocket 不在 fail)
  3. `db:setup` script 漏れ + credentials 抽出 quote bug (batch 1 commit)
- **CI pipeline 完全緑化** (ジョブ層): Setup → Supabase start → Export credentials → Install → **db:setup ✓** → Playwright install → Playwright test 起動 OK
- E2E spec 2 件は test 内部で fail (Phase 27 へ繰越) — scope 切り分け実行

## Claude 側の主要設計判断

1. **scope を pipeline-verified で seal**: Phase 25 handoff 「E2E (Playwright): CI 初回未実行」明記の latent state が Phase 26 初顕在化。E2E spec 内部 fail は本来別軸の作業のため、Phase 26 を pipeline 緑で seal し E2E spec correctness を Phase 27 へ切り出し。
2. **db:setup gap は Phase 25 invariant 漏れの正式修正**: Phase 25 sealed handoff「raw-migrations 27 件 fresh apply」は手動 clean install のみで script 反映なし。spec/data-model.md §17 順序通り `pre → alpha-1-public → drizzle migrate → post` に組み直し。
3. **JWT base64 fail の原因特定**: `supabase status --output env` がクォート付き emit、 `cut -d= -f2-` がクォート保持。`source` で strip。
4. **batch fix 採択**: 3 サイクル目で advisor 助言通り 2 fix を 1 commit にまとめて cycle 節約。

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| (なし) | Phase 26-A は調査・診断・1-行修正中心、Claude 主導 | - |

advisor を 2 回 call (scope 判断 + lockfile 訂正)。E2E spec deep debug が Phase 27 で発生する場合は Codex 委任候補。

## 主要ファイル (Phase 27 reference)

- `.github/workflows/e2e.yml:31-77` — Node 22 / credentials source 方式
- `package.json:22-25` — db:setup 4 段階順序
- `tests/e2e/vendor-portal-loop.spec.ts:83-95` — fail spec 1 (vendor accept)
- `tests/e2e/vendor-portal-spot-loop.spec.ts:90-110` — fail spec 2 (spot onboarding)
- `tests/_helpers/seed-vendor-e2e.ts:215-220` — cleanup の audit_logs FK 違反箇所
- `tests/e2e/_helpers/seed-vendor-spot-e2e.ts:160` — spot seed の createUser 呼び出し
- `phase-handoff/phase-26-sprint-beta-day2-sealed.md` — 前 Phase の全文脈

## データモデル変更

- なし
- `pnpm-lock.yaml` specifier 1 行 (resolved version 3.54.2 不変)

## API 契約

- 変更なし

## テスト・QA 状況

- vitest: 86 PASS / 0 fail / 0 skip 維持 (lockfile fix 後 local 確認済)
- tsc: clean
- **CI E2E**: pipeline ✓ / E2E spec 2 件 fail (latent state)
  - vendor-portal-loop.spec.ts:83 — `requestLink toBeVisible` 5s timeout (UI: 「現在 pending の依頼はありません」)
  - vendor-portal-spot-loop.spec.ts:90 — 同上パターン
- 副症状: cleanup で `audit_logs_company_id_fkey` 違反 (主因解消で消える derivative)

## 既知の懸念・TODO (Phase 27)

- **【最優先】E2E spec 2 件の root cause 切り分け**:
  - 仮説候補: ① seed の vendor_id / company_id 紐付け ② RLS で当該 vendor user に invitation 不可視 ③ pagination/filter ④ status 値の不一致
  - 確認手段: playwright.config に `trace: 'on-first-retry'` 追加 → trace.zip で network/console/DOM 全部確認、または CI で `psql` step 追加して DB row dump
- **cleanup 順序問題**: seed-vendor-e2e.ts:215 で `audit_logs` を先に DELETE してから `companies` DELETE する順序修正 (主因解消後にも残る可能性)
- **raw-migrations 冪等性整理** (Phase 26-B 候補、未着手)
- **pit_v24_poc schema 廃止** (Phase 26-C 候補、未着手)
- **Phase 25 sealed invariant 追加**: 「db:setup script が raw-migrations 全ディレクトリを参照すること」を明文化

## Phase 27 入力契約

### 前提として動くべき機能

- CI pipeline (Phase 26-A で緑化済み)
- vitest 86 PASS (Phase 25 維持)
- spot invitation MVP / vendor invitation callback (Phase 24/25 sealed)

### 参照すべきファイル

- 本 handoff
- `phase-26-sprint-beta-day2-sealed.md` (前 Phase の詳細)
- `.github/workflows/e2e.yml` (現状の CI 構成)
- `tests/e2e/vendor-portal-*.spec.ts` (修正対象 2 件)
- `tests/_helpers/seed-vendor-e2e.ts` / `tests/e2e/_helpers/seed-vendor-spot-e2e.ts`

### 絶対に壊してはいけないもの (invariants)

- ADR-0010 補項
- raw-migrations 27 ファイル touch 0 (alpha-1-public 内)
- 公開 API シグネチャ
- vitest 86 PASS / 0 skip
- CI pipeline 緑 (今回達成、retain)

### 推奨される次 Phase スコープ

- **A (最優先)**: E2E spec 2 件 root cause 特定 + 修正 → CI 完全緑
- **B**: cleanup 順序の防御的修正 (audit_logs → companies)
- **C**: raw-migrations 冪等性整理 (Phase 26 で繰越)
- **D**: pit_v24_poc schema 廃止 (Phase 26 で繰越)

### 注意点・コンテキスト

- PR #1 は phase-26-ci-verify branch、main ahead は 47 commits 程度 (43 + Phase 26 で 4 commit)
- CI cold run 概ね 2-7 分 (pnpm store cache あり)、E2E test step は 1-2 分でタイムアウト
- artifact 取得は `gh run download <id> -n playwright-artifacts -D <dir>` で可能

## Codex ledger refs

- なし (Phase 26-A は Claude 主導)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 追加 commit 数 | 3 (lockfile / Node 22 / batch fix) |
| 追加コード行数 | ~15 (workflow 10 + package.json 2 + lockfile 1) |
| CI run 数 | 4 (3 fail / 4 番目で pipeline 緑、E2E spec fail) |
| Codex 委任率 | 0/0 (Phase 26-A は委任なし) |
| advisor 呼び出し | 2 (lockfile 訂正 + scope 判断) |
| セッション数 | 1 (Phase 25 sealed 後の resume) |

## 振り返りメモ

- うまくいった: artifact 取得 → screenshot で「pending 依頼なし」を見て seed 経路を即推定。advisor の「artifact 見てから scope 判断」助言が的中
- 次回改善: Phase 25 で `db:setup` script の整合を確認しておくべきだった (handoff invariant 候補に「script 整合」を含めるべき)
- 反省: Node 20 → 22 を local 環境 (Node 24) と先に照合せず推測で push したが、結果的に正しかった (engines `>=20.11.0` range の確認は事前にした)

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-25 (Phase 26-A pipeline-verified)*
