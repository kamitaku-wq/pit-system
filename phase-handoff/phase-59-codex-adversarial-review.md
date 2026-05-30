# Phase 59 Codex adversarial review

## Meta

| 項目 | 値 |
|---|---|
| Codex ledger ID | `del-20260527-053711-f953` (auto-apply 済 P2) |
| 対象 plan | `phase-59-transport-order-invitations-fk-plan.md` v1 |
| 結論 | **CONDITIONAL-BLOCK** (BLOCK 3 + WARN 2 + NOTE 2) |
| 採用判断 | BLOCK 3 + WARN 2 全採用 → plan v2 化 |

## CONDITIONAL-BLOCK 内容

The core FK/migration direction is sound, but the plan has D3-specific coverage and schema-pattern gaps that should be fixed before implementation.

## BLOCK 項目 (採用必須)

### BLOCK-1: non-NULL `actingUserId` の active 経路 test 不足

- **指摘**: `src/lib/services/transport-orders.ts:33` で `actingUserId` を受理、`:158` で `invited_by_user_id` に書込む active 経路があるが、`tests/integration/services/transport-orders.integration.test.ts:148-158` の fixture helper は `actingUserId` を omit、コード全体で non-NULL を渡す test が **0 件**。
- **理由**: D3 は D2 と異なり active insert path。直接 FK test だけでは本番 service 経路が新 FK 下で動くか証明できない。
- **plan v2 採用**: 5 観点 test (D3 専用) に **第 6 観点**を追加: `createTransportOrderWithNotification` を **same-company user の actingUserId 付**で呼び成功すること、**cross-company user の actingUserId 付**で呼び FK 違反することを確認。

### BLOCK-2: `respond_to_spot_invitation` も ADR-0008 invariant に含めるべき

- **指摘**: plan は `accept_invitation_and_revoke_others()` のみを ADR-0008 RPC として保護対象に挙げているが、`src/lib/db/raw-migrations/post/0008_phase_28_c_respond_to_spot_invitation_ambiguous_fix.sql:55-57` および `:80-84` で `respond_to_spot_invitation` も `transport_order_invitations` を UPDATE している。
- **理由**: ADR-0008 文脈の transport invitation 行為が spot RPC 経路で起こる場合、`invited_by_user_id` 不変保護が plan の invariants から漏れている。
- **plan v2 採用**: invariants 節で `accept_invitation_and_revoke_others` に加え `respond_to_spot_invitation` も "UPDATE 対象に `invited_by_user_id` 含まないこと" を明記。

### BLOCK-3: Drizzle schema は `onDelete` を omit、raw SQL authoritative pattern を厳守

- **指摘**: plan v1 §2 で「`onDelete: "no action"` を明示」と書いたが、Phase 58 (`src/lib/db/schema/reservation_status_history.ts:9-11`, `:35-39`) は意図的に Drizzle `onDelete` を omit し raw SQL 側のみ `NO ACTION` を持っている。
- **理由**: local convention は "raw migration authoritative + Drizzle mirror only `.onUpdate('restrict')'`"。逸脱すると drift / generated metadata 不整合の risk。
- **plan v2 採用**: schema 変更内容を Phase 58 と完全同型に訂正: 単独 `references()` 削除、table-level `foreignKey()` の `.onUpdate("restrict")` のみ宣言、`onDelete` 不明示 (raw migration が authoritative)。

## WARN 項目 (採用推奨)

### WARN-1: "完全同型" narrative を緩和

- **指摘**: spec §7.10 (`spec/data-model.md:833-835`) は複数業者打診とスポット招待を記述、L842-854 は nullable vendor / spot binding 列を記述。`invited_by_user_id` 自体は L847 で `uuid FK` の 1 行のみ。
- **理由**: 「発行者側 FK だから D3=D1 同型」argument は妥当だが、spec 直接記述ではなく実装裏取りに基づく inference。RPC/service の D3 固有チェックを skip する根拠としては完全ではない。
- **plan v2 採用**: §handoff 警告解消 narrative の「構造的に完全同型」を「**発行者側 FK として論理的に D1 と同パターン (vendor 側カラムへの影響なし)。ただし active insert 経路を持つため D1 と完全同等ではなく、追加検証を併用**」に修正。

### WARN-2: 招待 response 経由で `invited_by_user_id` が不変な assertion 追加

- **指摘**: accept/revoke (`post/0006:48-58`) も spot accept/reject (`post/0008:55-57`, `:80-84`) も `invited_by_user_id` を更新しないが、これは現状の SQL 文の inspection のみで確認している。
- **理由**: plan の ADR-0008 不変 claim を **assertion で直接 test** すれば、将来 RPC を書き換えても regression を捕捉できる。
- **plan v2 採用**: 5+1 観点に **第 7 観点**を追加: invitation 行を作成 → `respond_to_spot_invitation` or `accept_invitation_and_revoke_others` を実行 → `invited_by_user_id` が**変更されていない**こと assert。

## NOTE 項目 (任意)

### NOTE-1: migration idempotency pattern は OK

- **指摘**: 単独 FK のみ drop する catalog query (plan §1 L74-83) + 複合 FK add (L94-100) は Phase 58 (`src/lib/db/raw-migrations/post/0018_*.sql:15-48`) と structurally 同型。D3 固有の SQL blocker なし。
- **plan v2 対応**: 採用 (pattern 維持)。

### NOTE-2: invitation 削除挙動の label 明確化

- **指摘**: 新 FK は **referenced users** 削除を NO ACTION で制限。invitation 自身の削除は `notification_outbox` / `vendor_portal_inbox` への CASCADE (`alpha-1-public/13_notifications.sql:23`, `:65`) で別系統。
- **plan v2 採用**: 観点 (iv) の label を「ON DELETE NO ACTION で users RESTRICT (referencing 行あり → user 削除拒否)」と明示、invitation 行削除の挙動とは区別。

## plan v2 反映サマリ

| 項目 | 反映先 |
|---|---|
| BLOCK-1 | 観点 6 追加 (service active 経路 same/cross-company actingUserId test) |
| BLOCK-2 | invariants に `respond_to_spot_invitation` 追加 |
| BLOCK-3 | schema 変更内容を Phase 58 同型に訂正 (onDelete omit) |
| WARN-1 | handoff narrative 緩和 ("完全同型" → "発行者側同パターン + 追加検証併用") |
| WARN-2 | 観点 7 追加 (RPC 経由 invited_by_user_id 不変 assertion) |
| NOTE-1 | 採用 (pattern 維持) |
| NOTE-2 | 観点 (iv) label 明確化 |

最終 test 観点数: **7** (Phase 57/58 の 5 観点から D3 active 経路 +2)。

---

*Codex adversarial review by gpt-5.5 / Phase 59 plan v1 → v2 化用*
