# Phase 57 Codex Adversarial Review

**日付**: 2026-05-27  
**レビュアー**: Codex (gpt-5.5)  
**対象**: `phase-handoff/phase-57-status-history-fk-plan.md` (plan v1)  
**比較基準**: Phase 56 で BLOCK 2 件を発見した同等の厳しさ

---

## 判定

**CONDITIONAL-GO**

- BLOCK: **0件**
- WARN: **6件**

D1の複合FK設計はPhase 56の致命傷（ON DELETE SET NULL で複合FK全列NULL化、drizzle 0.36.4のSET NULL列指定表現不能）をいずれも回避しており、approach changeが必要な致命バグは存在しない。ただし6件のWARNを採用判断の上でplan v2に反映を推奨する。

---

## BLOCK（0件）

なし。

**根拠**: Phase 56 BLOCK-1の原因は「ON DELETE SET NULLを複合FKに適用すると、参照元の両列がNULLになるPostgreSQL仕様」だった。Phase 57 D1はこの経路を一切使わず、`NO ACTION` + NULL許容列という分離設計を選択しており、同問題は発生しない。BLOCK-2の原因はdrizzleの`foreignKey().onDelete('set null', {columns:[...]})` が0.36.4では構文生成不能な点だった。Phase 57 D1はraw SQL migration（`post/0017_...sql`）で実装するため、drizzle表現制限の外にある。

---

## WARN（6件）

### WARN-1: raw-migrations/alpha-1-public内のINSERT棚卸し漏れリスク

**深刻度**: 中  
**場所**: plan v1 §1「INSERT 棚卸し（5箇所）」  
**内容**: 計画のINSERT棚卸しは5箇所を列挙しているが、`src/lib/db/raw-migrations/alpha-1-public/` 配下のSQL（24_vendor_rpcs.sql, 25_close_transport_order.sql, 27_spot_rpc.sql）については「NULL固定」と明記されており確認済と読める。一方で `seed/` 配下や他のpost/配下に `transport_order_status_history` への直接INSERTが潜む可能性は計画では排除されていない。FK追加後に制約違反が起きると本番適用でロールバックが必要になる。  
**採用判断**: migration実行前に `rg -rn "transport_order_status_history" src/lib/db/raw-migrations/ seed/` で全INSERTを網羅確認する手順をplan v2の前提確認セクションに追加すること。

### WARN-2: `actingUserId` の company 整合保証が service 外部から未検証

**深刻度**: 中  
**場所**: plan v1 §1 INSERT #1・#2「呼出側で actingUserId と companyId の company 整合が保証される入力契約」  
**内容**: 計画は「入力契約で保証される」と述べているが、その保証がどの層（API route / middleware / RLS / Zod schema / service 内ガード）で行われているかの明示がない。Phase 56でもcancelTransportOrderのactingUserIdパターンが「12/12 PASS」で実証されているとあるが、これはPhase 55以降のchange_logs向けのテストであり、status_history向けのFKが追加された後の同等テストカバレッジではない。  
**採用判断**: plan v2で「company整合の検証箇所（ファイル名:行番号）」を1行追記し、かつWARN-5のテスト観点5でネガティブケースをカバーする。

### WARN-3: migration idempotencyの保証が0016より弱い可能性

**深刻度**: 低〜中  
**場所**: plan v1 §4「migration設計」のSQLコード  
**内容**: 計画のSQLドラフトには `users_id_company_id_unique` の IF NOT EXISTS チェック、既存FK検索DROP、複合FK追加のIF NOT EXISTSが含まれており、Phase 56の0016と同等のidempotentガードが入っている。ただし `DO $$ ... END $$;` ブロック全体の外側に `BEGIN`/`EXCEPTION WHEN duplicate_object THEN NULL`相当のフォールバックがない。何らかの理由でブロック中のEXECUTE format()が失敗した場合（例: 同名FK既に存在するがIF NOT EXISTSに漏れたケース）、PL/pgSQLがraiseしてmigration全体がロールバックされる。  
**採用判断**: `DO $$` ブロック全体を `BEGIN ... EXCEPTION WHEN others THEN RAISE NOTICE '...' ; END $$;` で囲むか、各ALTER個別にEXCEPTIONを設けることを検討する。ただし0016と同等の構造であれば既存の運用判断を踏襲してもよい（WARN、BLOCKではない）。

### WARN-4: D2-D4横展開で「同一パターン踏襲」前提が強すぎる

**深刻度**: 低〜中  
**場所**: plan v1 §10「Phase 58候補」  
**内容**: D2以降の対象テーブル（`reservation_status_history`, `transport_order_invitations`, `admin_vendor_invitations`）をD1と「同 pattern」として扱う記述があるが、各テーブルのINSERT棚卸しは独立して実施されていない。特に `transport_order_invitations.invited_by_user_id` は §ADR-0008 関連と明記されており、invitation送信フローがcompany境界をまたぐ可能性がある。「同pattern連続実装可」と書かれると、D2-D4で独立棚卸しをスキップするリスクがある。  
**採用判断**: §10に「D2-D4各フェーズで§1相当のINSERT棚卸しを独立実施する（D1パターンをそのまま流用しない）」という注記を追加する。

### WARN-5: テストの「cross-company FK違反」ケースがNEGATIVE方向のみ（WARN補足）

