# Implementation Plan: Phase 31-A — Admin Foundation

## Phase Meta

| 項目 | 値 |
|---|---|
| 対象 Phase | 31-A (Foundation) |
| 前 Phase | Phase 30 sealed (2026-05-25) |
| 策定日 | 2026-05-25 |
| 推定セッション数 | 1 session (60-90 分) |
| branch | `phase-26-ci-verify` |
| DB migration | **0 件** (Phase 31-A はマイグレーションなし) |

## Overview

Phase 31-A は admin invite UI (Phase 31-B/C) の土台を作る。具体的には `/(admin)/*` ルートが現在 middleware で完全無保護なことを修正し、admin role 判定ヘルパーを新設し、3 つの 404 ルートを placeholder で解消し、sidebar の nav href バグを直す。DB migration ゼロ・既存テスト 87 PASS 維持が絶対条件。

## Prerequisites (実装開始前に確認)

1. `DATABASE_URL` が service_role 相当 (postgres 直接接続、RLS バイパス) かどうかを確認する。`src/lib/db/client.ts` の `postgres(databaseUrl)` は pg ドライバーを使うが、接続文字列に JWT や role 設定がない場合は `postgres` superuser として動作 → RLS バイパス。Supabase の `DATABASE_URL` は通常 transaction pooler (port 6543) で service_role key を埋め込む形式。**`roles` テーブルの `company_id=NULL` 行が Drizzle `db` から見えるかどうかを Step 1 実装前に確認すること**。見えない場合は onboard-action.ts パターン (service_role Supabase client) を採用する。

2. `spec/data-model.md §3.4` と実テーブルの乖離を把握しておく (実装には影響しないが混乱の源):
   - spec: `roles.key` → 実 SQL/Drizzle schema: `roles.code`
   - spec: role key `headquarters_admin` → `21_seed_master.sql` 実シード値: `code='admin'`
   - **実装は `roles.code = 'admin'` を使う**。spec は別途 doc fix が必要 (Phase 31-A スコープ外)。

## Design Decisions (設計判断 6 点)

### 1. Admin login route 設計

**採用: 既存 `/vendor/login` を再利用、`?next=` round-trip を追加**

admin 専用の `/admin/login` は作らない。middleware で `/admin/*` 未認証時に `/vendor/login?next=/admin/dashboard` へ redirect。login 成功後は `?next=` を消費して元の admin path へ戻す。

棄却した代替: `/admin/login` 追加 — UI の再実装コストと、既存 `/vendor/login` でも admin も業者も同じ Supabase Auth を使うため機能的に重複。Phase 31-B で branding 要件が出た場合のみ再検討。

**実装ポイント**: middleware で redirect URL に `?next=<pathname>` を付加する。ログイン後 redirect (現状 `/vendor/requests` 固定) は `/vendor/login` の server action 側で `next` param を読む必要がある。ただし Phase 31-A では middleware のみ変更し、login action の `next` 消費は **Phase 31-B スコープ** とする (理由: `/vendor/requests` へ redirect されてもその後手動で `/admin/dashboard` に遷移できる。`?next=` の完全実装は admin ログインを確認してから)。

### 2. Admin role 判定の DB 機構

**採用: 既存 `users` + `roles` テーブル、`roles.code = 'admin'` をチェック**

`is_admin` フラグ等の追加カラムは作らない (YAGNI、Phase 30-A 学び)。新規 SQL migration なし。判定ロジック: `users.id = auth.uid()` で users 行を取得し、`users.role_id` が紐付く `roles.code = 'admin'` であれば admin とみなす。

**注意**: シードの `roles.code='admin'` は `company_id=NULL` (システム標準ロール)。`19_rls_policies.sql` の roles policy は `company_id = current_user_company_id()` のみのため、`company_id=NULL` 行は authenticated ロールから不可視。Drizzle `db` が postgres 直接接続 (RLS バイパス) であれば問題ない。Prerequisites §1 で事前確認。

棄却した代替: `is_admin bool` カラム追加 — migration が必要、Phase 30-A の「具体的 UI 要件なしの先回り fix は YAGNI」に該当。

