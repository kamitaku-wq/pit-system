# Phase 25 Plan v1 Adversarial Review

> Codex Windows sandbox 失敗 (sandbox-blocked, del-20260525-031448-088e rejected) のため Claude が直接 source-backed で執筆。Phase 24 review の F1-F10 calibration を踏襲。

## Findings (severity 順)

### F1: [BLOCKER] middleware の `/vendor/invitations/[token]` carve-out が欠落 → δ-ui が永遠に動かない

- 該当: §δ-ui / Open Q #1
- 根拠: `src/middleware.ts:50-59` 現状 `isLoginPath = pathname === "/vendor/login"` のみ未認証許可。matcher は `["/vendor/:path*"]` (line 72) で `/vendor/invitations/[token]` も対象。未認証ユーザーが token URL を踏むと line 53-59 で `/vendor/login` に redirect される
- 影響範囲: δ-ui 全動作不可。case (a) の onboarding email 経路 (`inviteUserByEmail` mail → token URL クリック) で **token クリック時点ではブラウザ未認証** のため必ず login に飛ばされる
- 推奨修正: Open Q #1 を「sub-task ζ-mw」に格上げ。middleware に `const isInvitationPath = pathname.startsWith("/vendor/invitations/")` を追加、`!user && !isLoginPath && !isInvitationPath` に変更

### F2: [HIGH] callback URL を `/auth/callback` に変更すると Phase 24 invariant 抵触

- 該当: §F10 / Open Q #2
- 根拠: `src/lib/services/spot-onboarding.ts:235` で `redirectTo` が `/vendor/invitations/callback` に焼き込み済。Phase 24 handoff §「verifyAndOnboardSpotInvitation 不変」と「既存 raw-migrations 27 ファイル touch なし」が invariant
- 影響範囲: plan v1 の「`/auth/callback` に統一するか」検討は spot-onboarding.ts L235 編集 = Phase 24 焼き込みの後方変更。invariant の文字通りの違反ではないが、scope 局所化の精神に反する
- 推奨修正: **Q#2 は (B) `/vendor/invitations/callback/route.ts` 新規作成で確定**。spot-onboarding.ts touch なし。admin invitation も含む統一 callback への refactor は Phase 26 以降

### F3: [HIGH] δ-ui page.tsx の冪等性 (vendors INSERT 重複) が未設計

- 該当: §δ-ui
- 根拠: `spot-onboarding.ts:243-253` で case (a) は毎回 `vendors` INSERT 走る。findAuthUserByEmail (line 240) は auth.users 重複は避けるが、`vendors` 自体は UNIQUE 制約なし (推測)。同 token を 2 回 GET すると vendors row 2 件 + vendor_users INSERT で `vendor_users_vendor_id_email_unique` (`vendor_users.ts:28`) を踏んで失敗
- 影響範囲: ユーザーが page リロード / メール再クリック / preview 確認等で page が複数回開かれた場合、初回後は実装エラー。「冪等性 = onboardSpotInvitationAction を複数回叩いても同結果」が前提だが現状破綻
- 推奨修正: page.tsx の case 'new' 経路で、`transport_order_invitations.responded_at IS NOT NULL` (= 既に onboarding 走った) を pre-check して短絡 return するか、`onboardSpotInvitationAction` 内で `vendors WHERE email = ... AND company_id = ...` 既存 lookup を入れる。Plan v2 で sub-task ε-patch として明記

### F4: [HIGH] ζ の error class import path 整合性

- 該当: §ζ
- 根拠: `src/app/(vendor-portal)/vendor/requests/[id]/actions.ts:8-16` で 6 error class を `@/lib/services/transport-orders` から import。Phase 24 handoff §「既存 6 error class 再利用」と spot-invitations.ts 175 行内で `transport-orders` から re-import している (handoff §「typecheck 修正で transport-orders から re-import」)。router 経由でも spot error (`VendorCrossTenantError` 等) が actions.ts まで伝播する経路が不明
- 影響範囲: spot invitation の reject 経路で `VendorCrossTenantError` が throw された時、actions.ts:50-65 switch のどの case にも当たらず default の `throw e` で uncaught に。500 エラーで UI fallback
- 推奨修正: ζ scope に「`VendorCrossTenantError` の switch case 追加 + error → redirect mapping」を明示。または `respondToInvitation` router が spot error を投げる条件を再確認し、registered/spot を意識せず汎用 error class に正規化

