# Phase 38 入力契約: Phase 31-D sealed (Inngest expirer + admin E2E + middleware fix)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 38 (前: 31-D sealed) |
| 状態 | Phase 31-D sealed / Phase 31 (admin invite lifecycle) 全工程完了 |
| 完了日時 | 2026-05-26 |
| 担当 | Claude (resume + planner + Codex adversarial + advisor + S0 middleware + 全 S verify + Edit 修復) / Codex (S1 + S2 + S3 4 task) |
| 前 handoff | `phase-37-phase-31-d-plan.md` (plan)、`phase-37-codex-adversarial-review.md` (Codex review)、`phase-36-phase-31-c-sealed.md` (前 Phase 完了) |
| 主要 commit | `799c899` |

## 達成したこと (Phase 31-D)

- **S0 middleware fix**: `/vendor/admin-invite-callback` を未認証 exempt に追加。Phase 31-B 漏れの本番バグ修正 (Codex Critical C1 発見)
- **S1 invitation-expirer.ts**: Drizzle bulk UPDATE による hourly cron `runExpireOnce` named export + Inngest `invitationExpirer` 登録 (`client.ts` 配列に追加)
- **S1 unit test**: 3 ケース (対象あり / 0 行 / WHERE spy)、`vi.hoisted` + `vi.mock('@/lib/db/client')` パターン
- **S1 integration test**: NULL safe expire + audit_logs actor_kind='system' assert (D-1 + H2 必須化)
- **S2 seed-admin-e2e.ts**: admin role lookup を `isNull(roles.companyId)` 化 (Codex Critical C2 反映)、`crypto.randomUUID()` で email/company 一意化、compensating auth user delete
- **S3 admin-vendor-invite.spec.ts**: 3 test (admin login via `?next=` / invite form / vendor accept via `generateLink + redirectTo`)、inline callback URL (server-only 回避)
- **vitest**: ローカル 104 PASS (env 必要な tenant-isolation 8 個 collect 不可、想定 109 → 114 PASS) / typecheck clean
- **Codex adversarial review**: 3 Critical + 4 High を検出 → plan に S0 + D-5/D-6 修正 + integration 必須化 + UUID 一意化を反映

## Claude 側の主要設計判断

1. **三層レビュー継続**: planner → Codex adversarial → advisor 三層で Phase 31-C 同様の steel-manned plan。Codex の Critical 3 件 (middleware exempt / global admin role / generateLink redirectTo) を実ファイル verify で全件採用
2. **S0 を Phase 31-D scope に追加**: Phase 31-B の middleware exempt 漏れは本番 latent bug。E2E 着手の前提条件 → scope creep ではなく precondition fix として 1 commit に含める
3. **runExpireOnce 分離 export**: Inngest Dev Server なしで vitest 直接 invoke 可能にする (D-2)。outbox-dispatcher は raw `postgres()` を使うが expirer は Drizzle `db` で十分 (bulk UPDATE は atomic で idempotent)
4. **integration test を必須化**: Codex H2 指摘採用。mock の `db.update` では NULL-safe SQL を verify できない → tenant-isolation.test.ts に NULL 行残置 assert ケース追加
5. **generateLink を inline URL に**: `getCallbackUrl()` は `server-only` import を含むため E2E spec から呼べない → `${BASE_URL}/vendor/admin-invite-callback` で組み立て (Codex C3 / advisor 推奨)
6. **describe.serial vitest bug 修復**: Codex が vitest に存在しない `describe.serial` を使用 → Claude が Edit で `describe` に修正 (Playwright spec の `test.describe.serial` とは別もの)
7. **createSupabaseAdminClient 整合**: Codex 初期出力に `autoRefreshToken/persistSession: false` 欠落 → vendor-portal-loop.spec.ts のパターンに揃えて Edit 修復
8. **commit 1 個に集約**: Phase 31-C と同じ 1 commit ポリシー。9 files / 677 insertions

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260525-162400-1c11 | adversarial review (sandbox write fail → Claude が transcript から再構成) | applied (reconstructed) |
| del-20260525-164044-df2e | S1: expirer + client.ts + unit test + integration test | applied (Edit で `describe.serial` 修復) |
| del-20260525-165045-3d5d | S2: seed-admin-e2e helper | applied (typecheck clean) |
| del-20260525-165510-b709 | S3: admin-vendor-invite E2E spec | applied (Edit で auth options 追加 + unused import 削除) |

## 主要ファイル (Phase 39 reference)