**延期**: 「store_manager も admin 画面にアクセスするか」の判断は Phase 31-B で行う。Phase 31-A では `'admin'` code のみ。

### 3. Middleware matcher 統合方法

**採用: 統合 matcher + 関数内で admin/vendor 分岐**

```ts
export const config = { matcher: ["/vendor/:path*", "/admin/:path*"] };
```

matcher を 2 エントリに拡張し、関数内で `pathname.startsWith('/admin/')` / `pathname.startsWith('/vendor/')` の分岐を追加する。

棄却した代替: 「admin のみ別ファイルの middleware」— Next.js は middleware.ts が 1 ファイルのみ (正確には設定で分けられるが複雑)。シンプルさを優先。

**リスク**: 既存 vendor ロジックに触れるため HIGH リスク。変更は最小限 (matcher 拡張 + admin 分岐追加のみ、vendor ロジックは行移動なし)。

### 4. AdminShell の server-side auth wrap

**採用: Option B — Server Component (layout.tsx) で getAdminUser + redirect**

`src/app/(admin)/layout.tsx` を `async` Server Component に変更し、`getAdminUser()` を呼ぶ。null なら `/vendor/login?next=/admin/dashboard` へ redirect。AdminShell コンポーネントは presentational のまま変更なし。

棄却した代替:
- Option A (middleware のみ): middleware は role check しない (DB query は edge で行わない)。auth のみ middleware、role check は layout で行う二段構えが正しい。
- Option C (middleware + layout 二重): YAGNI。middleware は auth のみ、layout は role のみと責務が明確に分かれているので二重チェック不要。

**cross-portal collision ケース** (out of scope、追跡のみ):
- `vendor_user` が `/admin/dashboard` にアクセス → `getAdminUser()` は `users` テーブルに行なし → null → `/vendor/login` redirect (正常)。
- `users` テーブルのユーザーが `/vendor/requests` にアクセス → `vendor_users` 行なし → 500 の可能性 (pre-existing bug、Phase 31-A スコープ外、TODO として記録)。

### 5. vendors/page.tsx placeholder の content

**採用: 純粋 placeholder ("業者一覧（実装予定）")、DB 呼び出しなし**

理由: `tenant-isolation.test.ts:105-110` の invariant「vendors is internal-admin only」を誤って侵害しないため。DB 呼び出しなし = RLS/policy 変更ゼロ = invariant 安全。Phase 31-C で本格実装。

同様に `customers/page.tsx` / `settings/page.tsx` も同時に placeholder 作成する (advisor 指摘: 3 ページの diff コストは 1 ページと大差なし)。

### 6. YAGNI チェック (Phase 31-A スコープ境界)

Phase 31-A に含めるもの:
- `src/lib/auth/admin-role.ts` (getAdminUser helper)
- `src/middleware.ts` (matcher 拡張 + admin 分岐)
- `src/app/(admin)/layout.tsx` (async + role check)
- `src/components/layout/admin-shell.tsx` (nav href バグ修正)
- 3 placeholder pages (vendors/customers/settings)
- unit test for getAdminUser

Phase 31-A に含めないもの (Phase 31-B/C):
- `admin_vendor_invitations` schema
- invite form / server action skeleton
- audit hook / 監査ログ
- resend / revoke / expire automation
- role tier 多段化 (store_manager 等への admin 拡張)
- `/vendor/login` の `?next=` 消費 (login action 側)
- vendor portal cross-portal 500 bug 修正

## Implementation Steps

### Phase 1: Core Infrastructure

#### Step 1: admin role check helper 新設

**File**: `src/lib/auth/admin-role.ts` (新規、~40 行)

**Action**:
- `createClient()` (supabase/server.ts) で `supabase.auth.getUser()` を呼びユーザー取得
- Drizzle `db` で `users` JOIN `roles` WHERE `users.id = uid AND roles.code = 'admin'`
- 成功なら `{ userId: string; companyId: string; roleCode: 'admin' }` を返す
- 失敗 / ロール不一致 / DB エラーは `null` を返す (throw しない)
- ファイル冒頭に `// server-only` コメントと ADR-0010 補項明記

**Pre-check (実装前)**:
```sql
SELECT * FROM roles WHERE code = 'admin';
-- company_id = NULL の行が返れば、Drizzle db (postgres直接) からも見える
```

