/* global React, Shell, GlobalHeader, Sidebar, PageHeader, Tabs, Button, Icon, Badge, StatusBadge, Field, FilterChip */
// 段取りくん — Admin screens (§C)

// ─────────────────────────────────────────────
// C.1 ダッシュボード
// ─────────────────────────────────────────────
const KpiCard = ({ label, value, icon, tone = 'muted', sub, badgeCount }) => (
  <div className="card kpi" style={{ flex: 1, minWidth: 0, position: 'relative' }}>
    <div className="label">
      <Icon name={icon} size={14} style={{ color: 'var(--text-muted)' }} />
      {label}
      {badgeCount > 0 && <span style={{ marginLeft: 'auto', background: 'var(--danger)', color: '#fff', minWidth: 18, height: 18, borderRadius: 999, padding: '0 6px', fontSize: 11, fontWeight: 700, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', lineHeight: 1 }}>{badgeCount}</span>}
    </div>
    <div className="value">{value}</div>
    {sub && <div className="delta">{sub}</div>}
  </div>
);

const PitUtilizationRow = ({ store, lanes, pct, busy }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '92px 1fr 60px', alignItems: 'center', gap: 12, padding: '10px 0' }}>
    <div style={{ fontSize: 13, fontWeight: 500 }}>{store}<span style={{ color: 'var(--text-muted)', fontWeight: 400, marginLeft: 4 }}>{lanes}L</span></div>
    <div className="progress" style={{ height: 10 }}>
      <div style={{ width: `${pct}%`, background: pct >= 85 ? 'var(--danger)' : pct >= 70 ? 'var(--warning)' : 'var(--primary)' }} />
    </div>
    <div className="tabular" style={{ fontSize: 13, fontWeight: 600, textAlign: 'right' }}>{pct}%</div>
  </div>
);

const TentativeExpiryRow = ({ time, name, work, store, mins }) => (
  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
    <div className="tabular" style={{ fontSize: 13, fontWeight: 600, width: 48 }}>{time}</div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name} · {work}</div>
      <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{store}</div>
    </div>
    <span className="badge badge-warning"><Icon name="Clock" size={11} />{mins}分</span>
  </div>
);

