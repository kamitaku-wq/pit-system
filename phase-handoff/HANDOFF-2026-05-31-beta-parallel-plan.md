# 引き継ぎ書 — 2026-05-31 (β完走 並列体制セッション)

> 再起動後の最初の指示: このファイル + phase-68-*.md を読み、「現状報告→相談」から再開。いきなり実装に入らない。
> claude-mem 無効化を反映するため再起動した直後を想定。

## 0. なぜ再起動したか
- claude-mem プラグイン(`claude-mem@thedotmack`)のフックが Windows で壊れており
  (`worker unreachable` / `printf: write error: Permission denied`)、PreToolUse:Read / PreToolUse:Glob /
  PostToolUse:Bash を断続ブロックしていた(画像Readが4/5失敗)。
- 対処済: `~/.claude/settings.json` の `enabledPlugins["claude-mem@thedotmack"]` を **false** に変更
  (バックアップ: `~/.claude/settings.json.bak-pre-claudemem-disable`)。他プラグインは true 維持。
- プラグイン無効化はセッション再起動で反映 → 本ファイルは再起動後の継続用。
- 反映確認: 再起動後に Read/Glob が普通に通れば成功。まだ `worker unreachable` が出るなら
  `/hooks` で確認、または settings.json の false を再確認。

## 1. ユーザーの主目的 (今セッションで確定)
- **α版納期(2026-05-31 alpha-core ハードDDL)はすでに到達済み**(業者ループ+認証+本番デプロイ)。
- 次の主目的: **β版(mvp-release)まで最短で完走**したい。複数並行作業でスピードアップしたい。
- 品質基準: **プロダクション品質**(テスト80%維持・レビュー必須)。← ユーザー確定。

## 2. 並列体制 (確定した方針)
- **手段**: このセッション(Claude main)を司令塔にし、**Workflow ツール + Codex 委任**で並列化。
  複数PC/物理セッションは使わず、1セッションから多数サブエージェントを並列起動するのが最シンプル(ユーザー了承)。
  - Codex は実機で利用可(codex-cli 0.135.0, ChatGPT認証 kamitaku@funct.jp, verified)。私が裏で起動→レビュー→要約報告。ユーザーの手動操作不要。
  - UIモック生成(Codex app)は**不要**(完成デザインが既存、後述)。
- **役割分担**:
  | 役割 | 担い手 |
  |---|---|
  | 司令塔・スキーマ・統合マージ・レビュー・green確認・最終判断 | このセッション(Claude main)+ユーザー |
  | 核心の対話実装(カレンダー+店舗別ピット稼働=今日の工場ボード) | このセッション |
  | 独立機能の初稿/テスト/レビューの並列ファンアウト | Workflow(worktree隔離) |
  | 仕様明確な独立タスクの作り込み | Codex 委任(worktree分離) |
- **律速**: プロダクション品質では統合・レビュー・テストが律速(実装並列度ではない)。
  直列ボトルネック(スキーマ→統合→レビュー→green)を太く速く保つのが最短化の本質。
- **本番DB注意**: 本番 Supabase は1個(`ljcruianqmfhpdzvfubl`)。複数並列が同時に触るのは危険。
  開発はローカルDB、本番migrationはmain集約・直列。

## 3. 先行確認の成果 (durable・計画の入力)
### 3.1 スキーマ充足 → `phase-handoff/phase-68-schema-readiness-precheck.md`
- **β機能が要するテーブル/カラムは既存46テーブルでほぼ全充足。新規テーブル不要。**
- 直列ボトルネック「スキーマ確定」は事実上ほぼ空 → β機能は即レーン並列に投入可。
- 唯一の migration 候補: `statuses.color`(色分け用。(A)フロント定数マップでmigrationゼロ も可)。
- reservations(storeId/laneId/startAt/endAt/statusId/workMenuId), lanes(capacity), lane_working_hours,
  store_business_hours/holidays, service_tickets, vehicles, reservation_settings, company_settings,
  audit_logs, system_settings, transport_orders すべて確認済。
