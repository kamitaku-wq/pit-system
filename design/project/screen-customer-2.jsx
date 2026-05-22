/* global React, Icon, Button, Badge, Field, StatusBadge */
// 段取りくん — Customer screens part 2 (E.1 Step 1/4/5/6 + E.2)

const MobileShell2 = ({ children, step, total = 6, title, sub, noBack }) => (
  <div className="app" style={{ width: '100%', height: '100%', background: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column' }}>
    <div style={{ height: 52, background: '#fff', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 16px', gap: 10, flexShrink: 0 }}>
      {!noBack && <button className="btn btn-ghost btn-sm" style={{ padding: 6 }}><Icon name="ChevronLeft" size={18} /></button>}
      <div style={{ flex: 1 }}>
        <div className="brand-logo" style={{ fontSize: 14 }}>
          <span className="mark" style={{ width: 20, height: 20, fontSize: 11 }}>段</span>
          <span>段取りくん</span>
        </div>
      </div>
      {step && <span style={{ fontSize: 11.5, color: 'var(--text-muted)' }}><span className="tabular">{step}</span> / <span className="tabular">{total}</span></span>}
    </div>
    {step && (
      <div style={{ height: 3, background: 'var(--border)', flexShrink: 0 }}>
        <div style={{ height: '100%', width: `${(step / total) * 100}%`, background: 'var(--primary)' }} />
      </div>
    )}
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
// E.1 Step 1: 店舗選択
// ─────────────────────────────────────────────
const StoreCard = ({ name, addr, hours, distance, selected }) => (
  <button style={{
    display: 'flex', gap: 12, padding: '14px 16px', background: '#fff',
    border: `1.5px solid ${selected ? 'var(--primary)' : 'var(--border)'}`,
    borderRadius: 10, textAlign: 'left', width: '100%',
    boxShadow: selected ? '0 0 0 3px rgba(30, 58, 138, 0.1)' : 'none',
  }}>
    <div style={{ width: 40, height: 40, borderRadius: 10, background: selected ? 'var(--primary)' : 'var(--primary-light)', color: selected ? '#fff' : 'var(--primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
      <Icon name="Store" size={20} />
    </div>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 14.5, fontWeight: 600 }}>{name}</div>
      <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>{addr}</div>
      <div style={{ display: 'flex', gap: 12, marginTop: 4, fontSize: 11.5, color: 'var(--text-muted)' }}>
        <span><Icon name="Clock" size={11} /> {hours}</span>
        <span><Icon name="MapPin" size={11} /> {distance}</span>
      </div>
    </div>
  </button>
);

const ScreenCustomerStep1 = () => (
  <MobileShell2 step={1} title="ご希望の店舗をお選びください" sub="現在地から近い順に表示しています">
    <div style={{ padding: '12px 16px', display: 'flex', flexDirection: 'column', gap: 10 }}>
      <div style={{ position: 'relative' }}>
        <Icon name="Search" size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
        <input className="input" placeholder="店舗名・地名で検索" style={{ paddingLeft: 36 }} />
      </div>
      <StoreCard name="渋谷店" addr="東京都渋谷区道玄坂 1-X-X" hours="9:00–18:00" distance="0.8 km" selected />
      <StoreCard name="横浜店" addr="神奈川県横浜市西区みなとみらい X-X" hours="9:00–18:00" distance="28 km" />
      <StoreCard name="川崎店" addr="神奈川県川崎市川崎区東田町 X-X" hours="9:00–18:00 (日祝休)" distance="14 km" />
      <StoreCard name="横須賀店" addr="神奈川県横須賀市本町 X-X" hours="10:00–17:00" distance="56 km" />
    </div>
    <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid var(--border)', padding: '12px 16px' }}>
      <Button size="lg" iconRight="ArrowRight" style={{ width: '100%', justifyContent: 'center' }}>作業を選ぶ</Button>
    </div>
  </MobileShell2>
);

// ─────────────────────────────────────────────
// E.1 Step 4: お客様情報入力
// ─────────────────────────────────────────────
const ScreenCustomerStep4 = () => (
  <MobileShell2 step={4} title="お客様情報" sub="ご予約完了の確認メールをお送りします">
    <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Summary */}
      <div style={{ padding: '10px 12px', background: 'var(--primary-light)', borderRadius: 8, fontSize: 12.5, color: 'var(--primary)' }}>
        <Icon name="CheckCircle2" size={13} /> <span style={{ fontWeight: 600 }}>渋谷店 · オイル交換 · 05/23 (土) 10:00</span>
      </div>

      <Field label="お名前" required><input className="input" placeholder="例: 田中 太郎" /></Field>
      <Field label="電話番号" required hint="ハイフンなし"><input className="input" placeholder="例: 09012345678" /></Field>
      <Field label="メールアドレス" required hint="ご予約確認とリマインドをお送りします"><input className="input" placeholder="例: name@example.com" type="email" inputMode="email" /></Field>

      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', paddingTop: 8 }}>車両情報</div>
      <Field label="車種" required><input className="input" placeholder="例: トヨタ アルファード" /></Field>
      <Field label="ナンバー" required><input className="input" placeholder="例: 品川 300 あ 1234" /></Field>

      <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '10px 12px', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, fontSize: 12.5, cursor: 'pointer' }}>
        <input type="checkbox" style={{ accentColor: 'var(--primary)', marginTop: 2 }} />
        <span style={{ lineHeight: 1.5 }}>
          <a style={{ color: 'var(--primary)' }}>利用規約</a> と <a style={{ color: 'var(--primary)' }}>プライバシーポリシー</a> に同意します
        </span>
      </label>
    </div>
    <div style={{ position: 'sticky', bottom: 0, background: '#fff', borderTop: '1px solid var(--border)', padding: '12px 16px', display: 'flex', gap: 8 }}>
      <Button variant="secondary" size="lg" style={{ flex: 1 }}>戻る</Button>
      <Button size="lg" iconRight="ArrowRight" style={{ flex: 2 }}>認証コード送信</Button>
    </div>
  </MobileShell2>
);

// ─────────────────────────────────────────────
// E.1 Step 5: 認証コード入力
// ─────────────────────────────────────────────
const ScreenCustomerStep5 = () => (
  <MobileShell2 step={5} title="認証コードを入力" sub="ご登録のメールアドレスに 6 桁のコードをお送りしました">
    <div style={{ padding: '24px 16px', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 24 }}>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 4 }}>
        <div style={{ width: 36, height: 36, borderRadius: 999, background: 'var(--primary-light)', color: 'var(--primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="MailCheck" size={18} />
        </div>
      </div>

      <div style={{ textAlign: 'center', fontSize: 12.5, color: 'var(--text-secondary)' }}>
        <span className="tabular" style={{ color: 'var(--text)' }}>t****@example.com</span> 宛にお送りしました
      </div>

      <div style={{ display: 'flex', justifyContent: 'center', gap: 8 }}>
        {['8', '3', '7', '4', '', ''].map((d, i) => (
          <div key={i} className="tabular" style={{
            width: 44, height: 56, borderRadius: 8,
            border: `2px solid ${i === 4 ? 'var(--primary)' : 'var(--border-strong)'}`,
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 24, fontWeight: 700,
            background: i === 4 ? '#fff' : d ? 'var(--bg-subtle)' : '#fff',
            boxShadow: i === 4 ? '0 0 0 3px rgba(30, 58, 138, 0.15)' : 'none',
          }}>{d}{i === 4 && <span style={{ width: 2, height: 24, background: 'var(--primary)', animation: 'blink 1s infinite' }} />}</div>
        ))}
      </div>

      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginBottom: 8 }}>コードが届かない場合</div>
        <button className="btn btn-tertiary btn-sm">
          <Icon name="RotateCcw" size={13} />再送信（<span className="tabular">残り 4 回 / 本日</span>）
        </button>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>次回送信まで <span className="tabular">47</span> 秒</div>
      </div>
    </div>
  </MobileShell2>
);