**深刻度**: 低〜中  
**場所**: plan v1 §6「integration test 設計（4観点）」  
**内容**: 計画の4観点は網羅されているが、観点1（cross-company INSERT失敗）は「company AのrowにcompanyBのuserを指定→FK違反」とある。これは正しいが、さらに「FKが正しくRESTRICTで弾いていること（NO ACTIONとの違い）」を明示するケースがない。`NO ACTION`はpostgres内ではdeferred FK checkを許すため、同トランザクション内での一時的な違反状態でもcommit時に弾く挙動を確認しておく必要がある。Phase 57のon_deleteはNO ACTIONなので、deferred checkの挙動差は小さいが念のため。  
**採用判断**: テスト観点5として「acting_user_id に別companyのユーザーIDを指定しcommitしたときFKエラーが発生すること（deferrable動作の確認）」を追加する。軽微なので必須ではないが追加推奨。

### WARN-6: `users_id_company_id_unique` の staging/production 適用確認が手順に未明記

**深刻度**: 低  
**場所**: plan v1 §4 migration先頭の IF NOT EXISTS チェック  
**内容**: 計画は「Phase 56で追加済なので idempotent check のみ」としているが、staging/productionで0016が実際に適用済かの明示的な確認手順がない。0016未適用のまま0017を流すと、IF NOT EXISTSブロックで `users_id_company_id_unique` が追加されるため動作はするが、「追加済み前提」のコメントと実挙動の乖離がデバッグ時に混乱を招く。  
**採用判断**: plan v2の完了基準（§9）に「migration適用前: `\d users` で `users_id_company_id_unique` の存在を確認」を追加する（1行で足りる）。

---

## plan v2 への修正提案（差分形式）

```diff
 ## §1 INSERT棚卸し（5箇所）
+> **v2追記 (WARN-1対応)**: migration実行前に以下を実行し、棚卸し漏れがないことを確認する。
+> ```
+> rg -rn "transport_order_status_history" src/lib/db/raw-migrations/ seed/
+> ```

 ## §1 INSERT #1, #2 の company 整合保証
-actingUserId は呼出側で同 company 保証
+actingUserId は呼出側で同 company 保証（保証箇所: src/lib/services/transport-orders.ts の
+createTransportOrderWithNotification 入力契約, cancelTransportOrder 入力契約）
+（WARN-2対応: Phase 55テストで実証済のcancelTransportOrder pattern に加え、
+WARN-5のテスト観点5でstatus_history向けFKのネガティブケースを直接カバーする）

 ## §6 integration test 設計（4観点）
 観点1: cross-company INSERT 失敗
 観点2: same-company INSERT 成功
 観点3: NULL 許可 (MATCH SIMPLE)
 観点4: user hard delete RESTRICT (NO ACTION)
+観点5: acting_user_id に別companyのユーザーIDを指定しcommit時にFK違反が発生すること
+       （WARN-5対応: deferred NO ACTION の挙動確認）

 ## §9 完了基準（DoD）
 - [ ] migration 0017 apply 成功 (Supabase dev)
+- [ ] migration適用前: `\d users` で `users_id_company_id_unique` の存在確認（WARN-6対応）
 - [ ] typecheck clean
-- [ ] 新規 4 観点 test 全 PASS
+- [ ] 新規 5 観点 test 全 PASS（WARN-5観点5追加後）
 - [ ] 既存 156 tests retrogression なし → 160/160 PASS
 - [ ] drift 増加なし (2 → 2)
 - [ ] CI E2E 7/7 PASS 維持
 - [ ] phase-57-status-history-fk-sealed.md 200 行以内で書き出し

 ## §10 Phase 58候補（D2-D4）
 D1完了後、D2-D4は data ゼロ確認済なので同 pattern で連続実装可:
 - D2: reservation_status_history.changed_by_user_id (規模軽微、同 pattern)
 - D3: transport_order_invitations.invited_by_user_id (§ADR-0008 関連)
 - D4: admin_vendor_invitations.invited_by_user_id (規模軽微)
+> **v2追記 (WARN-4対応)**: D2-D4各フェーズで§1相当のINSERT棚卸しを独立実施すること。
+> D1パターンをそのまま流用しない。特にD3(transport_order_invitations)は
+> invitation送信フローがcompany境界をまたぐ可能性があるため独立設計が必須。
```

---

## Phase 56との比較サマリー

| 観点 | Phase 56 plan v1 | Phase 57 plan v1 |
|------|-----------------|-----------------|
| SET NULL複合FK全列NULL化 | **BLOCK** | 問題なし（NO ACTION設計） |
| drizzle表現限界（SET NULL列指定） | **BLOCK** | 問題なし（raw SQL設計） |
| idempotency | WARN | **WARN-3**（同等、0016より強固） |
| INSERT棚卸し漏れ | WARN | **WARN-1**（同等、seed/配下） |
| company整合の証跡明示 | WARN | **WARN-2**（同等） |
| 横展開前提強すぎ | （なし） | **WARN-4**（新規、D3 ADR-0008） |
| テストNEGATIVEケース不足 | （なし） | **WARN-5**（新規、deferred確認） |
| unique constraint存在確認 | （なし） | **WARN-6**（新規、1行手順） |

Phase 57 D1はPhase 56の教訓（raw SQL経路、NO ACTION選択、MATCH SIMPLE）を適切に取り込んでいる。残るWARNはすべて計画精度・テストカバレッジ・横展開リスクの範囲であり、approach変更なしで解消できる。

---

*このレビューはCodex (gpt-5.5) による独立判断です（実コード・計画ファイル直接確認済）。採択はClaudeとユーザーが行います。*
