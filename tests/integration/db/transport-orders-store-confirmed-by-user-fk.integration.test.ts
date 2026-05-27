import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { seedTransportStatuses } from "../../_helpers/seed-transport-statuses";
import { companies } from "@/lib/db/schema/companies";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { stores } from "@/lib/db/schema/stores";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { users } from "@/lib/db/schema/users";
import { vehicles } from "@/lib/db/schema/vehicles";
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
    .values({ name: `__to_scbu_${companyLabel}_${suffix}__`, code: `scbu_${suffix}` })
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
      vin: `SC${suffix.toUpperCase()}000000`,
    })
    .returning({ id: vehicles.id });
  const vehicle = requireRow(vehicleRow, "vehicle");

  const [serviceTicketRow] = await outerTx
    .insert(serviceTickets)
    .values({
      companyId: company.id,
      vehicleId: vehicle.id,
      storeId: pickupStore.id,
      ticketNo: `sc-${suffix}`,
      billingStatus: "unbilled",
    })
    .returning({ id: serviceTickets.id });
  const serviceTicket = requireRow(serviceTicketRow, "service ticket");

  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: company.id, name: `Vendor ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  const vendor = requireRow(vendorRow, "vendor");

  // 1-statement CTE pattern (Phase 60 established).
  // auth.users -> public.users in a single statement to avoid two-statement race.
  const userEmail = `user-scbu-${suffix}@example.test`;
  const userName = `User ${suffix}`;
  const userResult = await outerTx.execute(sql<{ id: string }>`
    WITH auth_user AS (
      INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
      VALUES (
        gen_random_uuid(),
        'authenticated',
        'authenticated',
        ${userEmail},
        now(),
        now(),
        now()
      )
      RETURNING id
    )
    INSERT INTO users (id, company_id, email, name, is_active)
    SELECT id, ${company.id}, ${userEmail}, ${userName}, true
    FROM auth_user
    RETURNING id
  `);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [userRow] = (userResult as any).rows ?? userResult;
  const user = requireRow(userRow, "user");

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
      orderNumber: `TO-SC-${crypto.randomUUID()}`,
      movementType: "one_way",
      canDrive: true,
      towRequired: false,
      statusId: fixture.statusIds.requested,
      // store_confirmed_by_user_id defaults to NULL (MATCH SIMPLE: FK check skipped when NULL)
    })
    .returning({ id: transportOrders.id, version: transportOrders.version });
  return requireRow(transportOrderRow, "transport order").id;
}

describeIntegration("transport_orders store_confirmed_by_user_id composite FK", () => {
  // Observation 1: cross-company UPDATE must be rejected by composite FK.
  // FK violation aborts the UPDATE; trg_audit_transport_orders does NOT fire
  // because the statement itself is aborted before AFTER triggers execute.
  it("rejects UPDATE setting cross-company store_confirmed_by_user_id via composite FK", async () => {
    await withRollback(async (outerTx) => {
      const fixtureA = await seedFixture(outerTx, { companyLabel: "A" });
      const fixtureB = await seedFixture(outerTx, { companyLabel: "B" });
      const transportOrderId = await seedTransportOrder(outerTx, fixtureA);

      await expectPostgresErrorCode(
        () =>
          outerTx
            .update(transportOrders)
            .set({ storeConfirmedByUserId: fixtureB.userId })
            .where(eq(transportOrders.id, transportOrderId)),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  // Observation 2: same-company UPDATE with IF MATCH (ADR-0007 version pattern).
  // Mirrors confirmTransportOrderManually future service write path.
  // trg_audit_transport_orders (AFTER UPDATE) fires here: 1 row inserted into
  // audit_logs is an expected side-effect of this UPDATE, not a regression.
  // trg_enforce_status_transition does NOT fire (status_id unchanged).
  // trg_set_updated_at bumps updated_at automatically (side-effect, not asserted here).
  it("accepts same-company UPDATE with IF MATCH version pattern and sets store_confirmed_by_user_id", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);

      // Read current version for IF MATCH guard
      const [before] = await outerTx
        .select({ version: transportOrders.version })
        .from(transportOrders)
        .where(eq(transportOrders.id, transportOrderId));
      const expectedVersion = requireRow(before, "transport order before").version;

      // ADR-0007 IF MATCH pattern: only update if version matches
      const result = await outerTx.execute(sql`
        UPDATE transport_orders
        SET
          store_confirmed_at = now(),
          store_confirmed_by_user_id = ${fixture.userId}::uuid,
          version = version + 1
        WHERE id = ${transportOrderId}::uuid
          AND company_id = ${fixture.companyId}::uuid
          AND version = ${expectedVersion}
        RETURNING id, store_confirmed_by_user_id, store_confirmed_at, version
      `);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const [updated] = (result as any).rows ?? result;
      requireRow(updated, "updated transport order");

      expect(updated.store_confirmed_by_user_id).toBe(fixture.userId);
      expect(updated.store_confirmed_at).not.toBeNull();
      expect(updated.version).toBe(expectedVersion + 1);
    });
  });

  // Observation 3: NULL is accepted (MATCH SIMPLE: partial key NULL skips FK check).
  // This covers the revert pattern: after confirmation, store_confirmed_by_user_id
  // can be reset to NULL without violating the composite FK.
  it("accepts UPDATE setting store_confirmed_by_user_id to NULL (MATCH SIMPLE revert pattern)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);

      // First set store_confirmed_by_user_id to same-company user
      await outerTx
        .update(transportOrders)
        .set({ storeConfirmedByUserId: fixture.userId })
        .where(eq(transportOrders.id, transportOrderId));

      // Then revert to NULL: MATCH SIMPLE must allow this
      await outerTx
        .update(transportOrders)
        .set({ storeConfirmedByUserId: null })
        .where(eq(transportOrders.id, transportOrderId));

      const [row] = await outerTx
        .select({ storeConfirmedByUserId: transportOrders.storeConfirmedByUserId })
        .from(transportOrders)
        .where(eq(transportOrders.id, transportOrderId));
      expect(row?.storeConfirmedByUserId).toBeNull();
    });
  });

  // Observation 4: hard delete of referenced user must be blocked (ON DELETE NO ACTION).
  // Users in this system are soft-deleted (is_active = false); this test confirms
  // the schema-level guard prevents accidental hard delete while reference exists.
  it("rejects user hard delete when referenced by transport_orders.store_confirmed_by_user_id (ON DELETE NO ACTION = RESTRICT)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const transportOrderId = await seedTransportOrder(outerTx, fixture);

      // Set store_confirmed_by_user_id to create an active reference
      await outerTx
        .update(transportOrders)
        .set({ storeConfirmedByUserId: fixture.userId })
        .where(eq(transportOrders.id, transportOrderId));

      // Attempt hard delete of the referenced user: must be rejected
      await expectPostgresErrorCode(
        () => outerTx.delete(users).where(eq(users.id, fixture.userId)),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  // Observation 5: FK violation is raised at statement time (NO ACTION non-deferrable).
  // PostgreSQL non-DEFERRABLE FK with NO ACTION fires immediately on the offending
  // statement, not at COMMIT. Using company A row but company B user triggers the
  // composite FK at statement execution.
  // FK violation aborts the UPDATE; audit_logs row is NOT created (AFTER trigger
  // never fires on an aborted statement).
  it("raises FK violation at statement time for cross-company user (NO ACTION non-deferrable check)", async () => {
    await withRollback(async (outerTx) => {
      const fixtureA = await seedFixture(outerTx, { companyLabel: "DefA" });
      const fixtureB = await seedFixture(outerTx, { companyLabel: "DefB" });
      const transportOrderId = await seedTransportOrder(outerTx, fixtureA);

      // Statement-time violation: UPDATE is rejected immediately (no deferred check)
      await expectPostgresErrorCode(
        () =>
          outerTx
            .update(transportOrders)
            .set({ storeConfirmedByUserId: fixtureB.userId })
            .where(eq(transportOrders.id, transportOrderId)),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });
});
