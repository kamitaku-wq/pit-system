/* global React, Shell, PageHeader, Icon, Badge, Button */
// 段取りくん — Settings top (§F.0)

const SettingsCard = ({ icon, title, sub, count, danger }) => (
  <button style={{
    display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 12,
    padding: '20px 20px', background: '#fff', border: '1px solid var(--border)',
    borderRadius: 8, textAlign: 'left', cursor: 'pointer',
    transition: 'border-color .12s, box-shadow .12s',
    width: '100%', minHeight: 132,
  }}
  onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--primary)'; e.currentTarget.style.boxShadow = 'var(--shadow-card-hover)'; }}
  onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.boxShadow = 'none'; }}>
    <div style={{
      width: 36, height: 36, borderRadius: 8,
      background: danger ? 'var(--danger-light)' : 'var(--primary-light)',
      color: danger ? 'var(--danger)' : 'var(--primary)',
      display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
    }}>
      <Icon name={icon} size={18} />
    </div>
    <div style={{ flex: 1 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <div style={{ fontSize: 14.5, fontWeight: 600 }}>{title}</div>
        {count != null && <span className="badge badge-muted tabular">{count}</span>}
      </div>
      <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5 }}>{sub}</div>
    </div>
  </button>
);

const SettingsGroup = ({ title, children }) => (
  <section style={{ marginBottom: 28 }}>
    <h3 className="sec-h" style={{ marginBottom: 12 }}>{title}</h3>
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12 }}>{children}</div>
  </section>
);

const ScreenSettings = () => (
  <Shell audience="admin" active="settings">
    <PageHeader title="設定" subtitle="会社・店舗、レーン、業者、通知ルール、コンプライアンスなどの管理" />
    <div style={{ padding: '24px 28px 60px', maxWidth: 1100, margin: '0 auto', width: '100%' }}>
      <SettingsGroup title="会社 ・ 店舗">
        <SettingsCard icon="Building2" title="会社設定" sub="会社情報、ロゴ、免責文言、本部の権限範囲" />
        <SettingsCard icon="Store" title="店舗管理" sub="店舗の追加・編集・削除、住所、連絡先" count={4} />
        <SettingsCard icon="CalendarClock" title="営業時間 / 休日" sub="店舗ごとの曜日別営業時間と祝日設定" />
      </SettingsGroup>

      <SettingsGroup title="レーン ・ 作業">
        <SettingsCard icon="Layers" title="レーン種別" sub="メンテナンス / 重整備 / 汎用などのカテゴリ" count={3} />
        <SettingsCard icon="Wrench" title="レーン" sub="店舗 × レーン名 × 同時受付数 + 対応できる作業メニュー" count={11} />
        <SettingsCard icon="Clock4" title="レーン稼働時間" sub="レーン単位の曜日別稼働、定休、特別営業" />
        <SettingsCard icon="FolderTree" title="作業カテゴリ" sub="法定 / メンテナンス / 修理などの大分類" count={6} />
        <SettingsCard icon="ListChecks" title="作業メニュー" sub="メニュー名、所要時間、料金、対応レーン" count={24} />
      </SettingsGroup>

      <SettingsGroup title="予約 ・ ステータス">
        <SettingsCard icon="CalendarPlus" title="予約枠" sub="営業時間の刻み、準備時間、仮予約の期限" />
        <SettingsCard icon="Tags" title="ステータス" sub="予約 / 整備伝票 / 回送の状態定義" count={18} />
        <SettingsCard icon="GitBranch" title="状態遷移ルール" sub="状態間の遷移可否と、誰がどの操作をできるか" />
      </SettingsGroup>

      <SettingsGroup title="業者">
        <SettingsCard icon="Truck" title="業者一覧" sub="登録業者、対応エリア、対応店舗、対応曜日" count={9} />
        <SettingsCard icon="Users" title="業者ログインアカウント" sub="業者用のログイン管理、認証、招待 URL" count={18} />
      </SettingsGroup>

      <SettingsGroup title="通知 ・ 権限">
        <SettingsCard icon="BellRing" title="通知ルール" sub="通知の種類と送り先、送信方法を設定します" count={12} />
        <SettingsCard icon="ShieldCheck" title="権限" sub="役割ごとの閲覧・操作範囲を設定します" count={6} />
        <SettingsCard icon="Columns" title="表示項目" sub="一覧画面の列構成と並び順を役割別にカスタマイズ" />
      </SettingsGroup>

      <SettingsGroup title="コンプライアンス">
        <SettingsCard icon="Fingerprint" title="顧客本人確認" sub="本人確認の方法、データ保管期間、外部サービス連携" danger />
        <SettingsCard icon="History" title="操作記録" sub="操作ログの保管期間、出力、検索条件" danger />
      </SettingsGroup>
    </div>
  </Shell>
);

Object.assign(window, { ScreenSettings });
