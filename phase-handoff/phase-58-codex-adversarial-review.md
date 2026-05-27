# Phase 58 Codex Adversarial Review

## 判定

**CONDITIONAL-BLOCK**

- BLOCK: **2件**
- WARN: **3件**

複合 FK 自体の設計は Phase 57 D1 と同じ `MATCH SIMPLE / ON DELETE NO ACTION / ON UPDATE RESTRICT` で成立する。`reservation_status_history` への active INSERT 経路も、提供ファイル範囲では見つからない。

ただし plan v1 の test 設計は、`20_triggers.sql` と D1 実装済 test の実態に反している。そのまま実装指示にすると失敗または意味の薄い test になるため、plan v2 修正後に GO が妥当。

## BLOCK (2件)

### BLOCK-1: `trg_reservation_transition` 前提と inline seed 要件が曖昧

**深刻度**: 高
**場所**: plan v1 §0, §1, §6 / `src/lib/db/raw-migrations/alpha-1-public/20_triggers.sql`

plan v1 は `trg_reservation_transition` を「BEFORE INSERT の status transition 検証」として扱い、reservation status 2件 + transition 1件を test 内 inline seed すれば trigger を満たせる、と書いている。

しかし `20_triggers.sql` の active 実装は `trg_enforce_status_transition BEFORE UPDATE OF status_id ON public.reservations` であり、`reservation_status_history` への BEFORE INSERT trigger は存在しない。

さらに、spec 側の `trg_reservation_transition` を前提にする場合でも、transition check は `from_status_id` と `to_status_id` の両方を見る。D1 test 移植のまま `toStatusId` だけを history に入れると `from_status_id` は NULL なので、`__test_from -> __test_to` transition とは一致しない。

**修正提案**: plan v2 で trigger 前提を分離すること。現行 DB を正とするなら transition seed は FK test には不要。spec trigger 復元耐性を持たせるなら、history INSERT 側も `fromStatusId` と `toStatusId` を transition と一致させる形に修正する。

---

### BLOCK-2: 観点5「commit 時 deferred check」は D1 実装済 migration と test に反する

**深刻度**: 高
**場所**: plan v1 §6 / `src/lib/db/raw-migrations/post/0017_status_history_user_company_composite_fk.sql` / D1 integration test

plan v1 は「commit 時点で FK 違反」としているが、`0017_status_history_user_company_composite_fk.sql` の FK は `DEFERRABLE` を指定していない。PostgreSQL default は **NOT DEFERRABLE** なので、cross-company INSERT は commit 時ではなく statement time に `23503` で失敗する。

D1 の実装済 test (`tests/integration/db/transport-order-status-history-fk.integration.test.ts`) も statement-time FK violation を検証する形になっている。

**修正提案**: 観点5を「NO ACTION non-deferrable check: statement time に `23503` が raise される」へ修正する。commit-time deferred を検証したいなら migration 設計自体を `DEFERRABLE INITIALLY DEFERRED` に変える必要があり、D1 pattern から外れる。

---

## WARN (3件)

### WARN-1: `ON DELETE SET NULL -> NO ACTION` 正当化は概ね妥当だが hard delete 影響が未明記

**深刻度**: 中
**場所**: plan v1 §3 / `src/lib/db/raw-migrations/alpha-1-public/11_reservations.sql`

既存 DDL と Drizzle schema は `changed_by_user_id REFERENCES users(id) ON DELETE SET NULL`。plan v1 の audit 保全・soft delete 前提という方向性は妥当。

ただし `users.id` は `auth.users(id) ON DELETE CASCADE` であり、Phase 58 後は、将来 history row が存在する状態で `auth.users` hard delete が走ると `public.users` cascade delete が複合 FK に阻止される。これは意図としてはよいが、運用契約として明文化すべき。

**採用判断**: §3 に「auth.users hard delete 経由でも意図的に阻止される。退会/削除運用は `users.is_active=false` または履歴 purge/anonymize を先行する」を追加する。

---

### WARN-2: INSERT=0 結論は支持できるが、RPC/SECURITY DEFINER/seed の証跡が弱い

**深刻度**: 低〜中
**場所**: plan v1 §1

`reservation_status_history|reservationStatusHistory` の active code 検索では direct INSERT は見つからない。提供範囲の RPC/SECURITY DEFINER/seed 関数にも reservation history INSERT は見当たらない。

ただし plan v1 の棚卸しコマンドは `seed/` が存在しない環境ではエラーを出し、`supabase/migrations` や `drizzle/` を明示していない。

**採用判断**: plan v2 に補助確認を追記する:

