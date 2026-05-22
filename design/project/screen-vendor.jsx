/* global React, Shell, PageHeader, Button, Icon, Badge, StatusBadge, Field, FilterChip */
// 段取りくん — Vendor Portal screens (§D)

// ─────────────────────────────────────────────
// D.3 業者ポータル — 依頼詳細
// ─────────────────────────────────────────────
const InfoRow = ({ label, value, mono }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '120px 1fr', gap: 16, padding: '8px 0', fontSize: 13, borderBottom: '1px dashed var(--border)' }}>
    <div style={{ color: 'var(--text-muted)', fontSize: 12.5 }}>{label}</div>
    <div className={mono ? 'tabular' : ''} style={{ fontWeight: 500 }}>{value}</div>
  </div>
);

const ScreenVendorRequestDetail = () => (
  <Shell audience="vendor" active="new">
    <PageHeader
      title="依頼 TY-2026-0142"
      breadcrumb={['新規依頼', 'TY-2026-0142']}
      right={
        <>
          <Badge tone="warning" icon="Clock">回答期限: あと 1 時間 47 分</Badge>
          <Button variant="secondary" icon="Printer">回送依頼書 (PDF)</Button>
        </>
      }
    />

    <div style={{ display: 'grid', gridTemplateColumns: '1fr 360px', height: 'calc(100% - 92px)' }}>
      {/* Main */}
      <div style={{ overflow: 'auto', padding: '24px 28px 120px' }}>
        {/* Status banner */}
        <div style={{ padding: '16px 20px', background: 'var(--primary-light)', borderRadius: 8, display: 'flex', alignItems: 'center', gap: 14, marginBottom: 24, border: '1px solid #BFDBFE' }}>
          <div style={{ width: 44, height: 44, borderRadius: 999, background: 'var(--primary)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: '#fff' }}>
            <Icon name="Truck" size={22} />
          </div>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>新規回送依頼</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 2 }}>◯◯モータース 渋谷店 から、片道回送のご依頼です。</div>
          </div>
          <Badge tone="info" icon="MapPin">片道</Badge>
        </div>

        {/* Route map */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-body" style={{ padding: '18px 20px' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 16 }}>
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}><Icon name="MapPin" size={12} style={{ color: 'var(--success)' }} /> 引取</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>渋谷店</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>〒150-XXXX 東京都渋谷区道玄坂 1-X-X</div>
                <div className="tabular" style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)', marginTop: 6 }}>05/23 (土) 09:30</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>担当: 田中 太郎 · <span className="tabular">03-xxxx-xxxx</span></div>
              </div>
              <div style={{ width: 60, display: 'flex', flexDirection: 'column', alignItems: 'center', color: 'var(--text-muted)' }}>
                <Icon name="ArrowRight" size={20} />
                <span style={{ fontSize: 11, marginTop: 4 }}>約 40 km</span>
                <span className="tabular" style={{ fontSize: 11 }}>≒ 60 分</span>
              </div>
              <div>
                <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 4 }}><Icon name="MapPin" size={12} style={{ color: 'var(--danger)' }} /> 搬入</div>
                <div style={{ fontSize: 15, fontWeight: 600 }}>横浜整備工場</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>〒220-XXXX 神奈川県横浜市西区みなとみらい X-X</div>
                <div className="tabular" style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)', marginTop: 6 }}>05/23 (土) 10:30</div>
                <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>受領: 整備課 鈴木</div>
              </div>
            </div>
          </div>
        </div>

        {/* Vehicle */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><div className="card-title">車両情報</div></div>
          <div style={{ padding: '16px 20px', display: 'grid', gridTemplateColumns: '160px 1fr', gap: 20 }}>
            <div className="placeholder-pattern" style={{ width: 160, height: 100, borderRadius: 6, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)', fontFamily: 'var(--font-mono)', fontSize: 11 }}>
              [車両写真]
            </div>
            <div>
              <InfoRow label="車種" value="トヨタ アルファード 2020 年式" />
              <InfoRow label="ナンバー" value="品川 300 あ 1234" />
              <InfoRow label="車台番号" value="ABCD-12-3456789" mono />
              <InfoRow label="走行可否" value={<><Badge tone="success" icon="Check">自走可</Badge> レッカー不要</>} />
              <InfoRow label="キー" value="店舗受付にて鍵 KEY-0142 を受領" />
            </div>
          </div>
        </div>

        {/* Notes */}
        <div className="card" style={{ marginBottom: 20 }}>
          <div className="card-header"><div className="card-title">注意事項</div></div>
          <div style={{ padding: '16px 20px' }}>
            <ul style={{ margin: 0, paddingLeft: 20, fontSize: 13, lineHeight: 1.7, color: 'var(--text)' }}>
              <li>チャイルドシート搭載済み、後部座席に荷物あり（要シート保護）</li>
              <li>雨天時はボディカバー必須（店舗にて貸与可）</li>
              <li>引取時に車両キズチェックシート記入をお願いします</li>
            </ul>
          </div>
        </div>

        {/* History */}
        <div className="card">
          <div className="card-header"><div className="card-title">通知履歴 / 変更履歴</div></div>
          <div style={{ padding: '14px 20px', display: 'flex', flexDirection: 'column', gap: 10 }}>
            {[
              { i: 'Pencil', t: '希望時刻が変更されました（09:00 → 09:30）', when: '05/22 13:50' },
              { i: 'Send', t: 'メール通知を送信しました', when: '05/22 13:45' },
              { i: 'MailOpen', t: 'メールが開封されました', when: '05/22 13:46' },
            ].map((x, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13 }}>
                <Icon name={x.i} size={14} style={{ color: 'var(--text-muted)' }} />
                <div style={{ flex: 1 }}>{x.t}</div>
                <div className="tabular" style={{ fontSize: 12, color: 'var(--text-muted)' }}>{x.when}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Right rail */}
      <aside style={{ borderLeft: '1px solid var(--border)', background: 'var(--bg-subtle)', padding: '24px', display: 'flex', flexDirection: 'column', gap: 16, overflow: 'auto' }}>
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>ご対応のお願い</div>
          <h2 style={{ margin: '6px 0 0', fontSize: 18, fontWeight: 700 }}>この依頼を引き受けますか？</h2>
          <p style={{ marginTop: 6, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            ご回答内容に応じて、業務委託契約書に従い回送業務を実施いただきます。引取・搬入が完了したら、本画面の進捗ボタンから報告をお願いします。
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Button size="lg" icon="CheckCircle2">対応可と回答</Button>
          <Button variant="secondary" size="lg" icon="XCircle">対応不可</Button>
        </div>

        <div className="divider" />

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 8 }}>進捗ステップ（受注後に有効化）</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {['引取予定', '引取済み', '搬入済み', '完了報告'].map((s, i) => (
              <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px', background: '#fff', border: '1px solid var(--border)', borderRadius: 6, fontSize: 13, color: 'var(--text-muted)' }}>
                <span style={{ width: 18, height: 18, borderRadius: 999, background: 'var(--bg-subtle)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 600 }}>{i + 1}</span>
                {s}
              </div>
            ))}
          </div>
        </div>

        <div className="divider" />

        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>緊急連絡先</div>
          <div style={{ fontSize: 13 }}>◯◯モータース 渋谷店</div>
          <div className="tabular" style={{ fontSize: 14, fontWeight: 600, color: 'var(--primary)' }}>03-xxxx-xxxx</div>
        </div>
      </aside>
    </div>
  </Shell>
);

// ─────────────────────────────────────────────
// D.4 対応可否回答モーダル（同意必須）
// ─────────────────────────────────────────────
const ScreenVendorAcceptModal = () => (
  <Shell audience="vendor" active="new">
    <PageHeader title="依頼 TY-2026-0142" breadcrumb={['新規依頼', 'TY-2026-0142', '対応可と回答']} />
    {/* Dimmed background of detail page */}
    <div style={{ position: 'relative', height: 'calc(100% - 92px)', overflow: 'hidden' }}>
      <div style={{ position: 'absolute', inset: 0, padding: 28, opacity: 0.4, filter: 'blur(1px)', pointerEvents: 'none' }}>
        <div style={{ background: 'var(--bg-subtle)', padding: 20, borderRadius: 8, fontSize: 13, color: 'var(--text-secondary)' }}>渋谷店 → 横浜整備工場 / 05/23 09:30 / トヨタ アルファード ...</div>
      </div>

      <div className="modal-overlay">
        <div className="modal" style={{ width: 600 }}>
          <div className="modal-header">
            <div>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>依頼への回答</div>
              <div className="modal-title" style={{ marginTop: 2 }}>対応可と回答する</div>
            </div>
            <button className="x-btn"><Icon name="X" size={18} /></button>
          </div>
          <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            <p style={{ margin: 0, fontSize: 13.5, color: 'var(--text-secondary)' }}>以下の依頼を引き受けます：</p>

            <div style={{ padding: '14px 16px', background: 'var(--bg-subtle)', borderRadius: 8, display: 'flex', flexDirection: 'column', gap: 6, fontSize: 13 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>依頼番号</span><span className="tabular" style={{ fontWeight: 600 }}>TY-2026-0142</span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>引取</span><span style={{ fontWeight: 500 }}>渋谷店 · <span className="tabular">05/23 09:30</span></span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>搬入</span><span style={{ fontWeight: 500 }}>横浜整備工場 · <span className="tabular">05/23 10:30</span></span></div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-muted)' }}>車両</span><span style={{ fontWeight: 500 }}>アルファード · 品川 300 あ 1234</span></div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="引取予定日時" required>
                <input className="input" defaultValue="2026-05-23  09:30" />
              </Field>
              <Field label="搬入予定日時" required>
                <input className="input" defaultValue="2026-05-23  10:30" />
              </Field>
            </div>

            <Field label="備考（任意）">
              <textarea className="textarea" placeholder="到着順序、車両を担当するドライバーなど" style={{ minHeight: 60 }} />
            </Field>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', border: '1.5px solid var(--primary)', borderRadius: 6, background: 'var(--primary-light)', cursor: 'pointer' }}>
              <input type="checkbox" style={{ accentColor: 'var(--primary)', marginTop: 2 }} />
              <span style={{ fontSize: 13, lineHeight: 1.6 }}>
                上記の内容で回送業務を引き受けます。<br />
                <span style={{ color: 'var(--text-secondary)' }}>業務委託契約書に従い、引取・搬入・返却の責任を負います。送信時刻と IP アドレスが記録されます。</span>
              </span>
            </label>
          </div>
          <div className="modal-footer">
            <Button variant="secondary">キャンセル</Button>
            <Button icon="Send">送信</Button>
          </div>
        </div>
      </div>
    </div>
  </Shell>
);

// ─────────────────────────────────────────────
// D.5 招待トークン受諾画面（未認証 / 公開 URL）
// ─────────────────────────────────────────────
const ScreenInviteAccept = () => (
  <div className="app" style={{ width: '100%', height: '100%', background: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column' }}>
    {/* Top minimal nav */}
    <div style={{ height: 56, background: '#fff', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 28px' }}>
      <div className="brand-logo">
        <span className="mark">段</span>
        <span>段取りくん</span>
      </div>
      <span style={{ marginLeft: 'auto', fontSize: 12.5, color: 'var(--text-muted)' }}>招待 URL · ログイン不要</span>
    </div>

    {/* Stepper */}
    <div style={{ padding: '32px 0 24px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#fff', borderBottom: '1px solid var(--border)' }}>
      <div className="stepper">
        <div className="step active"><span className="n">1</span>依頼内容の確認</div>
        <div className="sep" />
        <div className="step"><span className="n">2</span>業者情報の入力</div>
        <div className="sep" />
        <div className="step"><span className="n">3</span>パスワード設定</div>
        <div className="sep" />
        <div className="step"><span className="n">4</span>受注完了</div>
      </div>
    </div>

    {/* Hero */}
    <div style={{ flex: 1, overflow: 'auto', padding: '40px 24px 60px' }}>
      <div style={{ maxWidth: 640, margin: '0 auto' }}>
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div style={{ width: 64, height: 64, borderRadius: 16, background: 'var(--primary)', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', marginBottom: 16 }}>
            <Icon name="MailOpen" size={28} />
          </div>
          <h1 style={{ margin: 0, fontSize: 24, fontWeight: 700, letterSpacing: '-0.01em' }}>◯◯モータースから<br />回送依頼の招待が届いています</h1>
          <p style={{ margin: '10px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>下記の内容をご確認のうえ、ご対応の可否をお選びください。</p>
        </div>

        {/* Request summary card */}
        <div className="card" style={{ marginBottom: 20, boxShadow: 'var(--shadow-pop)' }}>
          <div className="card-header" style={{ background: 'var(--bg-subtle)' }}>
            <div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 600, letterSpacing: '0.04em', textTransform: 'uppercase' }}>依頼概要</div>
              <div className="tabular" style={{ fontSize: 17, fontWeight: 700, marginTop: 2 }}>TY-2026-0142</div>
            </div>
            <Badge tone="info" icon="Truck">片道回送</Badge>
          </div>
          <div className="card-body" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 0 }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'center', gap: 14, padding: '8px 0' }}>
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}><Icon name="MapPin" size={11} style={{ color: 'var(--success)' }} /> 引取</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>渋谷店</div>
                <div className="tabular" style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600 }}>05/23 09:30</div>
              </div>
              <Icon name="ArrowRight" size={18} style={{ color: 'var(--text-muted)' }} />
              <div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 2 }}><Icon name="MapPin" size={11} style={{ color: 'var(--danger)' }} /> 搬入</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>横浜整備工場</div>
                <div className="tabular" style={{ fontSize: 13, color: 'var(--primary)', fontWeight: 600 }}>05/23 10:30</div>
              </div>
            </div>
            <div className="divider" style={{ margin: '8px 0' }} />
            <InfoRow label="車両" value="トヨタ アルファード 2020 年式" />
            <InfoRow label="ナンバー" value="品川 300 あ 1234" />
            <InfoRow label="走行可否" value="自走可（レッカー不要）" />
            <InfoRow label="距離" value="約 40 km · 60 分（参考）" />
          </div>
        </div>

        {/* Disclaimer */}
        <div style={{ padding: '14px 16px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, fontSize: 12.5, color: '#92400E', display: 'flex', gap: 10, marginBottom: 20 }}>
          <Icon name="Info" size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <div>
            この招待は <span style={{ fontWeight: 600 }}>2026-05-22 19:00 まで</span> 有効です。期限を過ぎる、もしくは他業者が先に受注した場合は無効となります。
          </div>
        </div>

        {/* Consent */}
        <label style={{ display: 'flex', alignItems: 'flex-start', gap: 10, padding: '12px 14px', border: '1.5px solid var(--primary)', borderRadius: 8, background: '#fff', cursor: 'pointer', marginBottom: 20 }}>
          <input type="checkbox" style={{ accentColor: 'var(--primary)', marginTop: 2 }} />
          <span style={{ fontSize: 13, lineHeight: 1.6 }}>上記内容を確認し、業務委託契約書に従って対応します。</span>
        </label>

        {/* CTA */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: 12 }}>
          <Button variant="secondary" size="lg" icon="XCircle">対応不可</Button>
          <Button size="lg" iconRight="ArrowRight">対応可 → 業者登録へ</Button>
        </div>

        <div style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: 'var(--text-muted)' }}>
          ご不明点は ◯◯モータース 渋谷店 <span className="tabular">03-xxxx-xxxx</span> までご連絡ください。
        </div>
      </div>
    </div>
  </div>
);

// ─────────────────────────────────────────────
// (おまけ) D.1 inbox の通知エントリ群を D.3 と並べる場合に
// ─────────────────────────────────────────────
const ScreenVendorInbox = () => {
  const items = [
    { sev: 'action_required', title: '新規回送依頼', sub: '渋谷店 → 横浜整備工場 · TY-2026-0142', when: '5 分前', unread: true },
    { sev: 'urgent', title: '引取予定時刻が近づいています', sub: 'TY-2026-0140 · 残り 28 分', when: '30 分前', unread: true },
    { sev: 'info', title: '希望時刻が変更されました', sub: 'TY-2026-0141 · 14:00 → 14:30', when: '1 時間前', unread: true },
    { sev: 'info', title: '完了報告を受領しました', sub: 'TY-2026-0138 ありがとうございました', when: '昨日', unread: false },
  ];
  const sevMap = {
    action_required: { tone: 'warning', icon: 'AlertCircle', label: '要対応' },
    urgent: { tone: 'danger', icon: 'Flame', label: '緊急' },
    info: { tone: 'info', icon: 'Info', label: 'お知らせ' },
  };
  return (
    <Shell audience="vendor" active="inbox">
      <PageHeader title="通知一覧" subtitle="新着 3 件 · 未読 5 件" right={<Button variant="secondary" icon="CheckCheck" size="sm">すべて既読</Button>} />
      <div style={{ padding: '14px 28px', borderBottom: '1px solid var(--border)', display: 'flex', gap: 0, background: 'var(--bg-subtle)' }}>
        {[
          { k: 'unread', l: '未読', n: 5, active: true },
          { k: 'all', l: 'すべて', n: 24 },
          { k: 'archived', l: 'アーカイブ済', n: 121 },
        ].map(t => (
          <div key={t.k} style={{
            padding: '8px 16px', fontSize: 13, fontWeight: 500,
            background: t.active ? '#fff' : 'transparent',
            color: t.active ? 'var(--primary)' : 'var(--text-secondary)',
            border: '1px solid var(--border)', borderRight: t.k !== 'archived' ? 'none' : '1px solid var(--border)',
            borderTopLeftRadius: t.k === 'unread' ? 6 : 0, borderBottomLeftRadius: t.k === 'unread' ? 6 : 0,
            borderTopRightRadius: t.k === 'archived' ? 6 : 0, borderBottomRightRadius: t.k === 'archived' ? 6 : 0,
            display: 'inline-flex', alignItems: 'center', gap: 6,
          }}>
            {t.l}<span className="badge badge-muted" style={{ fontSize: 11 }}>{t.n}</span>
          </div>
        ))}
      </div>
      <div style={{ padding: 28, display: 'flex', flexDirection: 'column', gap: 12, maxWidth: 760, margin: '0 auto', width: '100%' }}>
        {items.map((it, i) => {
          const sev = sevMap[it.sev];
          return (
            <div key={i} style={{ padding: '14px 18px', background: '#fff', border: '1px solid var(--border)', borderLeft: `3px solid ${it.unread ? 'var(--primary)' : 'transparent'}`, borderRadius: 8, display: 'flex', gap: 14, alignItems: 'flex-start', boxShadow: it.unread ? 'var(--shadow-card)' : 'none' }}>
              <div style={{ width: 32, height: 32, borderRadius: 999, background: `var(--${sev.tone === 'danger' ? 'danger' : sev.tone === 'warning' ? 'warning' : 'info'}-light)`, color: `var(--${sev.tone === 'danger' ? 'danger' : sev.tone === 'warning' ? 'warning' : 'info'})`, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <Icon name={sev.icon} size={16} />
              </div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
                  <Badge tone={sev.tone} icon={sev.icon}>{sev.label}</Badge>
                  <span style={{ fontSize: 14, fontWeight: it.unread ? 600 : 500 }}>{it.title}</span>
                </div>
                <div style={{ fontSize: 12.5, color: 'var(--text-secondary)' }}>{it.sub}</div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
                <div className="tabular" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{it.when}</div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="btn btn-ghost btn-sm" style={{ height: 24, padding: '0 8px', fontSize: 12 }}>既読化</button>
                  <button className="btn btn-ghost btn-sm" style={{ height: 24, padding: '0 8px', fontSize: 12 }}>アーカイブ</button>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </Shell>
  );
};

Object.assign(window, {
  ScreenVendorRequestDetail, ScreenVendorAcceptModal, ScreenInviteAccept, ScreenVendorInbox,
});
