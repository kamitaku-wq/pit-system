# Phase 64-A.32a email 6 桁コード本人確認 (security core) sealed

## Phase Meta

| 項目 | 値 |
|---|---|
| Phase | 64-A.32a (前: A.31b-2 public reservation wizard UI) |
| 状態 | **sealed** (migration 0025 + 新テーブル + crypto pure + verify-code service / typecheck clean / unit 67 PASS (+19) / integration 14 PASS (新規、RLS anon 拒否を実発火検証含む) / next build green / prettier clean) |
| 担当 | Claude (advisor 1 + 敵対的設計レビュー workflow 4 reviewer + 実装レビュー code-reviewer+Codex 並走。block override 4 件記録=auth/security 例外) |
| Branch | `phase-64-mvp-implementation` |
| **/clear 推奨** | **推奨** (A.32b = email 送信配線 + route gate + wizard step6/7。UI/route 層に戻るため fresh context 望ましい) |

## スコープ (ユーザー判断: A.32 を 2 分割の前半)

handoff A.31b-2 は A.32 を「service/route 層作業」と under-scope していたが、create-on-confirm (A.29 sealed) を辿ると予約はコード検証**後**に作られるため、6 桁コードは `customer_reservation_tokens` (reservation_id NOT NULL) に格納できず**新規テーブル (migration) が必須**と判明。ユーザーが 2 分割を選択:
- **A.32a (本 phase) = security core**: migration 0025 + issue/verify-code service。email 送信非依存で完全テスト可能。
- **A.32b (次)** = email 送信配線 (outbox) + `createPublicReservation` 前の verify gate 差し込み + wizard step6/7 UI。

設計詳細・全レビュー反映: `phase-handoff/phase-64-a32a-design-plan.md` (本 seal と対で保持)。

## 実装 (変更ファイル 8 = 新規 5 + 既存 3)

- **migration** `src/lib/db/raw-migrations/post/0025_reservation_verification_codes.sql` (新規) — テーブル + partial unique index + expires_at index + 3 CHECK + RLS (ENABLE + tenant_isolation policy)。冪等。
- **schema** `src/lib/db/schema/reservation_verification_codes.ts` (新規) — drizzle mirror (DDL と厳密一致、code-reviewer が逐列照合し完全一致確認)。
- **schema index** `src/lib/db/schema/index.ts` (追記) — alphabetical 登録。
- **crypto pure** `src/lib/services/reservation-verification-code-crypto.ts` (新規) — `generateNumericCode` (crypto.randomInt unbiased) / `normalizeEmail` / `hashCode` (HMAC-SHA256(pepper, companyId:email:code)) / `timingSafeEqualHex` / `resolvePepper` (lazy fail-fast) + 定数。db 非 import。
- **service** `src/lib/services/reservation-verification-codes.ts` (新規) — `issueVerificationCode` (rate guard→supersede→INSERT、23505 retry) / `verifyVerificationCode` (FOR UPDATE→expired/locked→timing-safe HMAC→consume+audit / 不一致 attempt++)。service-role + companyId 引数 (ADR-0010/0011)。
- **unit test** `tests/unit/reservation-verification-code-crypto.test.ts` (新規, +19) — gen 分布/桁、HMAC 決定性+binding、normalize、timing-safe、pepper fail-fast。
- **integration test** `tests/integration/services/reservation-verification-codes.integration.test.ts` (新規, +12) — happy/wrong/locked/expired/replay/supersede/email-binding/cross-company/audit/rate-guard×2/partial-unique-index。
- **spec** `spec/data-model.md` §3.8 追加 + §12 「未配線」2 行を A.32a done / A.32b pending に更新。

## 達成したこと: 低エントロピー (6 桁=~20bit) コードを多層で防御 (token=256bit と別設計)

| 防御 | 実装 |
|---|---|
| active 1 件/email | partial unique index `(company_id,email) WHERE consumed_at IS NULL`。concurrent issue 直列化 + ORDER BY 決定論を DB 強制 |
| DB 漏洩耐性 + email binding 暗号強制 | code_hash = HMAC-SHA256(pepper, companyId:email:code)。pepper は env のみ。素 SHA-256 は 10^6 即逆引きのため不採用 |
| 試行制限 + ロック | attempt_count++ / `>= max_attempts` で locked (正コードでも) |
| single-use / supersede | consumed_at。再発行で旧 active を consume |
| timing-safe | crypto.timingSafeEqual |
| RLS | ENABLE + tenant_isolation (anon 不可視、service_role bypass)。未有効だと anon が attempt 改ざん/code_hash 注入で auth bypass 可能だった。**`SET LOCAL ROLE anon` で anon の read/tamper/insert 拒否を実発火検証** (integration test 13/14、owner 接続の整合性テストは RLS を bypass するため別途必要) |
| 発行レート guard | 同一(company,email)直近 window 上限 (再発行ブルートフォース緩和、暫定) |

## adversarial gate (Phase 64-A.26 #1)

| # | 条件 | 該当 | 対応 |
|---|---|---|---|
| 1 | raw-migration | **該当** (0025) | 敵対的設計レビュー workflow (4 reviewer) + 実装レビュー 2 巡目 |
| 2 | 新規署名鍵 | **該当** (HMAC pepper) | レビュー推奨で導入、env fail-fast、生成値は DB 非格納 |
| 3 | 手書き RLS policy | **該当** (tenant_isolation) | canonical (customer_reservation_tokens) verbatim 再利用 (新規パターンではない) |
| 5 | cross-tenant boundary | **該当** (company scope verify) | email binding + company scope を HMAC + lookup + RLS で 3 重強制、cross-company/email-binding テスト固定 |

