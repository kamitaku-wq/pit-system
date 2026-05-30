// Phase 64-C.4.0: 業者対応不可フォールバックの状態モデル補正 (post/0033) を検証する。
//
// 検証対象 (post/0033_reopen_rejected_transport_status.sql):
//   1. rejected status が is_terminal=false で seed/backfill されている (stall 化)。
//   2. rejected → requested 遷移が enforce_status_transition を通過する (再オープン経路)。
//   3. close_transport_order が rejected の is_terminal=false 補正後も壊れず、
//      全 invitation rejected で order を 'rejected' へ遷移させる (plan の盲点 = close 補正の回帰防止)。
//   4. 再オープン後 (旧 invitation revoked + 新 pending invitation) に close_transport_order を
//      再度呼んでも close しない (v_pending>0 → closed=false。再発火回帰)。
//
// テスト方針は transport-status-completed-transition.integration.test.ts に準拠
// (withRollback / seedTransportStatuses / transport_orders.status_id UPDATE を実 enforcement path とする)。

import { config } from "dotenv";
import { and, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { seedTransportStatuses } from "../../_helpers/seed-transport-statuses";
import { companies } from "@/lib/db/schema/companies";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { statuses } from "@/lib/db/schema/statuses";
import { stores } from "@/lib/db/schema/stores";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
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
  vendorId: string;
  pickupStoreId: string;
  deliveryStoreId: string;
  vehicleId: string;
  serviceTicketId: string;
  statusIds: Awaited<ReturnType<typeof seedTransportStatuses>>;
}

// transport_order を直接 statusId で INSERT する。INSERT は BEFORE UPDATE OF status_id trigger を
// 起動しないため、後続の UPDATE だけが遷移検証の対象として隔離される (completed-transition test と同方針)。
async function seedFixture(outerTx: Tx): Promise<Fixture> {
  const suffix = crypto.randomUUID().slice(0, 8);

  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__reopen_${suffix}__`, code: `ro_${suffix}` })
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
    .values({ companyId: company.id, storeId: pickupStore.id, vin: `RO${suffix.toUpperCase()}000000` })
    .returning({ id: vehicles.id });
  const vehicle = requireRow(vehicleRow, "vehicle");

  const [serviceTicketRow] = await outerTx
    .insert(serviceTickets)
    .values({
      companyId: company.id,
      vehicleId: vehicle.id,
      storeId: pickupStore.id,
      ticketNo: `ro-${suffix}`,
      billingStatus: "unbilled",
    })
    .returning({ id: serviceTickets.id });
  const serviceTicket = requireRow(serviceTicketRow, "service ticket");

  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: company.id, name: `Vendor ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  const vendor = requireRow(vendorRow, "vendor");

  // companies INSERT trigger (0013) + post/0028 + post/0033 が seed 済みの transport status を SELECT。
  const statusIds = await seedTransportStatuses(outerTx, company.id);

  return {
    companyId: company.id,
    vendorId: vendor.id,
    pickupStoreId: pickupStore.id,
    deliveryStoreId: deliveryStore.id,
    vehicleId: vehicle.id,
    serviceTicketId: serviceTicket.id,
    statusIds,
  };
}

async function seedTransportOrder(outerTx: Tx, fixture: Fixture, statusId: string): Promise<string> {
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
      statusId,
    })
    .returning({ id: transportOrders.id });
  return requireRow(transportOrderRow, "transport order").id;
}

async function seedInvitation(
  outerTx: Tx,
  fixture: Fixture,
  transportOrderId: string,
  response: "pending" | "accepted" | "rejected" | "revoked",
  // 同一 order に複数 invitation を立てる場合は vendor を分ける必要がある
  // (transport_order_invitations_transport_order_vendor_unique = (transport_order_id, vendor_id) UNIQUE WHERE vendor_id IS NOT NULL)。
  vendorId: string = fixture.vendorId,
): Promise<string> {
  const [invitationRow] = await outerTx
    .insert(transportOrderInvitations)
    .values({
      companyId: fixture.companyId,
      transportOrderId,
      vendorId,
      response,
      isWinningBid: false,
    })
    .returning({ id: transportOrderInvitations.id });
  return requireRow(invitationRow, "transport order invitation").id;
}

