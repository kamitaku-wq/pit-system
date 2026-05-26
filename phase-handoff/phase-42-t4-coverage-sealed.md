# Phase 43 入力契約: Phase 42 T4 audit 残 3 件 sealed (test 拡充で固定)

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase 番号 | 42 (前: 41 sealed) |
| 状態 | **sealed** (typecheck clean / unit 35 / integration 88 PASS) |
| 完了日時 | 2026-05-26 |
| 担当 | Claude (plan + scope 確定 + Codex bug fix + commit) / Codex (2 件委任: admin-invite-callback test 新規 / admin-vendor-invitations test 修正) |
| 前 handoff | `phase-41-recon-sealed.md` |
| Branch | `phase-42-t4-test-coverage` (commit `5d40904`) |

## 達成したこと (Phase 42)

- **T4-#2**: resend test に outbox 不変 assertion 追加 — Codex 委任 a63e
  - design 確定: resend は Supabase 経由再送、outbox は create 時のみ作成
  - assertion: idempotency_key 一致 / outbox.id 不変 / length=1
- **T4-#3 (a)**: `admin-invite-callback/finalize` の integration test 新規作成 (199 行) — Codex 委任 a4d5
  - vendor-invitation-callback test を mirror、401/404/200 + accepted 遷移検証
  - Claude が cleanup bug (vendorUser=false ケースで空文字 UUID DELETE) を 2 行で修正
- **T4-#3 (b)**: admin-vendor-invitations test に「accepted invitation の revoke 拒否」追加 — Codex 委任 a63e
  - status='accepted' を強制 UPDATE → revoke 呼び出し → InvalidStateError rejects 確認
- **T4-#4**: spec 確認で `revoked_at` は要求外と確定
  - spec/data-model.md に admin_vendor_invitations 自体の定義なし (Phase 31-B で追加だが spec 更新漏れ、audit-schema-drift-2026-05-24.md と整合)
  - revoke test に updated_at 変化 assertion 追加、service に設計意図 2 行コメント
- **整数 commit**: `test(phase-42): T4 audit 残 3 件 (outbox/state transition/revoked_at) 解消` (commit `5d40904`)

## Claude 側の主要設計判断

1. **advisor で scope 確認 (的中)**: 「test 拡充」という handoff 文言を鵜呑みにせず audit 発生源を特定 → #4 が schema gap を含むこと、#2/#3 は test 追加で完結することを切り分け
2. **T4-#4 を design 確定として close**: spec/data-model.md に admin_vendor_invitations の定義がなく `revoked_at` も要求されていないことを確認 → migration 追加せず updated_at で追跡する design を確定、service に 2 行コメントで明示
3. **Codex 委任を 2 並列**: admin-invite-callback test (新規) と admin-vendor-invitations test (修正) は別ファイル、依存なしで並列実行可能
4. **Codex bug を Claude が引き取り**: a4d5 が `vendorUser: false` ケースの cleanup を空文字 UUID で DELETE しようとして失敗 → 2 行の修正なので 1 回フィードバックループを省略して Claude が直接 fix (品質ガードレール §5.5 「1 回フィードバックして改善なければ引き取り」運用)

## Codex 委任成果

