/* global React, Shell, PageHeader, Button, Icon, Badge, StatusBadge, Field, FilterChip */
// 段取りくん — Additional screens (v2.1 §A.8 改修)
// C.1-KPI 拡張 / C.2 多店舗縮小ビュー / C.3 電話受付モード / 工場長日次ボード

// ─────────────────────────────────────────────
// C.1 ダッシュボード KPI 拡張版（過去 30 日 KPI）
// ─────────────────────────────────────────────
const Spark = ({ values, color = 'var(--primary)' }) => {
  const max = Math.max(...values);
  const w = 100, h = 28;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * w},${h - (v / max) * h * 0.85 - 2}`).join(' ');
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" style={{ width: '100%', height: 32, marginTop: 8 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <polyline points={`${pts} ${w},${h} 0,${h}`} fill={color} opacity="0.08" />
    </svg>
  );
};

const KpiBig = ({ label, value, unit, trend, sparkValues, sparkColor, sub }) => (
  <div className="card" style={{ flex: 1, padding: '20px 22px' }}>
    <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', fontWeight: 500 }}>{label}</div>
    <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginTop: 4 }}>
      <span className="tabular" style={{ fontSize: 36, fontWeight: 700, lineHeight: 1.05 }}>{value}</span>
      {unit && <span style={{ fontSize: 14, color: 'var(--text-secondary)', fontWeight: 500 }}>{unit}</span>}
    </div>
    {trend && (
      <div style={{ fontSize: 11.5, marginTop: 2, color: trend.up ? 'var(--success)' : 'var(--danger)', display: 'flex', alignItems: 'center', gap: 3 }}>
        <Icon name={trend.up ? 'TrendingUp' : 'TrendingDown'} size={11} />
        <span className="tabular">{trend.label}</span>
        <span style={{ color: 'var(--text-muted)', marginLeft: 3 }}>{sub}</span>
      </div>
    )}
    <Spark values={sparkValues} color={sparkColor} />
  </div>
);

const ScreenDashboardKpi = () => (
  <Shell audience="admin" active="home">
    <PageHeader title="ホーム · 経営 KPI" subtitle="過去 30 日間のサマリ"
      right={<><FilterChip label="期間" value="過去 30 日" /><Button variant="secondary" icon="Download">レポート出力</Button></>}
    />
    <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Hero KPIs */}
      <div style={{ display: 'flex', gap: 16 }}>
        <KpiBig label="配送成功率" value="99.2" unit="%" trend={{ up: true, label: '+0.4 pt' }} sub="前月比"
          sparkValues={[98.5, 98.7, 98.4, 98.9, 99.1, 99.0, 99.3, 99.2]} sparkColor="var(--success)" />
        <KpiBig label="業者平均応答時間" value="12" unit="分" trend={{ up: true, label: '-3 分' }} sub="前月比 (短縮)"
          sparkValues={[18, 17, 16, 15, 14, 13, 12, 12]} sparkColor="var(--primary)" />
        <KpiBig label="レーン稼働率" value="78" unit="%" trend={{ up: true, label: '+5 pt' }} sub="前月比"
          sparkValues={[68, 70, 72, 73, 75, 76, 77, 78]} sparkColor="var(--primary)" />
        <KpiBig label="通知失敗率" value="0.8" unit="%" trend={{ up: false, label: '+0.2 pt' }} sub="前月比 (悪化)"
          sparkValues={[0.5, 0.5, 0.6, 0.6, 0.7, 0.7, 0.8, 0.8]} sparkColor="var(--danger)" />
      </div>

      {/* Secondary metrics */}
      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 16 }}>
        {/* Volume trend */}
        <div className="card">
          <div className="card-header">
            <div className="card-title">店間移動依頼の推移</div>
            <FilterChip value="本社合計" />
          </div>
          <div style={{ padding: '20px 24px' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 6, height: 160 }}>
              {[42, 38, 51, 49, 55, 47, 62, 58, 64, 71, 68, 73].map((v, i) => (
                <div key={i} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6 }}>
                  <div style={{ width: '100%', height: `${(v / 75) * 100}%`, background: 'var(--primary)', borderRadius: '4px 4px 0 0', position: 'relative' }}>
                    {i === 11 && <span className="tabular" style={{ position: 'absolute', top: -18, left: '50%', transform: 'translateX(-50%)', fontSize: 11, fontWeight: 600, color: 'var(--primary)' }}>{v}</span>}
                  </div>
                  <span style={{ fontSize: 10, color: 'var(--text-muted)' }} className="tabular">{i + 1}月</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Top vendors */}
        <div className="card">
          <div className="card-header"><div className="card-title">業者別シェア</div></div>
          <div style={{ padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { name: '○○運送', pct: 42, jobs: 142 },
              { name: '□□急便', pct: 26, jobs: 87 },
              { name: '△△陸送', pct: 17, jobs: 56 },
              { name: '◇◇陸送', pct: 11, jobs: 38 },
              { name: 'その他', pct: 4, jobs: 12 },
            ].map(v => (
              <div key={v.name}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5, marginBottom: 3 }}>
                  <span style={{ fontWeight: 500 }}>{v.name}</span>
                  <span className="tabular" style={{ color: 'var(--text-muted)' }}>{v.jobs} 件 · {v.pct}%</span>
                </div>
                <div className="progress"><div style={{ width: `${v.pct}%` }} /></div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  </Shell>
);

// ─────────────────────────────────────────────
// C.2 多店舗縮小ビュー（10 店以上の概観）
// ─────────────────────────────────────────────
const ScreenCalendarCompact = () => {
  const stores = [
    { name: '渋谷店', lanes: 3, used: 18, total: 24, transfers: 2, alerts: 0 },
    { name: '渋谷別館', lanes: 2, used: 12, total: 16, transfers: 1, alerts: 0 },
    { name: '横浜店', lanes: 2, used: 8, total: 16, transfers: 3, alerts: 1 },
    { name: '横浜整備工場', lanes: 4, used: 28, total: 32, transfers: 5, alerts: 0 },
    { name: '川崎店', lanes: 4, used: 27, total: 32, transfers: 2, alerts: 0 },
    { name: '川崎南店', lanes: 2, used: 11, total: 16, transfers: 0, alerts: 0 },
    { name: '横須賀店', lanes: 2, used: 9, total: 16, transfers: 1, alerts: 0 },
    { name: '町田店', lanes: 3, used: 19, total: 24, transfers: 1, alerts: 0 },
    { name: '藤沢店', lanes: 2, used: 14, total: 16, transfers: 2, alerts: 0 },
    { name: '相模原店', lanes: 3, used: 21, total: 24, transfers: 0, alerts: 1 },
    { name: '八王子店', lanes: 2, used: 6, total: 16, transfers: 0, alerts: 0 },
    { name: '立川店', lanes: 3, used: 17, total: 24, transfers: 2, alerts: 0 },
  ];
  return (
    <Shell audience="admin" active="calendar">
      <PageHeader title="ピット予約カレンダー" subtitle="12 店舗 · 縮小表示モード" />
      <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-subtle)' }}>
        <div style={{ display: 'inline-flex', background: '#fff', border: '1px solid var(--border)', borderRadius: 6, padding: 2 }}>
          {['日', '週', '月'].map((v, i) => (
            <button key={v} style={{
              padding: '6px 14px', fontSize: 13, fontWeight: 500, border: 'none', borderRadius: 4,
              background: i === 0 ? 'var(--primary)' : 'transparent', color: i === 0 ? '#fff' : 'var(--text-secondary)',
            }}>{v}</button>
          ))}
        </div>
        <div className="tabular" style={{ fontSize: 14, fontWeight: 600 }}>2026年 5月 22日(金)</div>
        <div style={{ marginLeft: 'auto', display: 'inline-flex', background: '#fff', border: '1px solid var(--border)', borderRadius: 6, padding: 2 }}>
          <button style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 500, border: 'none', borderRadius: 4, background: 'transparent', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="LayoutGrid" size={13} />詳細表示
          </button>
          <button style={{ padding: '6px 12px', fontSize: 12.5, fontWeight: 500, border: 'none', borderRadius: 4, background: 'var(--primary)', color: '#fff', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="List" size={13} />縮小表示
          </button>
        </div>
      </div>

      <div style={{ padding: '20px 28px 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          {stores.map(s => {
            const pct = Math.round((s.used / s.total) * 100);
            const tone = pct >= 90 ? 'danger' : pct >= 75 ? 'warning' : 'primary';
            return (
              <div key={s.name} className="card" style={{ padding: '14px 18px', display: 'flex', alignItems: 'center', gap: 14, cursor: 'pointer' }}>
                <div style={{ width: 40, height: 40, borderRadius: 8, background: 'var(--bg-subtle)', color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                  <Icon name="Store" size={18} />
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 14, fontWeight: 600 }}>{s.name}</span>
                    <span className="tabular" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{s.lanes} レーン</span>
                    {s.alerts > 0 && <Badge tone="danger" icon="AlertCircle">要対応 {s.alerts}</Badge>}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
                    <div style={{ flex: 1 }}>
                      <div className="progress" style={{ height: 6 }}>
                        <div style={{ width: `${pct}%`, background: `var(--${tone === 'primary' ? 'primary' : tone})` }} />
                      </div>
                    </div>
                    <span className="tabular" style={{ fontSize: 12.5, fontWeight: 600, minWidth: 80, textAlign: 'right' }}>{s.used} / {s.total} 件 · {pct}%</span>
                  </div>
                  <div style={{ display: 'flex', gap: 12, marginTop: 6, fontSize: 11.5, color: 'var(--text-muted)' }}>
                    <span><Icon name="Calendar" size={11} /> 8 時間稼働</span>
                    <span><Icon name="Truck" size={11} /> 店間 {s.transfers} 件</span>
                  </div>
                </div>
                <Icon name="ChevronRight" size={16} style={{ color: 'var(--text-muted)' }} />
              </div>
            );
          })}
        </div>
      </div>
    </Shell>
  );
};

// ─────────────────────────────────────────────
// C.3 電話予約代行入力
// ─────────────────────────────────────────────
const ScreenPhoneReceipt = () => (
  <Shell audience="admin" active="cust-reservations">
    <PageHeader title="電話受付 · 予約代行入力" breadcrumb={['顧客予約', '新規', '電話受付']}
      right={<><Button variant="secondary" icon="X">中止</Button><Button icon="Check">予約を確定</Button></>}
    />

    {/* Sticky info banner */}
    <div style={{ padding: '14px 28px', background: 'var(--primary-light)', borderBottom: '1px solid #BFDBFE', display: 'flex', alignItems: 'center', gap: 12 }}>
      <Icon name="Phone" size={18} style={{ color: 'var(--primary)' }} />
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>電話受付モード</div>
        <div style={{ fontSize: 12, color: 'var(--text)' }}>顧客本人確認はスキップされます。メモ欄に「電話受付」と自動付与。受付者の操作記録に残ります。</div>
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>受付者：田中</span>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', height: 'calc(100% - 130px)' }}>
      <div style={{ overflow: 'auto', padding: '24px 28px' }}>
        <section style={{ marginBottom: 24 }}>
          <h3 className="sec-h">お客様情報</h3>
          <div className="card">
            <div style={{ padding: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="お名前" required hint="フルネームでお伺いしてください">
                <input className="input" placeholder="例: 田中 太郎" />
              </Field>
              <Field label="フリガナ">
                <input className="input" placeholder="例: タナカ タロウ" />
              </Field>
              <Field label="電話番号" required hint="折り返し連絡先（ハイフンなし）">
                <input className="input tabular" placeholder="090xxxxxxxx" type="tel" inputMode="tel" />
              </Field>
              <Field label="メールアドレス">
                <input className="input tabular" placeholder="任意" type="email" inputMode="email" />
              </Field>
              <Field label="既存顧客検索" hint="名前 / 電話 / ナンバー">
                <div style={{ position: 'relative' }}>
                  <Icon name="Search" size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input className="input" placeholder="既存顧客があれば検索" style={{ paddingLeft: 32 }} />
                </div>
              </Field>
            </div>
          </div>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h3 className="sec-h">車両情報</h3>
          <div className="card">
            <div style={{ padding: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="車種"><input className="input" placeholder="例: トヨタ アルファード" /></Field>
              <Field label="ナンバー"><input className="input tabular" placeholder="例: 品川 300 あ 1234" /></Field>
              <Field label="年式"><input className="input tabular" placeholder="例: 2020" /></Field>
              <Field label="走行距離"><input className="input tabular" placeholder="例: 42000" /></Field>
            </div>
          </div>
        </section>

        <section style={{ marginBottom: 24 }}>
          <h3 className="sec-h">作業 / 希望日時</h3>
          <div className="card">
            <div style={{ padding: 18, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 14 }}>
              <Field label="店舗" required><select className="select"><option>渋谷店</option><option>横浜店</option><option>川崎店</option></select></Field>
              <Field label="作業内容" required><select className="select"><option>オイル交換</option><option>タイヤ交換</option><option>車検整備</option></select></Field>
              <Field label="ご希望日" required><input className="input tabular" defaultValue="2026-05-23" /></Field>
              <Field label="ご希望時間" required><input className="input tabular" defaultValue="10:00" /></Field>
            </div>
          </div>
        </section>

        <Field label="受付メモ" hint="自動付与: 「電話受付（05/22 受付者：田中）」">
          <textarea className="textarea" defaultValue="電話受付（05/22 受付者：田中）&#10;" style={{ minHeight: 80 }} />
        </Field>
      </div>

      {/* Side: assisted slot picker */}
      <aside style={{ borderLeft: '1px solid var(--border)', background: 'var(--bg-subtle)', padding: 20, overflow: 'auto' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>05/23 (土) 渋谷店 空き状況</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
          {['09:00','09:30','10:00','10:30','11:00','11:30','13:00','13:30','14:00','14:30','15:00','15:30'].map((t, i) => {
            const sel = i === 2;
            const full = i === 3 || i === 9;
            return (
              <button key={t} className="tabular" style={{
                padding: '10px 0', borderRadius: 6, fontSize: 13, fontWeight: 600,
                background: sel ? 'var(--primary)' : full ? 'var(--bg-subtle)' : '#ECFDF5',
                color: sel ? '#fff' : full ? 'var(--text-muted)' : '#065F46',
                border: `1.5px solid ${sel ? 'var(--primary)' : full ? 'var(--border)' : '#A7F3D0'}`,
              }}>{t}</button>
            );
          })}
        </div>

        <div className="divider" />

        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 8 }}>受付スクリプト</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12.5, lineHeight: 1.5 }}>
          <div style={{ padding: '10px 12px', background: '#fff', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>1. ご挨拶 + 確認</div>
            「お電話ありがとうございます、◯◯モータース渋谷店、田中です。整備のご予約ですね、ご案内します。」
          </div>
          <div style={{ padding: '10px 12px', background: '#fff', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>2. お名前・電話番号</div>
            「では順番にお伺いします。お名前と折り返しのお電話番号をお願いいたします。」
          </div>
          <div style={{ padding: '10px 12px', background: '#fff', borderRadius: 6, border: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 600, marginBottom: 2 }}>3. 確認復唱</div>
            「ご予約内容を確認させていただきます。{'{店舗}'} で {'{日時}'} に {'{作業}'} ですね。」
          </div>
        </div>
      </aside>
    </div>
  </Shell>
);

// ─────────────────────────────────────────────
// 今日の工場ボード（カンバン） — 新規画面
// ─────────────────────────────────────────────
const FloorCard = ({ car, plate, work, tech, time, late, urgent }) => (
  <div className="card" style={{
    padding: '12px 14px', marginBottom: 8, background: '#fff',
    borderLeft: late ? '3px solid var(--danger)' : urgent ? '3px solid var(--warning)' : '3px solid transparent',
    cursor: 'grab',
  }}>
    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 6 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600 }}>{car}</div>
      {late && <Badge tone="danger" icon="AlertTriangle">{late}</Badge>}
      {urgent && !late && <Badge tone="warning" icon="Flame">急ぎ</Badge>}
    </div>
    <div className="tabular" style={{ fontSize: 11.5, color: 'var(--text-muted)', marginTop: 1 }}>{plate}</div>
    <div style={{ marginTop: 8, fontSize: 12.5, color: 'var(--text)' }}>{work}</div>
    <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 11.5 }}>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--text-secondary)' }}>
        <span className="avatar" style={{ width: 18, height: 18, fontSize: 10 }}>{tech.slice(0, 1)}</span>
        {tech}
      </span>
      <span className="tabular" style={{ color: 'var(--text-muted)' }}>{time}</span>
    </div>
  </div>
);

const FloorColumn = ({ title, count, tone, children }) => (
  <div style={{ flex: 1, background: 'var(--bg-subtle)', borderRadius: 8, padding: 12, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ width: 8, height: 8, borderRadius: 999, background: tone === 'muted' ? 'var(--border-strong)' : `var(--${tone === 'primary' ? 'primary' : tone})` }} />
        <span style={{ fontSize: 13, fontWeight: 600 }}>{title}</span>
        <span className="badge badge-muted tabular">{count}</span>
      </div>
      <button className="btn btn-ghost btn-sm" style={{ padding: 4 }}><Icon name="MoreHorizontal" size={14} /></button>
    </div>
    <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
  </div>
);

const ScreenFloorBoard = () => (
  <Shell audience="admin" active="floor">
    <PageHeader title="今日の工場ボード"
      subtitle="2026/05/22 (金) · 渋谷店 整備ピット稼働状況"
      right={
        <>
          <FilterChip label="店舗" value="渋谷店" />
          <FilterChip label="整備士" value="全員 (6)" />
          <Button variant="secondary" icon="Printer">作業指示書</Button>
        </>
      }
    />

    {/* Summary strip */}
    <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)', display: 'flex', gap: 24, alignItems: 'center' }}>
      <div><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>本日の総作業 </span><span className="tabular" style={{ fontSize: 17, fontWeight: 700 }}>14</span></div>
      <div><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>稼働中レーン </span><span className="tabular" style={{ fontSize: 17, fontWeight: 700 }}>3 / 3</span></div>
      <div><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>遅延発生 </span><span className="tabular" style={{ fontSize: 17, fontWeight: 700, color: 'var(--danger)' }}>1</span></div>
      <div><span style={{ fontSize: 11, color: 'var(--text-muted)' }}>本日完了 </span><span className="tabular" style={{ fontSize: 17, fontWeight: 700, color: 'var(--success)' }}>7</span></div>
      <div style={{ marginLeft: 'auto', fontSize: 11.5, color: 'var(--text-muted)' }}>カードをドラッグして次の状態へ移動</div>
    </div>

    <div style={{ padding: '20px 28px', display: 'flex', gap: 12, height: 'calc(100% - 132px)', overflow: 'auto' }}>
      <FloorColumn title="未着手" count={3} tone="muted">
        <FloorCard car="アルファード" plate="品川 300 あ 1234" work="車検整備（推定 180 分）" tech="鈴木" time="10:00 開始予定" />
        <FloorCard car="ヴェルファイア" plate="品川 330 い 4567" work="オイル交換" tech="佐藤" time="11:30 開始予定" />
        <FloorCard car="プリウス" plate="横浜 300 う 8901" work="タイヤ交換 (4 本)" tech="高橋" time="13:00 開始予定" urgent />
      </FloorColumn>

      <FloorColumn title="作業中" count={3} tone="info">
        <FloorCard car="ノア" plate="横浜 500 え 2345" work="バッテリー交換" tech="鈴木" time="09:15〜 (25 分経過)" />
        <FloorCard car="CX-5" plate="川崎 300 お 6789" work="修理見積 + 整備" tech="伊藤" time="09:30〜 (10 分経過)" />
        <FloorCard car="ハリアー" plate="練馬 300 か 1357" work="車検整備" tech="渡辺" time="08:30〜" late="20 分遅延" />
      </FloorColumn>

      <FloorColumn title="検査待ち" count={2} tone="warning">
        <FloorCard car="フィット" plate="横浜 500 か 1234" work="法定 12 ヶ月点検" tech="鈴木 → 検査" time="完了 10:35" />
        <FloorCard car="セレナ" plate="横須賀 300 き 5678" work="エアコン整備" tech="佐藤 → 検査" time="完了 11:05" />
      </FloorColumn>

      <FloorColumn title="完了" count={6} tone="success">
        <FloorCard car="ヤリス" plate="品川 480 さ 1212" work="オイル交換" tech="鈴木" time="✓ 09:32" />
        <FloorCard car="ハイラックス" plate="多摩 500 し 4567" work="タイヤ交換" tech="高橋" time="✓ 09:55" />
        <FloorCard car="ヴォクシー" plate="横浜 300 す 8888" work="法定点検" tech="佐藤" time="✓ 10:12" />
        <FloorCard car="クラウン" plate="品川 580 せ 0303" work="バッテリー" tech="渡辺" time="✓ 10:28" />
      </FloorColumn>
    </div>
  </Shell>
);

Object.assign(window, { ScreenDashboardKpi, ScreenCalendarCompact, ScreenPhoneReceipt, ScreenFloorBoard });