### F5: [MEDIUM] F10 callback の auth context (RLS or service_role)

- 該当: §F10
- 根拠: plan v1 は「`supabase.auth.exchangeCodeForSession` → session 取得 → vendor_users UPDATE (service_role 不要、Supabase server client)」とするが、`vendor_users.is_active=false` 状態で RLS policy が UPDATE を許可するか未検証。`vendor_users` の RLS policy が `is_active=true` 前提なら自己更新で詰まる
- 影響範囲: callback route が UPDATE 失敗で is_active flip できず、無限ループ (login 直後に再度 onboarding URL に飛ばされる)
- 推奨修正: `19_rls_policies.sql` で `vendor_users` の UPDATE policy を確認。flip 操作のみ service_role 経由 (ADR-0010 補項の対象 route として明示扱い) にするか、UPDATE policy を見直し。Plan v2 で sub-task として明示

### F6: [MEDIUM] E2E case (a) の inviteUserByEmail bypass 方法 (Q#3)

- 該当: §θ / Open Q #3
- 根拠: plan v1 で「seed 段階で auth.users 先作成 bypass」と提案。spot-onboarding.ts:240-262 で `findAuthUserByEmail` が hit すれば `inviteUserByEmail` は skip される。これで E2E は実メール送信なしで spot accept まで到達可能
- 推奨修正: **Q#3 は「seed で `auth.admin.createUser({ email_confirm: true, password: '<test-temp>' })` 先作成 + Playwright で `signInWithPassword` 経由 login」で確定**。`generateLink` は recovery flow が複雑なので MVP では避ける

### F7: [MEDIUM] Q#4 (Branching DIRECT_URL) は Phase 25 で未解決のまま着手することになる

- 該当: §ι / Open Q #4
- 根拠: `phase-23-recon-branching-migrations.md:96, 101` で **「DIRECT_URL を branch から取得できるか = pooler ではなく direct connection が必要、Branching API が出すのは pooler URL の可能性 → verify 必要」**を Phase 24 plan で確定すべき Unresolved として明示。Phase 24 では確定されず、Phase 25 plan v1 でも Open Q として残置
- 影響範囲: ι 着手後に DIRECT_URL 取得不可だと判明した場合、CI workflow 全体を Strategy C (dedicated staging DB) に切替が必要 = Phase 25 内で 0.5 day 追加リスク
- 推奨修正: ι 着手前に **branching の preview branch を 1 つ手動作成 → connection string 取得して port 5432 (DIRECT) が出るか verify** を spike として実施。これは plan v2 の前提条件 (実装着手 Gate) に追加

### F8: [LOW] `last_login_at` 更新の atomicity

- 該当: §F10
- 根拠: callback route で `is_active=true` + `last_login_at=now()` を 1 UPDATE で実行する想定だが、plan v1 で明示なし
- 推奨修正: 1 UPDATE で書く明示と DoD に追加 (些細だが Plan 規律)

### F9: [LOW] θ E2E case (c) の seed cost

- 該当: §θ
- 根拠: case (c) cross-tenant は別 company の vendor_user 先作成が必要 → seed が 2 tenants 分作る = `vendor-portal-loop.spec.ts` の既存 single-tenant seed pattern より複雑
- 推奨修正: seed helper を `seed-vendor-spot-e2e.ts` (case a 用) と分離して `seed-vendor-cross-tenant-e2e.ts` を別ファイル化、test ファイル内で beforeAll 切替

### F10: [LOW] θ で `pnpm test:e2e` script 未確認

- 該当: §θ
- 根拠: plan v1 で `pnpm test:e2e` 呼び出し前提だが、`package.json` の scripts 定義は未確認 (`vendor-portal-loop.spec.ts` 既存だが Playwright script 名は不明)
- 推奨修正: ι 着手前に `package.json` scripts 確認、なければ `pnpm playwright test` で代用

