import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { seedTransportStatuses } from "../../_helpers/seed-transport-statuses";
import { companies } from "@/lib/db/schema/companies";
import { notificationOutbox } from "@/lib/db/schema/notification_outbox";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { stores } from "@/lib/db/schema/stores";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendors } from "@/lib/db/schema/vendors";
import {
  AlreadyStoreConfirmedError,
  ConcurrentTransportOrderConfirmError,
  confirmTransportOrder,
  NotAcceptedForConfirmError,
  TransportOrderNotFoundError,
} from "@/lib/services/transport-orders";

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

function requireRow<T>(row: T | undefined, label: string): T {
  if (!row) throw new Error(`Expected ${label} row to be returned`);
  return row;
}

afterAll(async () => {
  await queryClient?.end();
});

async function withRollback(fn: (outerTx: Tx) => Promise<void>): Promise<void> {
  let originalError: unknown;

  await db!
    .transaction(async (outerTx) => {
      try {
        await fn(outerTx);
      } catch (err) {
        originalError = err;
      }

      throw new Error(ROLLBACK);
    })
    .catch((err) => {
      if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
    });

  if (originalError) throw originalError;
}

interface ConfirmFixture {
  companyId: string;
  userId: string;
  vendorId: string;
  transportOrderId: string;
  version: number;
  statusIds: Awaited<ReturnType<typeof seedTransportStatuses>>;
}

// confirmation_mode='manual' の order を 'accepted' まで進めて seed する。
//   - manual ゆえ trg_auto_confirm_on_accept (post/0029) は発火せず store_confirmed_at は NULL のまま。
//   - store_confirmed_by_user_id の composite FK (post/0021) のため同 company の user を seed する。
//   - status_id を直接 accepted に UPDATE しても version は増えない (confirmTransportOrder に渡す expectedVersion)。
async function seedAcceptedManualOrder(outerTx: Tx): Promise<ConfirmFixture> {
  const suffix = crypto.randomUUID().slice(0, 8);

  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__to_cf_${suffix}__`, code: `cf_${suffix}` })
    .returning({ id: companies.id });
  const company = requireRow(companyRow, "company");

  const [pickupStoreRow, deliveryStoreRow] = await outerTx
    .insert(stores)
    .values([
      { companyId: company.id, code: `p_${suffix}`, name: "Pickup" },
      { companyId: company.id, code: `d_${suffix}`, name: "Delivery" },
    ])
    .returning({ id: stores.id });
  const pickupStore = requireRow(pickupStoreRow, "pickup store");
  const deliveryStore = requireRow(deliveryStoreRow, "delivery store");

  const [vehicleRow] = await outerTx
    .insert(vehicles)
    .values({
      companyId: company.id,
      storeId: pickupStore.id,
      vin: `CF${suffix.toUpperCase()}000000`,
    })
    .returning({ id: vehicles.id });
  const vehicle = requireRow(vehicleRow, "vehicle");

  const [serviceTicketRow] = await outerTx
    .insert(serviceTickets)
    .values({
      companyId: company.id,
      vehicleId: vehicle.id,
      storeId: pickupStore.id,
      ticketNo: `cf-${suffix}`,
      billingStatus: "unbilled",
    })
    .returning({ id: serviceTickets.id });
  const serviceTicket = requireRow(serviceTicketRow, "service ticket");

  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: company.id, name: `Vendor ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  const vendor = requireRow(vendorRow, "vendor");

  const userResult = await outerTx.execute(sql`
    WITH auth_user AS (
      INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
      VALUES (gen_random_uuid(), 'authenticated', 'authenticated', ${`store-${suffix}@example.test`}, now(), now(), now())
      RETURNING id
    )
    INSERT INTO users (id, company_id, email, name, is_active)
    SELECT id, ${company.id}, ${`store-${suffix}@example.test`}, ${`Store User ${suffix}`}, true
    FROM auth_user
    RETURNING id
  `);
  // drizzle execute の戻り shape は driver 依存 (postgres.js: 配列直 / node-postgres: { rows })。
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [userRow] = (userResult as any).rows ?? userResult;
  const user = requireRow(userRow as { id: string } | undefined, "user");

  const statusIds = await seedTransportStatuses(outerTx, company.id);

  const [transportOrderRow] = await outerTx
    .insert(transportOrders)
    .values({
      companyId: company.id,
      vendorId: vendor.id,
      serviceTicketId: serviceTicket.id,
      vehicleId: vehicle.id,
      pickupStoreId: pickupStore.id,
      deliveryStoreId: deliveryStore.id,
      orderNumber: `TO-${crypto.randomUUID()}`,
      movementType: "one_way",
      canDrive: true,
      towRequired: false,
      confirmationMode: "manual",
      statusId: statusIds.requested,
    })
    .returning({ id: transportOrders.id });
  const transportOrder = requireRow(transportOrderRow, "transport order");

  // requested -> accepted (manual ゆえ auto-confirm trigger は発火しない)。
  await outerTx
    .update(transportOrders)
    .set({ statusId: statusIds.accepted })
    .where(eq(transportOrders.id, transportOrder.id));

  const [versionRow] = await outerTx
    .select({ version: transportOrders.version })
    .from(transportOrders)
    .where(eq(transportOrders.id, transportOrder.id));

  return {
    companyId: company.id,
    userId: user.id,
    vendorId: vendor.id,
    transportOrderId: transportOrder.id,
    version: requireRow(versionRow, "version").version,
    statusIds,
  };
}

