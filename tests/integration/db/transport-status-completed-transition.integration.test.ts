import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { seedTransportStatuses } from "../../_helpers/seed-transport-statuses";
import { companies } from "@/lib/db/schema/companies";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { stores } from "@/lib/db/schema/stores";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendors } from "@/lib/db/schema/vendors";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";
// enforce_status_transition() は許可されない遷移を RAISE EXCEPTION USING ERRCODE = 'P0001' で弾く。
const INVALID_STATUS_TRANSITION = "P0001";

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

interface Fixture {
  companyId: string;
  transportOrderId: string;
  statusIds: Awaited<ReturnType<typeof seedTransportStatuses>>;
}

// transport_order を直接 statusId='accepted' で INSERT する。INSERT は
// BEFORE UPDATE OF status_id trigger を起動しないため、後続の accepted → X の
// UPDATE だけが遷移検証の対象として隔離される。
async function seedFixtureAtAccepted(outerTx: Tx): Promise<Fixture> {
  const suffix = crypto.randomUUID().slice(0, 8);

  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__to_completed_${suffix}__`, code: `tc_${suffix}` })
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
      vin: `TC${suffix.toUpperCase()}000000`,
    })
    .returning({ id: vehicles.id });
  const vehicle = requireRow(vehicleRow, "vehicle");

  const [serviceTicketRow] = await outerTx
    .insert(serviceTickets)
    .values({
      companyId: company.id,
      vehicleId: vehicle.id,
      storeId: pickupStore.id,
      ticketNo: `tc-${suffix}`,
      billingStatus: "unbilled",
    })
    .returning({ id: serviceTickets.id });
  const serviceTicket = requireRow(serviceTicketRow, "service ticket");

  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: company.id, name: `Vendor ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  const vendor = requireRow(vendorRow, "vendor");

  // companies INSERT trigger (0013) + post/0028 が seed 済みの transport status を SELECT。
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
      statusId: statusIds.accepted,
    })
    .returning({ id: transportOrders.id });
  const transportOrder = requireRow(transportOrderRow, "transport order");

  return { companyId: company.id, transportOrderId: transportOrder.id, statusIds };
}

// NOTE (Phase 64-C.0): 状態遷移の enforcement point は、spec/data-model.md §15.5 が示唆する
// *_status_history の BEFORE INSERT ではなく、実装上は transport_orders の
// BEFORE UPDATE OF status_id trigger (enforce_status_transition, 20_triggers.sql:255) に張られている。
// status_history INSERT には遷移検証 trigger が存在しないため、status_history を対象にすると
// trigger を一切起動しない空テストになる。よって本テストは transport_orders.status_id の UPDATE を
// 実 enforcement path として検証する。
describeIntegration(
  "transport status: accepted -> completed transition (Phase 64-C.0 / post/0028)",
  () => {
    it("allows UPDATE transport_orders.status_id from accepted to completed", async () => {
      await withRollback(async (outerTx) => {
        const fixture = await seedFixtureAtAccepted(outerTx);

        await outerTx
          .update(transportOrders)
          .set({ statusId: fixture.statusIds.completed })
          .where(eq(transportOrders.id, fixture.transportOrderId));

        const rows = await outerTx
          .select({ statusId: transportOrders.statusId })
          .from(transportOrders)
          .where(eq(transportOrders.id, fixture.transportOrderId));
        expect(rows[0]?.statusId).toBe(fixture.statusIds.completed);
      });
    });

    it("rejects an unseeded transition (accepted -> requested) with P0001", async () => {
      await withRollback(async (outerTx) => {
        const fixture = await seedFixtureAtAccepted(outerTx);

        // accepted -> requested は status_transitions に seed されていない (逆走)。
        await expectPostgresErrorCode(
          () =>
            outerTx
              .update(transportOrders)
              .set({ statusId: fixture.statusIds.requested })
              .where(eq(transportOrders.id, fixture.transportOrderId)),
          INVALID_STATUS_TRANSITION,
        );
      });
    });
  },
);
