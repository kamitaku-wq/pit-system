'use server';

import { headers } from 'next/headers';
import {
  getReservationDetailViaServiceRole,
  type ReservationDetail,
} from '@/lib/services/customer-reservation-detail';
import {
  loadTokenStatusViaServiceRole,
  verifyAndConsumeTokenViaServiceRole,
  type VerifyReason,
} from '@/lib/services/customer-reservation-tokens';

// Phase 64-A.23 顧客 facing skeleton (GET-safe):
// - GET render (page.tsx) は loadTokenStatusAction のみ呼ぶ (consume なし)
// - 「予約を表示」form 送信時のみ consume + 詳細取得
//   → unfurl/prefetch/email scanner で token が焼かれない (RFC 7231 GET safe 準拠)
//
// Phase 64-A.24: consume 成功後に getReservationDetailViaServiceRole で詳細 join 取得。

export type LoadTokenStatusActionResult =
  | { ok: true; reason: 'ok' }
  | { ok: false; reason: Exclude<VerifyReason, 'ok'> };

export async function loadTokenStatusAction(
  rawToken: string,
): Promise<LoadTokenStatusActionResult> {
  const status = await loadTokenStatusViaServiceRole(rawToken);
  if (!status.ok) {
    return { ok: false, reason: status.reason };
  }
  return { ok: true, reason: 'ok' };
}

export type ConfirmReservationByTokenResult =
  | {
      ok: true;
      reason: 'ok';
      detail: ReservationDetail;
    }
  | {
      ok: false;
      reason: Exclude<VerifyReason, 'ok'>;
    };

async function consumeAndLoadDetail(
  rawToken: string,
  meta: { ipAddress?: string | null; userAgent?: string | null },
): Promise<ConfirmReservationByTokenResult> {
  const verifyResult = await verifyAndConsumeTokenViaServiceRole(rawToken, {
    ipAddress: meta.ipAddress ?? null,
    userAgent: meta.userAgent ?? null,
  });

  if (!verifyResult.ok) {
    return { ok: false, reason: verifyResult.reason };
  }

  const detail = await getReservationDetailViaServiceRole(
    verifyResult.token.reservationId,
  );
  if (!detail) {
    return { ok: false, reason: 'not_found' };
  }

  return { ok: true, reason: 'ok', detail };
}

// useActionState 用の form action (Client Component から呼ぶ)。
// rawToken は form の hidden input から受ける。ip/UA は headers() で取得。
export async function confirmAndConsumeReservationFormAction(
  _prevState: ConfirmReservationByTokenResult | null,
  formData: FormData,
): Promise<ConfirmReservationByTokenResult> {
  const rawToken = formData.get('token');
  if (typeof rawToken !== 'string' || rawToken.length === 0) {
    return { ok: false, reason: 'not_found' };
  }
  const headerStore = await headers();
  const ipAddress =
    headerStore.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null;
  const userAgent = headerStore.get('user-agent') ?? null;
  return consumeAndLoadDetail(rawToken, { ipAddress, userAgent });
}
