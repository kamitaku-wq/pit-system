# Phase 64-A.26 Phase 4 設計 spike (提案#2)

> spike = コードを書かず Phase 4 入口の高判断設計を前出しで確定する phase。
> **(b) Storage / (c) Turnstile は advisor 検証済で確定**。**(a) session 方式はユーザー判断待ち**（要件上書きに当たるため）。
> #1 adversarial gate: session 機構(項目2) と Storage bucket policy(項目3) が gate 対象 → (a) 確定後に cross-tenant/replay/leak の敵対的 enumerate を 1 回実施する。

---

## (a) 顧客の変更/キャンセル機構 【確定: 案 A per-action token — ユーザー承認済 2026-05-29】

> **決定**: 案 A（per-action token・spec §12.2/§4.7 準拠）。`customer_reservation_tokens` に `purpose`/`action` 列を 1 つ再追加し、view/modify/cancel を別 token 行で発行。A.21 の hash + atomic verify+consume canonical を verbatim 再利用。**spec 準拠のため要件変更なし**（§12.2 書き換え不要）。案 B(session)は不採用。

### 元の分岐分析（記録）

### 重要: これは要件レベルの分岐
- **spec §12.2** と **requirements.md §4.7** の両方が **modify token + cancel token**（SHA-256 hash + `expires_at`）を明示規定。
- プロジェクト Critical Rule:「要件を勝手に削除しない / 別仕様へ編集しない」→ session への置換は **ユーザー承認が必須**（Claude/advisor だけで確定不可）。
- A.25 で `purpose` 列を削除し token table を single-use 固定にしたのは投機的簡素化であり、DB-truth(ADR-0011) の対象（実装済み drift）ではない。両案とも greenfield。

### 選択肢

| 案 | 機構 | 新規 surface | spec 整合 |
|---|---|---|---|
| **A: per-action token（推奨・spec 準拠）** | `customer_reservation_tokens` に `purpose`/`action` 列を 1 つ再追加 → view/modify/cancel を別 token 行で発行、各リンクを email 送付。A.21 の hash + atomic verify+consume canonical をそのまま再利用 | ALTER TABLE 1 列のみ | §12.2/§4.7 にそのまま準拠 |
| B: 署名 cookie session | consume 1 回 → HMAC-SHA256 署名 HttpOnly cookie(30分, {companyId,reservationId} scope) → 変更/キャンセルを cookie 経由 server action に統一 | 新 secret + 署名/検証コード + session middleware + 未認証顧客の新 auth surface + theft/replay/rotation のセキュリティ分析 | §12.2 を書き換え（要件上書き） |

### 推奨: 案 A（per-action token）
- 要件をそのまま満たす。net-new surface は 1 列のみ。既存 canonical(A.21) を verbatim 再利用。可逆。
- 案 B の唯一の利点「1 リンクで 30 分なんでもできる UX」は **要件に存在しない**。要件は per-action token で充足済。新 auth surface を増やす負担は UX 要望が要件化されてから。
- → **特に「1 リンク UX」を要件として採用したい場合のみ案 B**。それ以外は案 A。

---

## (b) Storage 戦略 【確定 — advisor 検証済】

- **全社 1 private bucket + path prefix `{company_id}/{entity}/{entity_id}/{attachment_id}`**（per-company bucket は不採用: scale/管理コスト）。
- 直接アクセス全 deny。**service_role が A.22 の `verifyParentOwnership` 通過後に signed URL(TTL 5分)発行のみ**。
- data-model §12.1 は A.22 で multi-FK に更新済 → 整合。既存 canonical(A.22 cross-tenant ownership 検証)に aligned。
- **リスク**: 単一 bucket = service 層 ownership バグが cross-tenant read に直結 → A.22 ownership check + 5分 TTL で緩和。**#1 gate 対象**（実装 phase で敵対的検証）。
- 実装 phase の DoD: bucket 作成コマンドを handoff §再現手順に記載（提案#5 規律）。

## (c) Turnstile 多層防御境界 【確定 — advisor 検証済】

- **β-3 に束ねる**（独立 spike phase 不要、α-0 で PoC 済）。
- 適用面: **公開予約作成 form POST + rate limit のみ**。`/r/[token]` は 256-bit token-gated 済のため対象外。
- roadmap β-3 既存タスク「Cloudflare Turnstile 多層防御」に内包。

---

## spike 完了条件
- (b)(c) 確定 ✅
- (a) ユーザー判断後に確定 → spec/CLAUDE.md に ADR として記録（案 A なら §12.2 準拠を確認、案 B ならユーザー承認の上で §12.2 更新を別途実施）
- (a) 確定後、選んだ機構で cross-tenant/replay/token-or-cookie-leak の敵対的 enumerate を 1 回（#1 gate）

*Phase 64-A.26 Phase 4 設計 spike / (b)(c) sealed・(a) user-gated / advisor 検証反映*
