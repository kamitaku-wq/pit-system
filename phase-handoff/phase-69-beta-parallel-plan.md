# Phase 69: β完走 並列実装計画 v2 (advisor + Codex レビュー反映済 / 承認待ち)

> 作成: 2026-05-31 / 入力: phase-68-feature-audit.md / レビュー: advisor + Codex (phase-69-codex-review.md)
> 状態: **承認待ち**。本v2は v1 ドラフトを advisor(3点) + Codex(3点) + outbox前提のコード検証 で改訂したもの。ユーザー承認後に実装着手。
> 規律: 日付・確度の自発予測はしない (CLAUDE.md)。残タスク・依存・分担の事実提示に留める。

---

## 0. 入力サマリ (監査 + 検証)

- 監査55項目: done 11 / partial 27 / stub 5 / missing 12。β must ブロッカー 16〜18件。
- 核心「店舗別ピット稼働」= ダッシュボードピット稼働(欠落) / カレンダー縮小モード+色分け(欠落) / 今日の工場ボード c6-floor(実装ゼロ)。
- スキーマ: 既存50テーブルでほぼ充足。必要 migration = **statuses.color + version×4 のみ**（ただし下流波及は大、§2参照）。
- tenant: 一社専用 pivot でも company_id/RLS は内部不変条件として維持 (ADR-0001 有効)。

---

## 1. ★検証で確定した重大事実: 業者通知メールの描画レイヤーが存在しない

advisor 指摘で「outbox が壊れている」前提をコード検証した結果、**監査の発見は本物**:

| 検証 | 事実 (ファイル:行) |
|---|---|
| dispatcher の送信 | `outbox-dispatcher.ts:200-202` が payload の `to`/`subject`/`html` を**直読み**。再fetch・renderなし |
| 初回招待 | `transport-orders.ts:266` payload = `notificationPayload ?? {}`。アクション未指定で**空** |
| 他イベント(cancel/reopen/confirm) | `transport-orders.ts` の各 payload は `invitee_email` 等を組むが **to/subject/html は組まない** → これらも空 |
| 顧客認証メール | `customer-reservation-verification.ts:161-163` は to/subject/html を組む → **動作する唯一の手本** |

**結論**: α は「DB状態機械 + 業者ポータル + 顧客認証メール」は機能するが、**業者向けメールの中身(to/subject/html)を組む層が一度も作られていない**。= spec 最重要機能「業者へメール確実送信」は未達。S1 は実在ストリーム（v1 の「アクションから payload を渡す」より**大きい = 描画層新設**）。

---

## 2. 設計原則 (律速の扱い・レビュー反映)