const ScreenDashboard = () => (
  <Shell audience="admin" active="home">
    <PageHeader
      title="ホーム"
      subtitle="2026-05-22(金) · 渋谷店 / 横浜店 / 川崎店 / 横須賀店"
      right={
        <>
          <FilterChip label="期間" value="本日" />
          <Button variant="secondary" icon="Download">CSV</Button>
          <Button icon="Plus">新規予約</Button>
        </>
      }
    />
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* KPI row */}
      <div style={{ display: 'flex', gap: 16 }}>
        <KpiCard label="本日予約" value="24" icon="CalendarCheck" sub="昨日比 +3件" />
        <KpiCard label="業者未確認" value="3" icon="Clock" badgeCount={3} sub="最長 27 分経過" />
        <KpiCard label="対応不可" value="1" icon="XCircle" badgeCount={1} sub="再打診中 1件" />
        <KpiCard label="通知失敗" value="2" icon="AlertTriangle" badgeCount={2} sub="要手動再送" />
      </div>

      {/* Middle row */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 16 }}>
        <div className="card">
          <div className="card-header">
            <div className="card-title">店舗別ピット稼働状況</div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>本日 9:00–18:00</span>
          </div>
          <div className="card-body" style={{ paddingTop: 8, paddingBottom: 16 }}>
            <PitUtilizationRow store="渋谷店" lanes={3} pct={75} />
            <PitUtilizationRow store="横浜店" lanes={2} pct={50} />
            <PitUtilizationRow store="川崎店" lanes={4} pct={87} />
            <PitUtilizationRow store="横須賀店" lanes={2} pct={42} />
          </div>
        </div>

        <div className="card">
          <div className="card-header">
            <div className="card-title">仮予約 期限切れ間近</div>
            <span className="badge badge-warning"><Icon name="Clock" size={11} />4件</span>
          </div>
          <div className="card-body" style={{ paddingTop: 4, paddingBottom: 8 }}>
            <TentativeExpiryRow time="14:30" name="田中 太郎様" work="オイル交換" store="渋谷店 Lane1" mins={18} />
            <TentativeExpiryRow time="15:00" name="佐藤 花子様" work="タイヤ交換" store="横浜店 Lane1" mins={42} />
            <TentativeExpiryRow time="15:30" name="鈴木 一郎様" work="車検整備" store="川崎店 Lane2" mins={68} />
            <div style={{ paddingTop: 8 }}>
              <Button variant="tertiary" iconRight="ArrowRight" size="sm">すべて表示</Button>
            </div>
          </div>
        </div>
      </div>

      {/* Timeline mini */}
      <div className="card">
        <div className="card-header">
          <div className="card-title">本日のタイムライン</div>
          <Button variant="tertiary" iconRight="ArrowRight" size="sm">カレンダーを開く</Button>
        </div>
        <div style={{ padding: '16px 20px' }}>
          {/* hour ruler */}
          <div style={{ display: 'grid', gridTemplateColumns: '80px repeat(9, 1fr)', alignItems: 'center', gap: 8, fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>
            <div />
            {['9','10','11','12','13','14','15','16','17'].map(h => <div key={h} className="tabular">{h}:00</div>)}
          </div>
          {[
            { store: '渋谷 L1', events: [{ s: 0, w: 1, t: '田中', sub: 'オイル', c: 'blue' }, { s: 4, w: 2, t: '佐藤', sub: '車検', c: 'amber' }] },
            { store: '渋谷 L2', events: [{ s: 1, w: 2, t: '鈴木', sub: 'タイヤ', c: 'green' }, { s: 6, w: 2, t: '山本', sub: 'バッテリー', c: 'blue' }] },
            { store: '横浜 L1', events: [{ s: 0, w: 3, t: '店間: 田中', sub: '業者通知済', c: 'violet' }] },
            { store: '川崎 L2', events: [{ s: 2, w: 3, t: '高橋', sub: '修理見積', c: 'rose' }, { s: 7, w: 1, t: '小林', sub: '点検', c: 'green' }] },
          ].map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '80px 1fr', alignItems: 'center', gap: 8, padding: '4px 0', borderTop: i === 0 ? 'none' : '1px solid var(--border)' }}>
              <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-secondary)' }}>{row.store}</div>
              <div style={{ position: 'relative', height: 36, background: 'repeating-linear-gradient(90deg, transparent 0, transparent calc(11.11% - 1px), var(--border) calc(11.11% - 1px), var(--border) 11.11%)' }}>
                {row.events.map((e, j) => (
                  <div key={j} className={`evt evt-${e.c}`} style={{ position: 'absolute', top: 4, height: 28, left: `${e.s * 11.11}%`, width: `${e.w * 11.11}%`, padding: '4px 8px' }}>
                    <div className="evt-title" style={{ marginBottom: 0, fontSize: 11.5 }}>{e.t}</div>
                    <div className="evt-sub">{e.sub}</div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  </Shell>
);

// ─────────────────────────────────────────────
// C.2 ピット予約カレンダー
// ─────────────────────────────────────────────
const ScreenCalendar = () => {
  const HOURS = ['9:00', '10:00', '11:00', '12:00', '13:00', '14:00', '15:00', '16:00', '17:00'];
  const rows = [
    { store: '渋谷店', lane: 'Lane 1', type: 'メンテナンス', events: [
      { s: 0, w: 1, t: '田中 太郎', sub: 'オイル交換', c: 'blue', status: 'confirmed' },
      { s: 4, w: 2, t: '佐藤 花子', sub: '車検整備', c: 'amber', status: 'confirmed' },
      { s: 7, w: 1.5, t: '高橋 健', sub: 'タイヤ交換', c: 'blue', status: 'tentative' },
    ]},
    { store: '渋谷店', lane: 'Lane 2', type: '重整備', events: [
      { s: 1, w: 2, t: '鈴木 一郎', sub: 'タイヤ + アライメント', c: 'green', status: 'confirmed' },
      { s: 5, w: 3, t: '伊藤 美咲', sub: '修理見積 + 整備', c: 'rose', status: 'inprogress' },
    ]},
    { store: '横浜店', lane: 'Lane 1', type: '汎用', events: [
      { s: 0, w: 3, t: '【店間】 田中', sub: '業者通知済 · 移動中', c: 'violet', status: 'moving', truck: true },
      { s: 4, w: 2, t: '山本 美穂', sub: '法定点検', c: 'green', status: 'confirmed' },
    ]},
    { store: '横浜店', lane: 'Lane 2', type: 'メンテナンス', events: [
      { s: 2, w: 2.5, t: '中村 拓也', sub: 'バッテリー交換', c: 'blue', status: 'confirmed' },
      { s: 6, w: 1, t: '小林', sub: '点検', c: 'green', status: 'tentative' },
    ]},
    { store: '川崎店', lane: 'Lane 1', type: '汎用', events: [
      { s: 0, w: 4, t: '渡辺 翔', sub: '車検整備', c: 'amber', status: 'inprogress' },
      { s: 6, w: 2, t: '【店間】 林', sub: '業者: ○○運送', c: 'violet', truck: true },
    ]},
  ];

  return (
    <Shell audience="admin" active="calendar">
      <PageHeader
        title="ピット予約カレンダー"
        right={
          <>
            <Button variant="secondary" icon="Filter" size="md">フィルタ</Button>
            <Button icon="Plus">新規予約</Button>
          </>
        }
      />
      {/* toolbar */}
      <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-subtle)' }}>
        <div style={{ display: 'inline-flex', background: '#fff', border: '1px solid var(--border)', borderRadius: 6, padding: 2 }}>
          {['日', '週', '月'].map((v, i) => (
            <button key={v} style={{
              padding: '6px 14px', fontSize: 13, fontWeight: 500, border: 'none', borderRadius: 4,
              background: i === 0 ? 'var(--primary)' : 'transparent', color: i === 0 ? '#fff' : 'var(--text-secondary)',
            }}>{v}</button>
          ))}
        </div>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <button className="btn btn-ghost btn-sm" style={{ padding: 8 }}><Icon name="ChevronLeft" size={16} /></button>
          <div className="tabular" style={{ fontSize: 14, fontWeight: 600, padding: '0 12px' }}>2026年 5月 22日(金)</div>
          <button className="btn btn-ghost btn-sm" style={{ padding: 8 }}><Icon name="ChevronRight" size={16} /></button>
          <button className="btn btn-secondary btn-sm" style={{ marginLeft: 8 }}>今日</button>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
          <FilterChip label="店舗" value="全店 (4)" />
          <FilterChip label="レーン" value="全レーン" />
          <FilterChip label="作業" value="全種別" />
        </div>
      </div>

      {/* grid */}
      <div style={{ padding: 0, overflow: 'auto' }}>
        <div style={{ minWidth: 1100 }}>
          {/* header */}
          <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', background: '#fff', borderBottom: '1px solid var(--border)', position: 'sticky', top: 0, zIndex: 2 }}>
            <div style={{ padding: '12px 16px', fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>店舗 / レーン</div>
            <div style={{ display: 'grid', gridTemplateColumns: `repeat(${HOURS.length}, 1fr)` }}>
              {HOURS.map(h => (
                <div key={h} className="tabular" style={{ padding: '12px 0 12px 8px', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', borderLeft: '1px solid var(--border)' }}>{h}</div>
              ))}
            </div>
          </div>
          {/* rows */}
          {rows.map((row, i) => (
            <div key={i} style={{ display: 'grid', gridTemplateColumns: '160px 1fr', borderBottom: '1px solid var(--border)', minHeight: 76, background: i % 2 === 1 ? 'var(--bg-subtle)' : '#fff' }}>
              <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'center' }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>{row.store}</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{row.lane}</div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{row.type}</div>
              </div>
              <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: `repeat(${HOURS.length}, 1fr)` }}>
                {HOURS.map((h, j) => (
                  <div key={j} style={{ borderLeft: '1px solid var(--border)', minHeight: 76 }} />
                ))}
                {row.events.map((e, k) => (
                  <div key={k} className={`evt evt-${e.c}`} style={{
                    position: 'absolute', top: 8, bottom: 8,
                    left: `${(e.s / HOURS.length) * 100}%`,
                    width: `calc(${(e.w / HOURS.length) * 100}% - 6px)`,
                    padding: '8px 10px',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 4 }}>
                      <div className="evt-title">{e.t}</div>
                      {e.truck && <Icon name="Truck" size={12} style={{ color: '#8B5CF6' }} />}
                    </div>
                    <div className="evt-sub" style={{ marginTop: 2 }}>{e.sub}</div>
                    {e.status && (
                      <div style={{ marginTop: 4 }}>
                        <StatusBadge status={e.status} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          ))}
          {/* current time line indicator */}
        </div>
      </div>
    </Shell>
  );
};

// ─────────────────────────────────────────────
// C.4 店間整備依頼 Step 3 — 店間移動・業者選択
// ─────────────────────────────────────────────
const RadioRow = ({ checked, label, sub, onChange }) => (
  <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '10px 14px', border: `1.5px solid ${checked ? 'var(--primary)' : 'var(--border)'}`, borderRadius: 6, background: checked ? 'var(--primary-light)' : '#fff', cursor: 'pointer', flex: 1, minWidth: 0 }}>
    <span style={{ width: 16, height: 16, borderRadius: 999, border: `1.5px solid ${checked ? 'var(--primary)' : 'var(--border-strong)'}`, background: checked ? 'var(--primary)' : '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginTop: 2, flexShrink: 0 }}>
      {checked && <span style={{ width: 6, height: 6, borderRadius: 999, background: '#fff' }} />}
    </span>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 13.5, fontWeight: 500 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>}
    </div>
  </label>
);

const ScreenTransferRequest = () => (
  <Shell audience="admin" active="transfer">
    <PageHeader title="店間整備依頼" breadcrumb={['店間整備依頼', '新規作成', 'SV-2026-0089']} />

    {/* Stepper */}
    <div style={{ padding: '24px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div className="stepper">
        <div className="step done"><span className="n"><Icon name="Check" size={12} /></span>基本情報</div>
        <div className="sep" />
        <div className="step done"><span className="n"><Icon name="Check" size={12} /></span>日時・レーン</div>
        <div className="sep" />
        <div className="step active"><span className="n">3</span>店間移動・業者選択</div>
      </div>
    </div>

    <div style={{ padding: '28px 28px 100px', maxWidth: 880, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>
      {/* Summary banner */}
      <div className="card" style={{ background: 'var(--bg-subtle)', borderColor: 'var(--border)' }}>
        <div style={{ padding: '14px 20px', display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, fontSize: 13 }}>
          <div><div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginBottom: 2 }}>整備伝票</div><div style={{ fontWeight: 600 }} className="tabular">SV-2026-0089</div></div>
          <div><div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginBottom: 2 }}>車両</div><div style={{ fontWeight: 600 }}>アルファード · 品川 300 あ 1234</div></div>
          <div><div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginBottom: 2 }}>作業店舗</div><div style={{ fontWeight: 600 }}>横浜整備工場 · Lane 1</div></div>
          <div><div style={{ color: 'var(--text-muted)', fontSize: 11.5, marginBottom: 2 }}>作業時間</div><div style={{ fontWeight: 600 }} className="tabular">05/23 10:00–11:30 (90分)</div></div>
        </div>
      </div>

      {/* 店間移動あり checkbox */}
      <div>
        <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, fontWeight: 600, cursor: 'pointer' }}>
          <input type="checkbox" defaultChecked style={{ width: 16, height: 16, accentColor: 'var(--primary)' }} />
          店間移動あり（業者手配が必要）
        </label>
      </div>

      {/* 移動パターン */}
      <section>
        <h3 className="sec-h">移動パターン</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <RadioRow checked label="片道（引取→搬入）" sub="作業後は搬入店舗で顧客が受領" />
          <RadioRow label="往復（引取→搬入→返却）" sub="作業完了後に元店舗へ返却" />
          <RadioRow label="引取のみ" sub="搬入は別便、または社内移動" />
          <RadioRow label="三点移動" sub="A店→B店→C店、複雑経路" />
        </div>
      </section>

      {/* 店舗 + 時刻 */}
      <section style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 16 }}>
        <Field label="引取店舗" required>
          <div className="input" style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 9 }}>
            <Icon name="MapPin" size={14} style={{ color: 'var(--primary)' }} />渋谷店
          </div>
        </Field>
        <Field label="搬入店舗" required>
          <div className="input" style={{ display: 'flex', alignItems: 'center', gap: 6, paddingTop: 9 }}>
            <Icon name="MapPin" size={14} style={{ color: 'var(--primary)' }} />横浜整備工場
          </div>
        </Field>
        <Field label="返却先">
          <div className="input" style={{ color: 'var(--text-muted)', paddingTop: 9 }}>— （片道のため不要）</div>
        </Field>
        <Field label="希望引取日時" required hint="標準: 作業開始の 30 分前">
          <input className="input" defaultValue="2026-05-23  09:30" />
        </Field>
        <Field label="希望搬入日時" required>
          <input className="input" defaultValue="2026-05-23  10:00" />
        </Field>
        <Field label="走行可否">
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 40, padding: '0 12px', border: '1px solid var(--border-strong)', borderRadius: 4, fontSize: 14 }}>
            <input type="checkbox" defaultChecked style={{ accentColor: 'var(--primary)' }} />
            自走可（チェックを外すとレッカー必須）
          </label>
        </Field>
      </section>

      {/* 業者選択モード */}
      <section>
        <h3 className="sec-h">業者選択モード</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <RadioRow checked label="単一業者指名" sub="対応エリア・曜日マッチ業者から 1 社を直接通知" />
          <RadioRow label="複数業者一斉打診（先着受注）" sub="複数業者へ同時送信、最初に「対応可」を返した業者で確定" />
          <RadioRow label="スポット業者招待（未登録業者にメール）" sub="マスター未登録の業者を招待トークン付きメールで呼び込み" />
        </div>
        <div style={{ marginTop: 12, padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 6, background: 'var(--bg-subtle)' }}>
          <Field label="業者">
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <div className="input" style={{ display: 'flex', alignItems: 'center', gap: 8, paddingTop: 9, flex: 1 }}>
                <Icon name="Building" size={14} style={{ color: 'var(--text-muted)' }} />
                <span style={{ fontWeight: 500 }}>○○運送</span>
                <span className="badge badge-success" style={{ marginLeft: 4 }}><Icon name="MapPinned" size={11} />渋谷-横浜 対応</span>
                <span className="badge badge-muted">過去 38 件 / 完了率 97%</span>
              </div>
              <Button variant="secondary" icon="ArrowUpDown" size="sm">変更</Button>
            </div>
          </Field>
        </div>
      </section>

      {/* 確定モード */}
      <section>
        <h3 className="sec-h">確定モード</h3>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
          <RadioRow checked label="自動確定" sub="業者が「対応可」と回答した時点で予約確定" />
          <RadioRow label="手動確定" sub="業者回答後、店舗承認をもって確定" />
        </div>
      </section>

      {/* 注意事項 */}
      <Field label="注意事項（業者向け）">
        <textarea className="textarea" placeholder="例: チャイルドシート搭載済み、荷物多数、雨天時のシート保護要請など" defaultValue="" />
      </Field>
    </div>

    {/* Sticky footer */}
    <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid var(--border)', padding: '14px 28px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
      <Button variant="secondary" icon="ArrowLeft">戻る</Button>
      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="tertiary">下書き保存</Button>
        <Button icon="Send">予約確定 + 業者通知</Button>
      </div>
    </div>
  </Shell>
);

