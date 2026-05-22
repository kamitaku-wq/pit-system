/* global React, ReactDOM, DesignCanvas, DCSection, DCArtboard,
   ScreenDashboard, ScreenCalendar, ScreenTransferRequest, ScreenVendorNotify, ScreenTickets, ScreenOps,
   ScreenCustReservations, ScreenVehicles, ScreenAudit,
   ScreenVendorRequestDetail, ScreenVendorAcceptModal, ScreenInviteAccept, ScreenVendorInbox,
   ScreenVendorNewList, ScreenVendorNewListMobile, ScreenVendorProgress,
   ScreenCustomerStep1, ScreenCustomerStep2, ScreenCustomerStep3, ScreenCustomerStep4, ScreenCustomerStep5, ScreenCustomerStep6, ScreenCustomerConfirm,
   ScreenCustomerModify, ScreenCustomerCancel, ScreenCustomerResend, ScreenToasts,
   ScreenSettings, ScreenLanesSettings, ScreenVendorsMaster, ScreenStateMachine, ScreenConflictModal,
   ScreenCompanySettings, ScreenBusinessHours, ScreenWorkMenus, ScreenStatusSettings, ScreenNotificationRules, ScreenPermissions, ScreenKyc,
   ScreenVendorMobile, ScreenAdminMobile, ScreenStatesGallery, ScreenCopyCatalog,
   ScreenDashboardKpi, ScreenCalendarCompact, ScreenPhoneReceipt, ScreenFloorBoard,
   PrintServiceTicket, PrintTransportOrder, PrintDriverInstruction */

const W = 1440;
const H = 900;
const MOBILE_W = 390;
const MOBILE_H = 820;
const PRINT_W = 700;
const PRINT_H = 940;
const PRINT_LAND_W = 940;
const PRINT_LAND_H = 700;

