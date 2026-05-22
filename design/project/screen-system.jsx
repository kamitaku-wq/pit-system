/* global React, Shell, PageHeader, Icon, Button, Badge, StatusBadge, GlobalHeader */
// 段取りくん — Mobile + empty/error/loading states + microcopy catalog (§H + §J.4-5)

// ─────────────────────────────────────────────
// §H.3 業者ポータル — モバイル (D.3 mobile)
// ─────────────────────────────────────────────
const MobileTopBar = ({ title, sub, right, audience = 'vendor' }) => (
  <div style={{ height: 52, background: '#fff', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', padding: '0 12px', gap: 8, flexShrink: 0 }}>
    <button className="btn btn-ghost btn-sm" style={{ padding: 6 }}>
      <Icon name="Menu" size={20} />
    </button>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</div>}
    </div>
    {right || (
      <>
        <button className="btn btn-ghost btn-sm" style={{ position: 'relative', padding: 6 }}>
          <Icon name="Bell" size={20} />
          <span style={{ position: 'absolute', top: 4, right: 4, width: 6, height: 6, borderRadius: 999, background: 'var(--danger)' }} />
        </button>
      </>
    )}
  </div>
);

const ScreenVendorMobile = () => (
  <div className="app" style={{ width: '100%', height: '100%', background: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column' }}>
    <MobileTopBar title="TY-2026-0142" sub="◯◯モータース 渋谷店" />

    <div style={{ flex: 1, overflow: 'auto', padding: '12px 12px 100px' }}>
      {/* Status pill */}
      <div style={{ padding: '10px 14px', background: 'var(--primary-light)', borderRadius: 10, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10 }}>
        <Icon name="Truck" size={18} style={{ color: 'var(--primary)' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--primary)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>新規回送依頼</div>
          <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1 }}>片道 · 残り 1h 47m</div>
        </div>
      </div>

      {/* Route card */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, paddingTop: 4 }}>
              <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--success)' }} />
              <span style={{ width: 1, flex: 1, background: 'var(--border-strong)', minHeight: 26 }} />
              <span style={{ width: 8, height: 8, borderRadius: 999, background: 'var(--danger)' }} />
            </div>
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>引取</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>渋谷店</div>
                <div className="tabular" style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>05/23 09:30</div>
              </div>
              <div>
                <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>搬入</div>
                <div style={{ fontSize: 14, fontWeight: 600 }}>横浜整備工場</div>
                <div className="tabular" style={{ fontSize: 13, fontWeight: 600, color: 'var(--primary)' }}>05/23 10:30</div>
              </div>
            </div>
            <button style={{ width: 36, height: 36, borderRadius: 8, background: 'var(--bg-subtle)', border: '1px solid var(--border)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
              <Icon name="Map" size={16} />
            </button>
          </div>
        </div>
      </div>

      {/* Vehicle card (collapsed) */}
      <div className="card" style={{ marginBottom: 12 }}>
        <div style={{ padding: 14, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>車両</div>
            <div style={{ fontSize: 13.5, fontWeight: 600 }}>アルファード 2020</div>
            <div className="tabular" style={{ fontSize: 11.5, color: 'var(--text-secondary)' }}>品川 300 あ 1234</div>
          </div>
          <Badge tone="success" icon="Check">自走可</Badge>
        </div>
      </div>

      {/* Quick info chips */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, overflowX: 'auto', paddingBottom: 4 }}>
        <a href="#" style={{ flexShrink: 0, padding: '8px 12px', background: '#fff', border: '1px solid var(--border)', borderRadius: 999, fontSize: 12, fontWeight: 500, color: 'var(--primary)', textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="Phone" size={12} />03-xxxx-xxxx
        </a>
        <button style={{ flexShrink: 0, padding: '8px 12px', background: '#fff', border: '1px solid var(--border)', borderRadius: 999, fontSize: 12, fontWeight: 500, color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="Navigation" size={12} />ナビ起動
        </button>
        <button style={{ flexShrink: 0, padding: '8px 12px', background: '#fff', border: '1px solid var(--border)', borderRadius: 999, fontSize: 12, fontWeight: 500, color: 'var(--text)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Icon name="FileText" size={12} />依頼書 PDF
        </button>
      </div>

      {/* Notes */}
      <div className="card">
        <div className="card-header" style={{ padding: '10px 14px' }}><div className="card-title" style={{ fontSize: 13 }}>注意事項</div></div>
        <div style={{ padding: '10px 14px', fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-secondary)' }}>
          チャイルドシート搭載済み、後部座席に荷物あり（要シート保護）。雨天時はボディカバー必須。
        </div>
      </div>

      <div style={{ marginTop: 10, padding: '10px 12px', background: '#FFFBEB', border: '1px solid #FDE68A', borderRadius: 8, fontSize: 11.5, color: '#92400E', display: 'flex', gap: 6 }}>
        <Icon name="WifiOff" size={13} />
        <span>オフライン時はキャッシュから直近案件を表示します</span>
      </div>
    </div>

    {/* Bottom action zone (thumb zone, §H.3) */}
    <div style={{ background: '#fff', borderTop: '1px solid var(--border)', padding: '10px 12px 14px', display: 'flex', gap: 8 }}>
      <Button variant="secondary" size="lg" icon="XCircle" style={{ flex: 1 }}>対応不可</Button>
      <Button size="lg" icon="CheckCircle2" style={{ flex: 2 }}>対応可と回答</Button>
    </div>

    {/* Mobile bottom nav */}
    <div style={{ background: 'var(--bg-subtle)', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-around', padding: '6px 0' }}>
      {[
        { i: 'Inbox', l: '通知' },
        { i: 'PackagePlus', l: '新規', a: true },
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

// ─────────────────────────────────────────────
// §H.2 管理画面モバイル (C.1 ダッシュボード · ハンバーガー + カード型)
// ─────────────────────────────────────────────
const ScreenAdminMobile = () => (
  <div className="app" style={{ width: '100%', height: '100%', background: 'var(--bg-subtle)', display: 'flex', flexDirection: 'column' }}>
    <MobileTopBar title="ホーム" sub="◯◯モータース · 田中" audience="admin" />

    <div style={{ flex: 1, overflow: 'auto', padding: '12px 12px 80px' }}>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 6 }}>05/22 (金)</div>

      {/* KPI cards 2x2 */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 16 }}>
        {[
          { l: '本日予約', v: '24', i: 'CalendarCheck', sub: '昨日比 +3', tone: 'muted' },
          { l: '業者未確認', v: '3', i: 'Clock', sub: '最長 27 分', tone: 'warning' },
          { l: '対応不可', v: '1', i: 'XCircle', sub: '再打診中', tone: 'danger' },
          { l: '通知失敗', v: '2', i: 'AlertTriangle', sub: '要再送', tone: 'danger' },
        ].map((k, i) => (
          <div key={i} className="card" style={{ padding: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500 }}>
              <Icon name={k.i} size={12} style={{ color: `var(--${k.tone === 'muted' ? 'text-muted' : k.tone})` }} />
              {k.l}
            </div>
            <div className="tabular" style={{ fontSize: 26, fontWeight: 700, marginTop: 2 }}>{k.v}</div>
            <div style={{ fontSize: 10.5, color: 'var(--text-muted)' }}>{k.sub}</div>
          </div>
        ))}
      </div>

      {/* Table → cards (§H.2) */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>本日の予約</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {[
          { t: '10:00', n: '田中 太郎', w: 'オイル交換', s: 'confirmed' },
          { t: '11:30', n: '佐藤 花子', w: '車検整備', s: 'inprogress' },
          { t: '14:00', n: '【店間】 鈴木', w: 'タイヤ → 横浜店', s: 'moving' },
          { t: '15:30', n: '高橋 健', w: 'バッテリー交換', s: 'tentative' },
        ].map((r, i) => (
          <div key={i} className="card" style={{ padding: 12, display: 'flex', alignItems: 'center', gap: 12 }}>
            <div className="tabular" style={{ fontSize: 16, fontWeight: 700, minWidth: 48 }}>{r.t}</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 13.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.n}</div>
              <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{r.w}</div>
            </div>
            <StatusBadge status={r.s} />
          </div>
        ))}
      </div>
    </div>

    {/* FAB */}
    <button style={{ position: 'absolute', bottom: 84, right: 16, width: 52, height: 52, borderRadius: 999, background: 'var(--primary)', color: '#fff', border: 'none', boxShadow: 'var(--shadow-modal)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <Icon name="Plus" size={22} />
    </button>

    {/* Mobile bottom nav */}
    <div style={{ background: '#fff', borderTop: '1px solid var(--border)', display: 'flex', justifyContent: 'space-around', padding: '6px 0' }}>
      {[
        { i: 'LayoutDashboard', l: 'ホーム', a: true },
        { i: 'Calendar', l: 'カレンダー' },
        { i: 'Users', l: '予約' },
        { i: 'Truck', l: '回送' },
        { i: 'Menu', l: 'メニュー' },
      ].map(t => (
        <button key={t.l} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2, padding: '4px 8px', background: 'transparent', border: 'none', color: t.a ? 'var(--primary)' : 'var(--text-muted)' }}>
          <Icon name={t.i} size={18} />
          <span style={{ fontSize: 10, fontWeight: t.a ? 600 : 500 }}>{t.l}</span>
        </button>
      ))}
    </div>
  </div>
);

// ─────────────────────────────────────────────
// 空状態 / エラー / ロード中 イラスト (§J.5)
// ─────────────────────────────────────────────
const PlaceholderIllustration = ({ icon, tone = 'primary' }) => (
  <div style={{ position: 'relative', width: 120, height: 120, margin: '0 auto', marginBottom: 16 }}>
    <div style={{ position: 'absolute', inset: 0, borderRadius: 999, background: `var(--${tone}-light)`, opacity: 0.6 }} />
    <div style={{ position: 'absolute', inset: 16, borderRadius: 999, background: `var(--${tone}-light)` }} />
    <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', color: `var(--${tone})` }}>
      <Icon name={icon} size={48} strokeWidth={1.5} />
    </div>
    {/* Decorative dots */}
    <div style={{ position: 'absolute', top: 8, right: 4, width: 6, height: 6, borderRadius: 999, background: `var(--${tone})`, opacity: 0.4 }} />
    <div style={{ position: 'absolute', bottom: 12, left: 0, width: 4, height: 4, borderRadius: 999, background: `var(--${tone})`, opacity: 0.3 }} />
    <div style={{ position: 'absolute', top: 32, left: -4, width: 8, height: 8, borderRadius: 999, background: `var(--${tone})`, opacity: 0.25 }} />
  </div>
);

const StateCard = ({ kind, illust, illustTone, title, body, primary, secondary }) => {
  const kindBadge = { empty: 'Empty', error: 'Error', loading: 'Loading' }[kind];
  const kindTone = { empty: 'muted', error: 'danger', loading: 'info' }[kind];
  return (
    <div className="card" style={{ padding: '32px 24px', textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 0 }}>
      <Badge tone={kindTone} icon={kind === 'error' ? 'AlertTriangle' : kind === 'loading' ? 'Loader2' : 'Inbox'}>{kindBadge}</Badge>
      <div style={{ marginTop: 20 }}>
        <PlaceholderIllustration icon={illust} tone={illustTone} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6 }}>{title}</div>
      <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 16, maxWidth: 260 }}>{body}</div>
      <div style={{ display: 'flex', gap: 8 }}>
        {primary && <Button size="sm" icon={primary.icon}>{primary.label}</Button>}
        {secondary && <Button variant="tertiary" size="sm">{secondary.label}</Button>}
      </div>
    </div>
  );
};

const ScreenStatesGallery = () => (
  <div className="app" style={{ width: '100%', height: '100%', background: 'var(--bg-subtle)', padding: '32px 40px 60px', overflow: 'auto' }}>
    <div style={{ maxWidth: 1300, margin: '0 auto' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>§J.5 · 画面状態カタログ</div>
      <h1 style={{ margin: '4px 0 4px', fontSize: 22, fontWeight: 700 }}>空状態 / エラー / ロード中</h1>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--text-secondary)' }}>各画面で使用する 3 ステート × トーンのカタログ。シンプルな円形 + Lucide アイコンで構成（マスコットなし · §A.2）。</p>

      <h3 className="sec-h">空状態 (Empty States)</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
        <StateCard
          kind="empty" illust="CalendarPlus" illustTone="primary"
          title="本日の予約はまだありません"
          body="お客様からの予約は最大 30 日前から受け付けています。電話受付からも追加できます。"
          primary={{ icon: 'Plus', label: '新規予約' }}
          secondary={{ label: '電話受付' }}
        />
        <StateCard
          kind="empty" illust="Truck" illustTone="primary"
          title="回送依頼はありません"
          body="店間整備依頼を作成すると、業者通知と一緒にここに表示されます。"
          primary={{ icon: 'ArrowLeftRight', label: '店間依頼を作成' }}
        />
        <StateCard
          kind="empty" illust="Inbox" illustTone="primary"
          title="新着通知はありません"
          body="新規依頼や進捗更新があるとここに届きます。"
        />
      </div>

      <h3 className="sec-h">エラー状態 (Error States)</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
        <StateCard
          kind="error" illust="WifiOff" illustTone="danger"
          title="接続が切れています"
          body="ネットワーク接続を確認してから再度お試しください。直近のデータはオフラインで閲覧できます。"
          primary={{ icon: 'RotateCcw', label: '再読み込み' }}
        />
        <StateCard
          kind="error" illust="ServerCrash" illustTone="danger"
          title="サーバーエラーが発生しました"
          body="サポート側で問題を確認中です。しばらくしてから再度お試しください。"
          primary={{ icon: 'RotateCcw', label: '再試行' }}
          secondary={{ label: 'サポートに連絡' }}
        />
        <StateCard
          kind="error" illust="ShieldOff" illustTone="danger"
          title="このページへのアクセス権がありません"
          body="本部管理者のみ閲覧可能です。アクセスが必要な場合は管理者へお問い合わせください。"
          secondary={{ label: 'ホームへ戻る' }}
        />
      </div>

      <h3 className="sec-h">ロード中 (Loading / Skeleton)</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
        {/* Skeleton card 1: KPI */}
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 10 }}>KPI スケルトン</div>
          <div style={{ display: 'flex', gap: 12 }}>
            {[1, 2, 3].map(i => (
              <div key={i} style={{ flex: 1 }}>
                <div style={{ height: 10, background: 'var(--bg-subtle)', borderRadius: 4, marginBottom: 8, width: '60%' }} />
                <div style={{ height: 28, background: 'var(--border)', borderRadius: 4, marginBottom: 6 }} />
                <div style={{ height: 8, background: 'var(--bg-subtle)', borderRadius: 4, width: '40%' }} />
              </div>
            ))}
          </div>
        </div>

        {/* Skeleton card 2: List */}
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 10 }}>リストスケルトン</div>
          {[1, 2, 3].map(i => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 0', borderBottom: i < 3 ? '1px solid var(--border)' : 'none' }}>
              <div style={{ width: 28, height: 28, borderRadius: 999, background: 'var(--bg-subtle)' }} />
              <div style={{ flex: 1 }}>
                <div style={{ height: 10, background: 'var(--border)', borderRadius: 4, marginBottom: 4, width: `${65 + i * 5}%` }} />
                <div style={{ height: 8, background: 'var(--bg-subtle)', borderRadius: 4, width: '40%' }} />
              </div>
            </div>
          ))}
        </div>

        {/* Loading spinner */}
        <div className="card" style={{ padding: 32, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.04em', textTransform: 'uppercase' }}>送信中</div>
          <div style={{ width: 36, height: 36, border: '3px solid var(--bg-subtle)', borderTopColor: 'var(--primary)', borderRadius: 999, animation: 'dk-spin 0.9s linear infinite' }} />
          <div style={{ fontSize: 13, fontWeight: 500 }}>業者へ通知を送信中…</div>
          <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>通常 2〜5 秒で完了します</div>
        </div>
      </div>

      <style>{`@keyframes dk-spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  </div>
);

// ─────────────────────────────────────────────
// §J.4 コピーライティングカタログ
// ─────────────────────────────────────────────
const CopyItem = ({ k, ja, ctx, tone }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '180px 1fr 200px', gap: 14, padding: '10px 0', borderBottom: '1px dashed var(--border)', alignItems: 'flex-start' }}>
    <code style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.7, background: 'var(--bg-subtle)', padding: '2px 6px', borderRadius: 4, alignSelf: 'flex-start' }}>{k}</code>
    <div style={{ fontSize: 13, lineHeight: 1.6 }}>{ja}</div>
    <div style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>{tone && <Badge tone={tone}>{tone}</Badge>} {ctx}</div>
  </div>
);

const ScreenCopyCatalog = () => (
  <div className="app" style={{ width: '100%', height: '100%', background: 'var(--bg-subtle)', padding: '32px 40px 60px', overflow: 'auto' }}>
    <div style={{ maxWidth: 1200, margin: '0 auto' }}>
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase' }}>§J.4 · コピーライティング</div>
      <h1 style={{ margin: '4px 0 4px', fontSize: 22, fontWeight: 700 }}>マイクロコピー / エラー / 空状態</h1>
      <p style={{ margin: '0 0 24px', fontSize: 13, color: 'var(--text-secondary)' }}>i18n キー × 日本語コピー × トーン。実装時は <code style={{ fontFamily: 'var(--font-mono)', fontSize: 12 }}>i18n/ja.json</code> として書き出し。</p>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 className="sec-h">ボタン / アクション</h3>
        <CopyItem k="action.save" ja="保存" ctx="主要 CTA" />
        <CopyItem k="action.confirm" ja="確定する" ctx="不可逆操作" />
        <CopyItem k="action.cancel" ja="キャンセル" ctx="モーダル左ボタン" />
        <CopyItem k="action.back" ja="戻る" ctx="ステップウィザード" />
        <CopyItem k="action.send_notification" ja="業者へ通知を送信" ctx="C.4 Step 3 主要 CTA" />
        <CopyItem k="action.accept_request" ja="対応可と回答" ctx="D.3 業者ポータル" />
        <CopyItem k="action.decline_request" ja="対応不可" ctx="D.3 業者ポータル" />
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 className="sec-h">成功トースト</h3>
        <CopyItem k="toast.reservation.created" ja="ご予約を確定しました" ctx="顧客予約完了時" tone="success" />
        <CopyItem k="toast.vendor.notified" ja="業者へ通知を送信しました（◯◯運送 様）" ctx="C.4 確定後" tone="success" />
        <CopyItem k="toast.notification.resent" ja="通知を再送信しました" ctx="C.8 手動再送後" tone="success" />
        <CopyItem k="toast.settings.saved" ja="設定を保存しました" ctx="F.* 全般" tone="success" />
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 className="sec-h">警告・確認</h3>
        <CopyItem k="warning.lock_conflict" ja="他のスタッフが先に更新しました。最新内容を確認してから再操作してください。" ctx="B.10 楽観排他" tone="warning" />
        <CopyItem k="warning.invite_expired" ja="この依頼は既に他の業者が受注しました、または招待期限が切れています。" ctx="D.5 競合エラー" tone="warning" />
        <CopyItem k="warning.cancel_policy" ja="予約時間の 2 時間前を過ぎたキャンセルはキャンセル料が発生する場合があります。" ctx="E.4" tone="warning" />
        <CopyItem k="warning.delete_lane" ja="このレーンを削除すると、未来の予約 12 件が影響を受けます。本当に削除しますか？" ctx="F.4 削除確認" tone="warning" />
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 className="sec-h">エラーメッセージ</h3>
        <CopyItem k="error.network" ja="接続が切れています。ネットワーク接続を確認してください。" ctx="全般" tone="danger" />
        <CopyItem k="error.server" ja="サーバーエラーが発生しました。しばらくしてから再度お試しください。" ctx="全般" tone="danger" />
        <CopyItem k="error.notification_failed" ja="通知の配送に失敗しました。手動再送をお試しください。" ctx="C.8" tone="danger" />
        <CopyItem k="error.permission_denied" ja="このページへのアクセス権がありません。" ctx="C.9 etc." tone="danger" />
        <CopyItem k="error.invalid_email" ja="メールアドレスの形式が正しくありません" ctx="フォーム検証" tone="danger" />
        <CopyItem k="error.required" ja="この項目は必須です" ctx="フォーム検証" tone="danger" />
        <CopyItem k="error.code_invalid" ja="認証コードが正しくありません。もう一度ご確認ください。" ctx="E.1 Step 5" tone="danger" />
        <CopyItem k="error.code_rate_limit" ja="再送上限に達しました。1 時間後に再度お試しください。" ctx="E.5" tone="danger" />
      </div>

      <div className="card" style={{ padding: 20, marginBottom: 16 }}>
        <h3 className="sec-h">空状態</h3>
        <CopyItem k="empty.reservations" ja="本日の予約はまだありません" ctx="C.1 / C.3" />
        <CopyItem k="empty.transport_orders" ja="回送依頼はありません" ctx="C.5" />
        <CopyItem k="empty.notifications" ja="新着通知はありません" ctx="D.1" />
        <CopyItem k="empty.search" ja="該当する結果が見つかりません" ctx="検索全般" />
      </div>

      <div className="card" style={{ padding: 20 }}>
        <h3 className="sec-h">フォームヘルプテキスト</h3>
        <CopyItem k="hint.phone" ja="ハイフンなしで入力してください（例: 09012345678）" ctx="顧客予約" />
        <CopyItem k="hint.work_duration" ja="標準作業時間は作業メニュー設定から自動入力されます" ctx="C.4" />
        <CopyItem k="hint.disclaimer" ja="送信時刻と IP アドレスが記録されます" ctx="D.4 同意モーダル" />
        <CopyItem k="hint.invite_expiry" ja="この招待は 6 時間有効です。期限を過ぎると無効となります。" ctx="D.5" />
      </div>
    </div>
  </div>
);

Object.assign(window, { ScreenVendorMobile, ScreenAdminMobile, ScreenStatesGallery, ScreenCopyCatalog });
