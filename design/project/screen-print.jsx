/* global React, Icon */
// 段取りくん — Print layouts (§G) — A4 PDF mockups

// A4 portrait shell: 595 x 842 points scaled to fit artboard
const A4Portrait = ({ children, label }) => (
  <div style={{ width: '100%', height: '100%', background: '#E5E5E5', padding: 24, overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
    <div style={{
      width: 595, minHeight: 842, background: '#fff',
      boxShadow: '0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
      padding: '40px 44px 60px', display: 'flex', flexDirection: 'column', fontSize: 11,
      fontFamily: "'Noto Sans JP', sans-serif", color: '#0F172A', position: 'relative',
    }}>
      {label && <div style={{ position: 'absolute', top: -22, left: 4, fontSize: 10, color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>{label}</div>}
      {children}
    </div>
  </div>
);

const A4Landscape = ({ children, label }) => (
  <div style={{ width: '100%', height: '100%', background: '#E5E5E5', padding: 24, overflow: 'auto', display: 'flex', justifyContent: 'center' }}>
    <div style={{
      width: 842, minHeight: 595, background: '#fff',
      boxShadow: '0 4px 24px rgba(0,0,0,0.12), 0 0 0 1px rgba(0,0,0,0.04)',
      padding: '36px 48px 48px', display: 'flex', flexDirection: 'column', fontSize: 12,
      fontFamily: "'Noto Sans JP', sans-serif", color: '#0F172A', position: 'relative',
    }}>
      {label && <div style={{ position: 'absolute', top: -22, left: 4, fontSize: 10, color: '#94A3B8', fontFamily: 'var(--font-mono)' }}>{label}</div>}
      {children}
    </div>
  </div>
);

const PrintHeader = ({ company, doc, num, sub }) => (
  <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14, borderBottom: '2px solid #0F172A', marginBottom: 16 }}>
    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
      <div style={{ width: 32, height: 32, borderRadius: 6, background: '#1E3A8A', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 16, fontFamily: 'var(--font-inter)' }}>段</div>
      <div>
        <div style={{ fontSize: 13, fontWeight: 700 }}>{company}</div>
        <div style={{ fontSize: 9, color: '#94A3B8' }}>powered by 段取りくん</div>
      </div>
    </div>
    <div style={{ textAlign: 'right' }}>
      <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, letterSpacing: '0.04em' }}>{doc}</h1>
      <div style={{ marginTop: 2, fontSize: 11 }}><span style={{ color: '#94A3B8' }}>No.</span> <span className="tabular" style={{ fontWeight: 600 }}>{num}</span></div>
      {sub && <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>{sub}</div>}
    </div>
  </header>
);

const PrintSection = ({ title, children }) => (
  <section style={{ marginBottom: 14 }}>
    <h3 style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 700, color: '#475569', letterSpacing: '0.08em', textTransform: 'uppercase', borderBottom: '1px solid #CBD5E1', paddingBottom: 4 }}>{title}</h3>
    {children}
  </section>
);

const KvRow = ({ k, v, mono }) => (
  <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', padding: '4px 0', fontSize: 11, borderBottom: '1px dotted #E2E8F0' }}>
    <span style={{ color: '#94A3B8' }}>{k}</span>
    <span className={mono ? 'tabular' : ''} style={{ fontWeight: 500 }}>{v}</span>
  </div>
);

const PrintFooter = ({ doc, pages }) => (
  <footer style={{ marginTop: 'auto', paddingTop: 12, borderTop: '1px solid #E2E8F0', display: 'flex', justifyContent: 'space-between', fontSize: 9, color: '#94A3B8' }}>
    <span>{doc} · 印刷日時 <span className="tabular">2026/05/22 14:02</span></span>
    <span className="tabular">{pages}</span>
  </footer>
);

