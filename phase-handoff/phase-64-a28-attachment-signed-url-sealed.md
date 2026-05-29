# Phase 64-A.28 attachment signed URL (Storage 連携) sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-A.28 (前: A.27 per-action token foundation) |
| 状態 | **sealed** (a26-b Storage signed URL 確定設計の実装 / 419 tests PASS) |
| 担当 | Claude (advisor #1 gate で設計 adversarial 検証 + cancel-premise reconcile、自実装) |
| Branch | `phase-64-mvp-implementation` |
| **/clear 推奨** | **推奨** (A.29 = 別 MVP タスク。fresh context 望ましい) |

## 当初予定からの変更 (重要・記録)

A.27 handoff は A.28 = modify/cancel route を予定していたが、**着手時調査で前提が崩れ、ユーザー判断で A.28 = Storage signed URL に振り替えた**。経緯:

- **cancel-as-statusId の前提が誤り**: A.27 handoff / advisor 初回は「cancel は statusId → 'cancelled' で有界・clean」と仮定。しかし調査で **reservation の 'cancelled' status は seed されておらず、key 集合もコード/spec のどこにも定義されていない** ことが判明 (transport status のみ 0013 trigger で seed、reservation/service/vendor は spec §21_seed_master で「いつか」と計画されるのみ、test は ad-hoc に手作り)。さらに spec §918 は cancelled ≠ deleted、reservations に `cancelled_at` 列もなし。
- **結論**: customer-cancel を statusId で表現するには **reservation status model (key 集合 + per-company seed + transitions)** が必要だが存在しない。その一次 consumer は予約作成・vendor/staff workflow (どちらも未実装) で、customer-cancel ではない。customer-cancel から bottom-up に作ると状態機械を間違った consumer を軸に焼き込む (A.25/A.27 規律が防ぐアンチパターン)。
- **ユーザー判断**: customer-cancel を defer、A.28 = a26-b で設計確定済みの Storage signed URL に振り替え (consumer = A.22 attachments admin 詳細画面、非投機的)。
- **A.29 以降への申し送り**: customer modify/cancel は **reservation status model を別 phase で確立した後**に着手する。modify は変更可能フィールドが spec 未定義 (日時変更なら lane 空き・営業時間・競合再チェックを巻き込む非有界) のため、これも spec 化が前提。

## 達成したこと

a26-b 確定設計 (全社 1 private bucket + service_role signed URL TTL 5 分) の実装。

- **service** `src/lib/services/attachment-download.ts` (新規):
  - `issueAttachmentSignedUrl(id, ctx, opts)`: ① ownership gate (`getAttachmentById` の WHERE company_id = ctx.companyId、A.22 canonical) + deleted_at チェック (getAttachmentById は deleted_at を filter しないため **load-bearing**) → ② defense-in-depth (canonical bucket 一致 + `{companyId}/` prefix + path traversal `..`/leading `/` 拒否、違反は `console.error` で構造的事実のみ server-log し client には generic `invalid_storage_path`) → ③ service_role storage client で signed URL 発行 (TTL 5 分)
  - `ATTACHMENTS_BUCKET` (SSOT、既定 `attachments`、env `ATTACHMENTS_STORAGE_BUCKET` 上書き可)、`SIGNED_URL_TTL_SECONDS` (300)、`buildAttachmentStorageKey()` (key SSOT)、`StorageSigner` (注入可能、テスト容易性)
  - 戻り型: `{ ok:true; url; expiresInSeconds; fileName; contentType } | { ok:false; reason }` discriminated union
- **server action** `src/app/admin/attachments/[id]/actions.ts`: `issueAttachmentDownloadUrlAction(id)` (getAdminUser gate → service)。signed URL は on-demand POST で発行、SSR HTML に埋め込まない (短命 URL leak 回避)
- **UI** `download-button.tsx` (新規 Client Component) + `[id]/page.tsx`: detail page の旧プレースホルダ文言 (「MVP は signed URL 発行を含みません」) を「ダウンロード URL を発行 (5 分有効)」ボタンに置換。click → action POST → `window.open(url)`、URL は DOM に保持しない。失効済み行はボタン非表示
- **tests** (+8) `tests/integration/services/attachment-signed-url.integration.test.ts` (新規): happy / cross-tenant→not_found / soft-deleted→not_found / bucket mismatch→invalid_storage_path / prefix mismatch→invalid_storage_path / path traversal→invalid_storage_path / null signer→storage_unavailable / signer error→sign_failed。**fake signer 注入のため gate ロジックを検証、実 Supabase 署名は検証しない** (テストファイル冒頭に明記)
- **spec drift 解消**: data-model.md §12.1 を signed URL 発行 + bucket 名確定 + invariant + audit deferral で更新 (a26-b deferred 項目クローズ)

## 主要設計判断 (advisor #1 gate 反映)

1. **defense-in-depth は単一 bucket の核心防御**: 全社 1 bucket = service 層 ownership バグが cross-tenant read に直結。row.company_id は WHERE で保証済みだが、storageKey が別 company prefix を指す corruption/cross-tenant 試行を署名前に拒否 + server-log
2. **prefix を read で強制 / write で非強制** (411-test invariant 維持で `registerAttachment` 不改修): **footgun**。Phase 4 upload helper は必ず `buildAttachmentStorageKey()` で key を組むこと (さもなくば全 download が silent fail)。SSOT builder + 本 invariant で緩和
3. **signed URL on-demand**: SSR HTML に埋めず click 時 POST。短命 URL が prefetch/unfurl/log/cache に焼かれる leak を回避
4. **audit 意図的 deferral**: PII 露出を伴うが監査ログなし (A.24 と同 rationale: audit_logs.action CHECK が read 発行に map しない)。**silent omission ではなく記録された deferral**
5. **bucket 名を SSOT で確定**: a26 が「Phase 4 で確定」と deferred していた値を `attachments` に確定。service check と下記 bucket 作成コマンドが同一定数を参照 (drift すると全 download 失敗)

## §再現手順 (DoD — Storage bucket 作成、spec §Storage bucket policy 再現手順規律 #5)

canonical bucket `attachments` を **private** で作成する。直接アクセス全 deny = private bucket + storage.objects に public/anon/authenticated 向け RLS policy を**作らない** (service_role は RLS bypass で signed URL 発行可能)。最も再現性の高い SQL RPC:

```sql
-- Supabase SQL editor / mcp execute_sql / psql で実行 (冪等)
insert into storage.buckets (id, name, public)
values ('attachments', 'attachments', false)
on conflict (id) do nothing;
```

- `public = false` で直接 URL アクセス不可。
- storage.objects への select policy を追加しない (service_role のみが read/sign 可能な posture を維持)。
- env: 既定値 `attachments` を使う場合 `ATTACHMENTS_STORAGE_BUCKET` の設定は不要。別名にする場合は **アプリ env と本 SQL の双方**を同名に揃える (SSOT drift 防止)。
- ※ bucket 未作成でもアプリは起動・テストは通る (fake signer)。実 signed URL は本 bucket 実在 + `SUPABASE_SERVICE_ROLE_KEY` 設定時のみ動作。

## adversarial gate チェックリスト (#1 gate、a26-b で発火指定済み)

| # | 条件 | 該当する具体的変更 |
|---|---|---|
| 1 | raw-migration 変更 | なし (bucket は SQL RPC、migration ファイル外) |
| 2 | 新規署名鍵 / session 機構 | なし (Supabase 既存 service_role 署名を利用) |
| 3 | 手書き RLS / Storage bucket policy 新規 | **該当**: private bucket 新規 + 全 deny posture (policy は「作らない」設計)。Storage read 境界の新設 → advisor #1 gate 実施済 |
| 4 | 金銭計算 / billing | なし |
| 5 | 既存 canonical 外の cross-tenant boundary | なし (A.22 verifyParentOwnership / company-scoped getAttachmentById canonical を踏襲) |

→ #1 gate: advisor 1 回目 (設計 adversarial 検証、audit-deferral / server-log / SSOT footgun / bucket 名確定の 4 点を指摘 → 全反映) + reconcile 1 回 (cancel-premise 誤りの突き合わせ)。確認軸: cross-tenant→not_found / prefix-mismatch→invalid_storage_path+server-log / soft-deleted→not_found を test で固定済み。

## invariants (A.29 で壊さない)

- typecheck clean / **419 tests PASS** (411 + 8 signed URL)
- **download prefix 強制**: signed URL 発行は `{companyId}/` prefix + canonical bucket + no-traversal を必須。Phase 4 upload は `buildAttachmentStorageKey()` SSOT 必須
- signed URL は on-demand 発行・SSR 非埋め込み・TTL 5 分
- bucket 名 SSOT (`ATTACHMENTS_BUCKET`) と bucket 作成 SQL の同名維持
- A.22 cross-tenant parent ownership / company-scoped getAttachmentById 不変
- DB 真実採用 (ADR-0011) / use-case service placement (ADR-0011): Storage 連携は別ファイル `attachment-download.ts` に分離 (DB metadata CRUD の `attachments.ts` を pure に維持)

## A.29 着手時の選択肢 (要ユーザー判断 or roadmap 参照)

- customer modify/cancel は **reservation status model 確立後** (本 phase の申し送り)
- 他の Phase 4 未実装: 顧客予約作成フロー UI (車番→日時→確認→完了、token 発行の一次 consumer)、Cloudflare Turnstile 多層防御 (a26-c で β-3 束ね確定)、予約完了通知メール flow
- a26-b の Storage は本 phase で完了。残る a26 確定設計は (c) Turnstile (β-3)

## メトリクス

| 指標 | 値 |
|---|---|
| commit | 本 seal 1 |
| 変更ファイル | service 1 (新規) + action 1 + UI 2 (button 新規 + page) + test 1 (新規) + data-model 1 = 6 |
| 新規 tests | +8 (signed URL gate) → 419 |
| advisor | 2 (#1 gate 設計検証 1 + cancel-premise reconcile 1、blocker/誤前提を各反映) |
| ユーザー判断 | 2 (A.28 スコープ cancel-only → 前提訂正後 Storage signed URL に振替) |
| Codex 委任 | 0 (高 stake cross-tenant boundary + 設計密度高、Claude 自実装) |

*Phase 64-A.28 sealed / Generated by Claude 2026-05-29 / 次: A.29 (要 /clear。customer-cancel は reservation status model 後)*
