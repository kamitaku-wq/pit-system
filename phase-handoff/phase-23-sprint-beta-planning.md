# Phase 23: Sprint β Planning (recon + plan v2 確定) Handoff (sealed)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 23 |
| 状態 | sealed (planning phase 全完了) |
| 開始 | 2026-05-25 (Phase 22 sealed 直後) |
| 完了 | 2026-05-25 |
| 担当 | Claude (resume + 5 recon 統合 + plan 起草 v1/v1.1/v2 + sealed) / Codex (recon 3 件 implementation + adversarial review 失敗) / advisor (Codex 代替 adversarial review) |
| 関連 branch | main (uncommitted、Phase 23 sealed 後にまとめて commit) |
| 前 Phase | phase-22-alpha-3-day4-16e.md (sealed, commit 3baf2cd) |
| 関連 incident | R-H-002 (Codex Windows sandbox: recon (b) Branching + adversarial review の 2 件で `spawn setup refresh` 完全 block、Claude/advisor 巻取り運用) |

## このフェーズで達成したこと

- Sprint α-3 sealed 状態から Sprint β 計画フェーズに移行、recon-plan-review 全工程完遂
- 初版 3 recon (spot RPC / admin invitation / CI E2E) を Codex 並列委任で起草
- admin recon が Codex sandbox 失敗で推論ベースになっていたため Claude が実コード調査で source-backed 化 (全面書き直し)
- advisor 1 回目で plan 起草前矛盾 3 件発見 → 追加 recon 2 本 (spot onboarding pipeline + Branching 互換性) で解消
- plan v1 → advisor 2 回目で 4 件追加指摘 + scope 再設計 → plan v1.1 化
- Codex adversarial review が sandbox 失敗 (subagent + Bash 直接両方) → advisor 代替で 10 findings 取得
- user 判断 6 件取得 (admin 方針 / CI 戦略 / Sprint β scope / case (c) / F1 password / F4 case (b) / F8 ADR 形式)
- plan v2 確定、Phase 24 実装着手 Gate ✓
- 7 ファイル生成 (recon 5 + adversarial review + plan v2)

## Claude 側の主要設計判断

1. **admin recon 推論版 → Claude 実調査で全面書き直し**: Codex sandbox 失敗時の品質低下を補完。実コード調査で「admin shell 既存 / vendor_invitations 不在 / spec は spot 経由自動 onboarding が唯一の正規経路」を確定
2. **追加 recon 2 本投入**: advisor 矛盾 3 件 (RPC内 auth.admin 違反 / vendors 行作成タイミング / Branching 互換) を plan 起草前に潰す経路を選択。「plan 急造 → adversarial review でカバー」より上流で潰す方が cost 安い
3. **scope 再設計 (Phase 24/25 分割)**: advisor 提案を採用、Phase 24 を α/β/γ/δ-server/ε/η に絞り、UI/E2E/CI を Phase 25 へ。Phase 22 比 1.3-1.5× 規模見込みのため tight scope 回避
4. **Codex adversarial review → advisor 代替**: R-H-002 復旧待ちより advisor リトライが speedy。「異モデル視点」の代替性は弱いが substantive findings 10 件取得で品質確保
5. **case (c) 認可方式**: schema 差異発見 (実装 `UNIQUE(vendor_id, email)` vs spec `UNIQUE(email)`) を踏まえ、Phase 24 では `transport_order.company_id != vendor_users.company_id` の tenant 境界で阻止に確定。Sprint γ で global unique 化を検討
6. **inviteUserByEmail 採用 (F1)**: Supabase 標準で password set link メール送信、UX 軽量、Phase 24 +10-15min 内に収まる
7. **F2 false positive 判定**: `responded_at` カラムは 12_transport.sql:97 既存。Grep verify で BLOCKER 取り下げ

## Codex 委任成果

