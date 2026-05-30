# Phase 23 / Sprint β Recon: admin vendor invitation UI/API (rewritten)

> **重要**: 初版 (Codex sandbox 失敗で推論ベース) を Claude が実コード調査して全面 source-backed 化。

## 1. 現状調査 (source-backed)

- **admin shell 既存**: `src/app/(admin)/layout.tsx` = `AdminShell` wrap。`(admin)/dashboard/page.tsx` / `(admin)/calendar/page.tsx` 既存。AdminShell コンポーネントは `@/components/layout/admin-shell` (Phase 20 で確認)。
- **vendor_invitations 専用テーブル不在**: grep 結果は本 recon ファイル自身のみ hit。spec/data-model.md も §7.10 `transport_order_invitations` のみ定義、独立した vendor 招待テーブルは未定義。
- **Supabase Admin API 利用実績あり**: `scripts/seed-vendor-dev.ts` (356 行、`admin.createUser` pattern)、`tests/_helpers/seed-vendor-e2e.ts`。SDK 利用は実証済。
- **Resend は outbox 経由のみ**: `src/lib/inngest/functions/outbox-dispatcher.ts` で利用。spec/CLAUDE.md "Resend 直叩き禁止" 規律により、メール送信は `notification_outbox` INSERT → Inngest dispatcher が送る。
- **vendor 関連既存 UI**: vendor portal (Phase 20) のみ。admin 側の vendor 管理 UI は未実装。
- **seed-vendor-dev は dev/staging 専用**: `NODE_ENV=production` ガードで production 利用禁止。

## 2. spec/requirements/data-model での仕様

- **spec/requirements.md §A (518-523)**: 招待 3 パターン明記 = 直接指名 / 複数同時打診 / **スポット業者 (token URL 経由)**。admin による vendor user 事前招待は明示記述 **なし**。
- **spec/data-model.md §7.10 (833-)**: `transport_order_invitations` テーブル定義。`invitee_email/name/phone` (v2.2)、`invitation_token_hash text UNIQUE`、`invitations_target_check (vendor_id NOT NULL OR invitee_email NOT NULL)`。
- **spec/data-model.md 943 (決定的)**: 「**未登録業者の場合**: 招待 URL からアクセス → 受諾時に **Supabase Auth 招待メール送信** → vendor_users 登録 → bound_vendor_id / bound_vendor_user_id セット → transport_orders.vendor_id セット」。
- **spec/data-model.md §3.6 vendor_users**: `id = auth.users.id` (trigger 同期)、UNIQUE(email)、vendor_id/company_id 整合性 trigger。
- **spec/CLAUDE.md 規律**: 業者ポータルは vendor_users 認証、auth.users 直叩き禁止 / Resend 直叩き禁止 (outbox 経由必須)。
- **結論**: spec 上は **spot invitation 経由の自動 onboarding が唯一の正規 vendor user 作成経路**。「admin が vendor user を事前に招待する UI」は spec 拡張機能となる。

## 3. 推奨 invitation flow (3 案比較、spec 整合性軸)

| 案 | 概要 | spec 整合性 | 業務適合性 | Pros | Cons |
|---|---|---|---|---|---|
| **A. spot accept 時自動作成 (spec 通り)** | 既存 transport_order_invitations + spot RPC 経由で初回 accept 時に auth 招待メール送信 → vendor_users 自動 INSERT | ◎ spec 明示準拠 | △ 「事前に vendor を準備」できない | spec 整合、新規 schema 不要 | 業務フロー上「先に vendor 登録」要件があれば不足 |
| **B. admin invitation UI 追加 (spec 拡張)** | admin が `vendors` + `vendor_users` を事前作成 + auth invite 送信 | ○ spec 非明示だが矛盾せず | ◎ 業務的に自然 | UI で管理可、運用しやすい | 新規 server action + 監査 + RLS 拡張必要 |
| **C. A + B 併存** | spot accept 時自動 + admin 事前招待の両経路 | ○ | ◎ | 柔軟 | 複雑性増、両経路の整合性テスト必須 |

**推奨**: spec source of truth では **A 単独で要件達成可能**。しかし業務上 admin が登録済 vendor の追加メンバー招待 / 事前準備をするのは自然な要件。**Phase 24 plan で User judgment を仰ぐ分岐ポイント**。

技術的には A の方が小さい (spot RPC + auth invite hook のみ)、B は admin shell + 新 schema が必要。Sprint β スコープなら A を MVP 採用、B は Sprint γ 以降に拡張が無難。

## 4. admin UI 案 (B 採用時のみ)

- Route: `src/app/(admin)/vendors/invite/page.tsx` + `src/app/(admin)/vendors/page.tsx` (一覧)。既存 `(admin)/` shell に組込。
- 画面構造: vendor 一覧 (vendor name / 専属 company / vendor_users 数 / 作成日) / 招待フォーム (vendor 選択 or 新規 + 招待 email + role)。
- 状態表示: pending / sent / accepted / expired / revoked / failed。
- アクション: send / resend / revoke。copy invite link は監査要件次第。
- admin shell の現 navigation に「業者管理」リンクを追加 (vendor-shell.tsx と admin-shell.tsx の差分参考)。

## 5. server action / API 案

### 案 A (spec 通り、spot accept 時 auto-create)

spot RPC (`respond_to_spot_invitation`) の accept 経路に組込:
1. `vendor_users` に existing row 不在チェック (`lower(email)` match)
2. 不在なら Supabase `auth.admin.createUser({ email, email_confirm: false })` で `auth.users` 作成
3. `vendor_users` INSERT (`id = auth.users.id`, vendor_id = ..., email, name)
4. `notification_outbox` INSERT (template = `vendor_first_invite`、Inngest dispatcher が Resend で送信)