```
補助確認:
  rg -n "reservation_status_history|reservationStatusHistory" src tests scripts supabase drizzle
  rg -n "SECURITY DEFINER|CREATE OR REPLACE FUNCTION" src/lib/db/raw-migrations/alpha-1-public src/lib/db/raw-migrations/post
結論: active RPC/SECURITY DEFINER/seed に reservation_status_history INSERT なし。
docs/spec/poc は active 実装と分けて扱う。
```

---

### WARN-3: Drizzle schema diff は D1 と対称だが `onDelete` 省略意図を明記した方が安全

**深刻度**: 低
**場所**: plan v1 §5

§5 の Drizzle diff は D1 実装済 schema と同形で正しい。column-level `.references(... onDelete: "set null")` を削除し、table-level composite FK + `.onUpdate("restrict")` を追加する形は妥当。

ただし `onDelete("no action")` が Drizzle 側に出ないため、将来「指定漏れ」と誤読される余地がある。

**採用判断**: §5 に「`onDelete` は意図的に省略し、PostgreSQL default の NO ACTION と raw migration 0018 に合わせる」と追記する。

---

## plan v2 への修正提案（差分形式）

```diff
--- a/phase-handoff/phase-58-reservation-status-history-fk-plan.md
+++ b/phase-handoff/phase-58-reservation-status-history-fk-plan.md

 ## 0. D1 (Phase 57) との差異まとめ
-| trigger 生成 INSERT | なし | なし (`trg_reservation_transition` は status transition 検証のみ) |
+| trigger 生成 INSERT | なし | なし。現行 `20_triggers.sql` には `reservation_status_history` BEFORE INSERT trigger は存在しない。spec §15.5 には `trg_reservation_transition` が残るため、test seed は現行 DB 用か spec 復元耐性用かを明記する。 |

 ## 1. INSERT 経路棚卸し
+補助確認:
+  rg -n "reservation_status_history|reservationStatusHistory" src tests scripts supabase drizzle
+  rg -n "SECURITY DEFINER|CREATE OR REPLACE FUNCTION" src/lib/db/raw-migrations/alpha-1-public src/lib/db/raw-migrations/post
+結論: active RPC/SECURITY DEFINER/seed に reservation_status_history INSERT なし。

 ## 3. 採択方針
   4. 将来 reservation status workflow 実装時に「user 削除で履歴の changed_by が消える」現象を防ぐ
+  5. `auth.users -> public.users ON DELETE CASCADE` 経由の hard delete も、履歴 row 存在時は意図的に阻止される。退会/削除運用は `users.is_active=false`、または履歴 purge/anonymize を先行する。

 ## 5. drizzle schema 変更
 // raw migration 0018 is authoritative; drizzle-kit generate/push must not be used to regenerate this FK.
+// onDelete is intentionally omitted here: PostgreSQL default NO ACTION matches migration 0018.

 ## 6. integration test 設計
-5. **commit 時 deferred check**: TX 内で cross-company user を INSERT 後、commit 時点で FK 違反が確実に raise されること
+5. **NO ACTION non-deferrable check**: cross-company user 指定は statement time に `23503` で失敗すること (Phase 57 D1 実装済 test と同形)

-- **reservation 用 status + transition を test 内 inline で INSERT**:
+- **reservation 用 status を test 内 inline で INSERT**:
   - `INSERT INTO statuses ...` × 2
-  - `INSERT INTO status_transitions ...` × 1
-  - これで `trg_reservation_transition` BEFORE INSERT trigger を満たす
+  - 現行 `20_triggers.sql` では history INSERT trigger はないため、transition seed は FK test には不要。
+  - spec §15.5 の trigger 復元耐性を持たせる場合のみ `status_transitions` × 1 を追加し、history INSERT 側も `fromStatusId` と `toStatusId` を transition と一致させる。
```

## Phase 57 (D1) との比較サマリー

| 観点 | Phase 57 D1 | Phase 58 D2 plan v1 評価 |
|---|---|---|
| migration pattern | `MATCH SIMPLE / NO ACTION / RESTRICT` | 同形で妥当 |
| Drizzle schema diff | table-level composite FK、column FK 削除 | 同形で妥当。`onDelete` 省略意図だけ追記推奨 |
| INSERT 棚卸し | service/RPC/SQL 6箇所 | active direct INSERT 0箇所。補助証跡追記推奨 |
| 既存 FK 意味変化 | D1 は NO ACTION 統一済 | D2 は実 DDL/Drizzle が SET NULL なので hard delete 影響の明文化が必要 |
| status seed | `seedTransportStatuses` helper 使用 | reservation helper なし。inline seed 必要だが transition seed は trigger 前提次第 |
| trigger 前提 | D1 test は history trigger 非依存 | plan v1 は現行にない trigger を前提化しており BLOCK |
| 観点5 FK check timing | statement-time FK violation | plan v1 は commit-time deferred と書いており BLOCK |
| 総合リスク | 実装リスク 低 | plan v2 修正後に同等レベルに収束可能 |