- `src/middleware.ts` — admin-invite-callback exempt 追加済、Phase 32 以降の admin path 拡張時は同様の判定追加要
- `src/lib/inngest/functions/invitation-expirer.ts` — `runExpireOnce(db)` を直接呼べる
- `src/lib/inngest/client.ts` — `inngestFunctions` 配列 (新 cron 追加時はここに register)
- `tests/_helpers/seed-admin-e2e.ts` — `SeededAdminE2E` 型を export、admin 系 E2E 全般で再利用可
- `tests/e2e/admin-vendor-invite.spec.ts` — admin → vendor 招待フロー E2E、Phase 32 以降の admin 画面追加時は同パターンで spec 追加
- `tests/integration/tenant-isolation.test.ts` — admin_vendor_invitations 監査 + expirer ケース統合
- `phase-handoff/phase-37-phase-31-d-plan.md` — 8 設計判断 + S0-S3 ステップ詳細
- `phase-handoff/phase-37-codex-adversarial-review.md` — 3 Critical + 4 High 詳細

## データモデル変更

- **なし** (Phase 31-D は migration 追加 0、schema 変更 0、status UPDATE のみ)
- post を `redact_audit_payload` SoT とする運用維持 (ADR-0010 補項)

## API 契約

- 公開 service API 不変 (respondTo* 3 + createAdminVendorInvitation + resend/revoke/list の計 6 関数)
- 新規 export: `runExpireOnce(database?: typeof db): Promise<{expired: number}>` (`src/lib/inngest/functions/invitation-expirer.ts`)
- 新規 export: `seedAdminE2E(db, supabaseAdmin) → SeededAdminE2E` / `cleanupAdminE2E(db, supabaseAdmin, seeded)` (`tests/_helpers/seed-admin-e2e.ts`)
- 新規 Inngest function: `invitationExpirer` (id: "invitation-expirer", cron: "0 * * * *")
- middleware 拡張: `isAdminInviteCallbackPath` 判定 (1 path のみ)

## テスト・QA 状況

- vitest unit: **101 + 3 = 104 PASS / 0 FAIL** (ローカル、DATABASE_URL なし) ✓
- vitest integration (tenant-isolation.test.ts): **要 DATABASE_URL**。env 設定済環境で **想定 109 + 5 = 114 PASS** (Phase 31-C 109 + S1 unit 3 + integration 2)
- typecheck (`pnpm tsc --noEmit`): clean ✓
- CI E2E: **未走** (Phase 31-A + 31-B + 31-C + 31-D 統合検証は次 push で確認)
- 手動 verify (dev server): **未実施** (PR push 統合検証へ defer)
- migration: 追加なし

## 既知の懸念・TODO (Phase 39 スコープ候補)

