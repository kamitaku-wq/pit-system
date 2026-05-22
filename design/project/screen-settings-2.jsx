/* global React, Shell, PageHeader, Button, Icon, Badge, StatusBadge, Field, FilterChip */
// 段取りくん — Settings detail screens (F.4 / F.10 / F.13) + B.10 楽観排他

// ─────────────────────────────────────────────
// F.4 レーン設定（一覧 + 編集モーダル）
// ─────────────────────────────────────────────
const ScreenLanesSettings = () => {
  const rows = [
    { store: '渋谷店', name: 'Lane 1', type: 'メンテナンス', conc: 1, enabled: true, menus: 8 },
    { store: '渋谷店', name: 'Lane 2', type: '重整備', conc: 1, enabled: true, menus: 12 },
    { store: '渋谷店', name: 'Lane 3', type: '汎用', conc: 2, enabled: true, menus: 24, edit: true },
    { store: '横浜店', name: 'Lane 1', type: '汎用', conc: 2, enabled: true, menus: 24 },
    { store: '横浜店', name: 'Lane 2', type: 'メンテナンス', conc: 1, enabled: false, menus: 8 },
    { store: '川崎店', name: 'Lane 1', type: '汎用', conc: 2, enabled: true, menus: 22 },
    { store: '川崎店', name: 'Lane 2', type: '重整備', conc: 1, enabled: true, menus: 12 },
  ];
  return (
    <Shell audience="admin" active="settings">
      <PageHeader
        title="レーン設定"
        breadcrumb={['設定', 'レーン・作業', 'レーン']}
        right={<Button icon="Plus">新規レーン</Button>}
      />
      <div style={{ position: 'relative', height: 'calc(100% - 76px)' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 32 }}></th>
              <th>店舗</th>
              <th>レーン名</th>
              <th>種別</th>
              <th>同時予約数</th>
              <th>対応メニュー</th>
              <th>状態</th>
              <th style={{ width: 80 }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={i} className={r.edit ? 'selected' : ''}>
                <td><Icon name="GripVertical" size={14} style={{ color: 'var(--text-muted)', cursor: 'grab' }} /></td>
                <td>{r.store}</td>
                <td style={{ fontWeight: 500 }}>{r.name}</td>
                <td>{r.type}</td>
                <td className="tabular">{r.conc}</td>
                <td><span className="badge badge-muted tabular">{r.menus} 件</span></td>
                <td>
                  <label style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer' }}>
                    <span style={{ width: 32, height: 18, borderRadius: 999, background: r.enabled ? 'var(--success)' : 'var(--border-strong)', position: 'relative', display: 'inline-block', transition: 'background .15s' }}>
                      <span style={{ position: 'absolute', top: 2, left: r.enabled ? 16 : 2, width: 14, height: 14, borderRadius: 999, background: '#fff', transition: 'left .15s' }} />
                    </span>
                    <span style={{ marginLeft: 8, fontSize: 12.5, color: r.enabled ? 'var(--text)' : 'var(--text-muted)' }}>{r.enabled ? '有効' : '無効'}</span>
                  </label>
                </td>
                <td>
                  <button className="btn btn-ghost btn-sm" style={{ padding: 4 }}><Icon name="Pencil" size={14} /></button>
                  <button className="btn btn-ghost btn-sm" style={{ padding: 4 }}><Icon name="MoreVertical" size={14} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Edit modal */}
        <div className="modal-overlay">
          <div className="modal" style={{ width: 640, maxHeight: 'calc(100% - 80px)', display: 'flex', flexDirection: 'column' }}>
            <div className="modal-header">
              <div className="modal-title">レーン編集 · 渋谷店 Lane 3</div>
              <button className="x-btn"><Icon name="X" size={18} /></button>
            </div>
            <div className="modal-body" style={{ overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <Field label="店舗" required>
                  <select className="select" defaultValue="渋谷店"><option>渋谷店</option><option>横浜店</option><option>川崎店</option></select>
                </Field>
                <Field label="レーン名" required>
                  <input className="input" defaultValue="Lane 3" />
                </Field>
                <Field label="種別">
                  <select className="select" defaultValue="汎用"><option>メンテナンス</option><option>重整備</option><option>汎用</option></select>
                </Field>
                <Field label="同時予約数" hint="このレーンで並行して受け付ける件数">
                  <input className="input tabular" defaultValue="2" type="number" />
                </Field>
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>このレーンで対応する作業メニュー</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, padding: 12, background: 'var(--bg-subtle)', borderRadius: 6 }}>
                  {[
                    ['オイル交換', true], ['タイヤ交換', true], ['バッテリー交換', true], ['法定 12 ヶ月点検', true],
                    ['車検整備', false], ['エアコン整備', true], ['修理見積', true], ['重整備', false],
                  ].map(([m, c]) => (
                    <label key={m} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                      <input type="checkbox" defaultChecked={c} style={{ accentColor: 'var(--primary)' }} /> {m}
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>稼働時間（曜日ごと）</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, background: 'var(--bg-subtle)', borderRadius: 6 }}>
                  {[
                    ['月', '09:00', '18:00', false], ['火', '09:00', '18:00', false], ['水', '09:00', '18:00', false],
                    ['木', '09:00', '18:00', false], ['金', '09:00', '18:00', false], ['土', '09:00', '17:00', false],
                    ['日', '', '', true],
                  ].map(([d, s, e, closed]) => (
                    <div key={d} style={{ display: 'grid', gridTemplateColumns: '32px 1fr 16px 1fr 100px', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{d}</span>
                      <input className="input tabular" defaultValue={s} disabled={closed} style={{ height: 32, fontSize: 12.5, opacity: closed ? 0.4 : 1 }} />
                      <span style={{ textAlign: 'center', color: 'var(--text-muted)' }}>–</span>
                      <input className="input tabular" defaultValue={e} disabled={closed} style={{ height: 32, fontSize: 12.5, opacity: closed ? 0.4 : 1 }} />
                      <label style={{ fontSize: 12.5, display: 'inline-flex', alignItems: 'center', gap: 4 }}><input type="checkbox" defaultChecked={closed} style={{ accentColor: 'var(--primary)' }} />定休</label>
                    </div>
                  ))}
                </div>
              </div>

              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, fontWeight: 500 }}>
                <input type="checkbox" defaultChecked style={{ accentColor: 'var(--primary)' }} />有効化（この設定を使う）
              </label>
            </div>
            <div className="modal-footer">
              <Button variant="ghost" icon="Trash2" style={{ color: 'var(--danger)' }}>削除</Button>
              <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
                <Button variant="secondary">キャンセル</Button>
                <Button icon="Check">保存</Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </Shell>
  );
};

// ─────────────────────────────────────────────
// F.10 業者マスター
// ─────────────────────────────────────────────
const ScreenVendorsMaster = () => {
  const rows = [
    { name: '○○運送', code: 'V-0001', area: '渋谷 / 横浜 / 川崎', stores: 3, dow: '月〜土', jobs: 142, rate: '97%', status: '有効' },
    { name: '□□急便', code: 'V-0002', area: '渋谷 / 川崎', stores: 2, dow: '平日', jobs: 87, rate: '94%', status: '有効' },
    { name: '△△陸送', code: 'V-0003', area: '横浜 / 横須賀', stores: 2, dow: '平日 / 土', jobs: 56, rate: '89%', status: '有効' },
    { name: '◇◇陸送', code: 'V-0004', area: '全エリア', stores: 4, dow: '毎日', jobs: 38, rate: '92%', status: '有効' },
    { name: '☆☆運輸', code: 'V-0005', area: '横須賀', stores: 1, dow: '平日', jobs: 12, rate: '85%', status: '一時停止' },
  ];
  return (
    <Shell audience="admin" active="settings">
      <PageHeader title="業者一覧" breadcrumb={['設定', '業者', '業者一覧']} subtitle="登録済 9 社"
        right={<><Button variant="secondary" icon="Mail">招待 URL を発行</Button><Button icon="Plus">新規業者</Button></>}
      />
      <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-subtle)' }}>
        <FilterChip label="エリア" value="全エリア" />
        <FilterChip label="状態" value="有効" active />
        <FilterChip label="曜日" value="すべて" />
        <div style={{ marginLeft: 'auto', position: 'relative' }}>
          <Icon name="Search" size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
          <input className="input" placeholder="業者名・コードで検索" style={{ height: 32, paddingLeft: 30, width: 220, fontSize: 13 }} />
        </div>
      </div>
      <table className="tbl">
        <thead><tr>
                <th>業者名</th><th>コード</th><th>対応エリア</th><th>対応店舗</th><th>対応曜日</th><th>実績</th><th>状態</th><th style={{ width: 40 }}></th>
        </tr></thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.code}>
              <td>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--primary-light)', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 13 }}>
                    {r.name.slice(0, 1)}
                  </div>
                  <span style={{ fontWeight: 500 }}>{r.name}</span>
                </div>
              </td>
              <td><span className="tabular" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{r.code}</span></td>
              <td style={{ fontSize: 13 }}>{r.area}</td>
              <td><span className="badge badge-muted tabular">{r.stores}</span></td>
              <td style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{r.dow}</td>
              <td>
                <div className="tabular" style={{ fontSize: 13 }}>{r.jobs} 件 · <span style={{ color: 'var(--success)' }}>{r.rate}</span></div>
              </td>
              <td>{r.status === '有効' ? <Badge tone="success" icon="CheckCircle2">{r.status}</Badge> : <Badge tone="muted" icon="PauseCircle">{r.status}</Badge>}</td>
              <td><button className="btn btn-ghost btn-sm" style={{ padding: 4 }}><Icon name="MoreVertical" size={14} /></button></td>
            </tr>
          ))}
        </tbody>
      </table>
    </Shell>
  );
};