// 同一 order に 2 つ目以降の invitation を立てるための追加 vendor を作る。
async function seedAdditionalVendor(outerTx: Tx, fixture: Fixture): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: fixture.companyId, name: `Vendor ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  return requireRow(vendorRow, "additional vendor").id;
}

describeIntegration(
  "transport status: rejected stall + reopen (Phase 64-C.4.0 / post/0033)",
  () => {
    it("seeds rejected status as is_terminal=false (stall, not terminal)", async () => {
      await withRollback(async (outerTx) => {
        const fixture = await seedFixture(outerTx);

        const rows = await outerTx
          .select({ isTerminal: statuses.isTerminal })
          .from(statuses)
          .where(
            and(
              eq(statuses.companyId, fixture.companyId),
              eq(statuses.statusType, "transport"),
              eq(statuses.key, "rejected"),
            ),
          );
        expect(rows[0]?.isTerminal).toBe(false);
      });
    });

    it("keeps completed and cancelled as is_terminal=true (true terminals unchanged)", async () => {
      await withRollback(async (outerTx) => {
        const fixture = await seedFixture(outerTx);

        const rows = await outerTx
          .select({ key: statuses.key, isTerminal: statuses.isTerminal })
          .from(statuses)
          .where(
            and(
              eq(statuses.companyId, fixture.companyId),
              eq(statuses.statusType, "transport"),
            ),
          );
        const byKey = new Map(rows.map((r) => [r.key, r.isTerminal]));
        expect(byKey.get("completed")).toBe(true);
        expect(byKey.get("cancelled")).toBe(true);
        expect(byKey.get("requested")).toBe(false);
        expect(byKey.get("accepted")).toBe(false);
      });
    });

    it("allows UPDATE transport_orders.status_id from rejected to requested (reopen path)", async () => {
      await withRollback(async (outerTx) => {
        const fixture = await seedFixture(outerTx);
        // rejected で直接 INSERT (trigger を起動しない) → rejected → requested の UPDATE だけを検証。
        const transportOrderId = await seedTransportOrder(outerTx, fixture, fixture.statusIds.rejected);

        await outerTx
          .update(transportOrders)
          .set({ statusId: fixture.statusIds.requested })
          .where(eq(transportOrders.id, transportOrderId));

        const rows = await outerTx
          .select({ statusId: transportOrders.statusId })
          .from(transportOrders)
          .where(eq(transportOrders.id, transportOrderId));
        expect(rows[0]?.statusId).toBe(fixture.statusIds.requested);
      });
    });

    it("still rejects an unseeded transition (rejected -> accepted) with P0001", async () => {
      await withRollback(async (outerTx) => {
        const fixture = await seedFixture(outerTx);
        const transportOrderId = await seedTransportOrder(outerTx, fixture, fixture.statusIds.rejected);

        // rejected -> accepted は seed されていない (再オープンは必ず requested 経由)。
        await expectPostgresErrorCode(
          () =>
            outerTx
              .update(transportOrders)
              .set({ statusId: fixture.statusIds.accepted })
              .where(eq(transportOrders.id, transportOrderId)),
          INVALID_STATUS_TRANSITION,
        );
      });
    });

    it("close_transport_order still closes an all-rejected order to 'rejected' (close fix regression)", async () => {
      await withRollback(async (outerTx) => {
        const fixture = await seedFixture(outerTx);
        // requested の order + 単一 rejected invitation = 全 invitation rejected の状態。
        const transportOrderId = await seedTransportOrder(outerTx, fixture, fixture.statusIds.requested);
        await seedInvitation(outerTx, fixture, transportOrderId, "rejected");

        const result = await outerTx.execute(sql`
          SELECT transport_order_id, closed, new_status_id
          FROM public.close_transport_order(${transportOrderId}::uuid)
        `);
        const rows = (result as unknown as { rows?: unknown }).rows ?? result;
        const row = (Array.isArray(rows) ? rows[0] : rows) as
          | { closed?: boolean; new_status_id?: string }
          | undefined;

        // is_terminal=false 化後も close は壊れず (NULL lookup → P0002 にならず) rejected へ遷移する。
        expect(row?.closed).toBe(true);
        expect(row?.new_status_id).toBe(fixture.statusIds.rejected);

        const orderRows = await outerTx
          .select({ statusId: transportOrders.statusId })
          .from(transportOrders)
          .where(eq(transportOrders.id, transportOrderId));
        expect(orderRows[0]?.statusId).toBe(fixture.statusIds.rejected);
      });
    });

    it("does not re-fire close after reopen (revoked old invitation + new pending)", async () => {
      await withRollback(async (outerTx) => {
        const fixture = await seedFixture(outerTx);
        // 再オープン後の状態を再現: order は requested、旧 vendor の invitation は revoked、
        // 新 vendor の invitation は pending (C.4.1 reopenOrderForResolicit は別 vendor へ再割当 = fallback)。
        // 同一 order の複数 invitation は vendor を分ける (transport_order_vendor_unique 制約)。
        const transportOrderId = await seedTransportOrder(outerTx, fixture, fixture.statusIds.requested);
        const newVendorId = await seedAdditionalVendor(outerTx, fixture);
        await seedInvitation(outerTx, fixture, transportOrderId, "revoked");
        await seedInvitation(outerTx, fixture, transportOrderId, "pending", newVendorId);

        const result = await outerTx.execute(sql`
          SELECT closed
          FROM public.close_transport_order(${transportOrderId}::uuid)
        `);
        const rows = (result as unknown as { rows?: unknown }).rows ?? result;
        const row = (Array.isArray(rows) ? rows[0] : rows) as { closed?: boolean } | undefined;

        // pending invitation が存在するため close は発火しない (v_pending>0 → closed=false)。
        expect(row?.closed).toBe(false);
      });
    });

    it("does not count revoked invitations as rejected (revoked-only order does not close)", async () => {
      await withRollback(async (outerTx) => {
        const fixture = await seedFixture(outerTx);
        // revoked のみ (rejected ゼロ) → close は v_rejected=0 で発火しない。
        const transportOrderId = await seedTransportOrder(outerTx, fixture, fixture.statusIds.requested);
        await seedInvitation(outerTx, fixture, transportOrderId, "revoked");

        const result = await outerTx.execute(sql`
          SELECT closed
          FROM public.close_transport_order(${transportOrderId}::uuid)
        `);
        const rows = (result as unknown as { rows?: unknown }).rows ?? result;
        const row = (Array.isArray(rows) ? rows[0] : rows) as { closed?: boolean } | undefined;
        expect(row?.closed).toBe(false);
      });
    });
  },
);
