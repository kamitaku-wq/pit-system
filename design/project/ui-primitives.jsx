/* global React */
// 段取りくん — UI Primitives (§B common components)

// Lucide icon helper — wraps lucide-static SVG with React props
const Icon = ({ name, size = 16, className = '', strokeWidth = 1.75, style }) => {
  const ref = React.useRef(null);
  React.useEffect(() => {
    if (ref.current && window.lucide) {
      const svg = window.lucide.createElement(window.lucide.icons[name] || window.lucide.icons.Square);
      svg.setAttribute('width', size);
      svg.setAttribute('height', size);
      svg.setAttribute('stroke-width', strokeWidth);
      svg.style.flexShrink = '0';
      ref.current.innerHTML = '';
      ref.current.appendChild(svg);
    }
  }, [name, size, strokeWidth]);
  return <span ref={ref} className={`lc-wrap ${className}`} style={{ display: 'inline-flex', alignItems: 'center', ...style }} />;
};

// Status badge — §B.7
const Badge = ({ tone = 'muted', icon, children }) => (
  <span className={`badge badge-${tone}`}>
    {icon && <Icon name={icon} size={12} />}
    {children}
  </span>
);

// Status badge presets for our domain
const StatusBadge = ({ status }) => {
  const map = {
    available:    { tone: 'success', icon: 'CheckCircle2', label: '対応可' },
    unavailable:  { tone: 'danger',  icon: 'XCircle',      label: '対応不可' },
    unconfirmed:  { tone: 'warning', icon: 'Clock',        label: '業者未確認' },
    failed:       { tone: 'danger',  icon: 'AlertTriangle', label: '通知失敗' },
    moving:       { tone: 'info',    icon: 'Truck',        label: '移動中' },
    done:         { tone: 'muted',   icon: 'Flag',         label: '完了' },
    confirmed:    { tone: 'success', icon: 'CheckCircle2', label: '確定' },
    tentative:    { tone: 'warning', icon: 'Clock',        label: '仮予約' },
    cancelled:    { tone: 'muted',   icon: 'Ban',          label: 'キャンセル' },
    inprogress:   { tone: 'info',    icon: 'Wrench',       label: '作業中' },
    waiting:      { tone: 'warning', icon: 'Clock',        label: '対応待ち' },
    won:          { tone: 'primary', icon: 'Trophy',       label: '受注確定' },
    revoked:      { tone: 'muted',   icon: 'Ban',          label: '取下げ' },
    notified:     { tone: 'info',    icon: 'Send',         label: '通知済' },
  };
  const s = map[status] || { tone: 'muted', label: status };
  return <Badge tone={s.tone} icon={s.icon}>{s.label}</Badge>;
};

// Button — §B.4
const Button = ({ variant = 'primary', size = 'md', icon, iconRight, children, onClick, type = 'button', disabled }) => (
  <button
    type={type}
    onClick={onClick}
    disabled={disabled}
    className={`btn btn-${variant}${size !== 'md' ? ` btn-${size}` : ''}`}
    style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : {}}
  >
    {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
    {children}
    {iconRight && <Icon name={iconRight} size={size === 'sm' ? 14 : 16} />}
  </button>
);

