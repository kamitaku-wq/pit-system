/* global React, Shell, PageHeader, Button, Icon, Badge, StatusBadge, Field, FilterChip */
// 段取りくん — Vendor part 2 (D.2 新規依頼一覧 / D.6 進捗更新)

// ─────────────────────────────────────────────
// D.2 新規依頼一覧
// ─────────────────────────────────────────────
const ScreenVendorNewList = () => {
  const rows = [
    { id: 'TY-2026-0142', from: '渋谷店', to: '横浜整備工場', pickup: '05/23 09:30', distance: '40km', invited: false, deadline: '残り 1h 47m', sel: true },
    { id: 'TY-2026-0143', from: '川崎店', to: '横須賀店', pickup: '05/23 14:00', distance: '32km', invited: true, deadline: '残り 3h 12m' },
    { id: 'TY-2026-0144', from: '渋谷店', to: '川崎店', pickup: '05/24 10:00', distance: '24km', invited: false, deadline: '残り 21h' },
    { id: 'TY-2026-0145', from: '横須賀店', to: '横浜整備工場', pickup: '05/24 11:30', distance: '28km', invited: true, deadline: '残り 22h' },
  ];
  return (
    <Shell audience="vendor" active="new">
      <PageHeader title="新規依頼" subtitle="未回答 4 件 · 早い者勝ち案件あり" right={<Button variant="secondary" icon="Filter">フィルタ</Button>} />
      <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-subtle)' }}>
        <FilterChip label="経路" value="渋谷-横浜エリア" />
        <FilterChip label="期日" value="3 日以内" />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8, fontSize: 13 }}>
          <input type="checkbox" defaultChecked style={{ accentColor: 'var(--primary)' }} />
          <span>招待経由のみ表示</span>
        </label>
      </div>

      <table className="tbl">
        <thead>
          <tr>
            <th>依頼番号</th>
            <th>移動経路</th>
            <th>引取予定</th>
            <th>距離</th>
            <th>経路</th>
            <th>回答期限</th>
            <th style={{ width: 120 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id} className={r.sel ? 'selected' : ''}>
              <td><span className="tabular" style={{ fontWeight: 600, color: 'var(--primary)' }}>{r.id}</span></td>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontWeight: 500 }}>{r.from}</span>
                  <Icon name="ArrowRight" size={12} style={{ color: 'var(--text-muted)' }} />
                  <span style={{ fontWeight: 500 }}>{r.to}</span>
                </div>
              </td>
              <td className="tabular">{r.pickup}</td>
              <td className="tabular" style={{ color: 'var(--text-secondary)' }}>{r.distance}</td>
              <td>
                {r.invited
                  ? <Badge tone="primary" icon="MailOpen">招待経由</Badge>
                  : <Badge tone="muted" icon="Send">指名</Badge>}
              </td>
              <td><Badge tone="warning" icon="Clock">{r.deadline}</Badge></td>
              <td>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button size="sm" icon="CheckCircle2">回答</Button>
                  <button className="btn btn-ghost btn-sm" style={{ padding: 4 }}><Icon name="MoreVertical" size={14} /></button>
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
};

