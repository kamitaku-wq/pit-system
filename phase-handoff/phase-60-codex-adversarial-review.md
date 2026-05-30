# Phase 60 Codex adversarial review

## Meta

| 項目 | 値 |
|---|---|
| Codex ledger ID | phase-60-adv-review-20260527 |
| 対象 plan | phase-60-admin-vendor-invitations-fk-plan.md v1 |
| 結論 | **CONDITIONAL-BLOCK** (BLOCK 2 + WARN 4 + NOTE 3) |
| 採用判断 | BLOCK 2 + WARN 4 採用後に plan v2 化推奨 |

## 結論サマリー

FK/migration/schema の主方向は Phase 59 pattern を正しく継承している。ただし D4 は `admin_vendor_invitations` 固有の INSERT/UPDATE surface が plan v1 の棚卸しより広く、観点 6 の active service test も raw INSERT fallback を許すと Phase 59 BLOCK-1 の趣旨を失う。実装前に棚卸し表と test acceptance を tighten するべき。

---

## BLOCK 項目 (採用必須)

### BLOCK-1: INSERT/UPDATE 棚卸しが漏れている

**指摘**: plan v1 は INSERT/UPDATE 棚卸しとして `createAdminVendorInvitation`、`tenant-isolation.test.ts:133-134/146-147`、callback finalize、expirer、audit trigger だけを列挙している (`phase-handoff/phase-60-admin-vendor-invitations-fk-plan.md:31-38`)。しかし実コード上は以下の経路が未棚卸し:

- `resendAdminVendorInvitation` が `admin_vendor_invitations` を UPDATE する (`src/lib/services/admin-vendor-invitations.ts:293-299`) — `set({ sentAt, lastResentAt })` のみ
- `revokeAdminVendorInvitation` も UPDATE する (`src/lib/services/admin-vendor-invitations.ts:335-347`) — set({ status: revoked }) のみ
- `tenant-isolation.test.ts` の audit smoke に追加 direct INSERT が存在する (`tests/integration/tenant-isolation.test.ts:202-224`)
- expirer fixture は `invited_by_user_id` omitted/NULL で Drizzle INSERT する (`tests/integration/tenant-isolation.test.ts:280-297`)
- `admin-vendors` service test も omitted/NULL INSERT を複数持つ (`tests/integration/services/admin-vendors.integration.test.ts:53-56`, `:91-104`)
- callback finalize test fixture も `invited_by_user_id` omit で INSERT する (`tests/integration/app/admin-invite-callback.integration.test.ts:95-104`)

**理由**: Phase 59 sealed は D4 着手前の独立 INSERT 棚卸しを明示要求している (`phase-handoff/phase-59-transport-order-invitations-fk-sealed.md:121-123`)。D4 の複合 FK は MATCH SIMPLE なので omitted/NULL INSERT 自体は壊れないが、棚卸しが「漏れなし」と言えないまま実装に入ると、既存 regression test の失敗原因切り分けと invariant 設計が曖昧になる。

**plan v2 採用**: 棚卸し表に少なくとも次を追加すること:

1. `resendAdminVendorInvitation` UPDATE — set({ sentAt, lastResentAt }) のみ、`invited_by_user_id` 不変
2. `revokeAdminVendorInvitation` UPDATE — set({ status: revoked }) のみ、`invited_by_user_id` 不変
3. `tenant-isolation.test.ts:202-224` — same-company `ADMIN_A` direct INSERT
4. `tenant-isolation.test.ts:280-297` / `admin-vendors.integration.test.ts:53-56,91-104` / `admin-invite-callback.integration.test.ts:95-104` — `invited_by_user_id` omitted=NULL 経路 → MATCH SIMPLE で継続 PASS する旨の期待値まで明記

---

### BLOCK-2: 観点 6 の cross-company 構築で raw INSERT fallback を許すべきではない

**指摘**: plan v1 の観点 6 は `createAdminVendorInvitation` same/cross-company を掲げる一方、「構築可能なら」および「もしくは raw INSERT で cross-company を直接 assert」と fallback を許している (`phase-handoff/phase-60-admin-vendor-invitations-fk-plan.md:136-137`)。しかし service は vendor company と `adminUser.companyId` を先に照合し (`src/lib/services/admin-vendor-invitations.ts:377-380`)、その後 companyId = context.adminUser.companyId / invitedByUserId = context.adminUser.userId で INSERT する (`src/lib/services/admin-vendor-invitations.ts:187-192`)。

