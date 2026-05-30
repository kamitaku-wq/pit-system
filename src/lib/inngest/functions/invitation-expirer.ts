import { and, inArray, isNotNull, lt } from 'drizzle-orm';
import { db as defaultDb } from '@/lib/db/client';
import { adminVendorInvitations } from '@/lib/db/schema/admin_vendor_invitations';
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

export const invitationExpirer = inngest.createFunction(
  { id: 'invitation-expirer', name: 'Invitation Expirer' },
  { cron: '0 * * * *' },
  async ({ step, logger }) => {
    const result = await step.run('expire-invitations', () => runExpireOnce());
    logger.info('invitation-expirer completed', result);
    return result;
  },
);