// ─────────────────────────────────────────────
// D.6 進捗更新（モバイル中心 UX、最下部固定ボタン）
// ─────────────────────────────────────────────
const ScreenVendorProgress = () => {
  const steps = [
    { i: 'CalendarCheck', label: '引取予定', time: '05/23 09:30', state: 'done' },
    { i: 'Truck', label: '引取済み', time: '05/23 09:34', state: 'done' },
    { i: 'Navigation', label: '搬入済み', time: '— 移動中', state: 'current' },
    { i: 'Flag', label: '完了報告', time: '—', state: 'pending' },
  ];
  return (
    <Shell audience="vendor" active="active">
      <PageHeader title="TY-2026-0142 進捗更新"
        breadcrumb={['対応中', 'TY-2026-0142']}
        right={<Badge tone="info" icon="Truck">移動中</Badge>}
      />

      <div style={{ padding: '20px 28px 100px', maxWidth: 760, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Route summary */}
        <div className="card">
          <div className="card-body" style={{ padding: 18 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}><Icon name="MapPin" size={11} style={{ color: 'var(--success)' }} /> 引取済み</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>渋谷店</div>
                <div className="tabular" style={{ fontSize: 12, color: 'var(--success)', fontWeight: 600 }}>✓ 09:34</div>
              </div>
              <Icon name="ArrowRight" size={18} style={{ color: 'var(--text-muted)' }} />
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}><Icon name="MapPin" size={11} style={{ color: 'var(--danger)' }} /> 搬入先</div>
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>横浜整備工場</div>
                <div className="tabular" style={{ fontSize: 12, color: 'var(--primary)', fontWeight: 600 }}>到着予定 10:30</div>
              </div>
            </div>
          </div>
        </div>

        {/* Progress steps */}
        <div className="card">
          <div className="card-header"><div className="card-title">進捗</div></div>
          <div style={{ padding: '20px 24px' }}>
            <div style={{ position: 'relative' }}>
              {steps.map((s, i) => (
                <div key={i} style={{ display: 'flex', gap: 14, paddingBottom: i === steps.length - 1 ? 0 : 16, position: 'relative' }}>
                  {i < steps.length - 1 && (
                    <div style={{ position: 'absolute', left: 17, top: 36, bottom: 0, width: 2, background: s.state === 'done' ? 'var(--success)' : 'var(--border)' }} />
                  )}
                  <div style={{
                    width: 36, height: 36, borderRadius: 999,
                    background: s.state === 'done' ? 'var(--success)' : s.state === 'current' ? 'var(--primary-light)' : 'var(--bg-subtle)',
                    border: s.state === 'current' ? '2px solid var(--primary)' : 'none',
                    color: s.state === 'done' ? '#fff' : s.state === 'current' ? 'var(--primary)' : 'var(--text-muted)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, zIndex: 1,
                  }}>
                    {s.state === 'done' ? <Icon name="Check" size={16} /> : <Icon name={s.i} size={16} />}
                  </div>
                  <div style={{ flex: 1, paddingTop: 8 }}>
                    <div style={{ fontSize: 14, fontWeight: s.state === 'pending' ? 400 : 600, color: s.state === 'pending' ? 'var(--text-muted)' : 'var(--text)' }}>{s.label}</div>
                    <div className="tabular" style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{s.time}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Photo upload — checklist + camera capture (§A.8.10) */}
        <div className="card">
          <div className="card-header"><div className="card-title">写真記録（撮影チェックリスト）</div></div>
          <div style={{ padding: '14px 18px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8, marginBottom: 14, fontSize: 13 }}>
              {[
                { l: '外観（前後左右 4 方向）', done: true },
                { l: '内装（運転席 / 後部座席）', done: true },
                { l: 'メーター（走行距離）', done: false },
                { l: 'キズ・凹み（あれば）', done: false },
              ].map(x => (
                <label key={x.l} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: x.done ? 'var(--success-light)' : 'var(--bg-subtle)', borderRadius: 6, border: `1px solid ${x.done ? '#A7F3D0' : 'var(--border)'}` }}>
                  <input type="checkbox" defaultChecked={x.done} style={{ accentColor: 'var(--success)' }} />
                  <span style={{ flex: 1, color: x.done ? '#065F46' : 'var(--text)' }}>{x.l}</span>
                  {x.done && <Icon name="Check" size={14} style={{ color: 'var(--success)' }} />}
                </label>
              ))}
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10 }}>
              <div className="placeholder-pattern" style={{ height: 100, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 11 }}>外観 前</div>
              <div className="placeholder-pattern" style={{ height: 100, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 11 }}>外観 後</div>
              <div className="placeholder-pattern" style={{ height: 100, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontSize: 11 }}>内装</div>
              <label style={{ height: 100, borderRadius: 6, border: '1.5px dashed var(--border-strong)', background: '#fff', color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                <input type="file" accept="image/*" capture="environment" aria-label="現場の写真を撮影" style={{ display: 'none' }} />
                <Icon name="Camera" size={22} />
                写真を撮影
              </label>
            </div>
            <div style={{ marginTop: 10, fontSize: 11, color: 'var(--text-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
              <Icon name="Info" size={12} />
              タップでカメラが起動します（外出先想定）
            </div>
          </div>
        </div>

        {/* Notes */}
        <Field label="メモ（任意）">
          <textarea className="textarea" placeholder="例: 後部座席に荷物多数、シート保護済み、軽い泥はね有り" />
        </Field>
      </div>

      {/* Sticky bottom action */}
      <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid var(--border)', padding: '12px 28px', display: 'flex', gap: 8, justifyContent: 'center' }}>
        <Button variant="secondary" size="lg" icon="AlertCircle">トラブル報告</Button>
        <Button size="lg" icon="Flag" iconRight="ArrowRight">搬入完了を報告</Button>
      </div>
    </Shell>
  );
};

Object.assign(window, { ScreenVendorNewList, ScreenVendorProgress });

// ─────────────────────────────────────────────
// D.2 新規依頼一覧 — スマホ版カード UI (§H.3 thumb-zone)
// ─────────────────────────────────────────────
const ScreenVendorNewListMobile = () => {
  const rows = [
    { id: 'TY-2026-0142', from: '渋谷店', to: '横浜整備工場', pickup: '05/23 09:30', distance: '40km', invited: false, deadline: '1h 47m', urgent: false },
    { id: 'TY-2026-0143', from: '川崎店', to: '横須賀店', pickup: '05/23 14:00', distance: '32km', invited: true, deadline: '3h 12m', urgent: false },
    { id: 'TY-2026-0140', from: '横浜店', to: '渋谷店', pickup: '今日 16:00', distance: '40km', invited: false, deadline: '28m', urgent: true },
  ];
  return (
    <div className="app" style={{ width: '100%', height: '100%', background: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column' }}>
      {/* Top bar */}
      <div style={{ height: 52, background: '#fff', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8, flexShrink: 0 }}>
        <button className="btn btn-ghost btn-sm" style={{ padding: 6 }}><Icon name="Menu" size={20} /></button>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 600 }}>新規依頼</div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>未回答 3 件</div>
        </div>
        <button className="btn btn-ghost btn-sm" style={{ padding: 6, position: 'relative' }}>
          <Icon name="Bell" size={20} />
          <span style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: 999, background: 'var(--danger)' }} />
        </button>
      </div>

      {/* Sort chip */}
      <div style={{ padding: '10px 12px', display: 'flex', gap: 6, overflowX: 'auto', borderBottom: '1px solid var(--border)', background: '#fff' }}>
        <FilterChip label="並び順" value="期限が近い順" />
        <FilterChip label="経路" value="渋谷-横浜" />
      </div>

      {/* Cards */}
      <div style={{ flex: 1, overflow: 'auto', padding: '12px 12px 80px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        {rows.map(r => (
          <div key={r.id} className="card" style={{ padding: '14px 16px', borderLeft: r.urgent ? '3px solid var(--danger)' : '3px solid transparent' }}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <span className="tabular" style={{ fontSize: 13, fontWeight: 700, color: 'var(--primary)' }}>{r.id}</span>
              <Badge tone={r.urgent ? 'danger' : 'warning'} icon={r.urgent ? 'Flame' : 'Clock'}>残り {r.deadline}</Badge>
            </div>

            {/* Route */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12, padding: '10px 12px', background: 'var(--bg-subtle)', borderRadius: 8 }}>
              <Icon name="MapPin" size={14} style={{ color: 'var(--success)' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{r.from}</span>
              <Icon name="ArrowRight" size={12} style={{ color: 'var(--text-muted)' }} />
              <Icon name="MapPin" size={14} style={{ color: 'var(--danger)' }} />
              <span style={{ fontSize: 13, fontWeight: 600 }}>{r.to}</span>
            </div>

            <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 12, color: 'var(--text-secondary)' }}>
              <span><Icon name="Calendar" size={11} /> <span className="tabular">{r.pickup}</span></span>
              <span><Icon name="Navigation" size={11} /> <span className="tabular">{r.distance}</span></span>
              {r.invited && <Badge tone="primary" icon="MailOpen">招待経由</Badge>}
            </div>

            {/* Actions — thumb zone */}
            <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
              <Button variant="secondary" icon="XCircle" style={{ flex: 1, justifyContent: 'center' }}>対応不可</Button>
              <Button icon="CheckCircle2" style={{ flex: 2, justifyContent: 'center' }}>対応可</Button>
            </div>
          </div>
        ))}
      </div>

      {/* Bottom nav */}
      <div style={{ background: '#fff', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-around', padding: '6px 0' }}>
        {[
          { i: 'Inbox', l: '通知一覧' },
          { i: 'PackagePlus', l: '新規依頼', a: true },
          { i: 'Truck', l: '対応中' },
          { i: 'CheckCircle2', l: '完了' },
        ].map(t => (
          <button key={t.l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '4px 8px', background: 'transparent', border: 'none', color: t.a ? 'var(--primary)' : 'var(--text-muted)' }}>
            <Icon name={t.i} size={18} />
            <span style={{ fontSize: 10, fontWeight: t.a ? 600 : 500 }}>{t.l}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

Object.assign(window, { ScreenVendorNewListMobile });