## レビュー結果 (2 巡: 設計 workflow → 実装並走、CRITICAL 0)

**設計レビュー (workflow `a32a-design-adversarial-review`, reviewer 4 + synthesize)**: HIGH 4 / MEDIUM 2 / LOW 4 を**全件実装前に反映**:
- HIGH#1 partial unique index 欠如 → DDL 追加 + 23505 retry。HIGH#2 ペッパー無 SHA-256=平文 → HMAC+pepper。HIGH#3 verifiedEmail 未返却 → 成功型に追加。HIGH#4 再発行 attempt リセット → 発行 rate guard + A.33 hard 依存明記。MEDIUM#5 email 正規化対称性 → 両端 normalize + DB CHECK。MEDIUM#6 tx 契約 → 内部 db.transaction 明記。MEDIUM#7 ip/ua dead column → 列削除 (audit_logs のみ)。LOW#8 updated_at → 全 UPDATE 明示。LOW#9 oracle → A.32b 文言統一。LOW#10 purge → A.33 明記。

**実装レビュー (code-reviewer + Codex 並走、独立)**: CRITICAL 0。
- **[Codex HIGH] RLS 欠落 → 0025 に ENABLE+policy 追加** (Supabase anon footgun = attempt 改ざん/code_hash 注入の auth bypass を封じ)。**advisor 指摘 (整合性テストは owner 接続で RLS bypass) を受け、`SET LOCAL ROLE anon` で read/tamper/insert 拒否を実発火検証する test 13/14 を追加** (この修正は当初唯一テストの無い不変条件だった)。
- **[code-reviewer HIGH] attempt_count UPDATE 0 行フォールバック → throw** (DB 未永続のまま locked/invalid を返す試行制限崩壊を fail-fast)。
- [MEDIUM] IssueResult に正規化 email 追加 (A.32b 利便、無害)。[LOW] rate-guard window-reset テスト追加。nested tx savepoint は integration test 11/12 で実証。

## invariants (A.32b / 後続で壊さない)

- typecheck clean / **unit 67 PASS (+19)** / **integration 14 PASS (新規、RLS anon 拒否の実発火検証 13/14 含む)** / **next build green** / prettier clean。
- **email binding (最重要)**: verify は (company_id, email) で active 行を引き HMAC にも email を畳み込む。**A.32b は予約 customer.email を verify が返す `verifiedEmail` から取得し、クライアント送信 email を信用しない**。別 email/別 company は not_found。
- **active 1 件/email**: partial unique index。issue の supersede+INSERT は内部 tx + 23505 retry。
- **atomic verify**: FOR UPDATE→判定→consume/attempt++ をすべて単一 tx 内。options.db は .transaction() 対応クライアント。
- **DB schema 真実源は raw SQL** (0025)。drizzle schema は mirror — 変更時は両者を対称に保つ。
- 公開 surface の本番露出は A.33 (Turnstile + 送信レート制限) 完了が **hard 依存** (再発行で attempt リセットするため)。

## 運用 action item (要対応)

1. **migration 0025 適用済み** (本 phase でユーザーが `npm run db:apply-raw:post` 実行、`[DONE] 0025`)。他環境 (staging/本番) でも同コマンドで適用要。
2. **env**: `RESERVATION_VERIFICATION_CODE_PEPPER` (>=16 文字ランダム) を .env.local / CI / staging / 本番に設定。未設定で issue/verify が fail-fast。`.env.example` は Claude 編集権限外のため本 handoff で明記 (要追記)。

## A.32b 引き継ぎ契約

1. route は `verifyVerificationCode` を `createPublicReservation` 前に呼び、`verifiedEmail` を予約 customer.email に使う (クライアント email 不信用)。
2. 公開フローで email 必須化 (公開専用 refine、共有 customerInputSchema は不変)。
3. not_found/invalid_code/expired/locked はクライアント文言統一 (oracle 緩和)。
4. email 送信は outbox 経由 (issue が返す生 code を載せる)。outbox は reservation 等の既存 entity 紐付き構造のため、reservation 前の code 送信の outbox 形状は A.32b で設計。
5. 本番露出は A.33 完了が hard 依存。

## メトリクス

| 指標 | 値 |
|---|---|
| commit | 本 seal 1 (予定) |
| 変更ファイル | migration 1 + schema 2 + service 2 + test 2 + spec 1 = 8 (+ handoff/plan) |
| 新規 tests | +19 unit / +14 integration (RLS anon 拒否 2 件含む) |
| advisor | 1 (着手前設計) + 設計 workflow 4 reviewer + 実装 2 reviewer |
| ユーザー判断 | 2 (2 分割スコープ / migration 適用) |
| Codex 委任 | レビューのみ (実装は auth/crypto 判断密度高で Claude 自実装、block override 4 件) |

*Phase 64-A.32a sealed / Generated by Claude 2026-05-29 / 次: A.32b (要 /clear。email 送信配線 + createPublicReservation 前の verify gate + wizard step6/7 UI)*