// ─────────────────────────────────────────────
// G.1 整備伝票 PDF
// ─────────────────────────────────────────────
const PrintServiceTicket = () => (
  <A4Portrait label="A4 縦 · 整備伝票">
    <PrintHeader company="◯◯モータース 渋谷店" doc="整備伝票" num="SV-2026-0089" sub="2026/05/22 受付" />

    <PrintSection title="顧客情報">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <KvRow k="お客様名" v="田中 太郎 様" />
          <KvRow k="電話" v="090-xxxx-1234" mono />
          <KvRow k="メール" v="t****@example.com" mono />
        </div>
        <div>
          <KvRow k="住所" v="〒150-XXXX 東京都渋谷区..." />
          <KvRow k="顧客 ID" v="C-001234" mono />
          <KvRow k="本人確認" v="✓ 完了 (2026/05/22 09:42)" />
        </div>
      </div>
    </PrintSection>

    <PrintSection title="車両情報">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <KvRow k="車種" v="トヨタ アルファード" />
          <KvRow k="年式" v="2020 年" mono />
          <KvRow k="走行距離" v="42,108 km" mono />
        </div>
        <div>
          <KvRow k="ナンバー" v="品川 300 あ 1234" mono />
          <KvRow k="車台番号" v="ABCD-12-3456789" mono />
          <KvRow k="管理番号" v="V-001234" mono />
        </div>
      </div>
    </PrintSection>

    <PrintSection title="作業内容">
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
        <thead>
          <tr style={{ background: '#F8FAFC' }}>
            <th style={{ padding: '6px 8px', textAlign: 'left', borderBottom: '1px solid #CBD5E1', fontWeight: 600 }}>作業項目</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #CBD5E1', fontWeight: 600, width: 70 }}>想定時間</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #CBD5E1', fontWeight: 600, width: 70 }}>実績</th>
            <th style={{ padding: '6px 8px', textAlign: 'right', borderBottom: '1px solid #CBD5E1', fontWeight: 600, width: 90 }}>金額 (税込)</th>
          </tr>
        </thead>
        <tbody>
          {[
            ['車検整備一式', '90分', '92分', '¥48,400'],
            ['ブレーキパッド前後交換', '30分', '32分', '¥18,800'],
            ['エンジンオイル交換 (5W-30 4L)', '15分', '14分', '¥4,800'],
            ['法定 24 ヶ月点検料金', '—', '—', '¥12,000'],
            ['印紙代・諸費用', '—', '—', '¥1,800'],
          ].map((r, i) => (
            <tr key={i}>
              {r.map((c, j) => (
                <td key={j} className={j > 0 ? 'tabular' : ''} style={{ padding: '6px 8px', borderBottom: '1px solid #F1F5F9', textAlign: j === 0 ? 'left' : 'right' }}>{c}</td>
              ))}
            </tr>
          ))}
          <tr>
            <td colSpan="3" className="tabular" style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, borderTop: '2px solid #0F172A' }}>合計</td>
            <td className="tabular" style={{ padding: '8px 8px', textAlign: 'right', fontWeight: 700, borderTop: '2px solid #0F172A', fontSize: 13 }}>¥85,800</td>
          </tr>
        </tbody>
      </table>
    </PrintSection>

    <PrintSection title="ステータス履歴">
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
        {[
          ['予約受付', '05/22 09:42'], ['作業開始', '05/22 10:05'], ['作業完了', '05/22 11:38'], ['お引渡し', '— '],
        ].map(([s, t], i) => (
          <div key={i} style={{ padding: '8px 10px', background: i < 3 ? '#D1FAE5' : '#F1F5F9', border: `1px solid ${i < 3 ? '#10B981' : '#CBD5E1'}`, borderRadius: 4 }}>
            <div style={{ fontSize: 9, color: i < 3 ? '#065F46' : '#94A3B8', fontWeight: 600 }}>{s}</div>
            <div className="tabular" style={{ fontSize: 11, fontWeight: 600, marginTop: 2 }}>{t}</div>
          </div>
        ))}
      </div>
    </PrintSection>

    <PrintSection title="担当者・お客様署名">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 4 }}>
        <div>
          <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 2 }}>担当整備士</div>
          <div style={{ height: 50, borderBottom: '1px solid #CBD5E1', display: 'flex', alignItems: 'flex-end', paddingBottom: 4 }}>佐藤 拓 <span style={{ marginLeft: 8, fontSize: 9, color: '#94A3B8' }}>(整備士証 第◯◯号)</span></div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 2 }}>お客様サイン</div>
          <div style={{ height: 50, borderBottom: '1px solid #CBD5E1' }} />
        </div>
      </div>
    </PrintSection>

    <PrintFooter doc="整備伝票 SV-2026-0089" pages="1 / 1" />
  </A4Portrait>
);