**理由**: raw INSERT cross-company は観点 (i) と重複し、Phase 59 BLOCK-1 の「active insert path が新 FK 下で動くか証明する」趣旨 (`phase-handoff/phase-59-codex-adversarial-review.md:18-22`) を満たさない。D4 で検証すべきは「service 前段を bypass した manual `adminUser` でも、service 自体の INSERT が composite FK に捕捉される」こと。

**plan v2 採用**: 観点 6 は direct service call を必須にする。same-company は通常 fixture の `adminUser` で成功。cross-company は `adminUser.companyId = vendor.companyId` のまま `adminUser.userId` だけ別 company の public user id に差し替える manual `adminUser` を使い、`findVendor` の company guard を通過させた上で INSERT が FK 23503 になることを assert する。raw INSERT は観点 (i) のみで使う。

---
## WARN 項目 (採用推奨)

### WARN-1: D3→D4 差異の audit trigger を「不変検証対象 route」と呼ぶのは不正確

**指摘**: plan v1 は D4 差異として active service、callback finalize/expirer UPDATE、audit trigger を挙げている (`phase-handoff/phase-60-admin-vendor-invitations-fk-plan.md:44-49`)。active INSERT は実コード上も `createAdminVendorInvitation` が該当し (`src/lib/services/admin-vendor-invitations.ts:370-386`)、callback finalize は status/acceptedAt のみ UPDATE する (`src/app/(vendor-portal)/vendor/admin-invite-callback/finalize/route.ts:34-42`)、expirer は status/updatedAt のみ UPDATE する (`src/lib/inngest/functions/invitation-expirer.ts:8-21`) ので、主張の核は正しい。一方、audit trigger は AFTER INSERT/UPDATE/DELETE の side effect であり (`src/lib/db/raw-migrations/post/0011_phase31c_fixup_and_audit_trigger.sql:136-139`)、`invited_by_user_id` を更新する経路ではない。

**理由**: audit trigger は「FK 変更で壊れてはいけない副作用」として扱うべきで、「invited_by_user_id 不変の更新経路」と同列に置くと test の責務がぼやける。

**plan v2 採用**: D4 差異表は「UPDATE 不変対象: callback finalize / expirer / resend / revoke」「audit trigger: side-effect regression 対象」に分離する。

---

### WARN-2: Phase 59 の auth.users CTE contract と流用元 test の seed pattern が矛盾している

**指摘**: Phase 60 plan は auth.users CTE pattern を継承すると明記している (`phase-handoff/phase-60-admin-vendor-invitations-fk-plan.md:140,149`)。sealed input contract も同じ要求を持つ (`phase-handoff/phase-59-transport-order-invitations-fk-sealed.md:112`)。しかし流用元として指定された Phase 59 integration test の `seedUser` は `auth.users` INSERT 後に `public.users` を別 statement で INSERT しており、CTE ではない (`tests/integration/db/transport-order-invitations-fk.integration.test.ts:94-110`)。

**理由**: implementer が「Phase 59 test を完全流用」と解釈して `seedUser` をそのまま copy すると、Phase 60 plan 自身の CTE contract に反する。

**plan v2 採用**: 新規 `admin-vendor-invitations-fk.integration.test.ts` では Phase 59 test の seed helper を literal copy しない、と明記する。user seed は WITH auth_user AS (INSERT INTO auth.users ... RETURNING id) INSERT INTO public.users ... SELECT id ... の形に固定する。

---

### WARN-3: UPDATE 不変 assertion は callback/expirer だけでなく resend/revoke も対象に含めるべき

**指摘**: plan v1 の観点 7 は callback finalize と expirer の不変 assertion に限定されている (`phase-handoff/phase-60-admin-vendor-invitations-fk-plan.md:138,165-166`)。しかし admin invitation service には resend と revoke の UPDATE 経路がある (`src/lib/services/admin-vendor-invitations.ts:237-303`, `:306-350`)。既存 service integration test は resend/revoke の status/timestamp を見るが (`tests/integration/services/admin-vendor-invitations.integration.test.ts:182-219`, `:222-257`)、`invited_by_user_id` preservation は見ていない。

**理由**: Phase 59 WARN-2 は SQL inspection だけでなく実行時 assertion に落とす方針だった (`phase-handoff/phase-59-codex-adversarial-review.md:44-48`)。D4 でも「現状触っていない」だけでは将来 regression 捕捉として弱い。

**plan v2 採用**: 観点 7 を「UPDATE 不変 suite」として、少なくとも callback finalize / expirer / resend / revoke の 4 経路を assertion 対象にする。test count を +7 のまま維持するなら 1 it ブロック内の subcase でよい。

