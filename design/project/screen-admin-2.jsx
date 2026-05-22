/* global React, Shell, PageHeader, Button, Icon, Badge, StatusBadge, Field, FilterChip */
// 段取りくん — Admin screens part 2 (C.3 顧客予約一覧 / C.7 車両一覧 / C.9 監査ログ)

// ─────────────────────────────────────────────
// C.3 顧客予約一覧
// ─────────────────────────────────────────────
const ScreenCustReservations = () => {
  const rows = [
    { id: 'R-2026-0142', dt: '05/22 10:00', name: '田中 太郎', phone: '090-xxxx-1234', store: '渋谷店', work: 'オイル交換', source: 'web', status: 'confirmed' },
    { id: 'R-2026-0141', dt: '05/22 11:30', name: '佐藤 花子', phone: '080-xxxx-5678', store: '横浜店', work: '車検整備', source: 'web', status: 'confirmed' },
    { id: 'R-2026-0140', dt: '05/23 09:00', name: '鈴木 一郎', phone: '090-xxxx-2345', store: '川崎店', work: 'タイヤ交換', source: 'phone', status: 'tentative' },
    { id: 'R-2026-0139', dt: '05/23 14:00', name: '高橋 健', phone: '080-xxxx-9012', store: '渋谷店', work: 'バッテリー交換', source: 'web', status: 'confirmed' },
    { id: 'R-2026-0138', dt: '05/23 15:30', name: '伊藤 美咲', phone: '090-xxxx-3456', store: '横浜店', work: '修理見積', source: 'web', status: 'tentative' },
    { id: 'R-2026-0137', dt: '05/24 10:00', name: '山本 美穂', phone: '080-xxxx-4567', store: '川崎店', work: '法定点検', source: 'walk-in', status: 'confirmed' },
    { id: 'R-2026-0136', dt: '05/24 11:00', name: '中村 拓也', phone: '090-xxxx-5678', store: '横須賀店', work: 'エアコン整備', source: 'web', status: 'cancelled' },
    { id: 'R-2026-0135', dt: '05/24 13:30', name: '小林 大樹', phone: '080-xxxx-6789', store: '渋谷店', work: 'オイル交換', source: 'phone', status: 'confirmed' },
  ];
  return (
    <Shell audience="admin" active="cust-reservations">
      <PageHeader title="顧客予約一覧" subtitle="本日以降 · 42 件"
        right={<><Button variant="secondary" icon="Download">CSV</Button><Button icon="Plus">電話受付で追加</Button></>}
      />
      <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-subtle)' }}>
        <div style={{ position: 'relative', flex: '0 0 320px' }}>
          <Icon name="Search" size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" placeholder="顧客名 / 電話 / ナンバーで検索" style={{ height: 32, paddingLeft: 30, fontSize: 13 }} />
        </div>
        <FilterChip label="ステータス" value="全 4" />
        <FilterChip label="店舗" value="全店" />
        <FilterChip label="期間" value="本日 + 7日" />
        <FilterChip label="経路" value="全経路" />
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 32 }}><input type="checkbox" style={{ accentColor: 'var(--primary)' }} /></th>
            <th>予約番号</th>
            <th>予約日時 <Icon name="ArrowDown" size={12} style={{ verticalAlign: 'middle', color: 'var(--primary)' }} /></th>
            <th>顧客</th>
            <th>店舗</th>
            <th>作業</th>
            <th>経路</th>
            <th>ステータス</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td><input type="checkbox" style={{ accentColor: 'var(--primary)' }} /></td>
              <td><span className="tabular" style={{ fontWeight: 600, color: 'var(--primary)' }}>{r.id}</span></td>
              <td className="tabular" style={{ fontWeight: 500 }}>{r.dt}</td>
              <td>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{r.name} 様</div>
                <div className="tabular" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{r.phone}</div>
              </td>
              <td>{r.store}</td>
              <td>{r.work}</td>
              <td>
                <Badge tone={r.source === 'web' ? 'info' : r.source === 'phone' ? 'muted' : 'primary'} icon={r.source === 'web' ? 'Globe' : r.source === 'phone' ? 'Phone' : 'DoorOpen'}>
                  {r.source === 'web' ? 'Web' : r.source === 'phone' ? '電話' : '来店'}
                </Badge>
              </td>
              <td><StatusBadge status={r.status} /></td>
              <td><button className="btn btn-ghost btn-sm" style={{ padding: 4 }}><Icon name="MoreVertical" size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
};

