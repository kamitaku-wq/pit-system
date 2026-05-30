import { and, inArray, isNotNull, lt } from 'drizzle-orm';
import { db as defaultDb } from '@/lib/db/client';
import { adminVendorInvitations } from '@/lib/db/schema/admin_vendor_invitations';
import { transportOrderInvitations } from '@/lib/db/schema/transport_order_invitations';
import { inngest } from '@/lib/inngest/instance';

export type ExpireResult = { expired: number };

export async function runExpireOnce(database: typeof defaultDb = defaultDb): Promise<ExpireResult> {
  const now = new Date();
  const rows = await database
    .update(adminVendorInvitations)
    .set({ status: 'expired', updatedAt: now })
    .where(
      and(
        isNotNull(adminVendorInvitations.expiresAt),
        lt(adminVendorInvitations.expiresAt, now),
        inArray(adminVendorInvitations.status, ['pending', 'sent']),
      ),
    )
    .returning({ id: adminVendorInvitations.id });
  return { expired: rows.length };
}

// Phase 69 S0c (phase-68 監査 #18): transport_order_invitations の expires_at 超過行を expired 化。
// scope: invitation の response を pending→expired にするのみ。transport order の status 遷移や
// 次候補フォールバック (resolicit) への波及は別 phase の product 判断 (本処理では行わない)。
export async function runExpireTransportInvitationsOnce(
  database: typeof defaultDb = defaultDb,
): Promise<ExpireResult> {
  const now = new Date();
  const rows = await database
    .update(transportOrderInvitations)
    .set({ response: 'expired', updatedAt: now })
    .where(
      and(
        isNotNull(transportOrderInvitations.expiresAt),
        lt(transportOrderInvitations.expiresAt, now),
        inArray(transportOrderInvitations.response, ['pending']),
      ),
    )
    .returning({ id: transportOrderInvitations.id });
  return { expired: rows.length };
}

export const invitationExpirer = inngest.createFunction(
  { id: 'invitation-expirer', name: 'Invitation Expirer' },
  { cron: '0 * * * *' },
  async ({ step, logger }) => {
    const adminResult = await step.run('expire-admin-invitations', () => runExpireOnce());
    const transportResult = await step.run('expire-transport-invitations', () =>
      runExpireTransportInvitationsOnce(),
    );
    const result = {
      adminExpired: adminResult.expired,
      transportExpired: transportResult.expired,
    };
    logger.info('invitation-expirer completed', result);
    return result;
  },
);