// ─────────────────────────────────────────────
// G.2 回送依頼書 PDF
// ─────────────────────────────────────────────
const PrintTransportOrder = () => (
  <A4Portrait label="A4 縦 · 回送依頼書">
    <PrintHeader company="◯◯モータース 渋谷店" doc="回送依頼書" num="TY-2026-0142" sub="○○運送 御中" />

    <div style={{ padding: '10px 14px', background: '#DBEAFE', border: '1px solid #BFDBFE', borderRadius: 6, fontSize: 11, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
      <Icon name="Truck" size={16} style={{ color: '#1E3A8A', flexShrink: 0 }} />
      <span style={{ fontWeight: 600 }}>片道移動（引取 → 搬入）· 渋谷店 → 横浜整備工場</span>
    </div>

    <PrintSection title="引取">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <KvRow k="店舗" v="渋谷店" />
          <KvRow k="住所" v="〒150-XXXX 東京都渋谷区道玄坂 1-X-X" />
          <KvRow k="希望日時" v="2026/05/23 (土) 09:30" mono />
          <KvRow k="担当者" v="田中 太郎" />
          <KvRow k="連絡先" v="03-xxxx-xxxx" mono />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 8, background: '#F8FAFC', borderRadius: 4 }}>
          <div style={{ width: 90, height: 90, background: 'repeating-conic-gradient(#0F172A 0deg 90deg, #fff 90deg 180deg)', backgroundSize: '8px 8px' }} />
          <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 4 }}>地図 QR (Google Maps)</div>
        </div>
      </div>
    </PrintSection>

    <PrintSection title="搬入">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <KvRow k="店舗" v="横浜整備工場" />
          <KvRow k="住所" v="〒220-XXXX 神奈川県横浜市西区みなとみらい X-X" />
          <KvRow k="希望日時" v="2026/05/23 (土) 10:30" mono />
          <KvRow k="受領者" v="整備課 鈴木" />
          <KvRow k="連絡先" v="045-xxxx-xxxx" mono />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 8, background: '#F8FAFC', borderRadius: 4 }}>
          <div style={{ width: 90, height: 90, background: 'repeating-conic-gradient(#0F172A 0deg 90deg, #fff 90deg 180deg)', backgroundSize: '7px 7px' }} />
          <div style={{ fontSize: 9, color: '#94A3B8', marginTop: 4 }}>地図 QR (Google Maps)</div>
        </div>
      </div>
    </PrintSection>

    <PrintSection title="車両情報">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div>
          <KvRow k="車種" v="トヨタ アルファード 2020 年式" />
          <KvRow k="ナンバー" v="品川 300 あ 1234" mono />
          <KvRow k="車台番号" v="ABCD-12-3456789" mono />
        </div>
        <div>
          <KvRow k="走行可否" v="✓ 自走可" />
          <div style={{ display: 'grid', gridTemplateColumns: '90px 1fr', padding: '4px 0', fontSize: 11, borderBottom: '1px dotted #E2E8F0' }}>
            <span style={{ color: '#94A3B8' }}>レッカー</span>
            <span style={{ fontWeight: 500, color: '#EF4444' }}>不要</span>
          </div>
          <KvRow k="キー" v="店舗受付にて KEY-0142 を受領" />
        </div>
      </div>
    </PrintSection>

    <PrintSection title="注意事項">
      <ul style={{ margin: '4px 0 0 18px', padding: 0, fontSize: 11, lineHeight: 1.7 }}>
        <li>チャイルドシート搭載済み、後部座席に荷物あり（要シート保護）</li>
        <li>雨天時はボディカバー必須（店舗にて貸与可）</li>
        <li>引取時に車両キズチェックシートのご記入をお願いします</li>
      </ul>
    </PrintSection>

    <PrintSection title="緊急連絡先">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
        <div style={{ padding: '8px 10px', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 4 }}>
          <div style={{ fontSize: 9, color: '#991B1B', fontWeight: 600 }}>店舗担当 (24h)</div>
          <div className="tabular" style={{ fontSize: 14, fontWeight: 700, color: '#991B1B' }}>03-xxxx-xxxx</div>
        </div>
        <div style={{ padding: '8px 10px', background: '#FEE2E2', border: '1px solid #FCA5A5', borderRadius: 4 }}>
          <div style={{ fontSize: 9, color: '#991B1B', fontWeight: 600 }}>本部統括 (緊急時のみ)</div>
          <div className="tabular" style={{ fontSize: 14, fontWeight: 700, color: '#991B1B' }}>0120-xxx-xxx</div>
        </div>
      </div>
    </PrintSection>

    <PrintSection title="承諾サイン">
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 14 }}>
        {['業者担当者名', '対応日', '署名 / 押印'].map(l => (
          <div key={l}>
            <div style={{ fontSize: 10, color: '#94A3B8', marginBottom: 2 }}>{l}</div>
            <div style={{ height: 48, borderBottom: '1px solid #CBD5E1' }} />
          </div>
        ))}
      </div>
    </PrintSection>

    {/* Disclaimer */}
    <div style={{ marginTop: 'auto', paddingTop: 10, fontSize: 8.5, color: '#475569', lineHeight: 1.6, borderTop: '1px solid #E2E8F0' }}>
      <strong>責任分界・免責文言：</strong>本回送依頼に基づく業務は、別途締結の業務委託契約書に従って実施されます。引取時刻から搬入完了までの車両の保管・運行責任は受託業者（○○運送）に帰属します。事故・故障・遅延の責任分担、保険適用範囲については業務委託契約書 第 5 条〜第 8 条を参照してください。
      <span style={{ color: '#94A3B8' }}> [companies.transport_disclaimer_text v3 / 2026-04-01 改訂]</span>
    </div>

    <PrintFooter doc="回送依頼書 TY-2026-0142" pages="1 / 1" />
  </A4Portrait>
);