もし `db` から roles が見えない場合、以下のパターンに切り替える:
```ts
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const adminSupabase = createClient(supabaseUrl, serviceRoleKey);
```

**概略 diff サイズ**: +40 行 (新規ファイル)
**Codex 委任**: YES (新規ファイル ~40 行、仕様は本プランで確定済)
**依存**: なし
**不変条件への接触**: なし (新規ファイル、既存テスト無関係)
**リスク**: MEDIUM — roles RLS 問題 (Prerequisites §1 で事前確認)

---

#### Step 2: middleware admin 保護追加

**File**: `src/middleware.ts` (変更、~+15 行)

**Action**:
1. `matcher` を `["/vendor/:path*", "/admin/:path*"]` に変更
2. pathname 判定変数追加:
   ```ts
   const isAdminPath = pathname.startsWith("/admin/");
   const isLoginPath = pathname === "/vendor/login";
   const isInvitationPath = pathname.startsWith("/vendor/invitations/");
   ```
3. 未認証時の redirect ロジックを `isAdminPath || (!isLoginPath && !isInvitationPath)` に拡張
4. `?next=<pathname>` を redirect URL に付加 (admin path の場合)
5. 既存 vendor ログイン後 redirect (`/vendor/requests`) はそのまま維持

**概略 diff サイズ**: ~+10 行変更
**Codex 委任**: NO — 既存 vendor middleware の動作に直接触れる HIGH リスク変更。Claude が直接実装
**依存**: Step 1 不要 (middleware は auth チェックのみ、role チェックは layout)
**不変条件への接触**: `/vendor/:path*` の動作 — matcher は維持されるため変動なし。redirect URL 生成ロジックに手を入れるため慎重に
**リスク**: HIGH — 既存 vendor portal の redirect が壊れると業者 login 不能になる。`pnpm test` で vendor-portal 関連テストを確認

---

### Phase 2: Layout Auth Wrap

#### Step 3: AdminLayout の async server component 化 + role check

**File**: `src/app/(admin)/layout.tsx` (変更、~+12 行)

**Action**:
```ts
import { redirect } from "next/navigation";
import { getAdminUser } from "@/lib/auth/admin-role";

export default async function AdminLayout({ children }: AdminLayoutProps) {
  const adminUser = await getAdminUser();
  if (!adminUser) {
    redirect("/vendor/login?next=/admin/dashboard");
  }
  return <AdminShell>{children}</AdminShell>;
}
```

- `AdminShell` は props 変更なし (presentational)
- `AdminLayoutProps` の type 定義は既存のまま維持

**概略 diff サイズ**: ~+8 行
**Codex 委任**: NO — 設計判断 (Option B 採用、redirect 先) を含むため Claude 直接
**依存**: Step 1 (getAdminUser が必要)
**不変条件への接触**: なし (layout 変更のみ、既存 dashboard/calendar page は変更なし)
**リスク**: MEDIUM — getAdminUser が誤って null を返すと全 admin ページが login loop に入る。Step 1 のユニットテストで動作を事前確認

---

### Phase 3: Navigation Fix + Placeholder Sweep

#### Step 4a: admin-shell.tsx nav href バグ修正

**File**: `src/components/layout/admin-shell.tsx` (変更、~5 行変更)

**Action**: `navigationItems` の href を `/admin/` prefix 付きに修正:
```ts
{ label: "Dashboard", href: "/admin/dashboard", icon: LayoutDashboard },
{ label: "カレンダー", href: "/admin/calendar", icon: Calendar },
{ label: "顧客", href: "/admin/customers", icon: Users },
{ label: "業者", href: "/admin/vendors", icon: Wrench },
{ label: "設定", href: "/admin/settings", icon: Settings },
```

**概略 diff サイズ**: 5 行変更 (href 値のみ)
**Codex 委任**: YES (機械的変更)
**依存**: なし (Step 2/3 と順序不問)
**不変条件への接触**: なし
**リスク**: LOW

---

#### Step 4b: 3 placeholder pages 作成 (404 解消)

