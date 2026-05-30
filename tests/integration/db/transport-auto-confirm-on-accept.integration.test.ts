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

// confirmationMode を指定して transport_order を 'requested' で seed し、id と statusIds を返す。
async function seedRequestedOrder(
  outerTx: Tx,
  confirmationMode: "auto" | "manual",
): Promise<{
  transportOrderId: string;
  statusIds: Awaited<ReturnType<typeof seedTransportStatuses>>;
}> {
  const suffix = crypto.randomUUID().slice(0, 8);

  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__to_ac_${confirmationMode}_${suffix}__`, code: `ac_${suffix}` })
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
      vin: `AC${suffix.toUpperCase()}000000`,
    })
    .returning({ id: vehicles.id });
  const vehicle = requireRow(vehicleRow, "vehicle");

  const [serviceTicketRow] = await outerTx
    .insert(serviceTickets)
    .values({
      companyId: company.id,
      vehicleId: vehicle.id,
      storeId: pickupStore.id,
      ticketNo: `ac-${suffix}`,
      billingStatus: "unbilled",
    })
    .returning({ id: serviceTickets.id });
  const serviceTicket = requireRow(serviceTicketRow, "service ticket");

  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: company.id, name: `Vendor ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  const vendor = requireRow(vendorRow, "vendor");

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
      confirmationMode,
      statusId: statusIds.requested,
    })
    .returning({ id: transportOrders.id });
  const transportOrder = requireRow(transportOrderRow, "transport order");

  return { transportOrderId: transportOrder.id, statusIds };
}

// NOTE (Phase 64-C.1): trg_auto_confirm_on_accept (post/0029) は transport_orders の
// BEFORE UPDATE OF status_id に張られ、accept の UPDATE OF status_id 内で NEW.store_confirmed_at を
// セットする。BEFORE trigger が NEW.store_confirmed_at を書き換えるため、UPDATE 文が
// store_confirmed_at を SET 句に含めなくても永続化される (非自明だが標準動作)。
// accept は本来 respond_to_transport_order RPC 経由だが、trigger は UPDATE OF status_id で発火するため
// 直接 UPDATE が同一 enforcement path を踏む。
describeIntegration("transport auto-confirm on accept (Phase 64-C.1 / post/0029)", () => {
  it("sets store_confirmed_at on accept for confirmation_mode='auto' (by_user_id stays NULL)", async () => {
    await withRollback(async (outerTx) => {
      const { transportOrderId, statusIds } = await seedRequestedOrder(outerTx, "auto");

      await outerTx
        .update(transportOrders)
        .set({ statusId: statusIds.accepted })
        .where(eq(transportOrders.id, transportOrderId));

      const rows = await outerTx
        .select({
          storeConfirmedAt: transportOrders.storeConfirmedAt,
          storeConfirmedByUserId: transportOrders.storeConfirmedByUserId,
        })
        .from(transportOrders)
        .where(eq(transportOrders.id, transportOrderId));
      expect(rows[0]?.storeConfirmedAt).not.toBeNull();
      expect(rows[0]?.storeConfirmedByUserId).toBeNull();
    });
  });

  it("leaves store_confirmed_at NULL on accept for confirmation_mode='manual'", async () => {
    await withRollback(async (outerTx) => {
      const { transportOrderId, statusIds } = await seedRequestedOrder(outerTx, "manual");

      await outerTx
        .update(transportOrders)
        .set({ statusId: statusIds.accepted })
        .where(eq(transportOrders.id, transportOrderId));

      const rows = await outerTx
        .select({ storeConfirmedAt: transportOrders.storeConfirmedAt })
        .from(transportOrders)
        .where(eq(transportOrders.id, transportOrderId));
      expect(rows[0]?.storeConfirmedAt).toBeNull();
    });
  });
});