- **CI E2E 統合検証**: branch `phase-26-ci-verify` を push して Phase 31-A + 31-B + 31-C + 31-D の累積で CI green を確認 — **最優先候補**
- **`admin-vendor-invite.spec.ts` 実走**: env (`PLAYWRIGHT_BASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `DATABASE_URL`) 整備後、ローカル or CI で初回実走 → flake 確認
- **Inngest Cloud 統合検証**: 本番デプロイ後の cron 動作確認 (`invitation-expirer` 毎時実行)
- **resend で取得した vendor_users.authUserId が未使用** (Phase 31-C 残置): 後段リファクタで削除可
- **revoke 後の vendor session 強制失効未実装**: `auth.admin.signOut(userId)` を Phase 32 以降で検討
- **vendor portal cross-portal 500 bug** (pre-existing): `users` テーブルユーザーが `/vendor/requests` → vendor_users 0 行 → 500
- **Phase 31 全工程完了** — 残るは検証 + 次 sprint (β-2 or γ) の planning

## Phase 38 入力契約

### 前提として動くべき機能 (env 設定済環境)
- admin 招待リンクが `/vendor/admin-invite-callback` 経由で受諾可能 (S0 middleware fix)
- Inngest hourly cron `invitation-expirer` が `expires_at < now() AND status IN ('pending','sent')` を `expired` 更新、audit_logs に `actor_kind='system'` で記録
- E2E spec が admin login (`?next=`) → invite → vendor accept (`generateLink + redirectTo`) → `/vendor/requests` 全て PASS
- vitest 114 PASS / typecheck clean (env 設定済)

### 参照すべきファイル
- 本 handoff (`phase-38-phase-31-d-sealed.md`)
- `phase-37-phase-31-d-plan.md` (plan + 8 設計判断 + Codex+advisor review)
- `phase-37-codex-adversarial-review.md` (3 Critical + 4 High 詳細)
- `phase-36-phase-31-c-sealed.md` (前 Phase 完了)
- `src/middleware.ts` (admin path 拡張時はここを参照)
- `src/lib/inngest/functions/invitation-expirer.ts` (新 cron 追加時のパターン)

### 絶対に壊してはいけないもの (invariants)
- vitest 109 + 5 = **114 PASS** (env 込み) / typecheck clean
- alpha-1-public 27/28/29 ファイル touch 0
- 公開 API シグネチャ (6 service 関数) 不変
- `tests/integration/tenant-isolation.test.ts` の admin_vendor_invitations + expirer invariant
- post を `redact_audit_payload` SoT とする運用 (ADR-0010 補項)
- `getAdminUser()` signature / middleware admin matcher + `?next=` + admin-invite-callback exempt
- `inngestFunctions` 配列の 3 関数登録 (outboxDispatcher + inboxWorker + invitationExpirer)

### 推奨される次 Phase スコープ
- **Phase 39 候補 A (最優先)**: CI E2E 統合検証 (Phase 31-A〜D 累積で green 確認)
- **Phase 39 候補 B**: Sprint β-2 or γ の planning (Phase 31 完了後の次 sprint 定義)
- **Phase 39 候補 C**: vendor portal cross-portal 500 bug の修正

### 注意点・コンテキスト
- branch: `phase-26-ci-verify`、Phase 31-D commit `799c899` は Phase 31-C `8ea306e` の上
- Phase 31-D Codex 委任率 ~85% (Claude 直接: S0 middleware + S1 integration の describe.serial 修復 + S3 軽微修復)
- Phase 31-B latent bug を Codex review で発見 (middleware exempt 漏れ) — Phase 完了前の adversarial review 価値を再確認
- E2E spec の `generateLink` は sandbox の場合 dev DB で重複アカウント存在で `email_taken` エラー可能性 — `auth.admin.deleteUser` cleanup が重要

## Codex ledger refs

- del-20260525-162400-1c11 (adversarial review, sandbox write fail → reconstructed by Claude)
- del-20260525-164044-df2e (S1 expirer + tests, Edit で `describe.serial` 修復)
- del-20260525-165045-3d5d (S2 seed-admin-e2e, applied clean)
- del-20260525-165510-b709 (S3 E2E spec, Edit で auth options + unused import 整理)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 31-D commit 数 | 1 (`799c899`) |
| 追加コード行数 | 677 insertions / 1 deletion |
| 新規ファイル | 6 (middleware diff + expirer + client.ts diff + seed-admin-e2e + E2E spec + integration tests + 2 handoff) |
| 修正ファイル | 3 (middleware / client.ts / tenant-isolation.test.ts) |
| 追加テスト数 | 5 (unit 3 + integration 2、env 込み想定) |
| Codex 委任 task 数 | 4 (adversarial + S1 + S2 + S3) |
| Codex 委任行数 | ~580 (~85%) |
| Claude 直接 | S0 middleware (3 行) / describe.serial 修復 / E2E 軽微 Edit / plan + review 文書 |
| advisor 呼び出し | 1 回 (Codex review 後の reconcile) |
| Codex adversarial review | 1 回 (approve_with_changes、3 Critical + 4 High) |
| planner agent | 1 回 (plan 作成) |
| セッション数 | 1 (Phase 31-C sealed → Phase 31-D sealed) |

## 振り返りメモ

- うまくいった: Codex adversarial で Phase 31-B latent bug (middleware exempt 漏れ) を発見、本番に出る前にキャッチ
- うまくいった: 実ファイル verify (middleware.ts / seed_master.sql / admin-vendor-invitations.ts) で Codex Critical 3 件を全件採用判断
- うまくいった: S2 → S3 を Codex に分離委任、各 ~150 行を Claude 待ち最小化
- 課題: vitest と Playwright の `describe.serial` を Codex が混同 (Playwright のみ存在)。次回 spec 委任時にプロンプト先頭で明示
- 課題: Codex sandbox の adversarial review が write fail (Windows sandbox)、Claude が transcript + 自己検証で artifact 再構成 (~70 行)
- 学び: Phase 31-D 8 設計判断のうち 5 件が Codex review 反映 (D-5/D-6 + S0 + integration 必須 + UUID 一意化)、planner 単独 plan より steel-manned
- 学び: handoff 188 行で 200 行制約内 OK。ledger 4 件 + 詳細は別 review ファイルに分離

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-26 (Phase 31-D expirer + admin E2E + middleware fix 完了 / Phase 31 ライフサイクル全工程完了)*