// ─────────────────────────────────────────────
// E.1 Step 6: 完了画面
// ─────────────────────────────────────────────
const ScreenCustomerStep6 = () => (
  <MobileShell2 step={6} noBack>
    <div style={{ padding: '32px 20px 80px', display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 20 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ width: 64, height: 64, borderRadius: 999, background: 'var(--success-light)', color: 'var(--success)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
          <Icon name="CheckCircle2" size={32} />
        </div>
        <h2 style={{ margin: 0, fontSize: 22, fontWeight: 700 }}>ご予約完了</h2>
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)' }}>確認メールをお送りしました</p>
      </div>

      <div className="card" style={{ boxShadow: 'var(--shadow-pop)' }}>
        <div className="card-header" style={{ background: 'var(--bg-subtle)', borderBottom: '1px solid var(--border)' }}>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>予約番号</div>
            <div className="tabular" style={{ fontSize: 18, fontWeight: 700, marginTop: 2 }}>R-2026-0042</div>
          </div>
          <StatusBadge status="confirmed" />
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>日時</span>
            <span style={{ fontWeight: 600 }}><span className="tabular">2026/05/23 (土) 10:00</span></span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>店舗</span>
            <span style={{ fontWeight: 600 }}>渋谷店</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>作業</span>
            <span style={{ fontWeight: 600 }}>オイル交換（約 30 分）</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>料金目安</span>
            <span style={{ fontWeight: 600 }} className="tabular">¥4,800〜</span>
          </div>
        </div>
      </div>

      {/* QR */}
      <div style={{ padding: '16px', background: '#fff', border: '1px solid var(--border)', borderRadius: 8, textAlign: 'center' }}>
        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 10 }}>店頭でこの QR をご提示ください</div>
        <div style={{
          width: 120, height: 120, margin: '0 auto',
          background: `repeating-conic-gradient(#0F172A 0deg 90deg, #fff 90deg 180deg)`,
          backgroundSize: '12px 12px', border: '8px solid #fff', boxShadow: '0 0 0 1px var(--border)',
        }} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Button variant="secondary" size="lg" icon="Calendar">カレンダーに追加</Button>
        <Button variant="tertiary" size="lg">予約内容を変更 / キャンセル</Button>
      </div>
    </div>
  </MobileShell2>
);