// ─────────────────────────────────────────────
// C.7 車両一覧
// ─────────────────────────────────────────────
const ScreenVehicles = () => {
  const rows = [
    { mgr: 'V-001234', model: 'トヨタ アルファード', year: '2020', plate: '品川 300 あ 1234', owner: '田中 太郎', vin: 'ABCD-12-3456789', last: '05/22 車検整備', count: 8 },
    { mgr: 'V-001233', model: 'トヨタ ヴェルファイア', year: '2019', plate: '品川 330 い 4567', owner: '佐藤 花子', vin: 'ABCE-13-7890123', last: '05/22 オイル交換', count: 4 },
    { mgr: 'V-001232', model: 'トヨタ プリウス', year: '2021', plate: '横浜 300 う 8901', owner: '鈴木 一郎', vin: 'ABCF-14-4567890', last: '05/22 タイヤ交換', count: 6 },
    { mgr: 'V-001231', model: 'トヨタ ノア', year: '2018', plate: '横浜 500 え 2345', owner: '高橋 健', vin: 'ABCG-15-2345678', last: '05/22 バッテリー', count: 12 },
    { mgr: 'V-001230', model: 'マツダ CX-5', year: '2022', plate: '川崎 300 お 6789', owner: '伊藤 美咲', vin: 'ABCH-16-8901234', last: '05/21 修理見積', count: 2 },
    { mgr: 'V-001229', model: 'ホンダ フィット', year: '2017', plate: '横浜 500 か 1234', owner: '山本 美穂', vin: 'ABCI-17-5678901', last: '05/21 法定点検', count: 9 },
    { mgr: 'V-001228', model: '日産 セレナ', year: '2020', plate: '横須賀 300 き 5678', owner: '中村 拓也', vin: 'ABCJ-18-2345012', last: '05/21 エアコン', count: 5 },
  ];
  return (
    <Shell audience="admin" active="vehicles">
      <PageHeader title="車両一覧" subtitle="登録車両 1,284 台"
        right={<><Button variant="secondary" icon="Upload">CSV 取込</Button><Button icon="Plus">新規車両</Button></>}
      />
      <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-subtle)' }}>
        <div style={{ position: 'relative', flex: '0 0 380px' }}>
          <Icon name="Search" size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" placeholder="VIN / ナンバー / 顧客名 / 車種で検索" style={{ height: 32, paddingLeft: 30, fontSize: 13 }} />
        </div>
        <FilterChip label="メーカー" value="全社" />
        <FilterChip label="年式" value="全期間" />
        <FilterChip label="現所有" value="あり" />
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th>管理番号</th>
            <th>車種 / 年式</th>
            <th>ナンバー</th>
            <th>VIN</th>
            <th>現所有者</th>
            <th>最終整備</th>
            <th>整備履歴</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.mgr}>
              <td><span className="tabular" style={{ fontWeight: 600, color: 'var(--primary)' }}>{r.mgr}</span></td>
              <td>
                <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                  <div style={{ width: 36, height: 24, borderRadius: 4, background: 'var(--bg-subtle)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)' }}>
                    <Icon name="Car" size={14} />
                  </div>
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 500 }}>{r.model}</div>
                    <div className="tabular" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{r.year} 年式</div>
                  </div>
                </div>
              </td>
              <td className="tabular" style={{ fontSize: 12.5 }}>{r.plate}</td>
              <td className="tabular" style={{ fontSize: 11.5, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>{r.vin}</td>
              <td>{r.owner} 様</td>
              <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{r.last}</td>
              <td><span className="badge badge-muted tabular">{r.count} 件</span></td>
              <td><button className="btn btn-ghost btn-sm" style={{ padding: 4 }}><Icon name="MoreVertical" size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
};

// ─────────────────────────────────────────────
// C.9 監査ログ閲覧 (本部管理者のみ)
// ─────────────────────────────────────────────
const ScreenAudit = () => {
  const rows = [
    { id: 'AUD-0892341', actor: '田中 (本部管理者)', action: 'update', entity: 'transport_orders', entity_id: 'TY-2026-0142', ip: '203.0.113.42', when: '13:52:08', sel: true },
    { id: 'AUD-0892340', actor: '佐藤 (店長)', action: 'create', entity: 'reservations', entity_id: 'R-2026-0142', ip: '203.0.113.51', when: '13:45:21' },
    { id: 'AUD-0892339', actor: '山田 (業者)', action: 'accept_invitation', entity: 'transport_orders', entity_id: 'TY-2026-0142', ip: '198.51.100.7', when: '13:50:02' },
    { id: 'AUD-0892338', actor: 'system', action: 'send_email', entity: 'notification_deliveries', entity_id: 'ND-3421', ip: '—', when: '13:45:00' },
    { id: 'AUD-0892337', actor: '田中 (本部管理者)', action: 'delete', entity: 'lanes', entity_id: 'L-0042', ip: '203.0.113.42', when: '13:40:11' },
    { id: 'AUD-0892336', actor: '佐藤 (店長)', action: 'update', entity: 'companies', entity_id: 'C-0001', ip: '203.0.113.51', when: '13:35:48' },
  ];
  const actionColor = a => a === 'create' ? 'success' : a === 'delete' ? 'danger' : a === 'update' ? 'info' : 'muted';

  return (
    <Shell audience="admin" active="audit">
      <PageHeader title="監査ログ" subtitle="本部管理者のみ閲覧可 · 過去 90 日間 38,941 件" right={<Button variant="secondary" icon="Download">CSV エクスポート</Button>} />

      <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-subtle)' }}>
        <FilterChip label="actor" value="全員" />
        <FilterChip label="action" value="全アクション" />
        <FilterChip label="entity_type" value="全テーブル" />
        <FilterChip label="期間" value="本日" />
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <Icon name="Search" size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" placeholder="entity_id で検索" style={{ height: 32, paddingLeft: 30, width: 220, fontSize: 13 }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 540px', height: 'calc(100% - 132px)' }}>
        <div style={{ overflow: 'auto' }}>
          <table className="tbl">
            <thead><tr>
              <th>log_id</th><th>actor</th><th>action</th><th>entity</th><th>entity_id</th><th>IP</th><th>時刻</th>
            </tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className={r.sel ? 'selected' : ''}>
                  <td><span className="tabular" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{r.id}</span></td>
                  <td style={{ fontSize: 13 }}>{r.actor}</td>
                  <td><Badge tone={actionColor(r.action)} icon={r.action === 'create' ? 'PlusCircle' : r.action === 'delete' ? 'Trash2' : r.action === 'update' ? 'PencilLine' : 'Activity'}>{r.action}</Badge></td>
                  <td className="tabular" style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{r.entity}</td>
                  <td><span className="tabular" style={{ fontSize: 12, color: 'var(--primary)' }}>{r.entity_id}</span></td>
                  <td className="tabular" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.ip}</td>
                  <td className="tabular" style={{ fontSize: 12, color: 'var(--text-muted)' }}>05/22 {r.when}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Diff viewer */}
        <aside style={{ borderLeft: '1px solid var(--border)', overflow: 'auto', background: '#fff' }}>
          <div style={{ padding: '18px 22px 12px', borderBottom: '1px solid var(--border)' }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>ログ詳細</div>
            <div className="tabular" style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>AUD-0892341</div>
            <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
              <Badge tone="info" icon="PencilLine">update</Badge>
              <span className="badge badge-muted tabular">transport_orders</span>
            </div>
          </div>
          <div style={{ padding: '14px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', gap: 6, fontSize: 12.5 }}>
              <div style={{ color: 'var(--text-muted)' }}>actor</div><div>田中 (本部管理者) · u_001</div>
              <div style={{ color: 'var(--text-muted)' }}>IP</div><div className="tabular">203.0.113.42</div>
              <div style={{ color: 'var(--text-muted)' }}>User-Agent</div><div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)' }}>Mozilla/5.0 (Macintosh; Intel Mac OS X) AppleWebKit/537.36 ...</div>
              <div style={{ color: 'var(--text-muted)' }}>at</div><div className="tabular">2026-05-22 13:52:08.214</div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>変更内容（差分）</div>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5, lineHeight: 1.65, background: 'var(--bg-subtle)', borderRadius: 6, padding: '10px 12px', border: '1px solid var(--border)' }}>
                {[
                  { type: 'ctx', t: '{' },
                  { type: 'ctx', t: '  "id": "TY-2026-0142",' },
                  { type: 'ctx', t: '  "vendor_id": "v_0042",' },
                  { type: 'del', t: '-  "pickup_at": "2026-05-23T09:00:00+09:00",' },
                  { type: 'add', t: '+  "pickup_at": "2026-05-23T09:30:00+09:00",' },
                  { type: 'del', t: '-  "status": "unconfirmed",' },
                  { type: 'add', t: '+  "status": "available",' },
                  { type: 'ctx', t: '  "is_double_booking": false,' },
                  { type: 'ctx', t: '  "updated_at": "2026-05-22T13:52:08Z"' },
                  { type: 'ctx', t: '}' },
                ].map((l, i) => (
                  <div key={i} style={{
                    background: l.type === 'add' ? 'rgba(16, 185, 129, 0.10)' : l.type === 'del' ? 'rgba(239, 68, 68, 0.10)' : 'transparent',
                    color: l.type === 'add' ? '#065F46' : l.type === 'del' ? '#991B1B' : 'var(--text)',
                    padding: '0 8px', borderRadius: 3, whiteSpace: 'pre',
                  }}>{l.t}</div>
                ))}
              </div>
            </div>

            <div>
              <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 6 }}>関連エンティティ</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12.5 }}>
                <a style={{ color: 'var(--primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="ExternalLink" size={11} />reservations: R-2026-0142</a>
                <a style={{ color: 'var(--primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}><Icon name="ExternalLink" size={11} />vendor_users: v_0042</a>
              </div>
            </div>
          </div>
        </aside>
      </div>
    </Shell>
  );
};

Object.assign(window, { ScreenCustReservations, ScreenVehicles, ScreenAudit });