// Global Header — §B.1
const GlobalHeader = ({ user = '田中', notifCount = 3, company = '◯◯モータース', search = true, audience = 'admin' }) => (
  <div style={{
    height: 56, background: '#fff', borderBottom: '1px solid var(--border)',
    display: 'flex', alignItems: 'center', padding: '0 20px', gap: 16, flexShrink: 0,
  }}>
    <div className="brand-logo">
      <span className="mark">段</span>
      <span>段取りくん</span>
      {audience === 'vendor' && (
        <span style={{ marginLeft: 6, padding: '2px 8px', background: '#F1F5F9', color: '#475569', fontSize: 11, fontWeight: 600, borderRadius: 4 }}>業者画面</span>
      )}
    </div>
    {audience === 'admin' && (
      <>
        <div style={{ height: 24, width: 1, background: 'var(--border)' }} />
        <button style={{ display: 'inline-flex', alignItems: 'center', gap: 6, padding: '6px 10px', background: 'transparent', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, fontWeight: 500, color: 'var(--text)' }}>
          <Icon name="Building2" size={14} />{company}<Icon name="ChevronDown" size={12} />
        </button>
      </>
    )}
    {search && (
      <div style={{ flex: 1, maxWidth: 480, marginLeft: 16, position: 'relative' }}>
        <Icon name="Search" size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: '#94A3B8' }} />
        <input className="input" placeholder="車両 / 整備伝票 / 顧客を検索…" style={{ paddingLeft: 36, height: 36, background: 'var(--bg-subtle)', border: '1px solid transparent' }} />
        <kbd style={{ position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-muted)', background: '#fff', border: '1px solid var(--border)', borderRadius: 4, padding: '1px 5px' }}>⌘K</kbd>
      </div>
    )}
    <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4 }}>
      <button className="btn btn-ghost btn-sm" style={{ position: 'relative', padding: 8 }}>
        <Icon name="Bell" size={18} />
        {notifCount > 0 && <span style={{ position: 'absolute', top: 4, right: 4, background: 'var(--danger)', color: '#fff', minWidth: 16, height: 16, padding: '0 4px', borderRadius: 999, fontSize: 10, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>{notifCount}</span>}
      </button>
      <button className="btn btn-ghost btn-sm" style={{ padding: 8 }}><Icon name="Settings" size={18} /></button>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 8, padding: '4px 10px 4px 4px', borderRadius: 999, cursor: 'pointer' }}>
        <div className="avatar">{user.slice(0, 1)}</div>
        <span style={{ fontSize: 13, fontWeight: 500 }}>{user}</span>
        <Icon name="ChevronDown" size={12} style={{ color: '#94A3B8' }} />
      </div>
    </div>
  </div>
);

// Sidebar — §B.2 / B.3
const Sidebar = ({ items, active }) => (
  <nav style={{ width: 240, background: 'var(--bg-subtle)', borderRight: '1px solid var(--border)', display: 'flex', flexDirection: 'column', flexShrink: 0, paddingTop: 8, paddingBottom: 8, overflowY: 'auto' }}>
    {items.map((item, i) => {
      if (item.section) return <div key={`s${i}`} className="nav-section">{item.section}</div>;
      if (item.divider) return <div key={`d${i}`} style={{ height: 1, background: 'var(--border)', margin: '8px 12px' }} />;
      return (
        <div key={item.key} className={`nav-item ${active === item.key ? 'active' : ''}`}>
          <Icon name={item.icon} size={16} />
          <span>{item.label}</span>
          {item.badge && <span className="nav-badge">{item.badge}</span>}
        </div>
      );
    })}
  </nav>
);

const ADMIN_NAV = [
  { key: 'home', icon: 'LayoutDashboard', label: 'ホーム' },
  { key: 'calendar', icon: 'Calendar', label: 'カレンダー' },
  { key: 'cust-reservations', icon: 'Users', label: '顧客予約' },
  { key: 'transfer', icon: 'ArrowLeftRight', label: '店間整備依頼', badge: 2 },
  { key: 'vendor-notify', icon: 'Truck', label: '業者通知・回送', badge: 3 },
  { key: 'tickets', icon: 'FileText', label: '整備伝票' },
  { key: 'floor', icon: 'LayoutGrid', label: '今日の工場ボード' },
  { key: 'vehicles', icon: 'Car', label: '車両一覧' },
  { divider: true },
  { key: 'ops', icon: 'AlertTriangle', label: '通知の再送・確認', badge: 2 },
  { key: 'audit', icon: 'History', label: '操作記録' },
  { divider: true },
  { key: 'settings', icon: 'Settings', label: '設定' },
];

const VENDOR_NAV = [
  { key: 'inbox', icon: 'Inbox', label: '通知一覧', badge: 5 },
  { key: 'new', icon: 'PackagePlus', label: '新規依頼', badge: 1 },
  { key: 'active', icon: 'Truck', label: '対応中' },
  { key: 'done', icon: 'CheckCircle2', label: '完了済み' },
  { divider: true },
  { key: 'invites', icon: 'Mail', label: '招待管理' },
];