→ **spot recon の RPC skeleton (§2) を拡張する形**。Sprint β 計画で spot RPC と統合検討。

### 案 B (事前 admin invitation)

```ts
export async function createAdminVendorInvitation(input: {
  vendorId: string;
  email: string;
  name: string;
  role?: "vendor_admin" | "vendor_member";
}): Promise<{ invitationId: string; userId: string; status: "sent" }>
```

処理:
1. admin role check (server-side)
2. email normalize + duplicate check (`vendor_users` + 新 `admin_vendor_invitations`)
3. Supabase `auth.admin.inviteUserByEmail(email, { redirectTo })` 推奨 (password set link 自動発行)
4. `vendor_users` INSERT (auth.users.id 紐付け、`is_active=false` で初期)
5. `admin_vendor_invitations` INSERT (status='sent', expires_at, token_hash)
6. `notification_outbox` INSERT で welcome メール (auth の invite link を template に埋込)
7. accept 後 callback で `vendor_users.is_active=true` + invitation `accepted`

## 6. Schema 影響

- **案 A**: 新規 schema **なし**。`vendor_users` への INSERT path が増えるのみ。
- **案 B**: `admin_vendor_invitations` 新規テーブル要 (vendor_id / email / role / status / token_hash / expires_at / sent_at / accepted_at / created_by / 共通 audit)。

案 A は migration ゼロ、案 B は migration 1 件追加 (`26_admin_vendor_invitations.sql` 想定)。

## 7. RLS / 認可

- admin role 判定: spec/CLAUDE.md は users + roles + permission_keys pattern (existing)、`(admin)/` 配下は既存 middleware で保護されているはず (要確認)。
- 案 B の `admin_vendor_invitations`: admin role のみ SELECT/INSERT/UPDATE。vendor 側参照は accept 後 callback のみ。
- service_role 使用範囲: spec/CLAUDE.md ADR-0010 で「Inngest worker / migration / 顧客 token 検証 / 監査クリーンアップに限定」。auth.admin.* は server-only。

## 8. Vendor 側 first-login flow

両案共通:
1. メール内 invite link を vendor がクリック (Supabase auth callback URL)
2. password set or magic link auth 完了
3. `vendor_users.is_active=true` + `last_login_at` 更新 (trigger or callback action)
4. `/vendor/requests` redirect (案 A なら直接、案 B は onboarding step 経由)

middleware は既存 `/vendor/:path*` matcher で session refresh 既実装 (Phase 20)。

## 9. Test 種別

### 案 A (spec 通り)
- spot accept で email 未登録 → auth.users + vendor_users 自動作成 + notification_outbox INSERT
- spot accept で email 既登録 vendor_users あり → 再利用 (重複作成しない)
- auth invite メール送信失敗 (outbox failed) → transaction rollback or compensating action 確認
- regression: 既存 spot RPC test (recon #1 §7) を維持

### 案 B
- admin 以外 createAdminVendorInvitation → 403
- admin が valid input → auth.users + vendor_users (inactive) + admin_vendor_invitations 全作成
- duplicate pending invite → deterministic 422 or 409
- accept callback で vendor_users.is_active=true、invitation.status='accepted'
- E2E: admin が invite フォーム送信 → vendor がリンクで accept → /vendor/requests 到達

## 10. 既存 invariants 違反チェック

- Phase 19 invariants: `respond_to_transport_order` RPC / `respondToTransportOrder` service / 6 error class **不変** (案 A は spot RPC のみ拡張、案 B は無関係)
- Phase 20 invariants: `withAuthenticatedDb` / vendor portal route / seed-vendor-dev (email/password) **不変**
- Phase 22 invariants: `closeTransportOrderOnAllRejected` / `close_transport_order` RPC **不変**
- spec 規律: Resend 直叩き禁止 (両案とも outbox 経由)、auth.users 直叩き禁止 (vendor_users 経由)
- `pnpm test` 70/70 維持

## 11. 段階分割案・既知の懸念

### MVP (Sprint β 推奨スコープ)
- **案 A 採用**: spot RPC (recon #1) の accept 経路に auth invite + vendor_users 自動作成を統合
- 新規 schema ゼロ、spec 明示準拠
- integration test +3-4 (上記 §9 案 A 全件)

### Extension (Sprint γ 以降)
- 案 B (admin shell に vendor 管理 UI 追加)
- resend / revoke / expire automation
- 監査ログ / 招待履歴一覧
- bulk invite

### 既知の懸念
- 案 A だと「admin が事前に登録済 vendor の追加メンバー (vendor_admin 2 人目) を招待する」シナリオが unsupported。業務要件次第で B が必須化する可能性
- Supabase `auth.admin.inviteUserByEmail` vs `createUser({ email_confirm: false })` の使い分けは SDK version + redirect 設計で要確定
- notification_outbox template `vendor_first_invite` は spec/CLAUDE.md 通り別途定義必要 (template registry)
- vendor_users.id = auth.users.id trigger 同期の仕様詳細未確認 (spec §3.6 は trigger 名のみ)

### Unresolved (Phase 24 plan で確定)
- 案 A 単独 vs 案 B 追加 vs 併存 → **ユーザー判断**
- 案 A の場合: spec 943 "Supabase Auth 招待メール送信" は admin API 経由か magic link か (spec 明示なし)
- 案 B 採用なら: `admin_vendor_invitations` schema 確定 + admin role 判定の実装位置