| 委任 ID | 内容 | 状態 |
|---|---|---|
| del-20260526-072945 (a4d5) | admin-invite-callback/finalize integration test 新規 199 行 | applied (cleanup bug を Claude が 2 行で修正) |
| del-20260526-073156 (a63e) | admin-vendor-invitations test に 3 変更 (T4-#2/#3b/#4 assertion 追加) | applied (45 insertions / 3 deletions、全 PASS) |

**Codex sandbox 状態**: shell spawn 失敗は依然だが apply_patch 経路で 2/2 安定。Phase 41 で確立した「post-delegation 実体確認」が Codex bug 検出に有効と再確認。

## Phase 41 + Phase 42 累積 fix リスト

| # | 起源 | 修正 Phase | 内容 |
|---|---|---|---|
| 1-7 | Phase 31-A/B/C/D | 39-40 | (phase-40-recon-sealed.md 参照) |
| 8 | Phase 25 | 41 | vendor/invitations/callback 同型脆弱性 |
| 9 | Phase 40 (test infra) | 41 | admin-vendors test 1 mock → real DB |
| **10** | Phase 40 (T2 audit) | **42** | T4-#2/#3/#4 audit 残 3 件解消 (test 拡充で固定) |

## 残課題 / Phase 43 todo

- **本番デプロイ前の Supabase URL Configuration 更新**: Site URL を local → 本番 URL、Redirect URLs に `/vendor/admin-invite-callback` `/vendor/invitations/callback` 追加 (Phase 41 から継続)
- **`probe-invite-link.ts` を CI に組み込むか?** invite flow regression 検出に有用 (Phase 41 から継続)
- **UI 未実装**: Phase 41 で surface した UI/login 未実装、Phase 43+ で着手検討
- **vendor 側 E2E 拡張**: `probe-invite-link.ts` パターンで callback も叩く E2E 追加 (Phase 41 から継続)
- **spec/data-model.md に admin_vendor_invitations 定義追加**: audit-schema-drift-2026-05-24.md でも検出済の漏れ、spec 側更新タスク
- **Codex shell spawn 制約**: plugin upstream の Windows 制約、Claude 側で fix scope 外
- **branch merge**: `phase-42-t4-test-coverage` → `phase-26-ci-verify` への merge は未実施

## Phase 43 入力契約

### 推奨される次 Phase スコープ
1. **UI 実装着手** (Phase 41/42 で繰り返し surface、別 Phase の可能性大)
2. **本番デプロイ準備** (Supabase URL Configuration + Vercel/host 設定)
3. **spec/data-model.md 整備** (admin_vendor_invitations 等の Phase 31 以降追加分の定義追加)
4. **vendor 側 E2E 拡張** (probe-invite-link パターンで callback E2E 追加)

### 参照すべきファイル
- 本 handoff (`phase-42-t4-coverage-sealed.md`)
- `phase-41-recon-sealed.md` (前 Phase、T1 ルールあり)
- `tests/integration/app/admin-invite-callback.integration.test.ts` (Phase 42 新規)
- `tests/integration/services/admin-vendor-invitations.integration.test.ts` (Phase 42 修正)
- `src/lib/services/admin-vendor-invitations.ts` (Phase 42 コメント追加箇所、revoke 設計意図)
- `~/.claude/rules/common/codex-collaboration.md` §2.5 d (Phase 41 T1 ルール、Codex shell spawn 制約)

### 絶対に壊してはいけないもの (invariants)
- 既修正 10 bug すべてに retrogression なし
- typecheck clean / vitest unit 35 PASS / integration 88 PASS
- CI E2E 7/7 PASS (Phase 43 で初 CI 確認時に維持)
- `admin_vendor_invitations.status` の遷移ルール: pending/sent → accepted (callback finalize) / revoked (revoke service) / expired (将来), accepted から revoked への遷移は禁止
- `revoked_at` column は schema に追加しない (spec 要求外、updated_at で追跡)
- outbox は createAdminVendorInvitation 時のみ作成、resend では再生成しない

### 注意点・コンテキスト
- branch: `phase-42-t4-test-coverage` (commit `5d40904`)、`phase-26-ci-verify` への merge は未実施
- Phase 42 commit は 1 件 (T4 + admin-invite-callback test 新規)
- Codex sandbox: shell spawn 失敗だが apply_patch 経路で安定 (Phase 41/42 で 8/8 applied)
- DATABASE_URL 環境変数があれば全 integration test が green、なければ describeIntegration が skipIf

## Codex ledger refs

- del-20260526-072945-a4d5 (admin-invite-callback test 新規、applied + Claude cleanup bug 修正)
- del-20260526-073156-a63e (admin-vendor-invitations test 3 変更、applied)

## 主要メトリクス

| 指標 | 値 |
|---|---|
| Phase 42 commit 数 | 1 (`5d40904`) |
| 変更ファイル | 2 M + 1 A = 3 files |
| 新規ファイル | 1 (admin-invite-callback integration test、199 行) |
| 修正済 latent bug | 1 (#10 T4 audit 残 3 件 — 累積 10) |
| advisor 呼び出し | 1 回 (scope 確認、設計判断含む audit の切り分け) |
| Codex 委任 task 数 | 2 (test 修正 1 + test 新規 1) |
| Codex sandbox-blocked 率 | 0/2 (apply_patch 経路で安定) |
| Claude 側修正 (Codex 出力) | 1 (cleanup bug、2 行) |
| integration test 件数 | 84 → 88 (+4: admin-invite-callback 3 + accepted revoke 1) |

## 振り返りメモ

- **advisor の貢献**: 1 回呼び出しで「audit 発生源を確認してから着手」を採択 → T4 が design gap (#4) と test gap (#2/#3) の混在と確定。spec 確認で #4 が「migration 追加」ではなく「設計確定 + コメント」で済むことが分かり Phase 42 scope を最小化
- **Phase 41 T1 ルール「post-delegation 実体確認」が再び機能**: Codex 自動 apply の通知 (`applied: true`) を盲信せず、Claude が typecheck + vitest を手元で実行 → Codex が漏らした cleanup bug (空文字 UUID DELETE) を発見、2 行で修正。Phase 41 で確立した運用が定着
- **委任プロンプトの精度向上**: a4d5 と a63e のプロンプトで「apply_patch を使う」「shell 書込指示しない」「typecheck/vitest を実行しない」を明示 → Codex は instruction 通り apply_patch のみで完了、shell spawn 失敗は発生せず。Phase 41 で得た知見が再現
- **spec drift の確認が scope 決定の鍵**: spec/data-model.md に admin_vendor_invitations の定義がないことを確認しないと、`revoked_at` の migration 追加で Phase 42 が肥大化していた可能性。advisor 「audit 発生源を確認」助言が scope creep を防いだ

---

*Generated by phase-handoff skill / Sealed by Claude at 2026-05-26 (Phase 42 完了、累積 10 bug 全消化 + T4 audit 全項目クローズ)*
