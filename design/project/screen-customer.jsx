/* global React, Icon, Button, Badge, Field */
// 段取りくん — Customer reservation screens (§E) — mobile-first

// Reusable mobile shell
const MobileShell = ({ children, step, total = 6, title }) => (
  <div className="app" style={{ width: '100%', height: '100%', background: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column' }}>
    {/* Top app bar */}
    <div style={{ height: 52, background: '#fff', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10, flexShrink: 0 }}>
      <button className="btn btn-ghost btn-sm" style={{ padding: 6 }}><Icon name="ChevronLeft" size={18} /></button>
      <div style={{ flex: 1 }}>
        <div className="brand-logo" style={{ fontSize: 14 }}>
          <span className="mark" style={{ width: 20, height: 20, fontSize: 11 }}>段</span>
          <span>段取りくん</span>
        </div>
      </div>
      <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}><span className="tabular">{step}</span> / <span className="tabular">{total}</span></span>
    </div>
    {/* Progress */}
    <div style={{ height: 3, background: 'var(--border)', flexShrink: 0 }}>
      <div style={{ height: '100%', width: `${(step / total) * 100}%`, background: 'var(--primary)', transition: 'width .25s' }} />
    </div>
    {/* Title */}
    {title && (
      <div style={{ padding: '16px 20px 4px', background: '#fff' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{title}</h2>
      </div>
    )}
    <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
  </div>
);

// ─────────────────────────────────────────────
// E.1 Step 2: 作業メニュー選択
// ─────────────────────────────────────────────
const ScreenCustomerStep2 = () => {
  const menus = [
    { i: 'Droplet', cat: '基本メンテナンス', name: 'オイル交換', t: 30, p: '¥4,800〜', popular: true },
    { i: 'CircleDot', cat: '基本メンテナンス', name: 'タイヤ交換', t: 60, p: '¥8,000〜' },
    { i: 'BatteryCharging', cat: '基本メンテナンス', name: 'バッテリー交換', t: 30, p: '¥18,500〜' },
    { i: 'ShieldCheck', cat: '法定整備', name: '法定 12 ヶ月点検', t: 90, p: '¥18,000〜' },
    { i: 'ClipboardCheck', cat: '法定整備', name: '車検整備', t: 180, p: '¥58,000〜', popular: true },
    { i: 'Wrench', cat: '修理', name: '修理見積（無料）', t: 30, p: '無料' },
  ];
  return (
    <MobileShell step={2} title="ご希望の作業内容をお選びください">
      <div style={{ padding: '10px 20px 4px' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>渋谷店 · 営業 9:00–18:00</div>
      </div>
      <div style={{ padding: '12px 16px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '4px 4px 0' }}>人気のメニュー</div>
        {menus.filter(m => m.popular).map((m, i) => (
          <MenuCard key={i} m={m} selected={i === 0} />
        ))}
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', padding: '12px 4px 0' }}>すべてのメニュー</div>
        {menus.filter(m => !m.popular).map((m, i) => (
          <MenuCard key={i} m={m} />
        ))}
      </div>
      <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid var(--border)', padding: '12px 16px', display: 'flex', gap: 8 }}>
        <Button variant="secondary" size="lg" style={{ flex: 1 }}>戻る</Button>
        <Button size="lg" iconRight="ArrowRight" style={{ flex: 2 }}>日時を選ぶ</Button>
      </div>
    </MobileShell>
  );
};

const MenuCard = ({ m, selected }) => (
  <label style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', background: '#fff', border: `1.5px solid ${selected ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 10, cursor: 'pointer', boxShadow: selected ? '0 0 0 3px rgba(30, 58, 138, 0.1)' : 'none' }}>
    <div style={{ width: 40, height: 40, borderRadius: 8, background: selected ? 'var(--primary)' : 'var(--primary-light)', color: selected ? '#fff' : 'var(--primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon name={m.i} size={20} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{m.cat}</div>
      <div style={{ fontSize: 14.5, fontWeight: 600, marginTop: 1 }}>{m.name}</div>
      <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 12, color: 'var(--text-secondary)' }}>
        <span><Icon name="Clock" size={11} /> 約 <span className="tabular">{m.t}</span> 分</span>
        <span><Icon name="Tag" size={11} /> {m.p}</span>
      </div>
    </div>
    <div style={{ width: 22, height: 22, borderRadius: 999, border: `2px solid ${selected ? 'var(--primary)' : 'var(--border-strong)'}`, background: selected ? 'var(--primary)' : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      {selected && <Icon name="Check" size={12} style={{ color: '#fff' }} />}
    </div>
  </label>
);

// ─────────────────────────────────────────────
// E.1 Step 3: 空き日時選択
// ─────────────────────────────────────────────
const ScreenCustomerStep3 = () => {
  const days = [
    { d: '23', dow: '土', avail: 'high', selected: true },
    { d: '24', dow: '日', avail: 'low' },
    { d: '25', dow: '月', avail: 'high' },
    { d: '26', dow: '火', avail: 'mid' },
    { d: '27', dow: '水', avail: 'high' },
    { d: '28', dow: '木', avail: 'none' },
    { d: '29', dow: '金', avail: 'mid' },
  ];
  const slots = [
    { t: '09:00', s: 'open' }, { t: '09:30', s: 'open' }, { t: '10:00', s: 'selected' },
    { t: '10:30', s: 'full' }, { t: '11:00', s: 'open' }, { t: '11:30', s: 'open' },
    { t: '12:00', s: 'closed' }, { t: '12:30', s: 'closed' }, { t: '13:00', s: 'open' },
    { t: '13:30', s: 'full' }, { t: '14:00', s: 'open' }, { t: '14:30', s: 'open' },
    { t: '15:00', s: 'open' }, { t: '15:30', s: 'full' }, { t: '16:00', s: 'open' },
    { t: '16:30', s: 'open' }, { t: '17:00', s: 'open' }, { t: '17:30', s: 'full' },
  ];
  const slotStyles = {
    open:    { bg: '#ECFDF5', fg: '#065F46', border: '#A7F3D0' },
    selected:{ bg: 'var(--primary)', fg: '#fff', border: 'var(--primary)' },
    full:    { bg: 'var(--bg-subtle)', fg: 'var(--text-muted)', border: 'var(--border)' },
    closed:  { bg: '#F1F5F9', fg: '#CBD5E1', border: '#E2E8F0', stripe: true },
  };
  return (
    <MobileShell step={3} title="ご希望の日時をお選びください">
      <div style={{ padding: '4px 20px 0', fontSize: 12, color: 'var(--text-muted)' }}>渋谷店 · オイル交換（約 30 分）</div>

      {/* Day strip */}
      <div style={{ padding: '12px 16px 4px', overflow: 'hidden' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 8 }}>
          <button className="btn btn-ghost btn-sm" style={{ padding: 6 }}><Icon name="ChevronLeft" size={16} /></button>
          <div className="tabular" style={{ fontSize: 14, fontWeight: 600, flex: 1, textAlign: 'center' }}>2026 年 5 月</div>
          <button className="btn btn-ghost btn-sm" style={{ padding: 6 }}><Icon name="ChevronRight" size={16} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
          {days.map((d, i) => {
            const isSel = d.selected;
            const isNone = d.avail === 'none';
            return (
              <button key={i} style={{
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4,
                padding: '8px 0', border: `1.5px solid ${isSel ? 'var(--primary)' : 'var(--border)'}`,
                borderRadius: 10, background: isSel ? 'var(--primary)' : '#fff',
                color: isSel ? '#fff' : isNone ? 'var(--text-muted)' : 'var(--text)',
                opacity: isNone ? 0.5 : 1,
              }}>
                <span style={{ fontSize: 10, fontWeight: 500 }}>{d.dow}</span>
                <span className="tabular" style={{ fontSize: 17, fontWeight: 700 }}>{d.d}</span>
                <span style={{
                  width: 5, height: 5, borderRadius: 999,
                  background: isSel ? '#fff' : d.avail === 'high' ? 'var(--success)' : d.avail === 'mid' ? 'var(--warning)' : d.avail === 'low' ? 'var(--danger)' : 'transparent',
                }} />
              </button>
            );
          })}
        </div>
      </div>

      {/* Slots */}
      <div style={{ padding: '16px 16px 4px' }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>05/23 (土) の空き時間</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
          {slots.map((s, i) => {
            const st = slotStyles[s.s];
            return (
              <button key={i} disabled={s.s !== 'open' && s.s !== 'selected'} className="tabular" style={{
                padding: '12px 0', borderRadius: 8,
                background: st.bg, color: st.fg,
                border: `1.5px solid ${st.border}`,
                fontSize: 14, fontWeight: 600,
                cursor: (s.s === 'open' || s.s === 'selected') ? 'pointer' : 'not-allowed',
                opacity: s.s === 'closed' ? 0.5 : 1,
                backgroundImage: st.stripe ? 'repeating-linear-gradient(45deg, #F8FAFC 0 4px, transparent 4px 8px)' : 'none',
              }}>{s.t}</button>
            );
          })}
        </div>
        <div style={{ display: 'flex', gap: 12, marginTop: 14, fontSize: 11.5, color: 'var(--text-muted)' }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#ECFDF5', border: '1px solid #A7F3D0' }} /> 空き</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: 'var(--bg-subtle)', border: '1px solid var(--border)' }} /> 満枠</span>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}><span style={{ width: 8, height: 8, borderRadius: 2, background: '#F1F5F9' }} /> 営業時間外</span>
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid var(--border)', padding: '12px 16px', marginTop: 20 }}>
        <div style={{ padding: '10px 14px', background: 'var(--primary-light)', borderRadius: 8, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 10 }}>
          <Icon name="CheckCircle2" size={16} style={{ color: 'var(--primary)' }} />
          <div style={{ flex: 1, fontSize: 12.5 }}>
            <div style={{ fontWeight: 600, color: 'var(--primary)' }}>2026/05/23 (土) 10:00</div>
            <div style={{ color: 'var(--text-secondary)' }}>渋谷店 · オイル交換（約 30 分）</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" size="lg" style={{ flex: 1 }}>戻る</Button>
          <Button size="lg" iconRight="ArrowRight" style={{ flex: 2 }}>お客様情報入力へ</Button>
        </div>
      </div>
    </MobileShell>
  );
};

Object.assign(window, { ScreenCustomerStep2, ScreenCustomerStep3 });