// ─────────────────────────────────────────────
// E.2 予約確認（token URL からアクセス）
// ─────────────────────────────────────────────
const ScreenCustomerConfirm = () => (
  <MobileShell2 title="ご予約内容" sub="メールに記載された URL から表示しています" noBack>
    <div style={{ padding: '16px 16px 80px', display: 'flex', flexDirection: 'column', gap: 14 }}>
      <div className="card">
        <div className="card-header" style={{ background: 'var(--bg-subtle)' }}>
          <div>
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase' }}>予約番号</div>
            <div className="tabular" style={{ fontSize: 16, fontWeight: 700, marginTop: 2 }}>R-2026-0042</div>
          </div>
          <StatusBadge status="confirmed" />
        </div>
        <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            <span style={{ color: 'var(--text-muted)' }}>日時</span>
            <span style={{ fontWeight: 600 }} className="tabular">2026/05/23 (土) 10:00</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>店舗</span><span style={{ fontWeight: 600 }}>渋谷店</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>作業</span><span style={{ fontWeight: 600 }}>オイル交換</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>所要時間</span><span style={{ fontWeight: 600 }} className="tabular">約 30 分</span></div>
        </div>
      </div>

      <div className="card">
        <div className="card-header"><div className="card-title" style={{ fontSize: 13 }}>お車</div></div>
        <div style={{ padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>車種</span><span style={{ fontWeight: 500 }}>トヨタ アルファード</span></div>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>ナンバー</span><span style={{ fontWeight: 500 }} className="tabular">品川 300 あ 1234</span></div>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <Button variant="secondary" size="lg" icon="Edit3" style={{ flex: 1 }}>変更</Button>
        <Button variant="ghost" size="lg" icon="XCircle" style={{ flex: 1, color: 'var(--danger)' }}>キャンセル</Button>
      </div>

      <div style={{ padding: '12px 14px', background: 'var(--bg-subtle)', borderRadius: 8, fontSize: 11.5, color: 'var(--text-muted)', display: 'flex', gap: 8 }}>
        <Icon name="Info" size={13} />
        <span>変更・キャンセルは予約時間の 2 時間前まで承ります。それ以降は店舗 <span className="tabular">03-xxxx-xxxx</span> までご連絡ください。</span>
      </div>
    </div>
  </MobileShell2>
);

Object.assign(window, { ScreenCustomerStep1, ScreenCustomerStep4, ScreenCustomerStep5, ScreenCustomerStep6, ScreenCustomerConfirm });