// ─────────────────────────────────────────────
// F.13 状態遷移ルール（ビジュアル状態遷移エディタ）
// ─────────────────────────────────────────────
const StateNode = ({ x, y, label, tone = 'muted', selected }) => {
  const colors = {
    muted: { bg: '#F1F5F9', border: '#CBD5E1', fg: '#475569' },
    info: { bg: '#DBEAFE', border: '#3B82F6', fg: '#1E40AF' },
    warning: { bg: '#FEF3C7', border: '#F59E0B', fg: '#92400E' },
    success: { bg: '#D1FAE5', border: '#10B981', fg: '#065F46' },
    danger: { bg: '#FEE2E2', border: '#EF4444', fg: '#991B1B' },
    primary: { bg: '#DBEAFE', border: '#1E3A8A', fg: '#1E3A8A' },
  };
  const c = colors[tone];
  return (
    <div style={{
      position: 'absolute', left: x, top: y,
      padding: '10px 16px', background: c.bg, color: c.fg,
      border: `2px solid ${selected ? '#0F172A' : c.border}`, borderRadius: 8,
      fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap',
      boxShadow: selected ? '0 0 0 3px rgba(15, 23, 42, 0.15)' : 'var(--shadow-card)',
    }}>{label}</div>
  );
};

const ScreenStateMachine = () => (
  <Shell audience="admin" active="settings">
    <PageHeader title="状態遷移ルール" breadcrumb={['設定', '予約・ステータス', '状態遷移']} subtitle="予約の状態ルール"
      right={<><Button variant="secondary" icon="Download">JSON エクスポート</Button><Button icon="Save">保存</Button></>}
    />
    <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg-subtle)' }}>
      <FilterChip label="対象" value="予約" active />
      <FilterChip value="回送依頼" />
      <FilterChip value="整備伝票" />
      <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
        <span style={{ fontSize: 12, color: 'var(--text-muted)', alignSelf: 'center' }}>レイアウト</span>
        <FilterChip value="自動配置" />
      </div>
    </div>

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', height: 'calc(100% - 132px)' }}>
      {/* Canvas */}
      <div style={{ position: 'relative', overflow: 'auto', background: 'var(--bg-subtle)', backgroundImage: 'radial-gradient(circle, var(--border) 1px, transparent 1px)', backgroundSize: '20px 20px' }}>
        <div style={{ position: 'relative', width: 900, height: 540, margin: '20px auto' }}>
          {/* Arrows (SVG layer) */}
          <svg style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', pointerEvents: 'none' }}>
            <defs>
              <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill="#475569" />
              </marker>
              <marker id="arrSel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
                <path d="M0,0 L10,5 L0,10 z" fill="#1E3A8A" />
              </marker>
            </defs>
            {/* tentative -> confirmed */}
            <path d="M 160 60 Q 240 60 290 70" stroke="#1E3A8A" strokeWidth="2.5" fill="none" markerEnd="url(#arrSel)" />
            <text x="220" y="48" fontSize="11" fontWeight="600" fill="#1E3A8A" fontFamily="var(--font-inter)">確定</text>
            {/* confirmed -> inprogress */}
            <path d="M 420 70 Q 500 100 540 160" stroke="#475569" strokeWidth="2" fill="none" markerEnd="url(#arr)" />
            <text x="480" y="120" fontSize="11" fontWeight="500" fill="#475569" fontFamily="var(--font-inter)">作業開始</text>
            {/* inprogress -> done */}
            <path d="M 620 200 Q 700 240 740 320" stroke="#475569" strokeWidth="2" fill="none" markerEnd="url(#arr)" />
            <text x="680" y="270" fontSize="11" fontWeight="500" fill="#475569" fontFamily="var(--font-inter)">完了</text>
            {/* tentative -> cancelled */}
            <path d="M 100 100 Q 100 240 240 330" stroke="#475569" strokeWidth="2" fill="none" strokeDasharray="4 3" markerEnd="url(#arr)" />
            <text x="80" y="240" fontSize="11" fontWeight="500" fill="#475569" fontFamily="var(--font-inter)">期限切れ</text>
            {/* confirmed -> cancelled */}
            <path d="M 320 100 Q 280 240 280 330" stroke="#475569" strokeWidth="2" fill="none" markerEnd="url(#arr)" />
            <text x="245" y="220" fontSize="11" fontWeight="500" fill="#475569" fontFamily="var(--font-inter)">キャンセル</text>
          </svg>

          <StateNode x={40} y={40} label="仮予約" tone="warning" />
          <StateNode x={290} y={50} label="確定" tone="info" selected />
          <StateNode x={540} y={180} label="作業中" tone="primary" />
          <StateNode x={730} y={320} label="完了" tone="success" />
          <StateNode x={220} y={330} label="キャンセル" tone="muted" />
        </div>
      </div>

      {/* Transition detail */}
      <aside style={{ borderLeft: '1px solid var(--border)', background: '#fff', overflow: 'auto', padding: '20px 22px' }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>遷移ルール</div>
        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
          <Badge tone="warning">仮予約</Badge>
          <Icon name="ArrowRight" size={14} style={{ color: 'var(--text-muted)' }} />
          <Badge tone="info">確定</Badge>
        </div>
        <h3 style={{ margin: '10px 0 0', fontSize: 16, fontWeight: 700 }}>確定させる</h3>
        <p style={{ margin: '4px 0 16px', fontSize: 12.5, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
          仮予約を本予約に確定させます。本人確認認証コード入力後、自動で実行されます。
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <Field label="トリガー">
            <select className="select" defaultValue="manual"><option>手動（操作）</option><option>自動</option><option>イベント発生時</option></select>
          </Field>

          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>実行できる役割</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {[
                ['本部管理者', true], ['店長', true], ['現場スタッフ', true], ['業者', false], ['顧客', false], ['システム自動', true],
              ].map(([r, c]) => (
                <label key={r} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '4px 8px', background: c ? 'var(--bg-subtle)' : 'transparent', borderRadius: 4 }}>
                  <input type="checkbox" defaultChecked={c} style={{ accentColor: 'var(--primary)' }} />{r}
                </label>
              ))}
            </div>
          </div>

          <div>
            <div className="field-label" style={{ marginBottom: 6 }}>同時に実行されること</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}><input type="checkbox" defaultChecked style={{ accentColor: 'var(--primary)' }} />顧客へ確認メール送信</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}><input type="checkbox" defaultChecked style={{ accentColor: 'var(--primary)' }} />レーン占有を確保</label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}><input type="checkbox" style={{ accentColor: 'var(--primary)' }} />Slack 通知（#operations）</label>
            </div>
          </div>

          <Field label="条件（任意）" hint="例：二重予約でない場合のみ">
            <input className="input" defaultValue="二重予約でない" style={{ fontSize: 13 }} />
          </Field>
        </div>

        <div style={{ display: 'flex', gap: 8, marginTop: 20 }}>
          <Button variant="secondary" style={{ flex: 1 }}>取消</Button>
          <Button style={{ flex: 1 }}>適用</Button>
        </div>
      </aside>
    </div>
  </Shell>
);