---

### WARN-4: Phase 59 sealed input contract の transport 側 invariants が plan v1 では暗黙継承に留まる

**指摘**: Phase 59 sealed は D4 でも accept_invitation_and_revoke_others() 不変、respond_to_spot_invitation() 不変を列挙している (`phase-handoff/phase-59-transport-order-invitations-fk-sealed.md:100-114`)。Phase 60 plan はこれら transport RPC 2 件の不変を「既修正 29 機能」以上には明記していない (`phase-handoff/phase-60-admin-vendor-invitations-fk-plan.md:156`)。

**理由**: Phase 60 の実装は transport RPC を触らない見込みなので実リスクは低い。ただし sealed input contract の「全不変条件を継承」という観点では、Phase 59 の regression test を維持実行することを明文化した方がよい。

**plan v2 採用**: invariants に `tests/integration/db/transport-order-invitations-fk.integration.test.ts` を既存 regression として維持し、accept_invitation_and_revoke_others / respond_to_spot_invitation の `invited_by_user_id` 不変を Phase 60 でも非退行条件として明記する。

---
## NOTE 項目 (任意)

### NOTE-1: migration 0020 SQL は 0019 の table/constraint 差替 clone として妥当

**評価**: 現行 base では単独 FK は invited_by_user_id uuid REFERENCES public.users(id) ON DELETE SET NULL なので (`src/lib/db/raw-migrations/post/0010_admin_vendor_invitations.sql:18`)、single-column FK drop の catalog query と整合する。`public.admin_vendor_invitations` は 0010 で作成済みなので `::regclass` も問題ない。

**plan v2 対応**: 採用 (pattern 維持)。追加するなら constraint 名だけ plan と schema で完全一致させること。

---

### NOTE-2: Drizzle onDelete omit pattern は正しく継承されている

**評価**: Phase 59 review の BLOCK-3 は Drizzle 側の onDelete omit と raw SQL authoritative を要求した (`phase-handoff/phase-59-codex-adversarial-review.md:30-34`)。Phase 60 plan は .references() 削除、table-level foreignKey()、.onUpdate(restrict) のみ、onDelete omit を明示している (`phase-handoff/phase-60-admin-vendor-invitations-fk-plan.md:117-125`)。

**plan v2 対応**: 採用 (pattern 維持)。

---

### NOTE-3: referenced user delete label は Phase 59 NOTE-2 と同じ注意が必要

**評価**: Phase 60 観点 (iv) は referenced user delete restricted として定義されている (`phase-handoff/phase-60-admin-vendor-invitations-fk-plan.md:134`)。vendor_id ON DELETE CASCADE (`src/lib/db/raw-migrations/post/0010_admin_vendor_invitations.sql:17`) とは別系統であることを test 名にも残すこと。

**plan v2 対応**: 採用 (label 維持)。

---

## Phase 60 行動方針

| 項目 | 内容 |
|---|---|
| **BLOCK-1** | INSERT/UPDATE 棚卸し表を拡張し、resend/revoke、tenant-isolation hidden INSERT、admin-vendors test、callback fixture、expirer NULL fixture を明記。MATCH SIMPLE で継続 PASS する旨の期待値まで書く |
| **BLOCK-2** | 観点 6 は direct service call + manual inconsistent adminUser を必須化し、raw INSERT fallback を削除 |
| **WARN-1** | D3→D4 差異表で audit trigger を side-effect regression 対象として分離 |
| **WARN-2** | 新規 test の user seed は auth.users CTE に固定し、Phase 59 helper literal copy を禁止 |
| **WARN-3** | 観点 7 を callback / expirer / resend / revoke の UPDATE 不変 suite に拡張 |
| **WARN-4** | Phase 59 transport RPC invariants と transport FK test 維持を Phase 60 invariants に明記 |
| **NOTE-1** | migration 0020 clone 方針は維持。constraint 名を plan と schema で完全一致させる |
| **NOTE-2** | Drizzle onDelete omit / .onUpdate(restrict) only 方針は維持 |
| **NOTE-3** | referenced user delete restricted label は維持。vendor cascade との分離を test 名に残す |

最終 test 観点数は **7** のままでよい。ただし観点 7 は single assertion ではなく UPDATE 不変 suite として複数経路 (callback finalize / expirer / resend / revoke) を持たせること。

---

*Codex adversarial review — Phase 60 plan v1 -> v2 化用 (2026-05-27)*