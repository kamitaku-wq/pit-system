import { and, desc, eq, sql } from "drizzle-orm";
import type { DB } from "@/lib/db/client";
import { notificationOutbox } from "@/lib/db/schema/notification_outbox";

export interface FailedNotificationListItem {
  id: string;
  companyId: string;
  eventType: string;
  targetType: string;
  targetId: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextAttemptAt: Date;
  createdAt: Date;
  transportOrderId: string | null;
  reservationId: string | null;
  transportOrderInvitationId: string | null;
  idempotencyKey: string;
}

export async function listFailedNotifications(
  db: DB,
  companyId: string,
): Promise<FailedNotificationListItem[]> {
  return db
    .select({
      id: notificationOutbox.id,
      companyId: notificationOutbox.companyId,
      eventType: notificationOutbox.eventType,
      targetType: notificationOutbox.targetType,
      targetId: notificationOutbox.targetId,
      attempts: notificationOutbox.attempts,
      maxAttempts: notificationOutbox.maxAttempts,
      lastError: notificationOutbox.lastError,
      nextAttemptAt: notificationOutbox.nextAttemptAt,
      createdAt: notificationOutbox.createdAt,
      transportOrderId: notificationOutbox.transportOrderId,
      reservationId: notificationOutbox.reservationId,
      transportOrderInvitationId: notificationOutbox.transportOrderInvitationId,
      idempotencyKey: notificationOutbox.idempotencyKey,
    })
    .from(notificationOutbox)
    .where(and(eq(notificationOutbox.status, "failed"), eq(notificationOutbox.companyId, companyId)))
    .orderBy(desc(notificationOutbox.createdAt));
}

export async function requeueFailedNotification(
  db: DB,
  companyId: string,
  outboxId: string,
): Promise<boolean> {
  const updatedRows = await db
    .update(notificationOutbox)
    .set({
      status: "pending",
      nextAttemptAt: sql<Date>`now()`,
      processingStartedAt: null,
      attempts: 0,
      idempotencyKey: sql<string>`'re-' || gen_random_uuid()::text`,
      updatedAt: sql<Date>`now()`,
    })
    .where(
      and(
        eq(notificationOutbox.id, outboxId),
        eq(notificationOutbox.companyId, companyId),
        eq(notificationOutbox.status, "failed"),
      ),
    )
    .returning({ id: notificationOutbox.id });

  return updatedRows.length > 0;
}
