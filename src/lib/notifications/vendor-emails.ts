// 業者通知メールのレンダリング (純関数, Phase 69 S1)。
// ---------------------------------------------------------------------------
// 監査 (phase-68 cross-cutting #15/#16): outbox-dispatcher は payload.{to,subject,html,text}
// を直読みして Resend に渡す (eventType からのテンプレート解決はしない)。しかし業者向け
// イベントはどの経路も to/subject/html を組んでおらず、業者メールが実質空で送られていた。
// 本モジュールは customer-reservation-verification.renderReservationVerificationEmail と同型に、
// enqueue 時に送信内容を確定させる純関数を提供する。
//
// セキュリティ: 動的値 (業者名/店舗名/車両/備考) は admin 入力由来のため必ず HTML エスケープする
// (悪意ある master 値による HTML/リンク注入を防ぐ)。

export const MOVEMENT_TYPE_LABELS: Readonly<Record<string, string>> = {
  one_way: "片道",
  round_trip: "往復",
  pickup_only: "引取のみ",
  three_point: "三点移動",
};

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// JST 固定表示 (実行環境 TZ に依存しない)。null/undefined はそのまま null。
export function formatDateTimeJa(date: Date | null | undefined): string | null {
  if (!date) return null;
  try {
    return new Intl.DateTimeFormat("ja-JP", {
      timeZone: "Asia/Tokyo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    }).format(date);
  } catch {
    return null;
  }
}

export type VendorRequestEmailData = {
  vendorName: string;
  orderNumber: string;
  movementType: string;
  pickupStoreName?: string | null;
  deliveryStoreName?: string | null;
  returnStoreName?: string | null;
  vehicleLabel?: string | null;
  canDrive?: boolean | null;
  requestedPickupAt?: Date | null;
  requestedDeliveryAt?: Date | null;
  requestedReturnAt?: Date | null;
  notes?: string | null;
  portalUrl: string;
};

export type RenderedEmail = {
  subject: string;
  html: string;
  text: string;
};

type Row = { label: string; value: string };

function buildRows(data: VendorRequestEmailData): Row[] {
  const rows: Row[] = [];
  rows.push({ label: "依頼番号", value: data.orderNumber });
  rows.push({
    label: "移動区分",
    value: MOVEMENT_TYPE_LABELS[data.movementType] ?? data.movementType,
  });
  if (data.pickupStoreName) rows.push({ label: "引取店舗", value: data.pickupStoreName });
  if (data.deliveryStoreName) rows.push({ label: "搬入店舗", value: data.deliveryStoreName });
  if (data.returnStoreName) rows.push({ label: "返却店舗", value: data.returnStoreName });
  if (data.vehicleLabel) rows.push({ label: "車両", value: data.vehicleLabel });
  if (data.canDrive === false) rows.push({ label: "自走", value: "不可 (レッカー要)" });
  const pickup = formatDateTimeJa(data.requestedPickupAt);
  const delivery = formatDateTimeJa(data.requestedDeliveryAt);
  const ret = formatDateTimeJa(data.requestedReturnAt);
  if (pickup) rows.push({ label: "引取希望", value: pickup });
  if (delivery) rows.push({ label: "搬入希望", value: delivery });
  if (ret) rows.push({ label: "返却希望", value: ret });
  if (data.notes) rows.push({ label: "備考", value: data.notes });
  return rows;
}

// 回送・陸送の新規依頼 (transport_order.invitation.sent) メール。
export function buildVendorRequestEmail(data: VendorRequestEmailData): RenderedEmail {
  const subject = "【段取りくん】回送・陸送のご依頼が届いています";
  const rows = buildRows(data);

  const textLines = [
    `${data.vendorName} 御中`,
    "",
    "回送・陸送のご依頼が届いています。内容をご確認のうえ、業者ポータルから対応可否をご回答ください。",
    "",
    ...rows.map((r) => `${r.label}: ${r.value}`),
    "",
    `業者ポータル: ${data.portalUrl}`,
  ];
  const text = textLines.join("\n");

  const rowsHtml = rows
    .map(
      (r) =>
        `<tr><td style="padding:6px 12px 6px 0;color:#6b7280;white-space:nowrap;vertical-align:top">${escapeHtml(
          r.label,
        )}</td><td style="padding:6px 0;color:#111827">${escapeHtml(r.value)}</td></tr>`,
    )
    .join("");

  const html =
    `<!doctype html><html lang="ja"><body style="font-family:sans-serif;line-height:1.6;color:#111827;margin:0;padding:24px;background:#f8fafc">` +
    `<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e5e7eb;border-radius:12px;padding:24px">` +
    `<p style="margin:0 0 4px">${escapeHtml(data.vendorName)} 御中</p>` +
    `<h1 style="font-size:18px;margin:0 0 16px">回送・陸送のご依頼</h1>` +
    `<p style="margin:0 0 16px">内容をご確認のうえ、業者ポータルから対応可否をご回答ください。</p>` +
    `<table style="border-collapse:collapse;font-size:14px;margin:0 0 24px">${rowsHtml}</table>` +
    `<p style="margin:0"><a href="${escapeHtml(data.portalUrl)}" style="display:inline-block;background:#2563eb;color:#ffffff;text-decoration:none;padding:10px 20px;border-radius:8px;font-weight:600">業者ポータルで確認する</a></p>` +
    `</div></body></html>`;

  return { subject, html, text };
}
