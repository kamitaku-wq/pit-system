/* global React, Icon, Button, Badge, Field, StatusBadge */
// 段取りくん — Customer screens part 3 (E.3 変更 / E.4 キャンセル / E.5 認証コード再送)
//            + B.9 通知トースト

const MobileShellL = ({ children, title, sub }) => (
  <div className="app" style={{ width: '100%', height: '100%', background: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column' }}>
    <div style={{ height: 52, background: '#fff', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10, flexShrink: 0 }}>
      <button className="btn btn-ghost btn-sm" style={{ padding: 6 }}><Icon name="ChevronLeft" size={18} /></button>
      <div style={{ flex: 1 }}>
        <div className="brand-logo" style={{ fontSize: 14 }}>
          <span className="mark" style={{ width: 20, height: 20, fontSize: 11 }}>段</span>
          <span>段取りくん</span>
        </div>
      </div>
    </div>
    {title && (
      <div style={{ padding: '16px 20px 4px', background: '#fff' }}>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>{title}</h2>
        {sub && <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'var(--text-muted)' }}>{sub}</p>}
      </div>
    )}
    <div style={{ flex: 1, overflow: 'auto' }}>{children}</div>
  </div>
);

// ─────────────────────────────────────────────
// E.3 予約変更（modify token）
// ─────────────────────────────────────────────
const ScreenCustomerModify = () => {
  const slots = [
    { t: '09:00', s: 'open' }, { t: '09:30', s: 'open' }, { t: '10:00', s: 'current' },
    { t: '10:30', s: 'full' }, { t: '11:00', s: 'open' }, { t: '11:30', s: 'open' },
    { t: '13:00', s: 'selected' }, { t: '13:30', s: 'full' }, { t: '14:00', s: 'open' },
    { t: '14:30', s: 'open' }, { t: '15:00', s: 'open' }, { t: '15:30', s: 'full' },
  ];
  const slotStyles = {
    open:     { bg: '#ECFDF5', fg: '#065F46', border: '#A7F3D0' },
    selected: { bg: 'var(--primary)', fg: '#fff', border: 'var(--primary)' },
    current:  { bg: '#FEF3C7', fg: '#92400E', border: '#FCD34D' },
    full:     { bg: 'var(--bg-subtle)', fg: 'var(--text-muted)', border: 'var(--border)' },
  };
  return (
    <MobileShellL title="ご予約日時の変更" sub="新しい空き枠から選択してください">
      <div style={{ padding: '12px 16px 0' }}>
        {/* Current */}
        <div style={{ padding: '12px 14px', background: '#FEF3C7', border: '1px solid #FCD34D', borderRadius: 8, marginBottom: 16 }}>
          <div style={{ fontSize: 11, color: '#92400E', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>現在のご予約</div>
          <div className="tabular" style={{ fontSize: 14, fontWeight: 600, marginTop: 2 }}>2026/05/23 (土) 10:00 · 渋谷店 · オイル交換</div>
          <div style={{ fontSize: 11.5, color: '#92400E', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="Info" size={12} />変更すると現在の予約は自動的に解放されます
          </div>
        </div>

        {/* New slot picker */}
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8 }}>新しい日時を選択</div>
        <div style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
          {['23', '24', '25', '26'].map((d, i) => (
            <button key={d} style={{ flex: 1, padding: '8px 0', borderRadius: 8, border: `1.5px solid ${i === 0 ? 'var(--primary)' : 'var(--border)'}`, background: i === 0 ? 'var(--primary)' : '#fff', color: i === 0 ? '#fff' : 'var(--text)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <span style={{ fontSize: 10 }}>{['土', '日', '月', '火'][i]}</span>
              <span className="tabular" style={{ fontSize: 16, fontWeight: 700 }}>{d}</span>
            </button>
          ))}
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8, paddingBottom: 16 }}>
          {slots.map((s, i) => {
            const st = slotStyles[s.s];
            return (
              <button key={i} disabled={s.s === 'full'} className="tabular" style={{
                padding: '12px 0', borderRadius: 8,
                background: st.bg, color: st.fg, border: `1.5px solid ${st.border}`,
                fontSize: 14, fontWeight: 600, position: 'relative',
              }}>
                {s.s === 'current' && <span style={{ position: 'absolute', top: -7, right: -4, fontSize: 9, background: '#92400E', color: '#fff', padding: '1px 6px', borderRadius: 999 }}>現在</span>}
                {s.t}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid var(--border)', padding: '12px 16px' }}>
        <div style={{ padding: '8px 12px', background: 'var(--primary-light)', borderRadius: 6, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8, fontSize: 12.5 }}>
          <Icon name="ArrowRight" size={14} style={{ color: 'var(--primary)' }} />
          <span><span style={{ fontWeight: 600 }} className="tabular">10:00</span> → <span className="tabular" style={{ fontWeight: 600, color: 'var(--primary)' }}>13:00</span> へ変更</span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button variant="secondary" size="lg" style={{ flex: 1 }}>戻る</Button>
          <Button size="lg" style={{ flex: 2 }}>この日時で確定</Button>
        </div>
      </div>
    </MobileShellL>
  );
};

// ─────────────────────────────────────────────
// E.4 キャンセル
// ─────────────────────────────────────────────
const ScreenCustomerCancel = () => (
  <MobileShellL>
    <div style={{ padding: '16px 16px 80px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--danger-light)', color: 'var(--danger)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
          <Icon name="XCircle" size={28} />
        </div>
        <h2 style={{ margin: 0, fontSize: 19, fontWeight: 700 }}>ご予約をキャンセルしますか？</h2>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>キャンセル後の復元はできません</p>
      </div>

      <div className="card">
        <div style={{ padding: 14, fontSize: 13, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>予約番号</span><span className="tabular" style={{ fontWeight: 600 }}>R-2026-0042</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>日時</span><span className="tabular" style={{ fontWeight: 600 }}>2026/05/23 (土) 10:00</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>店舗</span><span style={{ fontWeight: 600 }}>渋谷店</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>作業</span><span style={{ fontWeight: 600 }}>オイル交換</span></div>
        </div>
      </div>

      <Field label="キャンセル理由 (任意)" hint="サービス改善のため、可能な範囲でお聞かせください">
        <select className="select" defaultValue="">
          <option value="" disabled>選択してください</option>
          <option>日程の都合がつかなくなった</option>
          <option>別店舗に変更したい</option>
          <option>車両を売却した</option>
          <option>他のお店で対応してもらう</option>
          <option>その他</option>
        </select>
      </Field>

      <Field label="補足 (任意)">
        <textarea className="textarea" placeholder="" style={{ minHeight: 60 }} />
      </Field>

      <div style={{ padding: '10px 12px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, fontSize: 11.5, color: '#92400E', display: 'flex', gap: 8 }}>
        <Icon name="Info" size={13} style={{ flexShrink: 0, marginTop: 1 }} />
        <span>予約時間の 2 時間前を過ぎたキャンセルはキャンセル料が発生する場合があります。詳しくは <a style={{ color: 'inherit', textDecoration: 'underline' }}>キャンセルポリシー</a> をご確認ください。</span>
      </div>
    </div>

    <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid var(--border)', padding: '12px 16px', display: 'flex', gap: 8 }}>
      <Button variant="secondary" size="lg" style={{ flex: 1 }}>戻る</Button>
      <Button variant="danger" size="lg" icon="XCircle" style={{ flex: 2 }}>キャンセルする</Button>
    </div>
  </MobileShellL>
);

// ─────────────────────────────────────────────
// E.5 認証コード再送（レート制限）
// ─────────────────────────────────────────────
const ScreenCustomerResend = () => (
  <MobileShellL title="認証コードの再送信" sub="本日の再送残: 4 回 / 5 回">
    <div style={{ padding: '20px 16px 60px', display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div style={{ textAlign: 'center', padding: '12px 0' }}>
        <div style={{ width: 56, height: 56, borderRadius: 999, background: 'var(--primary-light)', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 12 }}>
          <Icon name="Mail" size={26} />
        </div>
        <div style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>送信先メールアドレス</div>
        <div className="tabular" style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>t****@example.com</div>
      </div>

      {/* Rate limit visual */}
      <div className="card">
        <div style={{ padding: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 10 }}>本日の再送回数</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {[true, false, false, false, false].map((used, i) => (
              <div key={i} style={{ flex: 1, height: 6, borderRadius: 999, background: used ? 'var(--primary)' : 'var(--bg-subtle)', border: '1px solid var(--border)' }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontSize: 11.5, color: 'var(--text-muted)' }}>
            <span>1 回使用済</span>
            <span className="tabular">残り 4 回</span>
          </div>
        </div>
      </div>

      {/* Cooldown */}
      <div style={{ padding: '14px 16px', background: 'var(--warning-light)', border: '1px solid #FCD34D', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 12 }}>
        <Icon name="Hourglass" size={20} style={{ color: 'var(--warning)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#92400E' }}>次の再送までお待ちください</div>
          <div className="tabular" style={{ fontSize: 11.5, color: '#92400E' }}>あと 47 秒（1 分につき 1 回まで）</div>
        </div>
        <div className="tabular" style={{ fontSize: 22, fontWeight: 700, color: '#92400E' }}>47</div>
      </div>

      <Button size="lg" icon="Send" disabled>再送信（あと 47 秒）</Button>
      <Button variant="tertiary">違うメールアドレスで受信する</Button>

      <div style={{ padding: '12px 14px', background: 'var(--bg-subtle)', borderRadius: 8, fontSize: 11.5, color: 'var(--text-muted)', lineHeight: 1.6 }}>
        <Icon name="Info" size={12} /> セキュリティ保護のため、再送は <b>1 分につき 1 回</b>、<b>1 日 5 回</b> までとさせていただいています。
        繰り返し失敗する場合は、ご登録メールアドレスのスペル・迷惑メールフォルダをご確認ください。
      </div>
    </div>
  </MobileShellL>
);

// ─────────────────────────────────────────────
// B.9 通知トースト一覧（システム通知パターン）
// ─────────────────────────────────────────────
const Toast = ({ tone, icon, title, desc, action, time = '今' }) => {
  const map = {
    success: { bg: '#fff', accent: 'var(--success)', bg2: 'var(--success-light)' },
    warning: { bg: '#fff', accent: 'var(--warning)', bg2: 'var(--warning-light)' },
    danger:  { bg: '#fff', accent: 'var(--danger)',  bg2: 'var(--danger-light)' },
    info:    { bg: '#fff', accent: 'var(--info)',    bg2: 'var(--info-light)' },
  };
  const c = map[tone];
  return (
    <div style={{ width: 380, background: c.bg, border: '1px solid var(--border)', borderRadius: 8, boxShadow: 'var(--shadow-modal)', padding: '14px 14px 14px 14px', display: 'flex', gap: 12, alignItems: 'flex-start', position: 'relative', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: c.accent }} />
      <div style={{ width: 32, height: 32, borderRadius: 999, background: c.bg2, color: c.accent, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
        <Icon name={icon} size={16} />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600 }}>{title}</div>
          <div className="tabular" style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 'auto' }}>{time}</div>
        </div>
        {desc && <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 3, lineHeight: 1.5 }}>{desc}</div>}
        {action && <div style={{ marginTop: 8 }}>{action}</div>}
      </div>
      <button className="x-btn" style={{ padding: 2, marginTop: -2 }}><Icon name="X" size={14} /></button>
    </div>
  );
};

const ScreenToasts = () => (
  <div className="app" style={{ width: '100%', height: '100%', background: 'var(--bg-subtle)', padding: '40px 48px', overflow: 'auto' }}>
    <div style={{ maxWidth: 900 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>§B.9</div>
      <h1 style={{ margin: '4px 0 6px', fontSize: 22, fontWeight: 700 }}>通知トースト</h1>
      <p style={{ margin: '0 0 24px', fontSize: 13.5, color: 'var(--text-secondary)' }}>右下から出現、4 秒で自動消滅。重要操作（業者通知・通信失敗）は手動 dismiss まで残留。</p>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <Toast tone="success" icon="CheckCircle2" title="業者へ通知を送信しました" desc="○○運送（山田 様）に回送依頼 TY-2026-0142 を送信しました。" time="2 秒前" />
        <Toast tone="info" icon="Send" title="顧客に予約確認メールを送信" desc="田中 太郎 様（t****@example.com）" time="5 秒前" />
        <Toast tone="warning" icon="AlertCircle" title="業者の回答待ち" desc="□□急便から 12 分間応答がありません。" action={<button className="btn btn-tertiary btn-sm" style={{ padding: 0, height: 'auto' }}>詳細を見る →</button>} time="12 分前" />
        <Toast tone="danger" icon="AlertTriangle" title="通知の配送に失敗しました" desc="OB-2026-3421 · SMTP 550 メールボックス容量超過。手動再送をお試しください。" action={<div style={{ display: 'flex', gap: 6 }}><Button size="sm" variant="secondary" icon="RotateCcw">再送</Button><Button size="sm" variant="tertiary">運用画面へ</Button></div>} time="38 分前" />
        <Toast tone="info" icon="UserPlus" title="新規業者が登録されました" desc="◇◇陸送（代表: 田村 翔）が招待 URL から登録を完了。" time="1 時間前" />
        <Toast tone="success" icon="Save" title="設定を保存しました" desc="レーン設定 · 渋谷店 Lane 3" time="" />
      </div>

      <div style={{ marginTop: 32 }}>
        <h3 className="sec-h">右下スタック（4 件まで · スライドアップ）</h3>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'flex-start' }}>
          <Toast tone="success" icon="CheckCircle2" title="予約を確定しました" time="今" />
          <Toast tone="info" icon="Send" title="業者へ通知中…" time="2 秒前" />
        </div>
      </div>
    </div>
  </div>
);

Object.assign(window, { ScreenCustomerModify, ScreenCustomerCancel, ScreenCustomerResend, ScreenToasts });
