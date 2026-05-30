import { config } from "dotenv";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { seedTransportStatuses } from "../../_helpers/seed-transport-statuses";
import { companies } from "@/lib/db/schema/companies";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { stores } from "@/lib/db/schema/stores";
import { transportOrderChangeLogs } from "@/lib/db/schema/transport_order_change_logs";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { users } from "@/lib/db/schema/users";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendorCompanyMemberships } from "@/lib/db/schema/vendor_company_memberships";
import { vendors } from "@/lib/db/schema/vendors";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";
const FOREIGN_KEY_VIOLATION = "23503";

type Db = NonNullable<typeof db>;
type TransactionCallback = Parameters<Db["transaction"]>[0];
type Tx = Parameters<TransactionCallback>[0];

interface Fixture {
  companyId: string;
  pickupStoreId: string;
  deliveryStoreId: string;
  vehicleId: string;
  serviceTicketId: string;
  vendorId: string;
  userId: string;
  statusIds: { requested: string; accepted: string; rejected: string; cancelled: string };
}

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

async function expectPostgresErrorCode(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action();
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
    return;
  }

  throw new Error(`Expected postgres error code ${code}`);
}

async function seedFixture(outerTx: Tx, options: { companyLabel?: string } = {}): Promise<Fixture> {
  const { companyLabel = "Company" } = options;
  const suffix = crypto.randomUUID().slice(0, 8);
  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__to_cl_${companyLabel}_${suffix}__`, code: `cl_${suffix}` })
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
      vin: `PIT${suffix.toUpperCase()}000000`,
    })
    .returning({ id: vehicles.id });
  const vehicle = requireRow(vehicleRow, "vehicle");

  const [serviceTicketRow] = await outerTx
    .insert(serviceTickets)
    .values({
      companyId: company.id,
      vehicleId: vehicle.id,
      storeId: pickupStore.id,
      ticketNo: `cl-${suffix}`,
      billingStatus: "unbilled",
    })
    .returning({ id: serviceTickets.id });
  const serviceTicket = requireRow(serviceTicketRow, "service ticket");

  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: company.id, name: `Vendor ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  const vendor = requireRow(vendorRow, "vendor");

  const userResult = await outerTx.execute(sql<{ id: string }>`
    WITH auth_user AS (
      INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        ${`user-${suffix}@example.test`},
        now(),
        now(),
        now()
      )
      RETURNING id
    )
    INSERT INTO users (id, company_id, email, name, is_active)
    SELECT id, ${company.id}, ${`user-${suffix}@example.test`}, ${`User ${suffix}`}, true
    FROM auth_user
    RETURNING id
  `);
  const [userRow] = (userResult as any).rows ?? userResult;
  const user = requireRow(userRow, "user");

  await outerTx.insert(vendorCompanyMemberships).values({
    vendorId: vendor.id,
    companyId: company.id,
    isEnabled: true,
  });

  const statusIds = await seedTransportStatuses(outerTx, company.id);

  return {
    companyId: company.id,
    pickupStoreId: pickupStore.id,
    deliveryStoreId: deliveryStore.id,
    vehicleId: vehicle.id,
    serviceTicketId: serviceTicket.id,
    vendorId: vendor.id,
    userId: user.id,
    statusIds,
  };
}

async function seedTransportOrder(outerTx: Tx, fixture: Fixture): Promise<string> {
  const [transportOrderRow] = await outerTx
    .insert(transportOrders)
    .values({
      companyId: fixture.companyId,
      vendorId: fixture.vendorId,
      serviceTicketId: fixture.serviceTicketId,
      vehicleId: fixture.vehicleId,
      pickupStoreId: fixture.pickupStoreId,
      deliveryStoreId: fixture.deliveryStoreId,
      orderNumber: `TO-${crypto.randomUUID()}`,
      movementType: "one_way",
      canDrive: true,
      towRequired: false,
      statusId: fixture.statusIds.requested,
    })
    .returning({ id: transportOrders.id });
  return requireRow(transportOrderRow, "transport order").id;
}

describeIntegration("transport_order_change_logs changed_by_user_id composite FK", () => {
  it("rejects INSERT with cross-company changed_by_user_id via composite FK", async () => {
    await withRollback(async (outerTx) => {
      const fixtureA = await seedFixture(outerTx, { companyLabel: "A" });
      const fixtureB = await seedFixture(outerTx, { companyLabel: "B" });
      const transportOrderId = await seedTransportOrder(outerTx, fixtureA);

      await expectPostgresErrorCode(
        () =>
          outerTx.insert(transportOrderChangeLogs).values({
            companyId: fixtureA.companyId,
            transportOrderId,
            changeType: "cancelled",
            changedByUserId: fixtureB.userId,
            requiresNotification: false,
          }),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  it("accepts INSERT with same-company changed_by_user_id", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);

      const [inserted] = await outerTx
        .insert(transportOrderChangeLogs)
        .values({
          companyId: fixture.companyId,
          transportOrderId,
          changeType: "cancelled",
          changedByUserId: fixture.userId,
          requiresNotification: false,
        })
        .returning({ id: transportOrderChangeLogs.id });

      const rows = await outerTx
        .select()
        .from(transportOrderChangeLogs)
        .where(eq(transportOrderChangeLogs.id, requireRow(inserted, "change log").id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.changedByUserId).toBe(fixture.userId);
    });
  });

  it("accepts INSERT with NULL changed_by_user_id (MATCH SIMPLE)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);

      await outerTx.insert(transportOrderChangeLogs).values({
        companyId: fixture.companyId,
        transportOrderId,
        changeType: "cancelled",
        changedByUserId: null,
        requiresNotification: false,
      });

      const rows = await outerTx
        .select()
        .from(transportOrderChangeLogs)
        .where(
          and(
            eq(transportOrderChangeLogs.transportOrderId, transportOrderId),
            isNull(transportOrderChangeLogs.changedByUserId),
          ),
        );
      expect(rows).toHaveLength(1);
    });
  });

  it("rejects user hard delete referenced by change_log (ON DELETE NO ACTION = RESTRICT)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);

      await outerTx.insert(transportOrderChangeLogs).values({
        companyId: fixture.companyId,
        transportOrderId,
        changeType: "cancelled",
        changedByUserId: fixture.userId,
        requiresNotification: false,
      });

      await expectPostgresErrorCode(
        () => outerTx.delete(users).where(eq(users.id, fixture.userId)),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });
});
