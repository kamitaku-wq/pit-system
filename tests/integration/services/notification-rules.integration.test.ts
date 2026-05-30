import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import {
  createNotificationRule,
  deleteNotificationRule,
  getNotificationRuleById,
  listNotificationRules,
  NotificationRuleConflictError,
  updateNotificationRule,
} from "@/lib/services/notification-rules";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

// Drizzle does not expose a shared transaction type for postgres-js transactions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

type Fixture = {
  companyId: string;
  otherCompanyId: string;
};

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

async function seedFixture(outerTx: Tx): Promise<Fixture> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [company, otherCompany] = await outerTx
    .insert(companies)
    .values([
      { name: `__nr_company_${suffix}__`, code: `nr_${suffix}` },
      { name: `__nr_other_${suffix}__`, code: `nr_o_${suffix}` },
    ])
    .returning({ id: companies.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
  };
}

describeIntegration("notification_rule services", () => {
  it("creates a notification_rule scoped to the admin company with default is_enabled=true", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const created = await createNotificationRule(
        {
          eventType: `transport_order.invited.${suffix}`,
          targetType: "vendor",
          channel: "email",
          timingMinutesOffset: -1440,
          retryAfterMinutes: 30,
          maxReminders: 3,
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.companyId).toBe(fixture.companyId);
      expect(created.eventType).toBe(`transport_order.invited.${suffix}`);
      expect(created.targetType).toBe("vendor");
      expect(created.channel).toBe("email");
      expect(created.isEnabled).toBe(true);
      expect(created.timingMinutesOffset).toBe(-1440);
      expect(created.retryAfterMinutes).toBe(30);
      expect(created.maxReminders).toBe(3);
    });
  });

  it("lists notification_rules only for the requested company (cross-tenant exclusion)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      await createNotificationRule(
        { eventType: `event.a.${suffix}`, targetType: "vendor", channel: "email" },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createNotificationRule(
        { eventType: `event.b.${suffix}`, targetType: "customer", channel: "portal" },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createNotificationRule(
        { eventType: `event.other.${suffix}`, targetType: "vendor", channel: "email" },
        { db: outerTx, companyId: fixture.otherCompanyId },
      );

      const result = await listNotificationRules({}, { db: outerTx, companyId: fixture.companyId });
      const eventTypes = result.rows.map((r) => r.eventType);
      expect(eventTypes).toContain(`event.a.${suffix}`);
      expect(eventTypes).toContain(`event.b.${suffix}`);
      expect(eventTypes).not.toContain(`event.other.${suffix}`);
    });
  });

  it("filters notification_rules by q (event_type ILIKE) + targetType + channel + isEnabled", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      await createNotificationRule(
        { eventType: `ticket.created.${suffix}`, targetType: "vendor", channel: "email", isEnabled: true },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createNotificationRule(
        { eventType: `ticket.canceled.${suffix}`, targetType: "vendor", channel: "portal", isEnabled: false },
        { db: outerTx, companyId: fixture.companyId },
      );
      await createNotificationRule(
        { eventType: `reservation.done.${suffix}`, targetType: "customer", channel: "email", isEnabled: true },
        { db: outerTx, companyId: fixture.companyId },
      );

      const byQ = await listNotificationRules(
        { q: "ticket" },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(byQ.rows.map((r) => r.eventType).sort()).toEqual(
        [`ticket.canceled.${suffix}`, `ticket.created.${suffix}`].sort(),
      );

      const byTarget = await listNotificationRules(
        { targetType: "customer" },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(byTarget.rows.map((r) => r.eventType)).toEqual([`reservation.done.${suffix}`]);

      const byChannel = await listNotificationRules(
        { channel: "portal" },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(byChannel.rows.map((r) => r.eventType)).toEqual([`ticket.canceled.${suffix}`]);

      const enabledOnly = await listNotificationRules(
        { isEnabled: true },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(enabledOnly.rows.find((r) => r.eventType === `ticket.canceled.${suffix}`)).toBeUndefined();
    });
  });

  it("updates a notification_rule in company scope and rejects cross-tenant update", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const created = await createNotificationRule(
        { eventType: `event.update.${suffix}`, targetType: "vendor", channel: "email" },
        { db: outerTx, companyId: fixture.companyId },
      );

      const updated = await updateNotificationRule(
        created.id,
        { isEnabled: false, channel: "portal", maxReminders: 5 },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(updated?.isEnabled).toBe(false);
      expect(updated?.channel).toBe("portal");
      expect(updated?.maxReminders).toBe(5);
      // eventType / targetType は据え置き
      expect(updated?.eventType).toBe(`event.update.${suffix}`);
      expect(updated?.targetType).toBe("vendor");

      const crossTenant = await updateNotificationRule(
        created.id,
        { isEnabled: true },
        { db: outerTx, companyId: fixture.otherCompanyId },
      );
      expect(crossTenant).toBeNull();
    });
  });

  it("rejects duplicate (company_id, event_type, target_type, channel) UNIQUE within the same company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const event = `event.unique.${suffix}`;
      await createNotificationRule(
        { eventType: event, targetType: "vendor", channel: "email" },
        { db: outerTx, companyId: fixture.companyId },
      );

      // 同じ company で同じ key の組み合わせは UNIQUE 衝突
      await expect(
        outerTx.transaction(async (savepoint: Tx) =>
          createNotificationRule(
            { eventType: event, targetType: "vendor", channel: "email" },
            { db: savepoint, companyId: fixture.companyId },
          ),
        ),
      ).rejects.toBeInstanceOf(NotificationRuleConflictError);

      // channel が違えば OK
      await expect(
        createNotificationRule(
          { eventType: event, targetType: "vendor", channel: "portal" },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).resolves.toMatchObject({ channel: "portal" });

      // 別 company であれば同じ key でも OK
      await expect(
        createNotificationRule(
          { eventType: event, targetType: "vendor", channel: "email" },
          { db: outerTx, companyId: fixture.otherCompanyId },
        ),
      ).resolves.toMatchObject({ companyId: fixture.otherCompanyId });
    });
  });

  it("hard-deletes a notification_rule, rejects cross-tenant delete, and getById returns null afterwards", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createNotificationRule(
        { eventType: "event.delete.target", targetType: "store_user", channel: "sms" },
        { db: outerTx, companyId: fixture.companyId },
      );

      // 他社 companyId では削除されない
      await expect(
        deleteNotificationRule(created.id, { db: outerTx, companyId: fixture.otherCompanyId }),
      ).resolves.toBe(false);

      // 自社 companyId であれば削除される
      await expect(
        deleteNotificationRule(created.id, { db: outerTx, companyId: fixture.companyId }),
      ).resolves.toBe(true);

      const detail = await getNotificationRuleById(created.id, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(detail).toBeNull();

      // 二回目の delete は false
      await expect(
        deleteNotificationRule(created.id, { db: outerTx, companyId: fixture.companyId }),
      ).resolves.toBe(false);
    });
  });

  it("rejects invalid Zod input (empty event_type / invalid target_type / invalid channel / negative max_reminders)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);

      await expect(
        createNotificationRule(
          { eventType: "  ", targetType: "vendor", channel: "email" },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toThrow();

      await expect(
        createNotificationRule(
          // @ts-expect-error invalid target_type
          { eventType: "ok", targetType: "invalid_target", channel: "email" },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toThrow();

      await expect(
        createNotificationRule(
          // @ts-expect-error invalid channel
          { eventType: "ok", targetType: "vendor", channel: "fax" },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toThrow();

      await expect(
        createNotificationRule(
          { eventType: "ok", targetType: "vendor", channel: "email", maxReminders: -1 },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toThrow();
    });
  });

  it("supports nullable optional fields (timing_minutes_offset / retry_after_minutes / max_reminders)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const created = await createNotificationRule(
        { eventType: `event.nullable.${suffix}`, targetType: "vendor", channel: "line" },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(created.timingMinutesOffset).toBeNull();
      expect(created.retryAfterMinutes).toBeNull();
      expect(created.maxReminders).toBeNull();

      // explicit null clear via update
      const set = await updateNotificationRule(
        created.id,
        { timingMinutesOffset: -60, retryAfterMinutes: 10, maxReminders: 2 },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(set?.timingMinutesOffset).toBe(-60);

      const cleared = await updateNotificationRule(
        created.id,
        { timingMinutesOffset: null, retryAfterMinutes: null, maxReminders: null },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(cleared?.timingMinutesOffset).toBeNull();
      expect(cleared?.retryAfterMinutes).toBeNull();
      expect(cleared?.maxReminders).toBeNull();
    });
  });
});