---

## Open Q 4 件への独立判断

| Q | 確定回答 | 根拠 |
|---|---|---|
| #1 middleware patch | **必須 sub-task (ζ-mw として実装順序 0 番目)** | F1 BLOCKER |
| #2 callback URL | **`/vendor/invitations/callback/route.ts` 新規作成 (B案)** | F2 |
| #3 E2E bypass | **seed で `auth.admin.createUser({ email_confirm: true, password })` + signInWithPassword** | F6 |
| #4 DIRECT_URL | **ι 着手前に手動 spike で verify、不可なら Strategy C fallback** | F7 |

## plan v1 で見落とされている追加 Open Q

1. **F3 由来**: page.tsx 冪等性 — リロード/再クリック耐性をどう保証するか (短絡 lookup / responded_at 検査 / Server Action のみで GET 拒否)
2. **F4 由来**: spot reject 経路で `VendorCrossTenantError` のような spot 固有 error が actions.ts switch に到達した時の UI 表現 (新規 error code 追加 or 汎用 invalid_input にマージ)
3. **F5 由来**: callback route の DB アクセスを withAuthenticatedDb 経由 (RLS) と service_role 経由のどちらにするか — F10 は UPDATE 1 件のため service_role overkill だが、is_active=false 状態 RLS が UPDATE を許すか要確認

## 実装順序の妥当性

plan v1 の `ζ → F10 → δ-ui → ι → θ` は **0 番目に ζ-mw (middleware patch) を追加して 6 stage に修正**:

1. **ζ-mw** (middleware patch) — δ-ui の動作前提
2. **ζ** (actions.ts router 統合) — 軽量、regression ゲート
3. **F10** (callback route) — δ-ui の redirectTo 先確定
4. **δ-ui** (page.tsx + 冪等性対策)
5. **θ ローカル** (E2E 2 ケース、CI なしで先行)
6. **ι** (CI Branching, DIRECT_URL spike 後)

## 委任戦略の妥当性

plan v1 表は妥当。追加 **ζ-mw は Codex 強制** (機械的 patch、Claude review)。**F5 RLS verify は Claude 必須** (DB security 判断)。

## Phase 25 全体の Go/No-Go 判定

- **条件付き Go**
- 主要な条件:
  1. ζ-mw を sub-task 化 (Q#1 確定済)
  2. Q#2/Q#3 を上記独立判断で plan v2 に反映
  3. ι 着手前に Branching DIRECT_URL spike (~30 分) 実施し Strategy C fallback 判断
  4. δ-ui 冪等性 (F3) の設計判断を Plan v2 に追加
- 確信度: **medium-high** (F7 DIRECT_URL は spike 結果次第で plan が変わる)

---

## plan v1 → v2 必須修正サマリ

1. **F1**: middleware patch を ζ-mw sub-task 化、実装順序 0 番目
2. **F2/Q#2**: callback URL `/vendor/invitations/callback` で確定、F10 sub-task のファイル path 修正
3. **F3**: δ-ui 冪等性対策を ε-patch or page.tsx 内で明記
4. **F4/F5**: ζ の error class 補強 + F10 RLS verify を sub-task に
5. **Q#3**: E2E bypass を seed `createUser + signInWithPassword` で確定
6. **Q#4/F7**: ι 着手 Gate に DIRECT_URL spike を追加 (実装着手 Gate)
7. **F8/F9/F10 (LOW)**: DoD / seed 分離 / package.json scripts 確認を該当 sub-task に微修正

## Phase 24 review との重複/再発

- F6 (`is_active=false` 明示) → Phase 25 Plan v1 でも前提として継承 (handoff §「明示 INSERT」+ spot-onboarding.ts:286 で確認、再発リスクなし)
- F10 (`last_login_at` 経路) → Phase 25 で sub-task F10 として正式対応 (再発ではなく繰越完遂)
- F1-F5 (Phase 24 spot 固有) → Phase 25 plan v1 では既に Phase 24 で解消済を前提に書かれており、再発リスクなし