const App = () => (
  <DesignCanvas>
    <DCSection
      id="admin"
      title="管理画面 (Admin · §C)"
      subtitle="9 画面 + 楽観排他 UI · 本部管理者・店長・現場スタッフ向け"
    >
      <DCArtboard id="c1-dashboard" label="C.1 · ダッシュボード ★★★" width={W} height={H}><ScreenDashboard /></DCArtboard>
      <DCArtboard id="c1-kpi" label="C.1+ · 経営 KPI ダッシュボード (30 日)" width={W} height={H}><ScreenDashboardKpi /></DCArtboard>
      <DCArtboard id="c2-calendar" label="C.2 · ピット予約カレンダー ★★★" width={W} height={H}><ScreenCalendar /></DCArtboard>
      <DCArtboard id="c2-compact" label="C.2+ · 多店舗 縮小ビュー (12 店舗)" width={W} height={H}><ScreenCalendarCompact /></DCArtboard>
      <DCArtboard id="c3-cust-res" label="C.3 · 顧客予約一覧" width={W} height={H}><ScreenCustReservations /></DCArtboard>
      <DCArtboard id="c3-phone" label="C.3+ · 電話受付 (代行入力モード)" width={W} height={H}><ScreenPhoneReceipt /></DCArtboard>
      <DCArtboard id="c4-transfer" label="C.4 · 店間整備依頼 Step 3 ★★★" width={W} height={H}><ScreenTransferRequest /></DCArtboard>
      <DCArtboard id="c5-vendor-notify" label="C.5 · 業者通知・回送管理 ★★★" width={W} height={H}><ScreenVendorNotify /></DCArtboard>
      <DCArtboard id="c6-tickets" label="C.6 · 整備伝票一覧 ★★" width={W} height={H}><ScreenTickets /></DCArtboard>
      <DCArtboard id="c6-floor" label="今日の工場ボード (カンバン)" width={W} height={H}><ScreenFloorBoard /></DCArtboard>
      <DCArtboard id="c7-vehicles" label="C.7 · 車両一覧" width={W} height={H}><ScreenVehicles /></DCArtboard>
      <DCArtboard id="c8-ops" label="C.8 · 通知の再送・確認 ★" width={W} height={H}><ScreenOps /></DCArtboard>
      <DCArtboard id="c9-audit" label="C.9 · 操作記録" width={W} height={H}><ScreenAudit /></DCArtboard>
      <DCArtboard id="b10-conflict" label="B.10 · 同時更新の競合 UI" width={W} height={H}><ScreenConflictModal /></DCArtboard>
    </DCSection>

    <DCSection
      id="vendor"
      title="業者ポータル (Vendor Portal · §D)"
      subtitle="6 画面 · 回送業者向け · vendor_users 認証"
    >
      <DCArtboard id="d1-inbox" label="D.1 · 通知 inbox" width={W} height={H}><ScreenVendorInbox /></DCArtboard>
      <DCArtboard id="d2-new-list" label="D.2 · 新規依頼一覧 (デスクトップ)" width={W} height={H}><ScreenVendorNewList /></DCArtboard>
      <DCArtboard id="d2-new-list-m" label="D.2 · 新規依頼一覧 (スマホ · thumb zone)" width={MOBILE_W} height={MOBILE_H}><ScreenVendorNewListMobile /></DCArtboard>
      <DCArtboard id="d3-detail" label="D.3 · 依頼詳細 ★★★" width={W} height={H}><ScreenVendorRequestDetail /></DCArtboard>
      <DCArtboard id="d4-accept" label="D.4 · 対応可と回答（同意モーダル）★★" width={W} height={H}><ScreenVendorAcceptModal /></DCArtboard>
      <DCArtboard id="d5-invite" label="D.5 · 招待トークン受諾 ★★" width={W} height={H}><ScreenInviteAccept /></DCArtboard>
      <DCArtboard id="d6-progress" label="D.6 · 進捗更新" width={W} height={H}><ScreenVendorProgress /></DCArtboard>
    </DCSection>

    <DCSection
      id="customer"
      title="顧客予約画面 (Customer Booking · §E)"
      subtitle="10 画面 · モバイル中心 · エンドユーザー向け公開フロー"
    >
      <DCArtboard id="e1-step1" label="E.1 Step 1 · 店舗選択" width={MOBILE_W} height={MOBILE_H}><ScreenCustomerStep1 /></DCArtboard>
      <DCArtboard id="e1-step2" label="E.1 Step 2 · 作業メニュー ★★" width={MOBILE_W} height={MOBILE_H}><ScreenCustomerStep2 /></DCArtboard>
      <DCArtboard id="e1-step3" label="E.1 Step 3 · 日時選択 ★★" width={MOBILE_W} height={MOBILE_H}><ScreenCustomerStep3 /></DCArtboard>
      <DCArtboard id="e1-step4" label="E.1 Step 4 · 情報入力" width={MOBILE_W} height={MOBILE_H}><ScreenCustomerStep4 /></DCArtboard>
      <DCArtboard id="e1-step5" label="E.1 Step 5 · 認証コード" width={MOBILE_W} height={MOBILE_H}><ScreenCustomerStep5 /></DCArtboard>
      <DCArtboard id="e1-step6" label="E.1 Step 6 · 完了" width={MOBILE_W} height={MOBILE_H}><ScreenCustomerStep6 /></DCArtboard>
      <DCArtboard id="e2-confirm" label="E.2 · 予約確認 (token URL)" width={MOBILE_W} height={MOBILE_H}><ScreenCustomerConfirm /></DCArtboard>
      <DCArtboard id="e3-modify" label="E.3 · 予約変更 (modify token)" width={MOBILE_W} height={MOBILE_H}><ScreenCustomerModify /></DCArtboard>
      <DCArtboard id="e4-cancel" label="E.4 · キャンセル (cancel token)" width={MOBILE_W} height={MOBILE_H}><ScreenCustomerCancel /></DCArtboard>
      <DCArtboard id="e5-resend" label="E.5 · 認証コード再送（レート制限）" width={MOBILE_W} height={MOBILE_H}><ScreenCustomerResend /></DCArtboard>
    </DCSection>

    <DCSection
      id="settings"
      title="設定 (Settings · §F)"
      subtitle="11 画面 · F.0 トップ + 各カテゴリ代表 · 共通 CRUD パターンは F.4 を参照"
    >
      <DCArtboard id="f0-settings" label="F.0 · 設定トップ" width={W} height={H}><ScreenSettings /></DCArtboard>
      <DCArtboard id="f1-company" label="F.1 · 会社設定" width={W} height={H}><ScreenCompanySettings /></DCArtboard>
      <DCArtboard id="f3-hours" label="F.3 · 営業時間 / 休日" width={W} height={H}><ScreenBusinessHours /></DCArtboard>
      <DCArtboard id="f4-lanes" label="F.4 · レーン設定 (編集モーダル) [共通 CRUD パターン]" width={W} height={H}><ScreenLanesSettings /></DCArtboard>
      <DCArtboard id="f8-menus" label="F.8 · 作業メニュー (階層型)" width={W} height={H}><ScreenWorkMenus /></DCArtboard>
      <DCArtboard id="f10-vendors" label="F.10 · 業者一覧" width={W} height={H}><ScreenVendorsMaster /></DCArtboard>
      <DCArtboard id="f11-status" label="F.11 · ステータス定義" width={W} height={H}><ScreenStatusSettings /></DCArtboard>
      <DCArtboard id="f13-states" label="F.13 · 状態遷移ルール (ビジュアル)" width={W} height={H}><ScreenStateMachine /></DCArtboard>
      <DCArtboard id="f14-rules" label="F.14 · 通知ルール (rule builder)" width={W} height={H}><ScreenNotificationRules /></DCArtboard>
      <DCArtboard id="f15-perms" label="F.15 · 権限マトリクス" width={W} height={H}><ScreenPermissions /></DCArtboard>
      <DCArtboard id="f17-kyc" label="F.17 · 顧客本人確認" width={W} height={H}><ScreenKyc /></DCArtboard>
    </DCSection>

    <DCSection
      id="system"
      title="システム共通 (System · §B / §H / §J)"
      subtitle="トースト · モバイル対応 · 状態カタログ · コピー"
    >
      <DCArtboard id="b9-toasts" label="B.9 · 通知トースト 全パターン" width={W} height={H}><ScreenToasts /></DCArtboard>
      <DCArtboard id="h2-admin-mobile" label="H.2 · 管理画面 モバイル (C.1 ダッシュボード)" width={MOBILE_W} height={MOBILE_H}><ScreenAdminMobile /></DCArtboard>
      <DCArtboard id="h3-vendor-mobile" label="H.3 · 業者ポータル モバイル (D.3 依頼詳細) ★最重要" width={MOBILE_W} height={MOBILE_H}><ScreenVendorMobile /></DCArtboard>
      <DCArtboard id="j5-states" label="J.5 · 空状態 / エラー / ロード中 カタログ" width={W} height={H}><ScreenStatesGallery /></DCArtboard>
      <DCArtboard id="j4-copy" label="J.4 · コピーライティング (マイクロコピー / i18n)" width={W} height={H}><ScreenCopyCatalog /></DCArtboard>
    </DCSection>

    <DCSection
      id="print"
      title="印刷レイアウト (Print PDF · §G)"
      subtitle="3 種類 · PDF 出力モック"
    >
      <DCArtboard id="g1-ticket" label="G.1 · 整備伝票 PDF (A4 縦)" width={PRINT_W} height={PRINT_H}><PrintServiceTicket /></DCArtboard>
      <DCArtboard id="g2-transport" label="G.2 · 回送依頼書 PDF (A4 縦)" width={PRINT_W} height={PRINT_H}><PrintTransportOrder /></DCArtboard>
      <DCArtboard id="g3-driver" label="G.3 · 店間移動指示書 PDF (A4 横)" width={PRINT_LAND_W} height={PRINT_LAND_H}><PrintDriverInstruction /></DCArtboard>
    </DCSection>
  </DesignCanvas>
);

ReactDOM.createRoot(document.getElementById('root')).render(<App />);