**Files** (各新規、~8 行):
- `src/app/(admin)/vendors/page.tsx`
- `src/app/(admin)/customers/page.tsx`
- `src/app/(admin)/settings/page.tsx`

**Action** (vendors を例に):
```tsx
export default function AdminVendorsPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-semibold">業者一覧</h2>
        <p className="text-sm text-gray-600">（Phase 31-C で実装予定）</p>
      </div>
    </div>
  );
}
```

DB 呼び出しなし。`vendors` テーブルの SELECT ゼロ (tenant-isolation invariant 安全)。

**概略 diff サイズ**: +24 行 (3 ファイル合計)
**Codex 委任**: YES (ボイラープレート)
**依存**: なし
**不変条件への接触**: なし
**リスク**: LOW

---

### Phase 4: Test

#### Step 5: getAdminUser unit test

**File**: `tests/unit/lib/auth/admin-role.test.ts` (新規、~50 行)

**Action**:
- vitest + mock
- テストケース:
  1. `supabase.auth.getUser()` が user を返す + `db` が admin role 行を返す → `{ userId, companyId, roleCode: 'admin' }` を返す
  2. `supabase.auth.getUser()` が null → `null` を返す
  3. `db` が user を返すが role code が `'manager'` → `null` を返す
  4. `db` が例外を throw → `null` を返す (graceful degradation)

**概略 diff サイズ**: +50 行
**Codex 委任**: YES (tests/unit/ 配下 10 行以上 = 強制委任パス)
**依存**: Step 1
**不変条件への接触**: vitest スイートに追加 (87 → 90+ PASS 期待)
**リスク**: LOW

---

#### Step 6 (Optional): Middleware admin matcher smoke test

**File**: `tests/unit/middleware-admin-matcher.test.ts` (新規、~40 行)

**Action**:
- `/admin/dashboard` への未認証 request → `/vendor/login?next=/admin/dashboard` redirect を assert
- `/vendor/requests` への未認証 request → `/vendor/login` redirect を assert (既存動作の回帰確認)
- matcher に `/admin/:path*` が含まれるかを config から確認

**概略 diff サイズ**: +40 行
**Codex 委任**: YES (tests/ 配下)
**依存**: Step 2
**不変条件への接触**: 既存 vendor middleware の回帰テストを兼ねる
**リスク**: LOW

---

#### Step 7: Verification Pass

**Action**:
1. `pnpm test` → 87+ PASS, 0 FAIL を確認
2. `pnpm typecheck` → clean を確認
3. 手動確認:
   - `/admin/dashboard` に未認証アクセス → `/vendor/login` redirect (middleware)
   - 業者 vendor_user でログイン後 `/admin/dashboard` アクセス → `/vendor/login` redirect (layout の getAdminUser = null)
   - admin role の users でログイン → `/admin/dashboard` 表示
   - sidebar の nav リンクが `/admin/*` prefix で正しく機能
   - `/admin/vendors` `/admin/customers` `/admin/settings` が 404 でなく placeholder 表示

**Codex 委任**: NO
**依存**: Steps 1-6 全完了後

---

## Invariant Crosscheck

| 不変条件 | 触れる Step | 判定 |
|---|---|---|
| vitest 87 PASS 維持 | Step 5/6 でテスト追加 → 件数増加のみ | 安全 (追加のみ) |
| typecheck clean | Step 1-4 の型整合 | Step 1 で型を明示的に定義、リスク LOW |
| alpha-1-public 27+28+29 ファイル touch 0 | Phase 31-A は migration なし | 安全 |
| `vendor portal /vendor/requests` 完動 | Step 2 (middleware 変更) | HIGH RISK → 変更は matcher 追加+admin分岐のみ、vendor ロジック行は移動しない |
| 公開 API シグネチャ (respondToInvitation 等) | 無関係 | 安全 |
| `tenant-isolation.test.ts:105-110` vendors invariant | Step 4b — vendors/page.tsx は DB 呼び出しなし | 安全 |
| ADR-0010 service_role 利用範囲 | Step 1 で service_role 使う場合は補項に追記 | 追記必須 |

---

## Risk Table

