# Phase 24 Plan v1.1 Adversarial Review

> Codex Windows sandbox 2 回失敗 (R-H-002) のため advisor (異プロセス独立判断) で代替実施。
> Claude 側 advisor 1 回目で指摘済 4 件 (vendors row source / UI routing / compensating action / case (c) NG location) は plan v1.1 に反映済 — 本 review は **新規盲点** に集中。

## Findings (severity 順)

### F1: [BLOCKER] Open Q #3/#4 は「Open Q」ではなく BLOCKING design decision

- 該当: §ε / Open Q #3, #4 / 実装着手 Gate
- 問題: ε で `auth.admin.createUser` するが、その後ユーザーが **どうやって最初の authenticated session を確立するか** が未定義。password 必須/optional の判断、magic link 経路の有無は実装そのものを規定。η の 10 ケースは withAuthenticatedDb で test 用 session を fabricate するため test pass するが、本番フローには穴が残る
- 推奨: plan v2 で password setup pathway を design 決定として明記。3 候補 — (a) `inviteUserByEmail` で password set link メール送信 / (b) `createUser({ password: temp })` + 初回 password 変更強制 / (c) magic link auth (password 概念なし)

### F2: [BLOCKER] `responded_at` カラムの実在未検証

- 該当: §β (recon #1 §2 SQL 54, 71-72 行)
- 問題: spot RPC SQL は `responded_at=now()` を書き込む。recon #1 §1 は「invitations has no deleted_at/updated_at/bound_at」を明示したが `responded_at` には触れていない。存在しなければ migration apply で undefined column error
- 推奨: `src/lib/db/raw-migrations/alpha-1-public/12_transport.sql` で `transport_order_invitations.responded_at` を verify。不在なら 26 番 migration に `ADD COLUMN responded_at timestamptz` 追加

### F3: [BLOCKER] token raw value 生成/format 未定義

- 該当: §δ-server / §ε / Open Q #5
- 問題: plan は「token SHA256 → hash 比較」を述べるが raw token の生成・URL encode・エントロピー保証が未定義。既存の `transport_order_invitations.invitation_token_hash` を埋める service が他にあるなら source 引用必要、なければ Phase 24 で新規設計
- 推奨: plan v2 で token spec 明記 — minimum 128bit `crypto.randomBytes(32).toString('base64url')`、生成位置 (invitation 作成時 = 既存 `createTransportOrderWithNotification` の責務拡張 or 新 service) を確定

### F4: [HIGH] case (b) 既存 vendor lookup criterion 未定義

- 該当: §ε case (b)
- 問題: 「既存 vendor (transport_order.company_id の vendor exist)」と書かれているが、**どの field で lookup するか不明**。`vendors.email`? `vendors.name`? `invitations.vendor_id` の継承 (それなら spot ではない)? 検索キーがないと case (b) は実装不能
- 推奨: plan v2 で「case (b) は `vendors.email = invitee_email` で見つかるパス」 or 「case (b) は実は存在しない (新規は常に case (a))」のどちらか確定

### F5: [HIGH] §γ router function `respondToInvitation` のテスト欠落

- 該当: §γ / §η
- 問題: §η に 10 test ケース列挙だが router function 自体の dispatch 検証なし。誤 dispatch (registered → spot service / spot → registered service) は Phase 19 invariants を silent に壊す
- 推奨: η に +2: (1) registered invitation → respondToTransportOrder 経路 / (2) spot invitation → respondToSpotInvitation 経路。pnpm test 80 → 82

### F6: [HIGH] `vendor_users.is_active` 初期値未指定

- 該当: §ε / `09_vendors.sql:43`
- 問題: schema default は `true`。spot first-touch で vendor_users 作成 → 認証 session 確立前。default のまま `true` で INSERT すると confirm 前 user が portal リスト / RLS query 通過する可能性
- 推奨: spot 作成時のみ explicit `is_active=false`、login 成功 callback で `true` に flip。callback hook 場所を §ε または Phase 25 で確定

### F7: [MEDIUM] 既存 RLS policy 改変の semantic preservation 未検証

- 該当: §α (recon #1 §3)
- 問題: `DROP POLICY IF EXISTS vendor_select` → recreate で `OR bound_vendor_id = current_vendor_id()` 追加。これが `19_rls_policies.sql` 元 policy にあった clause か新規追加かが未確認。新規なら registered vendor visibility semantics も変わる
- 推奨: `19_rls_policies.sql:vendor_select` 元 SQL を Read 確認、新政策が super-set であることを §α 内に明記

### F8: [MEDIUM] ADR-0010 拡張は「1 行追記」では足りない

- 該当: §ADR-0010 拡張 / Risks
- 問題: spec/CLAUDE.md は project regulation の single source of truth。service_role 利用境界の追加は **ADR-0011 新設 or ADR-0010 正式 amendment** が discipline 上正しい。「1 行追記」は将来 phase の audit で根拠不明
- 推奨: plan v2 に ADR-0010 amendment 草案 (3-5 行) を含め、ユーザー approve 後 spec に正式追記

### F9: [LOW] `listUsers` pagination の scale 懸念

- 該当: §ε compensating action precheck
- 問題: seed-vendor-dev:111 の `listUsers({ page, perPage })` 全 page スキャンは O(N)、production user 多い時 rate limit / 遅延
- 推奨: Phase 24 MVP は OK、Sprint γ で `getUserByEmail` (将来 SDK サポート時) 移行候補として記録

### F10: [LOW] case (d) `last_login_at` 更新経路未確認

- 該当: §ε case (d)
- 問題: 既存 vendor_user の場合 `last_login_at` 更新は Supabase Auth 経由か app callback かが plan 未記載
- 推奨: Phase 25 の login flow 実装時に確認、Phase 24 では非ブロック

---

## plan v1.1 → v2 必須修正サマリ

1. **F1**: password setup pathway を design 決定として §ε に明示 (Open Q から削除、user 判断後)
2. **F2**: `responded_at` 実在 verify、不在なら 26 番に `ADD COLUMN` 追加
3. **F3**: token 生成 spec (entropy / encoding / 生成位置) を §δ-server / §ε に明記
4. **F4**: case (b) lookup criterion 確定 (or case (b) 削除)
5. **F5**: §η に router function test +2 ケース追加 (80 → 82 PASS が新目標)
6. **F6**: spot 作成時 `is_active=false` 明示 + login 後 flip 場所決定
7. **F8**: ADR-0010 amendment 草案を plan v2 に含める

## Open Q (advisor も Claude も解決不能、user 判断必要)

- **F1 派生**: password setup 3 候補 (inviteUserByEmail / createUser+temp password / magic link) のどれを採用するか
- **F4 派生**: case (b) を MVP scope に含めるか、case (a) のみで Sprint β を絞るか
- **F8 派生**: ADR amendment 形式 (正式 ADR-0011 / ADR-0010 補項) どちらか

## Verdict on scope

Phase 24 = α/β/γ/δ-server/ε/η は **BLOCKER 3 件解消後なら ~75-90 min で完遂可能**。

ただし F1 (password setup) が **scope を最大 1.5× まで膨らませる可能性**:
- magic link: δ-server に signup→magic link mail flow 追加 = +15-20 min
- inviteUserByEmail: email template + redirect URL config = +10-15 min
- createUser+temp password: temp password 強制変更フロー = +20-30 min

**推奨**: F1 を Phase 24 で完遂しない選択 — ε onboarding service は「vendor_users (is_active=false) 作成」までで return、login pathway は Phase 25 へ。これで Phase 24 は ~75 min に収まる。Open Q #3 #4 は「Phase 25 で決定」とする。
