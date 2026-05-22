/* global React, Shell, PageHeader, Button, Icon, Badge, StatusBadge, Field, FilterChip */
// 段取りくん — Settings part 3 (F.1 / F.3 / F.8 / F.11 / F.14 / F.15 / F.17)

// ─────────────────────────────────────────────
// F.1 会社設定（単一レコード設定フォーム）
// ─────────────────────────────────────────────
const ScreenCompanySettings = () => (
  <Shell audience="admin" active="settings">
    <PageHeader title="会社設定" breadcrumb={['設定', '会社・店舗', '会社設定']}
      right={<><Button variant="ghost">取消</Button><Button icon="Save">変更を保存</Button></>}
    />
    <div style={{ padding: '24px 28px 60px', maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Brand */}
      <section>
        <h3 className="sec-h">ブランド</h3>
        <div className="card">
          <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '160px 1fr', gap: 24 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center' }}>
              <div style={{ width: 120, height: 120, borderRadius: 12, background: 'var(--bg-subtle)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: 72, height: 72, borderRadius: 12, background: 'var(--primary)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 32, fontWeight: 700 }}>◯</div>
              </div>
              <Button variant="secondary" size="sm" icon="Upload">画像を変更</Button>
              <span style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>PNG / SVG · 512px+</span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <Field label="会社名" required><input className="input" defaultValue="株式会社 ◯◯モータース" /></Field>
              <Field label="英字表記"><input className="input" defaultValue="MARU MARU MOTORS, Inc." /></Field>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="法人番号"><input className="input tabular" defaultValue="1234567890123" /></Field>
                <Field label="代表者"><input className="input" defaultValue="◯◯ 太郎" /></Field>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="sec-h">連絡先</h3>
        <div className="card">
          <div style={{ padding: 20, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
            <Field label="本社住所" required><input className="input" defaultValue="〒150-XXXX 東京都渋谷区道玄坂 1-X-X" /></Field>
            <Field label="代表電話" required><input className="input tabular" defaultValue="03-xxxx-xxxx" /></Field>
            <Field label="代表メール"><input className="input tabular" defaultValue="info@maru-motors.example.jp" /></Field>
            <Field label="緊急連絡先（24h）"><input className="input tabular" defaultValue="0120-xxx-xxx" /></Field>
          </div>
        </div>
      </section>

      <section>
        <h3 className="sec-h">免責文言（回送依頼書 PDF に動的反映）</h3>
        <div className="card">
          <div style={{ padding: 20 }}>
            <Field label="免責文言" hint="回送依頼書 PDF に印字されます。変更内容は操作記録に残ります">
              <textarea className="textarea" style={{ minHeight: 120, fontSize: 12.5, lineHeight: 1.6 }} defaultValue="本回送依頼に基づく業務は、別途締結の業務委託契約書に従って実施されます。引取時刻から搬入完了までの車両の保管・運行責任は受託業者に帰属します..." />
            </Field>
            <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
              <span>現バージョン: v3 (2026-04-01 改訂)</span>
              <a style={{ color: 'var(--primary)' }}><Icon name="History" size={11} /> 変更履歴</a>
            </div>
          </div>
        </div>
      </section>

      <section>
        <h3 className="sec-h">本部権限・データ範囲</h3>
        <div className="card">
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              ['本部管理者の全店データ閲覧', true, '監査ログ・通知失敗・予約・整備伝票'],
              ['店長の他店データ閲覧', false, 'デフォルトは自店のみ。例外設定は権限から'],
              ['業者の連絡先を社内に公開', true, '業者マスター画面でロール別表示制御'],
              ['顧客情報の本部集約', true, '個人情報保護方針 v2 に準拠'],
            ].map(([l, on, sub], i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                  <span style={{ width: 32, height: 18, borderRadius: 999, background: on ? 'var(--primary)' : 'var(--border-strong)', position: 'relative', display: 'inline-block', flexShrink: 0 }}>
                    <span style={{ position: 'absolute', top: 2, left: on ? 16 : 2, width: 14, height: 14, borderRadius: 999, background: '#fff' }} />
                  </span>
                </label>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 13.5, fontWeight: 500 }}>{l}</div>
                  <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{sub}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  </Shell>
);

// ─────────────────────────────────────────────
// F.3 営業時間 / 休日 (週カレンダー)
// ─────────────────────────────────────────────
const ScreenBusinessHours = () => {
  const days = ['月', '火', '水', '木', '金', '土', '日'];
  const stores = [
    { name: '渋谷店', hours: ['09:00–18:00', '09:00–18:00', '09:00–18:00', '09:00–18:00', '09:00–18:00', '10:00–17:00', '定休'] },
    { name: '横浜店', hours: ['09:00–18:00', '09:00–18:00', '09:00–18:00', '09:00–18:00', '09:00–18:00', '09:00–17:00', '定休'] },
    { name: '川崎店', hours: ['09:00–18:00', '09:00–18:00', '09:00–18:00', '09:00–18:00', '09:00–18:00', '定休', '定休'] },
    { name: '横須賀店', hours: ['10:00–17:00', '10:00–17:00', '定休', '10:00–17:00', '10:00–17:00', '10:00–17:00', '10:00–16:00'] },
  ];
  const holidays = [
    { d: '2026/05/05', name: 'こどもの日', stores: '全店' },
    { d: '2026/07/20', name: '海の日', stores: '全店' },
    { d: '2026/08/13–15', name: '夏季休業', stores: '全店' },
    { d: '2026/12/30–01/03', name: '年末年始', stores: '全店' },
  ];
  return (
    <Shell audience="admin" active="settings">
      <PageHeader title="営業時間 / 休日" breadcrumb={['設定', '会社・店舗', '営業時間 / 休日']}
        right={<><Button variant="secondary" icon="Calendar">特別営業日</Button><Button icon="Plus">休業日を追加</Button></>}
      />
      <div style={{ padding: '24px 28px 60px', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {/* Weekly grid */}
        <section>
          <h3 className="sec-h">通常営業（曜日別）</h3>
          <div className="card">
            <div style={{ overflow: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-subtle)' }}>
                    <th style={{ padding: '12px 16px', textAlign: 'left', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>店舗</th>
                    {days.map(d => (
                      <th key={d} style={{ padding: '12px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600, color: d === '日' ? 'var(--danger)' : d === '土' ? 'var(--info)' : 'var(--text-secondary)' }}>{d}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {stores.map((s, i) => (
                    <tr key={s.name}>
                      <td style={{ padding: '14px 16px', borderBottom: i < stores.length - 1 ? '1px solid var(--border)' : 'none', fontWeight: 600 }}>{s.name}</td>
                      {s.hours.map((h, j) => (
                        <td key={j} style={{ padding: '12px 6px', borderBottom: i < stores.length - 1 ? '1px solid var(--border)' : 'none', textAlign: 'center' }}>
                          {h === '定休'
                            ? <span style={{ display: 'inline-block', padding: '3px 8px', background: 'var(--bg-subtle)', color: 'var(--text-muted)', borderRadius: 4, fontSize: 11, fontWeight: 500 }}>定休</span>
                            : <span className="tabular" style={{ fontSize: 12 }}>{h}</span>}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        <section>
          <h3 className="sec-h">休業日 / 特別営業日 (2026 年)</h3>
          <div className="card">
            <table className="tbl">
              <thead><tr><th>日付</th><th>名称</th><th>対象店舗</th><th>種別</th><th style={{ width: 40 }}></th></tr></thead>
              <tbody>
                {holidays.map((h, i) => (
                  <tr key={i}>
                    <td className="tabular" style={{ fontWeight: 600 }}>{h.d}</td>
                    <td>{h.name}</td>
                    <td>{h.stores}</td>
                    <td><Badge tone="danger" icon="Ban">休業</Badge></td>
                    <td><button className="btn btn-ghost btn-sm" style={{ padding: 4 }}><Icon name="MoreVertical" size={14} /></button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </Shell>
  );
};

// ─────────────────────────────────────────────
// F.8 作業メニュー（階層型 + 編集サイドパネル）
// ─────────────────────────────────────────────
const ScreenWorkMenus = () => {
  const tree = [
    { cat: '法定整備', menus: [
      { name: '車検整備', t: 180, p: 58000, used: 142, sel: true },
      { name: '法定 12 ヶ月点検', t: 90, p: 18000, used: 84 },
      { name: '法定 24 ヶ月点検', t: 120, p: 22000, used: 76 },
    ]},
    { cat: 'メンテナンス', menus: [
      { name: 'オイル交換 (5W-30)', t: 30, p: 4800, used: 412 },
      { name: 'オイル交換 (0W-20)', t: 30, p: 5800, used: 92 },
      { name: 'タイヤ交換 (4 本)', t: 60, p: 8000, used: 168 },
      { name: 'バッテリー交換', t: 30, p: 18500, used: 54 },
      { name: 'ワイパー交換', t: 15, p: 2400, used: 38 },
    ]},
    { cat: '修理', menus: [
      { name: '修理見積（無料）', t: 30, p: 0, used: 28 },
      { name: '一般修理', t: 0, p: 0, used: 19 },
    ]},
  ];
  return (
    <Shell audience="admin" active="settings">
      <PageHeader title="作業メニュー" breadcrumb={['設定', 'レーン・作業', '作業メニュー']}
        right={<><Button variant="secondary" icon="FolderPlus">カテゴリ追加</Button><Button icon="Plus">新規メニュー</Button></>}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 420px', height: 'calc(100% - 76px)' }}>
        <div style={{ overflow: 'auto', borderRight: '1px solid var(--border)' }}>
          {tree.map(c => (
            <div key={c.cat}>
              <div style={{ padding: '12px 24px', background: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', borderBottom: '1px solid var(--border)' }}>
                <Icon name="ChevronDown" size={12} />
                <Icon name="Folder" size={14} style={{ color: 'var(--primary)' }} />
                {c.cat}
                <span className="badge badge-muted">{c.menus.length}</span>
              </div>
              {c.menus.map((m, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 16, padding: '12px 24px 12px 48px', borderBottom: '1px solid var(--border)', background: m.sel ? 'var(--primary-light)' : '#fff', cursor: 'pointer' }}>
                  <Icon name="GripVertical" size={14} style={{ color: 'var(--text-muted)' }} />
                  <Icon name="Wrench" size={14} style={{ color: 'var(--text-muted)' }} />
                  <div style={{ flex: 1, fontSize: 13.5, fontWeight: m.sel ? 600 : 500 }}>{m.name}</div>
                  <div className="tabular" style={{ fontSize: 12, color: 'var(--text-secondary)', width: 60, textAlign: 'right' }}>{m.t > 0 ? `${m.t}分` : '—'}</div>
                  <div className="tabular" style={{ fontSize: 13, fontWeight: 500, width: 80, textAlign: 'right' }}>{m.p > 0 ? `¥${m.p.toLocaleString()}` : '無料'}</div>
                  <div className="tabular" style={{ fontSize: 11, color: 'var(--text-muted)', width: 70, textAlign: 'right' }}>{m.used} 件 / 月</div>
                  <button className="btn btn-ghost btn-sm" style={{ padding: 4 }}><Icon name="MoreVertical" size={14} /></button>
                </div>
              ))}
            </div>
          ))}
        </div>

        {/* Edit panel */}
        <aside style={{ background: '#fff', overflow: 'auto' }}>
          <div style={{ padding: '20px 24px 14px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>編集中</div>
            <div style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>車検整備</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>法定整備 · 過去 30 日で 142 件利用</div>
          </div>
          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="メニュー名" required><input className="input" defaultValue="車検整備" /></Field>
            <Field label="カテゴリ"><select className="select" defaultValue="法定整備"><option>法定整備</option><option>メンテナンス</option><option>修理</option></select></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="所要時間"><div style={{ position: 'relative' }}><input className="input tabular" defaultValue="180" style={{ paddingRight: 32 }} /><span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-muted)' }}>分</span></div></Field>
              <Field label="準備時間" hint="作業前後に必要な余裕"><div style={{ position: 'relative' }}><input className="input tabular" defaultValue="30" style={{ paddingRight: 32 }} /><span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 12, color: 'var(--text-muted)' }}>分</span></div></Field>
            </div>
            <Field label="料金（税込）"><div style={{ position: 'relative' }}><input className="input tabular" defaultValue="58000" style={{ paddingLeft: 28 }} /><span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', fontSize: 13, color: 'var(--text-muted)' }}>¥</span></div></Field>
            <Field label="顧客向け説明"><textarea className="textarea" defaultValue="自動車検査登録制度に基づく整備一式..." style={{ minHeight: 60 }} /></Field>

            <div>
              <div className="field-label" style={{ marginBottom: 6 }}>この作業に対応できるレーン</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: 10, background: 'var(--bg-subtle)', borderRadius: 6, fontSize: 12.5 }}>
                {['渋谷店 Lane 2 (重整備)', '渋谷店 Lane 3 (汎用)', '横浜整備工場 Lane 1', '川崎店 Lane 2 (重整備)'].map((l, i) => (
                  <label key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <input type="checkbox" defaultChecked style={{ accentColor: 'var(--primary)' }} />{l}
                  </label>
                ))}
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}><input type="checkbox" defaultChecked style={{ accentColor: 'var(--primary)' }} />顧客予約画面に表示</label>
          </div>
          <div style={{ padding: '14px 24px', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between' }}>
            <Button variant="ghost" icon="Trash2" style={{ color: 'var(--danger)' }}>削除</Button>
            <div style={{ display: 'flex', gap: 8 }}><Button variant="secondary">取消</Button><Button>保存</Button></div>
          </div>
        </aside>
      </div>
    </Shell>
  );
};

// ─────────────────────────────────────────────
// F.11 ステータス（色 + アイコン定義）
// ─────────────────────────────────────────────
const ScreenStatusSettings = () => {
  const groups = [
    { entity: 'reservations', items: [
      { key: 'tentative', label: '仮予約', tone: 'warning', icon: 'Clock' },
      { key: 'confirmed', label: '確定', tone: 'info', icon: 'CheckCircle2' },
      { key: 'in_progress', label: '作業中', tone: 'primary', icon: 'Wrench' },
      { key: 'done', label: '完了', tone: 'success', icon: 'Flag' },
      { key: 'cancelled', label: 'キャンセル', tone: 'muted', icon: 'Ban' },
    ]},
    { entity: 'transport_orders', items: [
      { key: 'unconfirmed', label: '業者未確認', tone: 'warning', icon: 'Clock' },
      { key: 'available', label: '対応可', tone: 'success', icon: 'CheckCircle2' },
      { key: 'unavailable', label: '対応不可', tone: 'danger', icon: 'XCircle' },
      { key: 'moving', label: '移動中', tone: 'info', icon: 'Truck' },
      { key: 'delivered', label: '搬入済み', tone: 'success', icon: 'PackageCheck' },
    ]},
  ];
  return (
    <Shell audience="admin" active="settings">
      <PageHeader title="ステータス" breadcrumb={['設定', '予約・ステータス', 'ステータス']} subtitle="対象别の状態定義" right={<Button icon="Plus">新規ステータス</Button>} />
      <div style={{ padding: '24px 28px 60px', maxWidth: 1000, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
        {groups.map(g => (
          <section key={g.entity}>
            <h3 className="sec-h" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span>{g.entity === 'reservations' ? '予約' : '回送依頼'}</span>
              <span className="badge badge-muted">{g.items.length} 状態</span>
            </h3>
            <div className="card">
              <table className="tbl">
                <thead><tr>
                  <th style={{ width: 32 }}></th><th>キー</th><th>表示名</th><th>プレビュー</th><th>カラー</th><th>アイコン</th><th>状態</th><th style={{ width: 40 }}></th>
                </tr></thead>
                <tbody>
                  {g.items.map(s => (
                    <tr key={s.key}>
                      <td><Icon name="GripVertical" size={14} style={{ color: 'var(--text-muted)', cursor: 'grab' }} /></td>
                      <td><span className="tabular" style={{ fontSize: 12, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }} data-status-key={s.key}>{s.key}</span></td>
                      <td style={{ fontWeight: 500 }}>{s.label}</td>
                      <td><StatusBadge status={s.key === 'in_progress' ? 'inprogress' : s.key} /></td>
                      <td>
                        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 16, height: 16, borderRadius: 4, background: s.tone === 'muted' ? 'var(--border-strong)' : `var(--${s.tone === 'primary' ? 'primary' : s.tone})`, border: '1px solid rgba(0,0,0,0.05)' }} />
                          <span className="tabular" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{s.tone}</span>
                        </div>
                      </td>
                      <td><Badge tone={s.tone} icon={s.icon}>{s.icon}</Badge></td>
                      <td><Badge tone="success" icon="CheckCircle2">有効</Badge></td>
                      <td><button className="btn btn-ghost btn-sm" style={{ padding: 4 }}><Icon name="MoreVertical" size={14} /></button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>
    </Shell>
  );
};

// ─────────────────────────────────────────────
// F.14 通知ルール（rule builder）
// ─────────────────────────────────────────────
const ScreenNotificationRules = () => {
  const rules = [
    { name: '新規回送依頼 → 業者へ通知', trigger: 'transport_orders.created', recipients: '業者（vendor_users）', channels: ['mail', 'in-app'], enabled: true, sel: true },
    { name: '対応可回答 → 店舗へ通知', trigger: 'transport_orders.accepted', recipients: '受付店舗（staff）', channels: ['in-app'], enabled: true },
    { name: '引取予定 1 時間前 → 業者リマインド', trigger: 'transport_orders.pickup_at -1h', recipients: '業者担当者', channels: ['mail', 'sms'], enabled: true },
    { name: '通知配送失敗 5 件連続 → 本部エスカレ', trigger: 'notification_deliveries.failed_streak >=5', recipients: '本部管理者', channels: ['mail', 'slack'], enabled: true },
    { name: '仮予約 30 分経過 → 顧客リマインド', trigger: 'reservations.tentative.age >=30min', recipients: '顧客', channels: ['mail', 'sms'], enabled: false },
  ];
  return (
    <Shell audience="admin" active="settings">
      <PageHeader title="通知ルール" breadcrumb={['設定', '通知・権限', '通知ルール']} subtitle="トリガー × 受信者 × チャネル"
        right={<Button icon="Plus">新規ルール</Button>}
      />
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 480px', height: 'calc(100% - 92px)' }}>
        <div style={{ overflow: 'auto' }}>
          <table className="tbl">
            <thead><tr><th>ルール名</th><th>トリガー</th><th>受信者</th><th>チャネル</th><th>状態</th><th style={{ width: 40 }}></th></tr></thead>
            <tbody>
              {rules.map((r, i) => (
                <tr key={i} className={r.sel ? 'selected' : ''}>
                  <td style={{ fontWeight: 500 }}>{r.name}</td>
                  <td><span className="tabular" style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{r.trigger}</span></td>
                  <td style={{ fontSize: 12.5 }}>{r.recipients}</td>
                  <td>
                    <div style={{ display: 'flex', gap: 4 }}>
                      {r.channels.map(c => {
                        const ch = { mail: { i: 'Mail', l: 'メール' }, sms: { i: 'MessageSquare', l: 'SMS' }, slack: { i: 'Hash', l: 'Slack' }, 'in-app': { i: 'Bell', l: 'アプリ内' } }[c] || { i: 'Bell', l: c };
                        return <Badge key={c} tone="muted" icon={ch.i}>{ch.l}</Badge>;
                      })}
                    </div>
                  </td>
                  <td>
                    <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                      <span style={{ width: 32, height: 18, borderRadius: 999, background: r.enabled ? 'var(--success)' : 'var(--border-strong)', position: 'relative', display: 'inline-block' }}>
                        <span style={{ position: 'absolute', top: 2, left: r.enabled ? 16 : 2, width: 14, height: 14, borderRadius: 999, background: '#fff' }} />
                      </span>
                    </label>
                  </td>
                  <td><button className="btn btn-ghost btn-sm" style={{ padding: 4 }}><Icon name="MoreVertical" size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Rule builder */}
        <aside style={{ borderLeft: '1px solid var(--border)', background: '#fff', overflow: 'auto', padding: '20px 22px' }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>ルール編集</div>
          <h3 style={{ margin: '6px 0 0', fontSize: 16, fontWeight: 700 }}>新規回送依頼 → 業者へ通知</h3>

          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Field label="ルール名" required><input className="input" defaultValue="新規回送依頼 → 業者へ通知" /></Field>

            <div>
              <div className="field-label" style={{ marginBottom: 6 }}>いつ（トリガー）</div>
              <div style={{ padding: 12, background: 'var(--bg-subtle)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <select className="select" defaultValue="created" style={{ background: '#fff' }}>
                  <option value="created">回送依頼が作成されたとき</option>
                  <option>回送依頼が更新されたとき</option>
                  <option>業者が「対応可」と回答したとき</option>
                </select>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', gap: 6 }}>
                  <Icon name="GitBranch" size={12} />条件: 業者が指名されている場合のみ
                </div>
              </div>
            </div>

            <div>
              <div className="field-label" style={{ marginBottom: 6 }}>誰に（受信者）</div>
              <div style={{ padding: 12, background: 'var(--bg-subtle)', borderRadius: 6, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
                <label><input type="checkbox" defaultChecked style={{ accentColor: 'var(--primary)' }} /> 指名業者の代表アカウント</label>
                <label><input type="checkbox" defaultChecked style={{ accentColor: 'var(--primary)' }} /> この依頼の担当者</label>
                <label><input type="checkbox" style={{ accentColor: 'var(--primary)' }} /> 受付店舗の店長</label>
              </div>
            </div>

            <div>
              <div className="field-label" style={{ marginBottom: 6 }}>何で送る（送信方法）</div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[
                  { k: 'mail', label: 'メール', icon: 'Mail', on: true },
                  { k: 'in-app', label: 'アプリ内通知', icon: 'Bell', on: true },
                  { k: 'sms', label: 'SMS', icon: 'MessageSquare', on: false },
                  { k: 'slack', label: 'Slack', icon: 'Hash', on: false },
                ].map(c => (
                  <label key={c.k} style={{ flex: 1, padding: '10px 8px', border: `1.5px solid ${c.on ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 6, textAlign: 'center', cursor: 'pointer', background: c.on ? 'var(--primary-light)' : '#fff', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
                    <Icon name={c.icon} size={14} style={{ color: c.on ? 'var(--primary)' : 'var(--text-muted)' }} />
                    <span style={{ fontSize: 11.5, fontWeight: c.on ? 600 : 400 }}>{c.label}</span>
                  </label>
                ))}
              </div>
            </div>

            <Field label="通知文テンプレート" hint="内部識別子：notify.transport_orders.created">
              <textarea className="textarea" defaultValue="【新規回送依頼】{vendor_name} 様、{from_store} から {to_store} への回送をご依頼したいです。期限までにご回答ください。" style={{ minHeight: 70, fontSize: 12.5 }} />
            </Field>

            <Field label="送信タイミング">
              <select className="select" defaultValue="immediate"><option>即時送信</option><option>1 分後</option><option>5 分後</option><option>15 分後</option></select>
            </Field>
          </div>

          <div style={{ display: 'flex', gap: 8, marginTop: 18 }}>
            <Button variant="secondary" style={{ flex: 1 }}>テスト送信</Button>
            <Button style={{ flex: 1 }}>保存</Button>
          </div>
        </aside>
      </div>
    </Shell>
  );
};

// ─────────────────────────────────────────────
// F.15 権限マトリクス
// ─────────────────────────────────────────────
const ScreenPermissions = () => {
  const roles = ['本部管理者', '店長', '現場スタッフ', '業者ユーザー', '顧客'];
  const groups = [
    { name: '予約', perms: [
      ['予約閲覧', ['rwc', 'rw', 'rw', 'r', 'r-self']],
      ['予約作成', ['c', 'c', 'c', '—', 'c-self']],
      ['予約変更', ['rw', 'rw', 'rw', '—', 'r-self']],
      ['予約キャンセル', ['rw', 'rw', 'r', '—', 'rw-self']],
    ]},
    { name: '店間整備・回送', perms: [
      ['店間依頼作成', ['c', 'c', '—', '—', '—']],
      ['業者通知送信', ['c', 'c', '—', '—', '—']],
      ['業者変更', ['rw', 'rw', '—', '—', '—']],
      ['進捗更新', ['rw', 'rw', 'rw', 'rw', '—']],
    ]},
    { name: '運用・監査', perms: [
      ['監査ログ閲覧', ['r', '—', '—', '—', '—']],
      ['通知失敗手動再送', ['rwc', 'rw', '—', '—', '—']],
      ['設定変更', ['rwc', 'rw-store', '—', '—', '—']],
      ['ユーザー招待', ['rwc', 'rw-store', '—', '—', '—']],
    ]},
  ];
  // Cell: tokens are read/write/create + scope ("all" / "self" / "store")
  const decode = v => {
    if (v === '—') return null;
    const scope = v.includes('-self') ? 'self' : v.includes('-store') ? 'store' : 'all';
    const base = v.replace('-self', '').replace('-store', '');
    return { r: base.includes('r'), w: base.includes('w'), c: base.includes('c'), scope };
  };
  const scopeText = { all: '', self: '自分のみ', store: '自店のみ' };
  const PermCell = ({ v }) => {
    const p = decode(v);
    if (!p) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
    const items = [];
    if (p.c) items.push({ label: '作成', tone: 'primary' });
    if (p.w) items.push({ label: '更新', tone: 'info' });
    if (p.r) items.push({ label: '閲覧', tone: 'muted' });
    const toneStyle = {
      primary: { bg: 'var(--primary-light)', fg: 'var(--primary)' },
      info:    { bg: 'var(--info-light)', fg: '#1E40AF' },
      muted:   { bg: 'var(--bg-subtle)', fg: 'var(--text-secondary)' },
    };
    return (
      <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 3, alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
          {items.map(it => (
            <span key={it.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 999, background: toneStyle[it.tone].bg, color: toneStyle[it.tone].fg, fontSize: 11, fontWeight: 600 }}>
              <Icon name="Check" size={10} />{it.label}
            </span>
          ))}
        </div>
        {p.scope !== 'all' && <span style={{ fontSize: 10, color: 'var(--text-muted)', fontWeight: 500 }}>{scopeText[p.scope]}</span>}
      </div>
    );
  };
  return (
    <Shell audience="admin" active="settings">
      <PageHeader title="権限" breadcrumb={['設定', '通知・権限', '権限']} subtitle="役割と操作の対応表"
        right={<><Button variant="secondary" icon="Download">CSV</Button><Button icon="Save">変更を保存</Button></>}
      />

      <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)', display: 'flex', alignItems: 'center', gap: 12, fontSize: 12, color: 'var(--text-secondary)', flexWrap: 'wrap' }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 999, background: 'var(--bg-subtle)', color: 'var(--text-secondary)', fontSize: 11, fontWeight: 600, border: '1px solid var(--border)' }}><Icon name="Check" size={10} />閲覧</span>
          画面を見れる
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 999, background: 'var(--info-light)', color: '#1E40AF', fontSize: 11, fontWeight: 600 }}><Icon name="Check" size={10} />更新</span>
          内容を変えられる
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 7px', borderRadius: 999, background: 'var(--primary-light)', color: 'var(--primary)', fontSize: 11, fontWeight: 600 }}><Icon name="Check" size={10} />作成</span>
          新規に作れる
        </span>
        <span style={{ color: 'var(--text-muted)' }}>「自分のみ」「自店のみ」はデータ範囲の制限を意味します</span>
        <span style={{ marginLeft: 'auto' }}>クリックで権限変更</span>
      </div>

      <div style={{ padding: '24px 28px 60px' }}>
        <div className="card" style={{ overflow: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ background: 'var(--bg-subtle)' }}>
                <th style={{ padding: '12px 16px', textAlign: 'left', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.04em', width: 220 }}>操作</th>
                {roles.map(r => (
                  <th key={r} style={{ padding: '12px 16px', textAlign: 'center', borderBottom: '1px solid var(--border)', fontSize: 12, fontWeight: 600, borderLeft: '1px solid var(--border)' }}>{r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <React.Fragment key={g.name}>
                  <tr><td colSpan={roles.length + 1} style={{ padding: '14px 16px 6px', fontSize: 11, fontWeight: 700, color: 'var(--primary)', letterSpacing: '0.06em', textTransform: 'uppercase', background: '#fff' }}>{g.name}</td></tr>
                  {g.perms.map(([label, vals]) => (
                    <tr key={label}>
                      <td style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', fontWeight: 500 }}>{label}</td>
                      {vals.map((v, i) => (
                        <td key={i} style={{ padding: '10px 8px', textAlign: 'center', borderBottom: '1px solid var(--border)', borderLeft: '1px solid var(--border)' }}>
                          <PermCell v={v} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Shell>
  );
};

// ─────────────────────────────────────────────
// F.17 顧客本人確認（コンプライアンス設定）
// ─────────────────────────────────────────────
const ScreenKyc = () => (
  <Shell audience="admin" active="settings">
    <PageHeader title="顧客本人確認" breadcrumb={['設定', 'コンプライアンス', '顧客本人確認']}
      right={<Button icon="Save">変更を保存</Button>}
    />
    <div style={{ padding: '24px 28px 60px', maxWidth: 900, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>
      <div style={{ padding: '14px 18px', background: 'var(--danger-light)', border: '1px solid #FCA5A5', borderRadius: 8, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Icon name="ShieldAlert" size={20} style={{ color: 'var(--danger)', marginTop: 2, flexShrink: 0 }} />
        <div>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#991B1B' }}>個人情報・コンプライアンス設定</div>
          <div style={{ fontSize: 12.5, color: '#7F1D1D', marginTop: 2 }}>変更は監査ログに記録され、本部管理者へ通知されます。法令遵守の観点から、変更前にコンプライアンス部門と相談してください。</div>
        </div>
      </div>

      <section>
        <h3 className="sec-h">本人確認フロー</h3>
        <div className="card">
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <Field label="認証方式" required>
              <select className="select" defaultValue="email-otp">
                <option value="email-otp">メール認証コード（6 桁・推奨）</option>
                <option>SMS 認証コード（電話番号）</option>
                <option>メール + SMS（二要素）</option>
                <option>本人確認書類スキャン</option>
              </select>
            </Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="認証コード有効期限">
                <select className="select" defaultValue="10"><option>5 分</option><option>10 分</option><option>15 分</option><option>30 分</option></select>
              </Field>
              <Field label="認証コード長"><select className="select" defaultValue="6"><option>4 桁</option><option>6 桁</option><option>8 桁</option></select></Field>
              <Field label="再送上限 / 1 時間"><input className="input tabular" defaultValue="5" /></Field>
              <Field label="再送までの待ち時間"><select className="select" defaultValue="60"><option>30 秒</option><option>60 秒</option><option>120 秒</option></select></Field>
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}><input type="checkbox" defaultChecked style={{ accentColor: 'var(--primary)' }} />顧客の電話番号も認証フローに含める</label>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5 }}><input type="checkbox" style={{ accentColor: 'var(--primary)' }} />来店時に身分証明書の確認を必須化（高額作業のみ）</label>
          </div>
        </div>
      </section>

      <section>
        <h3 className="sec-h">個人情報の保管期間</h3>
        <div className="card">
          <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              ['予約データ（顧客名・連絡先）', '5 年', '顧客との取引終了から'],
              ['整備伝票・車両情報', '7 年', '法令上の保管義務'],
              ['認証ログ・IP / UA', '1 年', 'セキュリティ調査用途'],
              ['監査ログ', '7 年', '不正アクセス調査・法令対応'],
            ].map(([label, dur, reason]) => (
              <div key={label} style={{ display: 'grid', gridTemplateColumns: '1fr 140px 1fr', alignItems: 'center', gap: 14, padding: '8px 0', borderBottom: '1px dashed var(--border)' }}>
                <div style={{ fontSize: 13.5, fontWeight: 500 }}>{label}</div>
                <select className="select" defaultValue={dur}><option>1 年</option><option>3 年</option><option>5 年</option><option>7 年</option><option>無期限</option></select>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{reason}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section>
        <h3 className="sec-h">外部本人確認サービス連携</h3>
        <div className="card">
          <div style={{ padding: 20, display: 'flex', alignItems: 'center', gap: 14 }}>
            <div style={{ width: 44, height: 44, borderRadius: 8, background: 'var(--bg-subtle)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
              <Icon name="Fingerprint" size={20} />
            </div>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 14, fontWeight: 600 }}>外部本人確認サービス</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>本人確認 API を有効化すると、運転免許証スキャン・オンライン本人確認が利用可能になります。</div>
            </div>
            <Badge tone="muted" icon="PauseCircle">未接続</Badge>
            <Button variant="secondary" icon="Link">接続する</Button>
          </div>
        </div>
      </section>
    </div>
  </Shell>
);

Object.assign(window, {
  ScreenCompanySettings, ScreenBusinessHours, ScreenWorkMenus, ScreenStatusSettings,
  ScreenNotificationRules, ScreenPermissions, ScreenKyc,
});