describeIntegration("confirmTransportOrder (Phase 64-C.2 / L3-8 manual 確定)", () => {
  it("confirms an accepted manual order: sets store_confirmed_at/by, bumps version, enqueues outbox", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedAcceptedManualOrder(outerTx);

      const result = await confirmTransportOrder(outerTx, fixture.companyId, fixture.userId, {
        transportOrderId: fixture.transportOrderId,
        expectedVersion: fixture.version,
      });

      expect(result.transportOrderId).toBe(fixture.transportOrderId);
      expect(result.newVersion).toBe(fixture.version + 1);
      expect(result.storeConfirmedAt).toBeInstanceOf(Date);
      expect(result.idempotencyKey).toBe(
        `to:${fixture.transportOrderId}:store_confirmed:v${fixture.version + 1}`,
      );

      const [order] = await outerTx
        .select({
          storeConfirmedAt: transportOrders.storeConfirmedAt,
          storeConfirmedByUserId: transportOrders.storeConfirmedByUserId,
          version: transportOrders.version,
        })
        .from(transportOrders)
        .where(eq(transportOrders.id, fixture.transportOrderId));
      expect(order?.storeConfirmedAt).not.toBeNull();
      expect(order?.storeConfirmedByUserId).toBe(fixture.userId);
      expect(order?.version).toBe(fixture.version + 1);

      const outboxRows = await outerTx
        .select({
          eventType: notificationOutbox.eventType,
          idempotencyKey: notificationOutbox.idempotencyKey,
          targetType: notificationOutbox.targetType,
          targetId: notificationOutbox.targetId,
        })
        .from(notificationOutbox)
        .where(
          and(
            eq(notificationOutbox.transportOrderId, fixture.transportOrderId),
            eq(notificationOutbox.eventType, "transport_order.store_confirmed"),
          ),
        );
      expect(outboxRows).toHaveLength(1);
      expect(outboxRows[0]?.idempotencyKey).toBe(
        `to:${fixture.transportOrderId}:store_confirmed:v${fixture.version + 1}`,
      );
      // 通知先が依頼業者であること (Codex C.2 review W3)。
      expect(outboxRows[0]?.targetType).toBe("vendor");
      expect(outboxRows[0]?.targetId).toBe(fixture.vendorId);
    });
  });

  it("does not confirm an order from a different company (cross-tenant → NotFound)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedAcceptedManualOrder(outerTx);
      // 別 company B (transport status は companies INSERT trigger で auto-seed される) のスコープで
      // company A の order を確定しようとすると、order SELECT が company_id で空振りし NotFound。
      // (random UUID だと accepted status 未 seed で StatusSeedMissingError が先に出るため実 company を作る)
      const suffix = crypto.randomUUID().slice(0, 8);
      const [companyBRow] = await outerTx
        .insert(companies)
        .values({ name: `__to_cf_b_${suffix}__`, code: `cfb_${suffix}` })
        .returning({ id: companies.id });
      const companyB = requireRow(companyBRow, "company B");

      await expect(
        confirmTransportOrder(outerTx, companyB.id, fixture.userId, {
          transportOrderId: fixture.transportOrderId,
          expectedVersion: fixture.version,
        }),
      ).rejects.toBeInstanceOf(TransportOrderNotFoundError);
    });
  });

  it("throws AlreadyStoreConfirmedError on a second confirm", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedAcceptedManualOrder(outerTx);

      await confirmTransportOrder(outerTx, fixture.companyId, fixture.userId, {
        transportOrderId: fixture.transportOrderId,
        expectedVersion: fixture.version,
      });

      await expect(
        confirmTransportOrder(outerTx, fixture.companyId, fixture.userId, {
          transportOrderId: fixture.transportOrderId,
          expectedVersion: fixture.version + 1,
        }),
      ).rejects.toBeInstanceOf(AlreadyStoreConfirmedError);
    });
  });

  it("throws ConcurrentTransportOrderConfirmError on version mismatch", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedAcceptedManualOrder(outerTx);

      await expect(
        confirmTransportOrder(outerTx, fixture.companyId, fixture.userId, {
          transportOrderId: fixture.transportOrderId,
          expectedVersion: fixture.version + 99,
        }),
      ).rejects.toBeInstanceOf(ConcurrentTransportOrderConfirmError);
    });
  });

  it("throws NotAcceptedForConfirmError for a non-accepted (cancelled) order", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedAcceptedManualOrder(outerTx);
      // accepted -> cancelled は有効遷移 (seed 済)。cancelled は accepted ではないので確定不可。
      // accepted -> requested は逆走で enforce_status_transition に弾かれるため使わない。
      await outerTx
        .update(transportOrders)
        .set({ statusId: fixture.statusIds.cancelled })
        .where(eq(transportOrders.id, fixture.transportOrderId));

      await expect(
        confirmTransportOrder(outerTx, fixture.companyId, fixture.userId, {
          transportOrderId: fixture.transportOrderId,
          expectedVersion: fixture.version,
        }),
      ).rejects.toBeInstanceOf(NotAcceptedForConfirmError);
    });
  });
});