| リスク | レベル | Mitigation |
|---|---|---|
| Middleware 変更で vendor portal redirect が壊れる | HIGH | Step 2 は Claude 直接実装。変更は matcher 追加と admin 分岐のみ。既存 vendor if/else ブロックを一切移動しない。Step 7 で手動 vendor login 確認 + vitest 全件確認 |
| roles.code='admin' の company_id=NULL 行が Drizzle db から不可視 (RLS 問題) | MEDIUM | Prerequisites §1 で事前確認。不可視の場合は onboard-action.ts の service_role pattern に切り替え (実装量変化は最小) |
| getAdminUser が誤って null を返し admin ページ全体が login loop | MEDIUM | Step 5 ユニットテストで動作保証。Step 7 で手動確認 |
| admin-shell.tsx の href 修正で dashboard/calendar がリンク切れ | LOW | href の付け替えのみ。`/admin/dashboard` と `/admin/calendar` は既存 page.tsx があるため 404 にならない |
| spec の roles.key/headquarters_admin 表記で実装者が混乱 | LOW | 本プランの Prerequisites §2 に明記。実装は roles.code='admin' を使う |
| vendor_user が admin layout に到達し 500 エラー | LOW | getAdminUser は users テーブル row が存在しない場合に null を返す設計 → redirect で安全にハンドル。Step 5 テストケース 2 でカバー |

---

## Definition of Done (DoD)

- [ ] `pnpm test` が 87 件以上 PASS、0 FAIL
- [ ] `pnpm typecheck` clean
- [ ] `src/middleware.ts` の matcher に `/admin/:path*` が含まれる
- [ ] 未認証状態で `/admin/dashboard` にアクセスすると `/vendor/login` に redirect される
- [ ] vendor_user (業者) が認証済みで `/admin/dashboard` にアクセスすると `/vendor/login` に redirect される (role check)
- [ ] admin role ユーザーが `/admin/dashboard` を表示できる
- [ ] `/admin/vendors` `/admin/customers` `/admin/settings` が 404 でなく placeholder を表示する
- [ ] AdminShell sidebar のナビゲーションリンクが `/admin/*` prefix で正しく動作する
- [ ] alpha-1-public SQL ファイルの変更 0 件
- [ ] 新規 SQL migration ファイル 0 件 (post/ 配下も含む)
- [ ] vendor portal `/vendor/requests` の動作が Phase 30 sealed 時と同一 (Step 2 回帰確認)
- [ ] `tenant-isolation.test.ts` の PASS/FAIL 変化なし

---

## Doc Issues (Phase 31-A スコープ外、別途修正)

1. `spec/data-model.md §3.4`: `roles.key` → `roles.code` に修正が必要 (実 SQL は `code`)
2. `spec/data-model.md §3.4`: role key `headquarters_admin` → `21_seed_master.sql` 実値は `code='admin'`。spec の role key 設計と seed 値の整合を確認・修正
3. `spec/CLAUDE.md` ADR-0010 補項: Phase 31-A で service_role を `getAdminUser()` に使う場合、補項を追記

---

## 推定セッション数

**1 session (60-90 分)** で完了可能。

内訳:
- Steps 1/4a/4b/5/6: Codex 委任 (並列可)
- Steps 2/3/7: Claude 直接 (順次)
- Step 2 が最も時間がかかる可能性あり (既存動作の手動確認)

Codex 委任対象: Step 1 (helper), Step 4a (nav fix), Step 4b (3 placeholders), Step 5 (unit test), Step 6 (smoke test) — 合計 ~180 行

Claude 直接: Step 2 (middleware, ~10 行変更), Step 3 (layout, ~8 行変更), Step 7 (verification)

---

## Phase 31-B への引き継ぎ契約

Phase 31-A 完了後、Phase 31-B (Invite Core) の入力契約:
- `getAdminUser()` が動作し `AdminUser | null` を返す
- `/(admin)/*` は middleware + layout の二層で保護済
- `src/app/(admin)/vendors/` ディレクトリ存在 (31-B で invite page を追加)
- `admin_vendor_invitations` schema は **未定義** (31-B で migration を追加)
- vitest 87+ PASS / typecheck clean / CI E2E 4 passed 維持

---

*Generated by planner agent / Phase 31-A Foundation plan — 2026-05-25*