// ─────────────────────────────────────────────
// B.10 楽観排他コンフリクト UI
// ─────────────────────────────────────────────
const ScreenConflictModal = () => (
  <Shell audience="admin" active="calendar">
    <PageHeader title="ピット予約カレンダー" />
    <div style={{ position: 'relative', height: 'calc(100% - 76px)', overflow: 'hidden' }}>
      {/* dim background */}
      <div style={{ position: 'absolute', inset: 0, padding: 28, opacity: 0.4, filter: 'blur(1px)', pointerEvents: 'none' }}>
        <div style={{ background: 'var(--bg-subtle)', padding: 20, borderRadius: 8, height: '90%' }} />
      </div>

      <div className="modal-overlay">
        <div className="modal" style={{ width: 540 }}>
          <div className="modal-header" style={{ background: '#FFFBEB', borderBottom: '1px solid #FDE68A' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 999, background: 'var(--warning-light)', color: 'var(--warning)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <Icon name="AlertTriangle" size={18} />
              </div>
              <div>
                <div className="modal-title" style={{ color: '#92400E' }}>他のスタッフが先に更新しました</div>
                <div style={{ fontSize: 12, color: '#92400E', opacity: 0.7, marginTop: 2 }}>OptimisticLockError · version 12 → 13</div>
              </div>
            </div>
            <button className="x-btn"><Icon name="X" size={18} /></button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <p style={{ margin: 0, fontSize: 13.5, lineHeight: 1.7 }}>
              あなたが編集していた予約 <span className="tabular" style={{ fontWeight: 600, color: 'var(--primary)' }}>R-2026-0142</span> は、
              <span style={{ fontWeight: 600 }}>田中さん</span> が <span className="tabular">11 秒前</span> に更新しました。
              最新内容を確認してから再操作してください。
            </p>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <div style={{ padding: '12px 14px', border: '1px solid var(--border)', borderRadius: 8 }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>あなたの変更</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                  <div>レーン: <span style={{ fontWeight: 600 }}>渋谷店 Lane 2</span></div>
                  <div>時刻: <span className="tabular" style={{ fontWeight: 600 }}>10:00–11:30</span></div>
                </div>
              </div>
              <div style={{ padding: '12px 14px', border: '1.5px solid var(--primary)', borderRadius: 8, background: 'var(--primary-light)' }}>
                <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--primary)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>田中さんの変更 (最新)</div>
                <div style={{ fontSize: 12.5, lineHeight: 1.6 }}>
                  <div>レーン: <span style={{ fontWeight: 600 }}>渋谷店 Lane 1</span></div>
                  <div>時刻: <span className="tabular" style={{ fontWeight: 600 }}>11:00–12:30</span></div>
                </div>
              </div>
            </div>

            <div style={{ padding: '10px 12px', background: 'var(--bg-subtle)', borderRadius: 6, fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
              <Icon name="Info" size={13} />
              <span>あなたの編集内容は破棄されません。「変更内容を確認」を押すと差分を表示し、必要な変更だけ再適用できます。</span>
            </div>
          </div>
          <div className="modal-footer">
            <Button variant="secondary" icon="GitCompare">変更内容を確認</Button>
            <Button icon="RotateCcw">再読込して再操作</Button>
          </div>
        </div>
      </div>
    </div>
  </Shell>
);

Object.assign(window, { ScreenLanesSettings, ScreenVendorsMaster, ScreenStateMachine, ScreenConflictModal });
