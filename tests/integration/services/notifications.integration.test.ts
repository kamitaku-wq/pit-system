import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import type { DB } from "@/lib/db/client";
import { companies } from "@/lib/db/schema/companies";
import { notificationOutbox } from "@/lib/db/schema/notification_outbox";
import {
  listFailedNotifications,
  requeueFailedNotification,
} from "@/lib/services/notifications";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

type Db = NonNullable<typeof db>;
type TransactionCallback = Parameters<Db["transaction"]>[0];
type Tx = Parameters<TransactionCallback>[0];

interface CompanyFixture {
  companyId: string;
}

function requireRow<T>(row: T | undefined, label: string): T {
  if (!row) throw new Error(`Expected ${label} row to be returned`);
  return row;
}

afterAll(async () => {
  await queryClient?.end();
});

async function withRollback(fn: (outerTx: Tx) => Promise<void>): Promise<void> {
  await db!
    .transaction(async (outerTx) => {
      try {
        await fn(outerTx);
      } finally {
        throw new Error(ROLLBACK);
      }
    })
    .catch((err) => {
      if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
    });
}

async function seedBaseFixture(
  outerTx: Tx,
  options: { companyLabel?: string } = {},
): Promise<CompanyFixture> {
  const { companyLabel = "Company" } = options;
  const suffix = crypto.randomUUID().slice(0, 8);
  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__to_${companyLabel}_${suffix}__`, code: `to_${suffix}` })
    .returning({ id: companies.id });
  const company = requireRow(companyRow, "company");

  return { companyId: company.id };
}

function serviceDb(outerTx: Tx): DB {
  return outerTx as unknown as DB;
}

describeIntegration("notifications service", () => {
  it("lists failed notifications only for the requested company ordered newest first", async () => {
    await withRollback(async (outerTx) => {
      const companyA = await seedBaseFixture(outerTx, { companyLabel: "A" });
      const companyB = await seedBaseFixture(outerTx, { companyLabel: "B" });
      const olderCreatedAt = new Date("2026-01-01T00:00:00.000Z");
      const newerCreatedAt = new Date("2026-01-02T00:00:00.000Z");

      const [companyAFailedOlderRow] = await outerTx
        .insert(notificationOutbox)
        .values({
          companyId: companyA.companyId,
          idempotencyKey: `test-key-${crypto.randomUUID()}`,
          eventType: "transport_order_invitation_created",
          targetType: "vendor",
          targetId: crypto.randomUUID(),
          payload: {},
          status: "failed",
          attempts: 2,
          maxAttempts: 5,
          lastError: "SMTP timeout",
          createdAt: olderCreatedAt,
        })
        .returning({ id: notificationOutbox.id });
      const companyAFailedOlder = requireRow(companyAFailedOlderRow, "company A older failed");
      const [companyAFailedNewerRow] = await outerTx
        .insert(notificationOutbox)
        .values({
          companyId: companyA.companyId,
          idempotencyKey: `test-key-${crypto.randomUUID()}`,
          eventType: "transport_order_invitation_created",
          targetType: "vendor",
          targetId: crypto.randomUUID(),
          payload: {},
          status: "failed",
          attempts: 3,
          maxAttempts: 5,
          lastError: "SMTP timeout",
          createdAt: newerCreatedAt,
        })
        .returning({ id: notificationOutbox.id });
      const companyAFailedNewer = requireRow(companyAFailedNewerRow, "company A newer failed");
      const [companyBFailedRow] = await outerTx
        .insert(notificationOutbox)
        .values({
          companyId: companyB.companyId,
          idempotencyKey: `test-key-${crypto.randomUUID()}`,
          eventType: "transport_order_invitation_created",
          targetType: "vendor",
          targetId: crypto.randomUUID(),
          payload: {},
          status: "failed",
          attempts: 4,
          maxAttempts: 5,
          lastError: "SMTP timeout",
        })
        .returning({ id: notificationOutbox.id });
      const companyBFailed = requireRow(companyBFailedRow, "company B failed");
      const [companyAPendingRow] = await outerTx
        .insert(notificationOutbox)
        .values({
          companyId: companyA.companyId,
          idempotencyKey: `test-key-${crypto.randomUUID()}`,
          eventType: "transport_order_invitation_created",
          targetType: "vendor",
          targetId: crypto.randomUUID(),
          payload: {},
          status: "pending",
          attempts: 0,
          maxAttempts: 5,
        })
        .returning({ id: notificationOutbox.id });
      const companyAPending = requireRow(companyAPendingRow, "company A pending");

      const rows = await listFailedNotifications(serviceDb(outerTx), companyA.companyId);
      const rowIds = rows.map((row) => row.id);

      expect(rows).toHaveLength(2);
      expect(rowIds).toEqual([companyAFailedNewer.id, companyAFailedOlder.id]);
      expect(rowIds).not.toContain(companyBFailed.id);
      expect(rowIds).not.toContain(companyAPending.id);
    });
  });

  it("requeues a failed notification while preserving lastError", async () => {
    await withRollback(async (outerTx) => {
      const companyA = await seedBaseFixture(outerTx, { companyLabel: "A" });
      const [outboxRow] = await outerTx
        .insert(notificationOutbox)
        .values({
          companyId: companyA.companyId,
          idempotencyKey: "orig-key-xxx",
          eventType: "transport_order_invitation_created",
          targetType: "vendor",
          targetId: crypto.randomUUID(),
          payload: {},
          status: "failed",
          attempts: 5,
          maxAttempts: 5,
          lastError: "SMTP timeout",
          processingStartedAt: new Date("2026-01-01T00:00:00.000Z"),
          nextAttemptAt: new Date("2026-01-01T00:00:00.000Z"),
        })
        .returning({ id: notificationOutbox.id });
      const outbox = requireRow(outboxRow, "notification outbox");

      const beforeRequeue = new Date(Date.now() - 1_000);
      const result = await requeueFailedNotification(
        serviceDb(outerTx),
        companyA.companyId,
        outbox.id,
      );
      const afterRequeue = new Date(Date.now() + 5_000);
      const [refetched] = await outerTx
        .select()
        .from(notificationOutbox)
        .where(eq(notificationOutbox.id, outbox.id))
        .limit(1);

      expect(result).toBe(true);
      expect(refetched).toBeDefined();
      if (!refetched) throw new Error("Expected notification outbox row to exist");
      expect(refetched.status).toBe("pending");
      expect(refetched.attempts).toBe(0);
      expect(refetched.processingStartedAt).toBeNull();
      expect(refetched.nextAttemptAt.getTime()).toBeGreaterThanOrEqual(beforeRequeue.getTime());
      expect(refetched.nextAttemptAt.getTime()).toBeLessThanOrEqual(afterRequeue.getTime());
      expect(refetched.idempotencyKey).toMatch(/^re-/);
      expect(refetched.idempotencyKey).not.toBe("orig-key-xxx");
      expect(refetched.lastError).toBe("SMTP timeout");
    });
  });

  it("rejects cross-tenant and missing notification requeue requests", async () => {
    await withRollback(async (outerTx) => {
      const companyA = await seedBaseFixture(outerTx, { companyLabel: "A" });
      const companyB = await seedBaseFixture(outerTx, { companyLabel: "B" });
      const [outboxRow] = await outerTx
        .insert(notificationOutbox)
        .values({
          companyId: companyA.companyId,
          idempotencyKey: `test-key-${crypto.randomUUID()}`,
          eventType: "transport_order_invitation_created",
          targetType: "vendor",
          targetId: crypto.randomUUID(),
          payload: {},
          status: "failed",
          attempts: 5,
          maxAttempts: 5,
          lastError: "SMTP timeout",
        })
        .returning({ id: notificationOutbox.id });
      const outbox = requireRow(outboxRow, "notification outbox");

      const crossTenantResult = await requeueFailedNotification(
        serviceDb(outerTx),
        companyB.companyId,
        outbox.id,
      );
      const [refetched] = await outerTx
        .select()
        .from(notificationOutbox)
        .where(eq(notificationOutbox.id, outbox.id))
        .limit(1);
      const missingResult = await requeueFailedNotification(
        serviceDb(outerTx),
        companyA.companyId,
        crypto.randomUUID(),
      );

      expect(crossTenantResult).toBe(false);
      expect(refetched).toBeDefined();
      if (!refetched) throw new Error("Expected notification outbox row to exist");
      expect(refetched.status).toBe("failed");
      expect(missingResult).toBe(false);
    });
  });
});