- レーン稼働率(= 予約済分/稼働可能分)は既存スキーマで計算可能。
- 再利用候補サービス: `src/lib/services/calendar-events.ts`, `reservation-availability.ts`。

### 3.2 既存UIデザイン → `phase-handoff/phase-68-design-reference-map.md`
- **`docs/assets/screenshots/` に完成デザイン50枚(全ASCII名・Codex/Workflowも直接読める)**。
  spec全画面(§1業務/§3設定/§4業者/§5顧客/§6印刷/§7モバイル)をカバー。UIモック工程は不要。
- **★核心の「店舗別ピット稼働」はデザイン確定済み**(c2-calendar 視覚確認済):
  - `c2-calendar.png`(縮小表示モード) = 店舗カードgrid。各カードに レーン数 / 稼働率バー+「予約/容量・%」 /
    稼働時間 / 店間移動件数 / ⚠要対応バッジ。12店舗一覧。詳細表示トグルでレーン別タイムライン。
  - `c6-floor.png` = 「今日の工場ボード」(店舗ピット稼働のフロアボード)。**ユーザー確認済で確定**。
  - `c1-dashboard.png`/`c1-kpi.png` = ダッシュボード(KPI/ピット稼働カード)。
- **意図されたナビIA**(c2-calendarで確認、現admin-shellと異なる・業務志向):
  ホーム/カレンダー/顧客予約/店間整備依頼/業者通知・回送/整備伝票/**今日の工場ボード**/一覧表/
  (区切り)/通知の再送・確認/操作記録/設定。→ ナビIA作り直しもβ作業。
- 実装方針: **デザイン準拠(レイアウト/配色/情報設計の正)+ ロジックはspecが正**。委任時はPNG絶対パスを渡す。

## 4. α/β スコープの事実 (roadmap)
- alpha-core(5/31必達)= 業者通知ループ+最小マスター+認証 → **到達済み**。
- mvp-release(6/2~)= β: β-1 カレンダー / β-2 整備伝票+車両 / β-3 顧客予約 / β-4 v1.0.0。
- ユーザー指摘の「店舗別ピット稼働」は roadmap上β-1。ただしdemoインパクト大=前倒し価値あり。
- 注意(CLAUDE.md規律): 日付・確度の自発予測はしない。残タスク・依存の事実提示に留める。

## 5. 未完: α-readiness 機能監査 (再実行が必要)
- Workflow で spec全章×実装の網羅監査を起動していたが、再起動で中断。
- スクリプト: `~/.claude/projects/.../workflows/scripts/alpha-feature-audit-wf_16b965c9-279.js`(別セッションでは要再作成の可能性)。
- 目的: 実装済/部分/スタブ/未実装 を α-scope付きで網羅 → `phase-handoff/phase-68-feature-audit.md` に出力予定(未生成)。
- 再起動後に Workflow を再実行(別セッションなので resumeFromRunId は不可→新規実行)。

## 6. 次アクション (再起動後)
1. 本ファイル+phase-68-schema-readiness-precheck.md + phase-68-design-reference-map.md を読む。
2. 監査 Workflow を再実行 → 残タスク・直列箇所を確定(phase-68-feature-audit.md 生成)。
3. 監査結果 × スキーマ充足 × デザイン × roadmap で
   **「レーン割り当て × 着手順 × どれをWorkflow/Codex/このセッションでやるか」の具体計画**を作成。
4. advisor + Codex で計画レビュー(着手前)。
5. 承認後: (statuses.color 採るなら)スキーマ先行 → 独立機能をCodex/Workflow並列 → 核心(工場ボード+カレンダー)はこのセッション → main逐次統合+green確認。

## 7. リポジトリ状態
- branch main, origin同期。working tree に未コミットの phase-handoff/phase-68-*.md(3枚)あり(本ファイル含む)。
  → これらは設計ドキュメントなのでコミットしてよい(ユーザー判断)。
- 検証コマンド: `npx tsc --noEmit` / `npx next build` / `npx vitest run --project=unit`。
- コミットは tsc+build+test green 目視後の規律。

---
*Handoff / Claude 2026-05-31 / β並列体制セッション。claude-mem無効化のため再起動 → 本ファイルから再開。*
