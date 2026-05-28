'use server';

import { eq } from 'drizzle-orm';
import { headers } from 'next/headers';
import { db } from '@/lib/db/client';
import { reservations } from '@/lib/db/schema/reservations';
import {
  loadTokenStatusViaServiceRole,
  verifyAndConsumeTokenViaServiceRole,
  type VerifyReason,
} from '@/lib/services/customer-reservation-tokens';

// Phase 64-A.23 顧客 facing skeleton:
// - GET render (page.tsx) は loadTokenStatusAction のみ呼ぶ (consume なし)
// - 「予約を表示」form 送信時のみ confirmAndConsumeReservationAction が consume + 監査
//   → unfurl/prefetch/email scanner で token が焼かれない (RFC 7231 GET safe 準拠)

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
      reservation: {
        id: string;
        companyId: string;
        startAt: Date;
        endAt: Date;
        statusId: string | null;
      };
    }
  | {
      ok: false;
      reason: Exclude<VerifyReason, 'ok'>;
    };

async function consumeAndLoadReservation(
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

  const reservationId = verifyResult.token.reservationId;
  const rows = await db
    .select({
      id: reservations.id,
      companyId: reservations.companyId,
      startAt: reservations.startAt,
      endAt: reservations.endAt,
      statusId: reservations.statusId,
    })
    .from(reservations)
    .where(eq(reservations.id, reservationId))
    .limit(1);

  const row = rows[0];
  if (!row) {
    return { ok: false, reason: 'not_found' };
  }

  return {
    ok: true,
    reason: 'ok',
    reservation: {
      id: row.id,
      companyId: row.companyId,
      startAt: row.startAt,
      endAt: row.endAt,
      statusId: row.statusId,
    },
  };
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
  return consumeAndLoadReservation(rawToken, { ipAddress, userAgent });
}
