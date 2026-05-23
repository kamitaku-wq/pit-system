# spec 品質規約監査 v1 (2026-05-23)

## メタ

- 監査対象: spec/*.md (13 ファイル) + docs/index.html + design/project/
- 実施: Codex (Lane 3) + Claude (直接 grep 検証)
- 判定基準: 致命 (Critical = §A.8.11 顧客向け露出) / 重要 (High = 用語不統一顕著) / 補強 (Medium) / 情報 (Low)
- 監査日時: 2026-05-23

---

## A. §A.8.11 用語ポリシー違反

### A.1 顧客向け文書での違反 (致命 / Critical)

顧客向けレイヤー対象: docs/index.html, design/project/, spec/screen-list.md, spec/claude-design-handoff.md の UI 文言部

#### A.1.1 spec/screen-list.md

| 行 | 用語 | 文脈 (概要) | 推奨修正 |
|---|---|---|---|
| 16 | テナント表示 | ヘッダー表示仕様「テナント表示 → ヘッダーに会社名＋ライセンスバッジ表示」 | 「会社名表示」に変更 |
| 237 | SaaS プラン | 機能リスト内「SaaS プラン」 | 「ご契約プラン」または「利用プラン」 |
| 316 | is_shared | UI 仕様記述「共有フラグ (is_shared)」がそのまま記載 | UI 説明から削除。data-model.md のみに記載 |
| 552 | テナント単位の設定 | 設定画面の説明「テナント単位の設定」 | 「貴社の設定」または「会社設定」 |

#### A.1.2 design/project/uploads/claude-design-handoff.md

| 行 | 用語 | 文脈 (概要) | 推奨修正 |
|---|---|---|---|
| 28 | SaaS | 概要セクション「現代販売会社向け SaaS: ピット管理…」 | 「クラウド業務システム」等に変更 |
| 33 | SaaS | デザイン参考「モダン・ペルー SaaS 系（Notion / Linear…）」 | 内部設計参考であれば許容を検討。要確認 |
| 981 | is_shared | 設定画面詳細「is_shared チェックボックス（プレダイアログ）」 | is_shared を除去。「業者種別管理」等に置換 |

#### A.1.3 docs/index.html

- 違反なし (grep 結果 0 件) - 良好

#### A.1.4 spec/claude-design-handoff.md (UI 文言部)

| 行 | 用語 | 文脈 (概要) | 推奨修正 |
|---|---|---|---|
| 30 | SaaS | エリア説明「現代販売会社向け SaaS: ピットスロット表示…」 | 「業務クラウドシステム」等に変更 |
| 1199 | is_shared | 設定画面機能説明「is_shared チェックボックス」 | 「業者種別設定」等に置換 |

注: 行 246-313 は §A.8.11 ポリシー説明内の禁止用語列挙のため除外 (許容)。

### A.2 社内ドキュメントでの言及 (情報 / Low - 許容)

| ファイル | 検出件数 | 用途・許容理由 |
|---|---|---|
| spec/data-model.md | 17 件 | DB スキーマ設計。システム内部用語として正当 |
| spec/requirements.md | 10 件 | 機能要件の内部記述。設計用語として正当 |
| spec/implementation-plan.md | 4 件 | 実装計画の内部記述。設計用語として正当 |
| spec/dod-checklist.md | 複数 | 禁止用語の DoD チェックリスト記載。意図的列挙のため許容 |

---

## B. 用語不統一

### B.1 ドメイン用語の表記ゆれ

| 用語グループ | 表記パターン | ファイル別件数 (主要) | 推奨統一案 |
|---|---|---|---|
| 業者 | 業者 / ベンダー / vendor | 業者: requirements.md=101, screen-list.md=48 / vendor: data-model.md=149 | DB・コード: vendor / UI・日本語文書: 業者 / ベンダーは廃止 |
| 販売会社 | 販売会社 / 会社 / company | 販売会社: requirements.md=9 / company: data-model.md=109 | DB・コード: company / 顧客向け UI: 貴社 / 仕様書: 販売会社 |
| 予約 | 予約 / reservation / booking | 予約: requirements.md=101 / reservation: data-model.md=54 / booking: data-model.md=3 | DB・コード: reservation / UI・日本語: 予約 / booking は廃止 |
| 業者対応不可 | 対応不可 / 断り / 対応不能 / decline | claude-design-handoff.md=12, requirements.md=11 | DB・コード: decline / UI・日本語: 対応不可 / 断り・対応不能は廃止 |
| 通知キュー | outbox / アウトボックス / 通知キュー | outbox のみ全ファイルで統一済み | 統一済み。問題なし |

### B.2 重要度評価

- High: 予約/reservation/booking の 3 表記混在 (data-model.md に booking が 3 件混入)
- High: 業者/vendor の混在 (意図的な使い分けか不明瞭な箇所あり)
- Medium: 販売会社/会社/company の混在 (UI 向けに「貴社」統一が必要)
- Low: outbox 統一は完了している

---

## C. 命名規約逸脱

### C.1 テーブル名 (snake_case 複数形)

CamelCase テーブル名は検出されなかった。companies, vendors, transport_orders 等は規約準拠。
結果: 違反なし

### C.2 カラム名 (snake_case + _id / _at / _by)

主要カラムは snake_case 準拠。is_shared カラムは命名規約準拠 (boolean は is_ プレフィックス許容)。
結果: 明確な違反は未検出。目視確認推奨

### C.3 enum 値 (snake_case)

data-model.md および requirements.md 内の enum 値は snake_case (pending, verified, scheduled, declined 等) で記述。
結果: 概ね準拠

### C.4 service 関数 (camelCase 動詞先頭)

implementation-plan.md 内の関数名は camelCase 動詞先頭パターン (createTransportOrder 等)。
結果: 概ね準拠

### C.5 helper function (snake_case)

implementation-plan.md 内のヘルパー関数名は snake_case パターン (current_company_id, is_vendor_user 等)。
結果: 概ね準拠

### C.6 総合評価

命名規約は全体として良好に守られている。コード生成段階での個別チェックを DoD に含めることを推奨。

---

## D. ドキュメント構造規約

### D.1 見出し階層違反

| ファイル | 違反箇所 | 詳細 |
|---|---|---|
| spec/roadmap.md | Line 203, 212 | H1 から直接 H3 へジャンプ |

他の 12 ファイル: 違反なし

### D.2 必須セクション欠落

全 13 ファイルでメタセクションおよび関連ドキュメントセクションが欠落している。

| ファイル | メタ | 関連ドキュメント | 改訂履歴 |
|---|---|---|---|
| claude-design-handoff.md | なし | なし | なし |
| CLAUDE.md | なし | なし | なし |
| codex-review-decisions-2026-05-23.md | なし | なし | なし |
| data-model.md | なし | なし | あり (revision キーワード検出) |
| decisions-draft-2026-05-23.md | なし | なし | なし |
| implementation-plan.md | なし | なし | なし |
| requirements.md | なし | なし | なし |
| screen-list.md | なし | なし | なし |
| verification-checklist.md | なし | なし | なし |
| dependency-graph.md | なし | なし | なし |
| dod-checklist.md | なし | なし | なし |
| risks.md | なし | なし | なし |
| roadmap.md | なし | なし | なし |

判定基準: 「メタ」= ## メタ または ## Meta セクション / 「関連ドキュメント」= ## 関連 または ## Related セクション

### D.3 ToC 欠落 (1,000 行超ファイル限定)

| ファイル | 行数 | ToC |
|---|---|---|
| spec/data-model.md | 1728 行 | なし (要追加) |

他のファイルは全て 1,000 行未満のため対象外。

### D.4 改訂履歴欠落

spec/data-model.md のみ revision 関連キーワードが検出 (改訂履歴あり)。
他 12 ファイルは改訂履歴セクションが未整備。## 改訂履歴 セクションの標準化を推奨。

---

## E. 総評

### E.1 件数サマリ

| カテゴリ | 件数 | 重要度 |
|---|---|---|
| §A.8.11 顧客向け露出 (致命的違反) | 7 件 | Critical |
| 用語不統一 (主要グループ) | 4 グループ | High / Medium |
| 命名規約逸脱 | 0 件 (明確な違反なし) | - |
| 構造規約違反 | 29 件 (メタ/関連欠落 26件 + roadmap 見出し 2件 + data-model ToC 1件) | Medium / Low |

### E.2 全体品質スコア

3 / 5

- 命名規約 (C) は良好に管理されている
- §A.8.11 顧客向け文書への用語露出 (A.1) に Critical 違反が 7 件あり
- 全ファイルにメタ・関連ドキュメントセクションが欠落している (構造的な課題)
- 用語混在は概ね許容レベルだが booking (予約) の混入は修正推奨

### E.3 修正推奨優先順位 Top 5

| 優先 | 対象 | アクション | 重要度 |
|---|---|---|---|
| 1 | spec/screen-list.md L16, L237, L316, L552 | テナント→会社名, SaaS プラン→ご契約プラン, is_shared UI 文言削除, テナント単位→貴社の設定 | Critical |
| 2 | design/project/uploads/claude-design-handoff.md L28, L981 | SaaS→クラウド業務システム, is_shared チェックボックス UI 仕様から除去 | Critical |
| 3 | spec/claude-design-handoff.md L30, L1199 | SaaS→クラウド業務システム, is_shared チェックボックス→業者種別設定 | Critical |
| 4 | spec/data-model.md | ToC を追加 (1728 行、構造把握困難) | Medium |
| 5 | spec/roadmap.md L203, L212 | 見出し階層 H1→H3 の飛び級を H1→H2→H3 に修正 | Low |

### E.4 中長期推奨

- 全 spec ファイルに ## メタ (作成日・作成者・バージョン) と ## 関連ドキュメント セクションを標準追加
- booking を reservation に統一 (data-model.md 内 3 件)
- 断り・対応不能を対応不可 (顧客向け UI) / decline (DB・コード) に統一
- DoD チェックリスト (dod-checklist.md §A.8.11) に screen-list と design-handoff のレビューゲートを追加

---

*監査実施: 2026-05-23 | 次回監査推奨: 実装 Phase 1 完了後*