// Shell — header + sidebar + main
const Shell = ({ children, audience = 'admin', active, navItems }) => (
  <div className="app" style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
    <GlobalHeader audience={audience} user={audience === 'vendor' ? '山田' : '田中'} />
    <div style={{ flex: 1, display: 'flex', overflow: 'hidden' }}>
      <Sidebar items={navItems || (audience === 'vendor' ? VENDOR_NAV : ADMIN_NAV)} active={active} />
      <main style={{ flex: 1, overflow: 'auto', background: '#fff' }}>{children}</main>
    </div>
  </div>
);

// Page header (inside main)
const PageHeader = ({ title, subtitle, breadcrumb, right }) => (
  <div style={{ padding: '20px 28px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16 }}>
    <div>
      {breadcrumb && (
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
          {breadcrumb.map((b, i) => (
            <React.Fragment key={i}>
              {i > 0 && <Icon name="ChevronRight" size={12} />}
              <span>{b}</span>
            </React.Fragment>
          ))}
        </div>
      )}
      <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, letterSpacing: '-0.01em' }}>{title}</h1>
      {subtitle && <p style={{ margin: '4px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>{subtitle}</p>}
    </div>
    {right && <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>{right}</div>}
  </div>
);

// Tabs
const Tabs = ({ items, active, onChange = () => {} }) => (
  <div style={{ display: 'flex', gap: 0, borderBottom: '1px solid var(--border)' }}>
    {items.map(it => (
      <div
        key={it.key}
        onClick={() => onChange(it.key)}
        style={{
          padding: '10px 16px',
          fontSize: 13,
          fontWeight: 500,
          color: active === it.key ? 'var(--primary)' : 'var(--text-secondary)',
          borderBottom: `2px solid ${active === it.key ? 'var(--primary)' : 'transparent'}`,
          marginBottom: -1,
          cursor: 'pointer',
          display: 'inline-flex',
          alignItems: 'center',
          gap: 6,
        }}
      >
        {it.label}
        {it.count != null && <span className="badge badge-muted" style={{ fontSize: 11, height: 18, padding: '0 6px' }}>{it.count}</span>}
      </div>
    ))}
  </div>
);

// Field row helper — id/label/aria 連携付き (§A.8.8)
const Field = ({ label, required, children, hint, error, id }) => {
  const reactId = React.useId();
  const fieldId = id || `f-${reactId}`;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  // Clone children and inject aria-* + id
  const childArray = React.Children.toArray(children);
  const enhancedChildren = childArray.map((child, i) => {
    if (!React.isValidElement(child) || i > 0) return child;
    return React.cloneElement(child, {
      id: child.props.id || fieldId,
      'aria-describedby': [hintId, errorId].filter(Boolean).join(' ') || undefined,
      'aria-required': required || undefined,
      'aria-invalid': !!error || undefined,
    });
  });
  return (
    <div className="field">
      {label && (
        <label className="field-label" htmlFor={fieldId}>{label}{required && <span className="req" aria-label="必須">*</span>}</label>
      )}
      {enhancedChildren}
      {hint && !error && <span id={hintId} style={{ fontSize: 12, color: 'var(--text-muted)' }}>{hint}</span>}
      {error && <span id={errorId} role="alert" style={{ fontSize: 12, color: 'var(--danger)', display: 'flex', alignItems: 'center', gap: 4 }}><Icon name="AlertCircle" size={12} />{error}</span>}
    </div>
  );
};

// Filter chip / select-ish
const FilterChip = ({ label, value, active }) => (
  <button style={{
    display: 'inline-flex', alignItems: 'center', gap: 6,
    height: 32, padding: '0 12px', borderRadius: 6,
    background: active ? 'var(--primary-light)' : '#fff',
    border: `1px solid ${active ? 'var(--primary)' : 'var(--border)'}`,
    fontSize: 13, fontWeight: 500, color: active ? 'var(--primary)' : 'var(--text)',
  }}>
    {label && <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>{label}:</span>}
    <span>{value}</span>
    <Icon name="ChevronDown" size={12} style={{ color: 'var(--text-muted)' }} />
  </button>
);

// Export to window for cross-script use
Object.assign(window, {
  Icon, Badge, StatusBadge, Button, GlobalHeader, Sidebar, Shell, PageHeader, Tabs, Field, FilterChip,
  ADMIN_NAV, VENDOR_NAV,
});
