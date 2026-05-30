# Phase 69 並列実装計画 Codex 敵対レビュー

対象: `phase-handoff/phase-69-beta-parallel-plan.md`  
入力: `phase-handoff/phase-68-feature-audit.md`

## 総評

分類と「migration は main 直列」の方針は正しいが、現計画は衝突面と must の抜けを過小評価している。特に `statuses.color` と `version×4` は migration だけではなく、service、form、list select、既存 UPDATE、テストまで波及する横断変更。S3 の worktree fan-out も `vendor-shell.tsx` と `transport-orders.ts` に集中するため、そのまま並列化すると統合で詰まる。

## 1. 依存見落とし

### statuses.color

`statuses.color` の下流は計画より広い。最低限、`src/lib/db/schema/statuses.ts`、`src/lib/services/statuses.ts`、status 新規/編集 page と actions、service ticket の固定 `bg-blue-100` バッジ、calendar event color mapping、既存 statuses への default color/backfill までを S0a の完了条件に入れるべき。Phase 69 は「カレンダー色分け」と「statuses UI」は追っているが、整備伝票一覧の色分けと seed/backfill を落としている。

### version×4

`version×4` は S0b migration + S4 IF MATCH では粒度が粗い。既存 UPDATE は HTTP API ではなく Server Actions と service 関数で、`customers.ts`、`vehicles.ts`、`service-tickets.ts` の update/delete、各 detail page の hidden `expectedVersion`、actions の parse、service の `SET version = version + 1 WHERE version = expectedVersion`、0 row update の domain error 化まで必要。`reservations` は管理側作成/更新 UI 自体が欠落しており、version 配線だけ先行しても受け皿がない。

### invitation expirer

`transport_order_invitations` の期限切れ対応は `invitation-expirer.ts` だけでなく `src/lib/inngest/client.ts` の登録にも触る。既存 function 拡張なら同一ファイル衝突、新 function 追加なら登録ファイル衝突が起きる。さらに expired 化が invitation だけでよいのか、inbox/outbox/transport order status へ波及させないのかを明記すべき。

## 2. worktree 並列衝突

- `src/components/vendor-portal/vendor-shell.tsx`: S3 の shell/inbox/list/detail/progress/invite が全て依存する。1 owner 固定が必要。
- `src/components/layout/admin-shell.tsx`: S2 floor nav、S4 設定/運用 UI、予約作成 §2 の導線が衝突する。
- `src/lib/services/transport-orders.ts`: S1 outbox payload と S3 detail/progress/invite が同じ巨大 service に集中する。S3 は可能なら vendor portal 専用 query service に分けるべき。
- `src/lib/inngest/client.ts` と `src/lib/db/schema/index.ts`: Inngest function 登録と schema export の集約点。直列 owner を置くべき。

## 3. 着手順の破綻

第1波に S3 fan-out を入れるのは早い。S3 は vendor_portal_inbox の状態設計、通知 payload、期限切れ invitation、vendor shell、transport order detail query に依存する。先に S1 outbox repair と vendor route/data contract を main に固定し、その後 inbox/detail の縦切りを通してから list/progress/invite を並列化する方がよい。

S2 の稼働率 service も直列ボトルネック。dashboard、calendar compact、floor board が共有するなら、店舗×日付×lane の fixture test と service contract を先に固めるべき。UI を先に並べると mock 前提の作り直しが増える。

## 4. 高 stake: outbox/notification

S1 の検証は甘い。「payload が空でない」「1通テスト送信成功」だけでは再発防止にならない。最低限、`createTransportOrderWithNotification` の unit/integration で `payload.to/subject/html` non-empty、recipient 解決元の優先順位、dispatcher 側の欠損 payload validation、idempotency key 維持、outbox → dispatcher → delivery log → vendor inbox の追跡、外部 Resend に依存しない mock test を acceptance criteria に入れるべき。

## 5. スコープのカット線

最大の抜けは Phase 68 の β must #4「予約作成画面 §2 全体」が Phase 69 から落ちていること。β must 全完了を掲げるなら、管理側 reservation INSERT の薄い縦切りは計画に戻す必要がある。これを落とすなら、β must から外す明示承認が必要。

later のうち顧客予約変更/キャンセル、PDF、LINE/SMS、経理証跡は妥当。ただし `work_menus.visibleToCustomers` は顧客予約デモを見せるなら should ではなく前提修正に近い。React Email も業者依頼メール1本だけに絞るなら、β demo の通知対象を明記すべき。

## 6. 代替の分担/順序

1. Schema/Contract Spine: `statuses.color` は migration/schema/service/form/backfill/整備伝票バッジまで。`version×4` は migration/schema/error class/1テーブル exemplar まで。
2. Notification Critical Path: payload contract、React Email 業者依頼、dispatcher validation、outbox/inbox/retry 検証を先行。
3. Admin Core Vertical Slice: 稼働率 service、dashboard、calendar compact、floor board、予約作成 §2 の薄い縦切り。
4. Vendor Portal Contract First: vendor shell/nav と inbox data contract を1 ownerで固定し、request list/detail、respond/progress/invite を後続並列。
5. Settings/Operations UI: permissions matrix、statuses.color UI、version 配線を table ごとに分割。

## 最重要指摘

1. `予約作成画面 §2 全体` が Phase 68 の must なのに Phase 69 計画から落ちている。
2. `statuses.color` と `version×4` は migration ではなく既存 service/form/list/update/test まで巻き込む横断変更で、S0/S4 の粒度が粗すぎる。
3. S3 worktree fan-out は `vendor-shell.tsx` と `transport-orders.ts` に集中衝突するため、先に vendor route/data contract を main で固定すべき。