| 委任 ID | 内容 | 成果物 | 状態 |
|---|---|---|---|
| (recon #1 spot) | RPC + RLS + helper + service recon | phase-23-sprint-beta-recon-spot.md (200 行) | applied (高品質、source-backed) |
| (recon #2 admin) | admin invitation UI/API recon | phase-23-sprint-beta-recon-admin-invite.md (160 行) | **Claude 全面書き直し** (sandbox 失敗で推論ベースになったため) |
| (recon #3 CI E2E) | CI workflow + Supabase 戦略 recon | phase-23-sprint-beta-recon-ci-e2e.md (153 行) | applied (推奨 = staging C → user 再質問で Branching A 採用) |
| del-20260524-235617 (推) | spot onboarding pipeline recon | phase-23-recon-spot-onboarding-pipeline.md (67 行) | applied (矛盾 1+2 解消) |
| del-20260524-235730 (推) | Branching 互換性 recon | (sandbox 失敗、unresponsive) | **Claude 直接執筆** (phase-23-recon-branching-migrations.md, 推奨案 B) |
| del-20260525-010340-1895 | Phase 24 plan adversarial review | (sandbox 失敗) | **override sandbox-blocked**、advisor 代替で 10 findings |

委任成功率: 4/6 (apply_patch 成功)、2 件は Claude/advisor 巻取り。

## 主要ファイル (next phase reference)

### 新規 (Phase 23 で生成、Phase 24 で必読)

- `phase-handoff/phase-23-sprint-beta-recon-spot.md` (200 行) — spot RPC/RLS/helper/service 設計
- `phase-handoff/phase-23-recon-spot-onboarding-pipeline.md` (67 行) — onboarding 4 ケース pipeline
- `phase-handoff/phase-23-sprint-beta-recon-admin-invite.md` (160 行) — admin invitation 案 A 確定経緯
- `phase-handoff/phase-23-sprint-beta-recon-ci-e2e.md` (153 行) — CI E2E (Phase 25 用)
- `phase-handoff/phase-23-recon-branching-migrations.md` (~120 行) — Branching 案 B 確定
- `phase-handoff/phase-24-adversarial-review.md` (~130 行) — advisor による 10 findings + verdict
- `phase-handoff/phase-24-sprint-beta-day1-plan.md` (~180 行) — **plan v2 (実装直接対象)**

### 変更

- なし (Phase 23 は計画 Phase のため source code 変更ゼロ)

## データモデル変更

なし (Phase 23 計画 Phase)。Phase 24 で migration 26/27 番追加予定。

## API 契約

なし (Phase 23 計画 Phase)。Phase 24 で `respond_to_spot_invitation` RPC + `respondToSpotInvitation` service + `respondToInvitation` router + `verifyAndOnboardSpotInvitation` service 追加予定。

## テスト・QA 状況

- Phase 23 は計画 Phase のためテスト追加ゼロ
- baseline `pnpm test` 70/70 PASS (Phase 22 sealed 状態) 維持
- `pnpm typecheck` PASS 維持
- Phase 24 完了時の新 baseline: **82/82 PASS** (+12 ケース予定)

## 既知の懸念・TODO (Phase 24 着手前 / 並行)

- [ ] **spec/CLAUDE.md ADR-0010 補項追記** (user approve 済、plan v2 に文案あり): vendor invitation token verification/onboarding server route を service_role 利用境界に追加。Phase 24 実装と並行可、α/β 実装は spec 追記前でも開始可能
- [ ] **Phase 22 sealed 後の uncommitted 状態**: Phase 23 で生成した 7 ファイルを Phase 23 seal commit に含める (Phase 24 着手前 commit 推奨)
- [ ] **R-H-002 Codex sandbox 状況**: Phase 23 で 2 件完全 block、Phase 24 実装で Codex 委任率高い (α/β/δ-server/ε/η = 5/6 強制委任) ため、sandbox 復旧不安定なら Claude 巻取り発生見込み

## Phase 24 入力契約 (Sprint β Day 1 実装)

### 前提として動くべき機能

- Phase 22 全機能 (close_transport_order RPC + Sprint α-3 全機能)
- `pnpm test` 70/70 PASS が baseline
- `withAuthenticatedDb` / Phase 19/20/22 invariants 全継承

### 参照すべきファイル (実装着手時の最小 Read セット)

1. `phase-handoff/phase-24-sprint-beta-day1-plan.md` (本 plan v2、実装の source of truth)
2. `phase-handoff/phase-23-sprint-beta-recon-spot.md` (SQL skeleton α/β 用)
3. `phase-handoff/phase-23-recon-spot-onboarding-pipeline.md` (ε 4 ケース設計)
4. `phase-handoff/phase-24-adversarial-review.md` (実装中に refer すべき 10 findings)
5. `src/lib/db/raw-migrations/alpha-1-public/24_vendor_rpcs.sql` (RPC pattern)
6. `src/lib/db/raw-migrations/alpha-1-public/25_close_transport_order.sql` (Phase 22 pattern)
7. `src/lib/services/transport-orders.ts` (error class import 元、touch 禁止)

### 絶対に壊してはいけないもの (invariants)

- Phase 19/20/22 invariants 全継承
- `respond_to_transport_order(uuid,text,text)` RPC / `respondToTransportOrder` service / 6 error class 不変
- `withAuthenticatedDb` / `closeTransportOrderOnAllRejected` 不変
- 既存 raw-migrations 25 ファイル touch 禁止 (新規 26+)
- ADR-0010 service_role 境界遵守 (RPC 内 auth.admin 禁止)
- `pnpm test` 70 → 82 (減らない、増えるのみ)

### 推奨される Phase 24 スコープ

plan v2 §Sub-task 分解の α/β/γ/δ-server/ε/η を全完遂。詳細は plan v2 参照。

### 注意点

- Codex 委任率高 (5/6 強制委任)、sandbox 不安定時は Claude 巻取りに切替
- ADR-0010 補項を spec/CLAUDE.md に並行追記
- Phase 24 完了 = spot MVP DB/service 層完成、UI/E2E は Phase 25

## Codex ledger refs

- 詳細: `~/.claude/telemetry/delegation-ledger.jsonl` を 2026-05-24/25 範囲で grep
- 主要: spot recon / admin recon / CI E2E recon / spot onboarding pipeline / adversarial review override
- override 記録: del-20260525-010340-1895 (sandbox-blocked: windows spawn setup refresh during adversarial review)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| 追加ファイル数 | 7 (recon 5 + adversarial review 1 + plan v2 1) |
| 追加行数 | ~1100 (recon ~700 + review ~130 + plan ~280) |
| Codex 委任数 | 6 (4 success + 2 sandbox fail) |
| Codex 委任成功率 | 67% (4/6、sandbox fail 2 件は advisor/Claude 巻取りで補完) |
| advisor 呼出数 | 2 (plan 起草前 + adversarial review 代替) |
| user 判断数 | 6 (admin方針 / CI 戦略 / Sprint β scope / Branching 再 / case(c) / F1+F4+F8 = 3) |
| pnpm test | 70/70 維持 (Phase 23 計画 Phase なので変更ゼロ) |
| セッション数 | 1 (Phase 22 sealed → 23 連続) |
| 経過時間 | ~120 分 (recon 60 + adversarial 30 + plan 30) |

## Phase 振り返りメモ

- **うまくいったこと**:
  - advisor 1 回目の矛盾 3 件指摘で plan 急造を回避 → 追加 recon 2 本で上流潰し、結果 plan v2 が cleaner
  - Codex sandbox 失敗 2 件で Claude/advisor 巻取り運用が機能、品質維持
  - Codex adversarial review 失敗を advisor で代替できた (異プロセス独立判断、ある程度の第二意見性)
  - schema 差異 (vendor_users UNIQUE) を adversarial review 段階で発見、Phase 24 設計に反映
  - scope 再設計 (Phase 24/25 分割) で tight scope 回避、Phase 24 完遂見通し ~85min

- **次回改善したいこと**:
  - Codex sandbox R-H-002 が依然不安定。重要 review は最初から Bash 直接経路 + advisor の 2 系統並列で起動する検討
  - recon の品質チェック (sandbox 失敗による推論ベースの検出) を初期に組込む (Claude 補完が後回しになるとロス大)
  - plan v1 → v1.1 → v2 の 3 ラウンドは多い。v1 の段階で advisor で minimum check してから外に出す pattern を試行

---

*Generated by phase-handoff skill / Filled by Claude at Phase 23 seal (2026-05-25)*