// ─────────────────────────────────────────────
// G.3 店間移動指示書 PDF (ドライバー向け・A4 横)
// ─────────────────────────────────────────────
const PrintDriverInstruction = () => (
  <A4Landscape label="A4 横 · 店間移動指示書 (ドライバー向け)">
    <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 14, borderBottom: '3px solid #1E3A8A', marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 40, height: 40, borderRadius: 8, background: '#1E3A8A', color: '#fff', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: 18, fontFamily: 'var(--font-inter)' }}>段</div>
        <div>
          <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>店間移動指示書</div>
          <h1 className="tabular" style={{ margin: 0, fontSize: 28, fontWeight: 700, letterSpacing: '-0.01em' }}>TY-2026-0142</h1>
        </div>
      </div>
      <div style={{ textAlign: 'right' }}>
        <div style={{ fontSize: 11, color: '#94A3B8', fontWeight: 600 }}>業者</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>○○運送 御中</div>
        <div style={{ fontSize: 10, color: '#475569', marginTop: 2 }}>担当: 山田 次郎</div>
      </div>
    </header>

    {/* Big route */}
    <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', alignItems: 'stretch', gap: 16, marginBottom: 18 }}>
      <div style={{ padding: '18px 22px', background: '#F0FDF4', border: '2px solid #10B981', borderRadius: 8 }}>
        <div style={{ fontSize: 11, color: '#065F46', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>① 引取</div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>渋谷店</div>
        <div className="tabular" style={{ fontSize: 26, fontWeight: 700, color: '#1E3A8A', marginTop: 4 }}>09:30</div>
        <div style={{ fontSize: 11, color: '#475569', marginTop: 6, lineHeight: 1.5 }}>〒150-XXXX 東京都渋谷区道玄坂 1-X-X<br />担当: 田中 太郎</div>
        <div className="tabular" style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginTop: 6 }}>📞 03-xxxx-xxxx</div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '0 8px' }}>
        <Icon name="ArrowRight" size={36} style={{ color: '#94A3B8' }} />
        <div className="tabular" style={{ fontSize: 13, fontWeight: 600, marginTop: 6 }}>約 40 km</div>
        <div className="tabular" style={{ fontSize: 11, color: '#475569' }}>≒ 60 分</div>
      </div>
      <div style={{ padding: '18px 22px', background: '#FEF2F2', border: '2px solid #EF4444', borderRadius: 8 }}>
        <div style={{ fontSize: 11, color: '#991B1B', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>② 搬入</div>
        <div style={{ fontSize: 22, fontWeight: 700 }}>横浜整備工場</div>
        <div className="tabular" style={{ fontSize: 26, fontWeight: 700, color: '#1E3A8A', marginTop: 4 }}>10:30</div>
        <div style={{ fontSize: 11, color: '#475569', marginTop: 6, lineHeight: 1.5 }}>〒220-XXXX 神奈川県横浜市西区みなとみらい X-X<br />受領: 整備課 鈴木</div>
        <div className="tabular" style={{ fontSize: 16, fontWeight: 700, color: '#0F172A', marginTop: 6 }}>📞 045-xxxx-xxxx</div>
      </div>
    </div>

    {/* Vehicle big */}
    <div style={{ padding: '14px 18px', background: '#F8FAFC', border: '1.5px solid #CBD5E1', borderRadius: 8, display: 'grid', gridTemplateColumns: '1.5fr 1fr 1fr 1fr', gap: 16, marginBottom: 16 }}>
      <div>
        <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>車両</div>
        <div style={{ fontSize: 16, fontWeight: 700 }}>トヨタ アルファード</div>
        <div className="tabular" style={{ fontSize: 12, color: '#475569', marginTop: 2 }}>2020 年式 · 白</div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>ナンバー</div>
        <div className="tabular" style={{ fontSize: 18, fontWeight: 700 }}>品川 300 あ 1234</div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>走行可否</div>
        <div style={{ fontSize: 16, fontWeight: 700, color: '#065F46' }}>✓ 自走可</div>
        <div style={{ fontSize: 11, color: '#94A3B8' }}>レッカー不要</div>
      </div>
      <div>
        <div style={{ fontSize: 10, color: '#94A3B8', fontWeight: 600 }}>キー</div>
        <div className="tabular" style={{ fontSize: 16, fontWeight: 700 }}>KEY-0142</div>
        <div style={{ fontSize: 10, color: '#94A3B8' }}>店舗受付にて受領</div>
      </div>
    </div>

    {/* Notes + emergency */}
    <div style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 14 }}>
      <div style={{ padding: '10px 14px', border: '1px solid #CBD5E1', borderRadius: 6 }}>
        <div style={{ fontSize: 10, color: '#475569', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>注意事項</div>
        <ul style={{ margin: '0 0 0 16px', padding: 0, fontSize: 11, lineHeight: 1.7 }}>
          <li>チャイルドシート搭載済み、後部座席に荷物あり（要シート保護）</li>
          <li>雨天時はボディカバー必須（店舗にて貸与可）</li>
          <li>引取・搬入時に車両キズチェックシート記入</li>
        </ul>
      </div>
      <div style={{ padding: '10px 14px', background: '#FEE2E2', border: '1.5px solid #EF4444', borderRadius: 6 }}>
        <div style={{ fontSize: 10, color: '#991B1B', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>緊急連絡先 (24h)</div>
        <div className="tabular" style={{ fontSize: 18, fontWeight: 700, color: '#991B1B' }}>03-xxxx-xxxx</div>
        <div style={{ fontSize: 10, color: '#7F1D1D' }}>◯◯モータース 渋谷店 統括</div>
      </div>
    </div>

    <PrintFooter doc="店間移動指示書 TY-2026-0142" pages="1 / 1" />
  </A4Landscape>
);

Object.assign(window, { PrintServiceTicket, PrintTransportOrder, PrintDriverInstruction });