// ─────────────────────────────────────────────
// C.5 業者通知・回送管理（一覧 + スライドオーバー詳細）
// ─────────────────────────────────────────────
const ScreenVendorNotify = () => {
  const rows = [
    { id: 'TY-2026-0142', vendor: '○○運送', route: '渋谷店 → 横浜整備工場', sent: '5 分前', status: 'available', pickup: '05/23 09:30', staff: '山田 次郎' },
    { id: 'TY-2026-0141', vendor: '□□急便', route: '渋谷店 → 川崎店', sent: '12 分前', status: 'unconfirmed', pickup: '05/23 14:00', staff: '— 未割当', warn: '要確認' },
    { id: 'TY-2026-0140', vendor: '△△陸送', route: '横浜整備工場 → 渋谷店', sent: '25 分前', status: 'unavailable', pickup: '05/23 11:00', staff: '佐藤 拓', urgent: true },
    { id: 'TY-2026-0139', vendor: '○○運送', route: '川崎店 → 渋谷店', sent: '1 時間前', status: 'moving', pickup: '05/22 16:00', staff: '山田 次郎' },
    { id: 'TY-2026-0138', vendor: '◇◇陸送', route: '横須賀店 → 横浜整備工場', sent: '2 時間前', status: 'done', pickup: '05/22 13:00', staff: '田村 翔' },
    { id: 'TY-2026-0137', vendor: '□□急便', route: '渋谷店 → 横須賀店', sent: '3 時間前', status: 'available', pickup: '05/23 08:00', staff: '佐藤 拓' },
  ];

  return (
    <Shell audience="admin" active="vendor-notify">
      <PageHeader
        title="業者通知・回送管理"
        subtitle="発注済み店間移動の業者対応状況"
        right={<Button variant="secondary" icon="Download">CSV エクスポート</Button>}
      />
      <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-subtle)' }}>
        <FilterChip label="ステータス" value="全 6" />
        <FilterChip label="業者" value="全業者" />
        <FilterChip label="期間" value="本日 + 翌日" />
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, marginLeft: 8, fontSize: 13 }}>
          <input type="checkbox" style={{ accentColor: 'var(--primary)' }} />
          <span>緊急対応のみ</span>
        </label>
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <Icon name="Search" size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" placeholder="依頼番号で検索" style={{ height: 32, paddingLeft: 30, width: 220, fontSize: 13 }} />
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 460px', height: 'calc(100% - 132px)' }}>
        {/* List */}
        <div style={{ overflow: 'auto' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 32 }}><input type="checkbox" style={{ accentColor: 'var(--primary)' }} /></th>
                <th>依頼番号</th>
                <th>業者</th>
                <th>移動経路</th>
                <th>引取予定</th>
                <th>通知送信</th>
                <th>状態</th>
                <th style={{ width: 40 }}></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={r.id} className={i === 0 ? 'selected' : ''} style={r.status === 'unavailable' ? { background: 'rgba(239, 68, 68, 0.04)' } : {}}>
                  <td><input type="checkbox" style={{ accentColor: 'var(--primary)' }} defaultChecked={i === 0} /></td>
                  <td><span className="tabular" style={{ fontWeight: 600, color: 'var(--primary)' }}>{r.id}</span></td>
                  <td>{r.vendor}</td>
                  <td>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                      <Icon name="MapPin" size={12} style={{ color: 'var(--text-muted)' }} />
                      {r.route}
                    </div>
                  </td>
                  <td className="tabular" style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{r.pickup}</td>
                  <td style={{ fontSize: 12.5, color: 'var(--text-muted)' }}>{r.sent}</td>
                  <td>
                    <div style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                      <StatusBadge status={r.status} />
                      {r.warn && <Badge tone="warning" icon="AlertCircle">{r.warn}</Badge>}
                      {r.urgent && <Badge tone="danger" icon="Flame">緊急</Badge>}
                    </div>
                  </td>
                  <td><button className="btn btn-ghost btn-sm" style={{ padding: 4 }}><Icon name="MoreVertical" size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Slide-over detail */}
        <aside style={{ borderLeft: '1px solid var(--border)', background: '#fff', overflow: 'auto' }}>
          <div style={{ padding: '20px 24px 16px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>依頼詳細</div>
              <div className="tabular" style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>TY-2026-0142</div>
              <div style={{ marginTop: 6, display: 'flex', gap: 6 }}>
                <StatusBadge status="available" />
                <Badge tone="info" icon="Truck">片道移動</Badge>
              </div>
            </div>
            <button className="x-btn"><Icon name="X" size={16} /></button>
          </div>

          <div style={{ padding: '20px 24px', display: 'flex', flexDirection: 'column', gap: 20 }}>
            <section>
              <h3 className="sec-h">業者・担当</h3>
              <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--primary-light)', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700 }}>○</div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>○○運送</div>
                  <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>担当: 山田 次郎 · <span className="tabular">090-xxxx-xxxx</span></div>
                </div>
              </div>
            </section>

            <section>
              <h3 className="sec-h">タイムライン</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {[
                  { icon: 'Send', color: 'success', label: '通知送信', time: '05/22 13:45', state: 'done' },
                  { icon: 'CheckCircle2', color: 'success', label: '業者確認', time: '05/22 13:50', state: 'done' },
                  { icon: 'ThumbsUp', color: 'success', label: '対応可と回答', time: '05/22 13:52', state: 'done' },
                  { icon: 'Truck', color: 'muted', label: '引取予定', time: '05/23 09:30', state: 'pending' },
                  { icon: 'Flag', color: 'muted', label: '搬入予定', time: '05/23 10:30', state: 'pending' },
                ].map((step, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div style={{ width: 28, height: 28, borderRadius: 999, background: step.state === 'done' ? 'var(--success-light)' : 'var(--bg-subtle)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: step.state === 'done' ? 'var(--success)' : 'var(--text-muted)', flexShrink: 0 }}>
                      <Icon name={step.icon} size={14} />
                    </div>
                    <div style={{ flex: 1, fontSize: 13, fontWeight: step.state === 'pending' ? 400 : 500, color: step.state === 'pending' ? 'var(--text-secondary)' : 'var(--text)' }}>{step.label}</div>
                    <div className="tabular" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{step.time}</div>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="sec-h">アクション</h3>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <Button variant="secondary" icon="UserCog" size="sm">業者変更</Button>
                <Button variant="secondary" icon="Calendar" size="sm">日時変更</Button>
                <Button variant="secondary" icon="RotateCcw" size="sm">再打診</Button>
                <Button variant="ghost" icon="Ban" size="sm">キャンセル</Button>
              </div>
            </section>

            <section>
              <h3 className="sec-h">招待管理（一斉打診履歴）</h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {[
                  { v: '○○運送', s: 'won' },
                  { v: '□□急便', s: 'revoked' },
                  { v: '△△陸送', s: 'revoked' },
                ].map(x => (
                  <div key={x.v} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', background: 'var(--bg-subtle)', borderRadius: 6, fontSize: 13 }}>
                    <span style={{ fontWeight: 500 }}>{x.v}</span>
                    <StatusBadge status={x.s} />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="sec-h">通知履歴</h3>
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <div style={{ display: 'flex', gap: 8 }}><Icon name="Check" size={12} style={{ color: 'var(--success)', marginTop: 2 }} /><div><div style={{ fontWeight: 500, color: 'var(--text)' }}>通知 #1 — Resend / sent</div><div className="tabular">05/22 13:45:02 → yamada@maru-unsou.example.jp</div></div></div>
                <div style={{ display: 'flex', gap: 8 }}><Icon name="Check" size={12} style={{ color: 'var(--success)', marginTop: 2 }} /><div><div style={{ fontWeight: 500, color: 'var(--text)' }}>クリック確認 — opened</div><div className="tabular">05/22 13:50:11</div></div></div>
              </div>
            </section>
          </div>
        </aside>
      </div>
    </Shell>
  );
};

// ─────────────────────────────────────────────
// C.6 整備伝票一覧
// ─────────────────────────────────────────────
const ScreenTickets = () => {
  const rows = [
    { id: 'SV-2026-0089', date: '05/22', store: '渋谷店', work: '横浜整備工場', cust: '田中 太郎', car: 'アルファード', menu: '車検整備 + 店間', status: 'inprogress', amount: '¥58,400' },
    { id: 'SV-2026-0088', date: '05/22', store: '渋谷店', work: '渋谷店', cust: '佐藤 花子', car: 'ヴェルファイア', menu: 'オイル交換', status: 'done', amount: '¥6,820' },
    { id: 'SV-2026-0087', date: '05/22', store: '横浜店', work: '横浜店', cust: '鈴木 一郎', car: 'プリウス', menu: 'タイヤ交換', status: 'done', amount: '¥48,000' },
    { id: 'SV-2026-0086', date: '05/22', store: '川崎店', work: '川崎店', cust: '高橋 健', car: 'ノア', menu: 'バッテリー交換', status: 'confirmed', amount: '¥18,500' },
    { id: 'SV-2026-0085', date: '05/21', store: '横浜店', work: '渋谷店', cust: '伊藤 美咲', car: 'CX-5', menu: '修理見積', status: 'tentative', amount: '— 見積中' },
    { id: 'SV-2026-0084', date: '05/21', store: '渋谷店', work: '渋谷店', cust: '山本 美穂', car: 'フィット', menu: '法定点検', status: 'done', amount: '¥32,000' },
    { id: 'SV-2026-0083', date: '05/21', store: '横須賀店', work: '横須賀店', cust: '中村 拓也', car: 'セレナ', menu: 'エアコン整備', status: 'done', amount: '¥28,900' },
    { id: 'SV-2026-0082', date: '05/20', store: '川崎店', work: '横浜整備工場', cust: '小林 大樹', car: 'ハリアー', menu: '車検整備', status: 'cancelled', amount: '— ' },
  ];
  return (
    <Shell audience="admin" active="tickets">
      <PageHeader title="整備伝票一覧" subtitle="過去 30 日間 · 124 件"
        right={<><Button variant="secondary" icon="Printer">印刷</Button><Button variant="secondary" icon="Download">CSV</Button><Button icon="Plus">新規伝票</Button></>}
      />
      <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-subtle)' }}>
        <div style={{ position: 'relative', flex: '0 0 320px' }}>
          <Icon name="Search" size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" placeholder="顧客名 / ナンバー / 車種で検索" style={{ height: 32, paddingLeft: 30, fontSize: 13 }} />
        </div>
        <FilterChip label="ステータス" value="全 6" />
        <FilterChip label="店舗" value="全店" />
        <FilterChip label="期間" value="過去 30日" />
        <FilterChip label="作業種別" value="全種別" />
        <div style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>計 124 件中 1–8 件</div>
      </div>
      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 32 }}><input type="checkbox" style={{ accentColor: 'var(--primary)' }} /></th>
            <th>伝票番号 <Icon name="ArrowUpDown" size={12} style={{ verticalAlign: 'middle', color: 'var(--text-muted)' }} /></th>
            <th>受付日</th>
            <th>受付店</th>
            <th>作業店</th>
            <th>顧客 / 車両</th>
            <th>作業</th>
            <th>金額</th>
            <th>ステータス</th>
            <th style={{ width: 40 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td><input type="checkbox" style={{ accentColor: 'var(--primary)' }} /></td>
              <td><span className="tabular" style={{ fontWeight: 600, color: 'var(--primary)' }}>{r.id}</span></td>
              <td className="tabular" style={{ color: 'var(--text-secondary)' }}>{r.date}</td>
              <td>{r.store}</td>
              <td>
                {r.store !== r.work ? (
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <Icon name="ArrowRight" size={12} style={{ color: '#8B5CF6' }} />
                    {r.work}
                  </span>
                ) : r.work}
              </td>
              <td>
                <div style={{ fontSize: 13, fontWeight: 500 }}>{r.cust}</div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{r.car}</div>
              </td>
              <td>{r.menu}</td>
              <td className="tabular" style={{ fontWeight: 500 }}>{r.amount}</td>
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
// C.8 通知失敗・運用画面
// ─────────────────────────────────────────────
const ScreenOps = () => {
  const rows = [
    { id: 'OB-2026-3421', kind: '業者通知（初回）', target: '○○運送 yamada@maru.example', attempt: '5/5', error: 'SMTP 550: メールボックス容量超過', staff: '— 未割当', age: '38 分前' },
    { id: 'OB-2026-3420', kind: '顧客リマインド', target: '田中 様 t****@example.com', attempt: '5/5', error: 'DNS lookup failed: メールドメイン解決失敗', staff: '山田 健', age: '52 分前' },
    { id: 'OB-2026-3418', kind: '業者通知（再送）', target: '□□急便 info@maru-kyubin.jp', attempt: '4/5', error: 'タイムアウト (30s)', staff: '山田 健', age: '1 時間前', retry: true },
    { id: 'OB-2026-3416', kind: '招待トークン', target: 'spot@example.jp', attempt: '5/5', error: 'バウンス: アドレス無効', staff: '佐藤 拓', age: '2 時間前' },
  ];
  return (
    <Shell audience="admin" active="ops">
      <PageHeader title="通知失敗・運用" subtitle="配送失敗 / 手動再送 / 原因調査"
        right={<><Button variant="secondary" icon="RefreshCw">一括再送</Button><Button variant="secondary" icon="UserCheck">担当割当</Button></>}
      />

      {/* Escalation banner */}
      <div style={{ margin: '20px 28px 0', padding: '14px 18px', background: 'var(--danger-light)', border: '1px solid var(--danger)', borderRadius: 8, display: 'flex', gap: 12, alignItems: 'flex-start' }}>
        <Icon name="AlertTriangle" size={20} style={{ color: 'var(--danger)', marginTop: 2 }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: 600, fontSize: 14, color: '#991B1B' }}>連続失敗 5 件発生中</div>
          <div style={{ fontSize: 13, color: '#7F1D1D', marginTop: 2 }}>本部管理者へエスカレーション送信済み（05/22 13:42）。SMTP プロバイダ ◯◯ で配送障害の可能性。</div>
        </div>
        <Button variant="secondary" size="sm">対応中にする</Button>
      </div>

      <div style={{ padding: '14px 28px', display: 'flex', alignItems: 'center', gap: 8 }}>
        <FilterChip label="ステータス" value="failed (4)" active />
        <FilterChip value="cancelled" />
        <FilterChip value="未対応" />
        <FilterChip label="担当" value="全員" />
        <FilterChip label="種別" value="全種別" />
      </div>

      <table className="tbl">
        <thead>
          <tr>
            <th style={{ width: 32 }}><input type="checkbox" style={{ accentColor: 'var(--primary)' }} /></th>
            <th>送信ID</th>
            <th>種別</th>
            <th>送信先</th>
            <th>試行</th>
            <th>失敗理由</th>
            <th>担当</th>
            <th>発生</th>
            <th style={{ width: 120 }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.id}>
              <td><input type="checkbox" style={{ accentColor: 'var(--primary)' }} /></td>
              <td><span className="tabular" style={{ color: 'var(--primary)', fontWeight: 500, fontSize: 12.5 }}>{r.id}</span></td>
              <td>{r.kind}</td>
              <td style={{ fontSize: 13 }}>{r.target}</td>
              <td><span className="badge badge-danger tabular">{r.attempt}</span></td>
              <td style={{ fontSize: 12.5, fontFamily: 'var(--font-mono)', color: '#7F1D1D', maxWidth: 300 }}>{r.error}</td>
              <td style={{ fontSize: 13, color: r.staff.includes('未') ? 'var(--text-muted)' : 'var(--text)' }}>{r.staff}</td>
              <td style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.age}</td>
              <td>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button variant="secondary" size="sm" icon="RotateCcw">再送</Button>
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

Object.assign(window, {
  ScreenDashboard, ScreenCalendar, ScreenTransferRequest, ScreenVendorNotify, ScreenTickets, ScreenOps,
});