| 原則 | 内容 |
|---|---|
| **律速は統合・レビュー・green** | 実装並列度でなく main での migration適用→マージ→review(+Codex)→green が throughput を決める。 |
| **★contract-first (Codex#3反映)** | worktree fan-out の前に、共有 service / route / data contract を main で固定する。contract 未固定での並列化は統合で詰まる。 |
| **migration は main 直列専管 + 下流まで1単位** | statuses.color / version×4 は migration だけでなく schema/service/form/list/既存UPDATE/backfill/test まで1ストリームの完了条件に含める (Codex#2)。 |
| **★ファイル所有権を明示 (advisor#3/Codex#3)** | 共有ファイルは単一 owner。他ストリームは import のみ。§3 のマップを厳守。 |
| **★視覚適合ゲート (advisor#2)** | demo核心画面は green 後に「アプリ起動→スクショ(e2e-runner/agent-browser)→confirmed PNG 比較」で乖離を検査。本効果の起点(design乖離)を出力側で symmetric に検証する。 |
| **高 stake は Claude リード** | outbox/notification, migration, 認可境界は Claude が設計・レビュー。 |
| **デザイン準拠 + spec がロジックの正** | 実装は confirmed PNG に合わせ、ロジック/契約は spec が正。 |

---

## 3. ★ファイル所有権マップ (衝突回避・厳守)

| 共有ファイル | owner | 他ストリームの扱い |
|---|---|---|
| `src/lib/db/schema/index.ts` | **S0 (main)** | 全 schema export は S0 が集約。他は触らない |
| `src/lib/inngest/client.ts` | **S0 (main)** | Inngest function 登録は S0 集約 (expirer 含む) |
| `src/lib/services/statuses.ts` + calendar color map | **S0a** | S4 statuses UI は S0a 後に import |
| `src/lib/services/transport-orders.ts` (2402行) | **S1 (outbox payload)** | S3 は**直接触らない**。vendor 閲覧用 query は新設 `vendor-portal-orders.ts` 経由 (S3a が新設) |
| 稼働率 service (新設 `src/lib/services/pit-utilization.ts` 想定) | **S2 (このセッション)** | dashboard/calendar/floor が consume。contract+fixture を先に固定 |
| `src/components/vendor-portal/vendor-shell.tsx` | **S3a (vendor contract)** | inbox/list/detail/progress/invite は import のみ |
| `src/components/layout/admin-shell.tsx` | **S2 (このセッション)** | floor/§2予約/S4設定 の nav 追加は S2 に依頼して集約 |

---

## 4. ストリーム定義 (5本・contract-first 再編)

| ストリーム | 内容 | 主手段 | 位置 |
|---|---|---|---|
| **S0 Schema/Contract Spine** | statuses.color (下流まで) / version×4 (exemplar+error class) / expirer登録 / vendor・稼働率 contract 固定 | **Claude main (直列・最初)** | 第1波・全ての前提 |
| **S1 Notification Critical Path** | 業者メール描画層 (event→{to,subject,html}) + React Email + dispatcher validation + 追跡テスト | **Claude リード + Codex** (高 stake) | 第1波 (S0と並列着手可) |
| **S2 Admin Core Vertical Slice** | 稼働率service → ①dashboard ②calendar compact+色 ③floor board ④**予約作成§2 薄い縦切り(復活)** | **このセッション (Claude核心)** | 第1〜2波 (核心) |
| **S3 Vendor Portal (contract-first)** | 3a:shell/nav+inbox contract(main) → 3b:inbox/detail 縦切り → 3c:list/respond/progress/invite 並列 | **3a=main / 3b-c=Workflow+Codex** | S0/S1 後 |
| **S4 Settings/Ops UI** | 権限matrix / 通知失敗UI日本語化 / statuses.color UI / version IF MATCH 配線(table毎) | **Codex 委任** | 即着手分 + S0後分 |

---

## 5. 着手順・波 + 最初の demo 可能マイルストーン

```
第1波: [S0 spine (main直列)] ∥ [S1 業者メール描画層] ∥ [S4 即着手分: 権限matrix / 通知失敗UI日本語化]
        ↓ (S0 statuses.color 完了)
第2波: [S2① dashboard] [S2② calendar色分け] [S4 statuses.color UI] [S0b後→ S4 version配線(service_tickets/customers/vehicles)]
        ↓ (S0 vendor contract + S1 固定)
第3波: [S2③ floor board] [S2④ 予約作成§2 → reservations version配線] [S3b inbox/detail] [S3c fan-out: list/respond/progress/invite]
```

- **M1 (最初の demo 可能)**: S0 spine + **S1 業者メール実送信** + **S2① dashboard ピット稼働** + **S2② calendar 縮小+色分け**。= 「店舗別ピット稼働が見える + 業者通知が実際に届く」コア。**マージ順を M1 に最適化**。
- **M2**: + S2③ floor board + S2④ 予約作成§2 + S3b vendor inbox/detail。
- **M3**: + S3c 残り vendor 画面 + S4 残り + should 核心。

---

## 6. ストリーム別タスク内訳 (下流まで・レビュー反映)

### S0 Schema/Contract Spine (main 直列・最初)
| タスク | 完了条件 (Codex#2 で下流拡張) |
|---|---|
| **statuses.color** | migration + `schema/statuses.ts` + `services/statuses.ts` + status 新規/編集 page+actions + **既存statusesへ default color backfill(seed)** + **整備伝票バッジの `bg-blue-100` 固定撤廃** + **calendar event color mapping 契約** + tsc/test 緑 |
| **version×4** | migration(reservations/service_tickets/customers/vehicles) + **OptimisticLockError class** + **exemplar 1テーブル(service_tickets)完全配線(service `SET version=version+1 WHERE version=expected`, 0row→domain error, detail hidden `expectedVersion`, action parse)**。残table配線は S4。reservations は §2 縦切り後 (受け皿UI必要) |
| **invitation expirer** | `invitation-expirer.ts` を transport_order_invitations 対応 + `inngest/client.ts` 登録 (main集約) + **expired 波及範囲明記** (invitation のみか inbox/outbox/status へ波及か) + unit test |
| **contract 固定** | 稼働率 service の interface + 店舗×日付×lane fixture / vendor 閲覧 query service `vendor-portal-orders.ts` の interface + vendor-shell nav contract |

### S1 Notification Critical Path (Claude リード + Codex, 高 stake)
| タスク | 完了条件 (Codex#4 で acceptance 強化) |
|---|---|
| 業者メール描画層 (event_type → {to,subject,html}) | invite/cancel/reopen/store_confirmed の各 event で to/subject/html を組む。**render-at-enqueue 方式**(顧客認証パスを踏襲) を推奨。recipient 解決元の優先順位を明記 |
| React Email テンプレ (emails/ 新設) | 業者依頼メール(必須) + β demo 対象イベント(invite + cancel/reschedule)。render→payload.html 注入 |
| dispatcher 欠損 payload validation | to 空などを fail-fast / 明示エラー (空メール送信を構造的に防止) |
| 追跡テスト | integration: payload.to/subject/html non-empty / idempotency維持 / outbox→delivery_log→vendor inbox 追跡 / **Resend mock** (外部依存なし) |

### S2 Admin Core Vertical Slice (このセッション = Claude核心)
| タスク | デザイン | 完了条件 |
|---|---|---|
| 稼働率 service (予約済分/稼働可能分) — fixture+contract 先 | — | 店舗×日付で稼働率/件数/容量/店間/要対応 を返す + unit test |
| ① dashboard ピット稼働 + 本日予約KPI + 通知失敗KPI | c1-dashboard.png/c1-kpi.png | 店舗別稼働バー・4KPI・期限切れ間近リスト + 視覚適合 |
| ② calendar 縮小モード(店舗カードgrid)+詳細トグル+色分け+フィルタ | c2-calendar/compact.png | 12店舗カードgrid・statuses.color色分け・店舗/レーン/作業種別フィルタ + 視覚適合 |
| ③ 今日の工場ボード (c6-floor) 新規 + ナビ | c6-floor.png | レーン別ボード + admin-shell nav 追加 + 視覚適合 |
| ④ **予約作成§2 薄い縦切り (復活, Codex#1)** | (§2フロー) | 管理側 reservations INSERT の最小縦切り → reservations version 配線の受け皿 |

### S3 Vendor Portal (contract-first → 縦切り → fan-out)
| 段 | タスク | デザイン | 手段 |
|---|---|---|---|
| 3a (main先行) | vendor-shell nav 5アイテム+ブランド「段取りくん」 / `vendor-portal-orders.ts` query service / inbox data contract | d1-inbox.png | Claude 設計 + Codex |
| 3b (縦切り) | 通知inbox(4.0, severity/既読 状態設計=Claude) / 依頼詳細(4.2 store/vehicle JOIN) | d1-inbox/d3-detail.png | Claude状態設計→Codex |
| 3c (並列fan-out) | 新規依頼一覧(4.1 情報密度) / 対応可否モーダル(4.3) / 進捗更新(4.4, 写真記録はStorage=Claude) / 招待4ステップ(4.3.1, 状態設計=Claude) | d2/d4/d6/d5.png | Workflow(worktree)+Codex |

### S4 Settings/Ops UI (Codex 委任・table毎分割)
| タスク | デザイン | 位置 |
|---|---|---|
| 権限 操作×ロール マトリクスUI | f15-perms.png | 即 |
| 通知失敗運用UI 日本語化+タブ+一括再送 | c8-ops.png | 即 |
| statuses.color UI (color picker) | f11-status.png | S0a後 |
| version IF MATCH 配線 (service_tickets→customers→vehicles, table毎) | — | S0b後 |

---

## 7. 統合・レビュー・green + 視覚適合ゲート (律速管理)
1. 各ストリームは worktree で実装 → diff を main に提出。
2. main (Claude) が順に: ①migration先適用 ②マージ ③code-review (高stakeは code-reviewer + Codex 並走) ④`npx tsc --noEmit` + `npx next build` + `npx vitest run --project=unit` green。
3. **★視覚適合ゲート (demo核心画面のみ)**: green 後に e2e-runner/agent-browser でアプリ起動→当該画面スクショ→confirmed PNG と比較し、重大乖離が無いことを確認してから commit。(緑だけではデザイン乖離=本効果の起点を検知できないため)
4. green + 視覚適合 通過後に commit。失敗は当該ストリームへ差し戻し。バッチ単位レビューで context 切替を抑制。

---

## 8. should / later
- **should (余力で・推奨順)**: 店間整備依頼フルatomicウィザード§1.4 / 業者回送 右ペイン§1.5 / カレンダー空き枠ドラッグ作成 / 顧客予約フロー仕上げ§5.1 / 設定トップ・会社設定§3.0-3.1 / 状態遷移グラフ§3.11。
- **★prereq (Codex#5)**: `work_menus.visibleToCustomers` の管理側露出 — 顧客予約 demo を見せるなら should でなく前提修正。
- **later (β対象外確定)**: 表示項目§3.16 / 監査ログ設定§3.18 / 監査ログ閲覧§1.9 / 顧客予約変更§5.3・キャンセル§5.4 / LINE・SMS / 経理証跡 / PDF§6.1-6.3。

---

## 9. リスク・未検証 (監査§8 + レビュー)
- outbox 実送信は本番/Inngest ログ or E2E 確認 (S1 acceptance に組込済)。
- Google OAuth 本番 provisioning・seed の viewer role 有無は実環境確認要。
- 顧客予約 rate limit 値 (実装 per-IP 5/600s vs spec 1分1回・1日5回) は β-3 着手前に合意。
- ナビIA: confirmed デザインは業務志向7項目+設定集約。本計画は floor/§2 の nav 追加に留め、**全面IA刷新は should 扱い (明示的に保留, 黙殺しない)**。
- pg_cron `purge_expired_reservation_rows` 手動適用 (本番手順書要記載)。

---

## 10. 承認を求める判断点 (ユーザー)
1. **計画 v2 全体**で実装着手してよいか (M1 マイルストーン優先でマージ順最適化)。
2. **予約作成§2** を β must に**復活**(薄い縦切り, Claude核心) で合意か (Codex 指摘。落とすなら明示 descope 承認が必要)。
3. **メール描画方式**: render-at-enqueue (顧客認証パス踏襲) を推奨。これでよいか。
4. **ナビIA**: 今は最小 nav 追加に留め、**全面IA刷新は should 保留**でよいか (今すぐ刷新も可)。
5. **statuses.color**: (B)migration + 下流(backfill/伝票バッジ/calendar map) を採用でよいか。

---
*Phase 69 v2 / Claude 2026-05-31 / advisor+Codex 反映済。次: ユーザー承認 → S0/S1 第1波 着手。*
