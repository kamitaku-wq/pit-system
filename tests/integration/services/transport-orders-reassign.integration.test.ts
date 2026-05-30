// Phase 64-C.4.1: reassignTransportOrderVendor (L3-3 fallback 次候補打診 / L3-5 manual 手動切替)。
//
// 検証対象:
//   - fallback 再割当: rejected→requested, 新 invitation + attempt_seq, vendor_selection_log
//     method=fallback, change_log rejected_reassigned, 旧 invitation revoked, outbox invitation.sent。
//   - manual 切替: selection_method=manual, change_type=vendor_changed。
//   - rejected 以外 (requested/accepted/completed/cancelled) からの再割当は ReassignNotRejectedError。
//   - version mismatch → ConcurrentTransportOrderReassignError。
//   - 非 active vendor → VendorMembershipError。
//   - attempt_seq の純増 (2 回連続再割当)。
//   - invitation upsert: 過去に打診した vendor を再選択しても UNIQUE 衝突しない。
//   - close 再発火回帰: 再割当後に close_transport_order が再発火しない (v_pending>0)。
//
// テスト方針は transport-orders-cancel.integration.test.ts に準拠 (withRollback / seedFixture /
// service を outerTx 上で実行)。

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
import { transportOrderChangeLogs } from "@/lib/db/schema/transport_order_change_logs";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrderStatusHistory } from "@/lib/db/schema/transport_order_status_history";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendorCompanyMemberships } from "@/lib/db/schema/vendor_company_memberships";
import { vendors } from "@/lib/db/schema/vendors";
import {
  ConcurrentTransportOrderReassignError,
  createTransportOrderWithNotification,
  reassignTransportOrderVendor,
  ReassignNotRejectedError,
  VendorMembershipError,
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

interface Fixture {
  companyId: string;
  pickupStoreId: string;
  deliveryStoreId: string;
  vehicleId: string;
  serviceTicketId: string;
  vendorId: string;
  userId: string;
  statusIds: Awaited<ReturnType<typeof seedTransportStatuses>>;
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

function serviceDb(outerTx: Tx): Db {
  return outerTx as unknown as Db;
}

async function seedFixture(outerTx: Tx): Promise<Fixture> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__reassign_${suffix}__`, code: `ra_${suffix}` })
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
    .values({ companyId: company.id, storeId: pickupStore.id, vin: `RA${suffix.toUpperCase()}000000` })
    .returning({ id: vehicles.id });
  const vehicle = requireRow(vehicleRow, "vehicle");

  const [serviceTicketRow] = await outerTx
    .insert(serviceTickets)
    .values({
      companyId: company.id,
      vehicleId: vehicle.id,
      storeId: pickupStore.id,
      ticketNo: `ra-${suffix}`,
      billingStatus: "unbilled",
    })
    .returning({ id: serviceTickets.id });
  const serviceTicket = requireRow(serviceTicketRow, "service ticket");

  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: company.id, name: `Vendor A ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  const vendor = requireRow(vendorRow, "vendor");

  // users.id は auth.users(id) への非 deferrable FK ゆえ、先に auth.users を seed する
  // (confirm test と同パターン)。
  const userResult = await outerTx.execute(sql`
    WITH auth_user AS (
      INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
      VALUES (gen_random_uuid(), 'authenticated', 'authenticated', ${`user-${suffix}@example.test`}, now(), now(), now())
      RETURNING id
    )
    INSERT INTO users (id, company_id, email, name, is_active)
    SELECT id, ${company.id}, ${`user-${suffix}@example.test`}, ${`User ${suffix}`}, true
    FROM auth_user
    RETURNING id
  `);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [userRow] = (userResult as any).rows ?? userResult;
  const user = requireRow(userRow as { id: string } | undefined, "user");

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

// active membership 付きの追加 vendor を作る (再割当先)。
async function seedVendorWithMembership(outerTx: Tx, fixture: Fixture, label: string): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: fixture.companyId, name: `${label} ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  const vendorId = requireRow(vendorRow, "additional vendor").id;
  await outerTx.insert(vendorCompanyMemberships).values({
    vendorId,
    companyId: fixture.companyId,
    isEnabled: true,
  });
  return vendorId;
}

// membership 無し vendor (再割当不可)。
async function seedVendorWithoutMembership(outerTx: Tx, fixture: Fixture): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: fixture.companyId, name: `NoMember ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  return requireRow(vendorRow, "no-membership vendor").id;
}

async function seedOrder(outerTx: Tx, fixture: Fixture, statusId: string, vendorId = fixture.vendorId): Promise<string> {
  const [orderRow] = await outerTx
    .insert(transportOrders)
    .values({
      companyId: fixture.companyId,
      vendorId,
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
  return requireRow(orderRow, "transport order").id;
}

async function seedInvitation(
  outerTx: Tx,
  fixture: Fixture,
  transportOrderId: string,
  vendorId: string,
  response: "pending" | "accepted" | "rejected" | "revoked",
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
  return requireRow(invitationRow, "invitation").id;
}

// rejected stall の order を作る (vendor A が rejected invitation を持ち、order status=rejected)。
async function seedRejectedOrder(outerTx: Tx, fixture: Fixture): Promise<{ orderId: string; oldInvitationId: string }> {
  const orderId = await seedOrder(outerTx, fixture, fixture.statusIds.rejected);
  const oldInvitationId = await seedInvitation(outerTx, fixture, orderId, fixture.vendorId, "rejected");
  return { orderId, oldInvitationId };
}

describeIntegration("reassignTransportOrderVendor", () => {
  it("fallback: reopens a rejected order to a new vendor (requested + new invitation + attempt + logs)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const { orderId, oldInvitationId } = await seedRejectedOrder(outerTx, fixture);
      const newVendorId = await seedVendorWithMembership(outerTx, fixture, "Vendor B");

      const result = await reassignTransportOrderVendor(serviceDb(outerTx), fixture.companyId, fixture.userId, {
        transportOrderId: orderId,
        expectedVersion: 1,
        newVendorId,
        mode: "fallback",
        consideredVendorIds: [newVendorId],
      });

      expect(result.transportOrderId).toBe(orderId);
      expect(result.newVendorId).toBe(newVendorId);
      expect(result.newVersion).toBe(2);
      expect(result.attemptSeq).toBe(1);
      expect(result.idempotencyKey).toBe(
        `to:${orderId}:invite:${result.newInvitationId}:a${result.attemptSeq}`,
      );

      // order: requested 再オープン + vendor 差し替え + scalar リセット。
      const [order] = await outerTx.select().from(transportOrders).where(eq(transportOrders.id, orderId));
      expect(order?.statusId).toBe(fixture.statusIds.requested);
      expect(order?.vendorId).toBe(newVendorId);
      expect(order?.vendorResponse).toBe("pending");
      expect(order?.version).toBe(2);

      // 旧 invitation (vendor A) は rejected のまま。helper の revoke は pending/accepted のみ対象で、
      // rejected は既に終端的応答ゆえ revoke しない (cancel と同作法、業者の拒否記録を保全する)。
      const [oldInv] = await outerTx
        .select()
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.id, oldInvitationId));
      expect(oldInv?.response).toBe("rejected");

      // 新 invitation は pending。
      const [newInv] = await outerTx
        .select()
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.id, result.newInvitationId));
      expect(newInv?.response).toBe("pending");
      expect(newInv?.vendorId).toBe(newVendorId);

      // attempt 記録。
      const attempts = await outerTx.execute(sql`
        SELECT vendor_id, attempt_seq, response FROM transport_order_vendor_attempts
        WHERE transport_order_id = ${orderId} ORDER BY attempt_seq
      `);
      const attemptRows = (attempts as unknown as { rows?: unknown }).rows ?? attempts;
      const attemptList = Array.isArray(attemptRows) ? attemptRows : [];
      expect(attemptList).toHaveLength(1);
      expect((attemptList[0] as { attempt_seq?: number }).attempt_seq).toBe(1);

      // vendor_selection_log (fallback)。
      const selLogs = await outerTx.execute(sql`
        SELECT selection_method, selection_reason FROM vendor_selection_logs
        WHERE transport_order_id = ${orderId}
      `);
      const selRows = (selLogs as unknown as { rows?: unknown }).rows ?? selLogs;
      const selList = Array.isArray(selRows) ? selRows : [];
      expect(selList).toHaveLength(1);
      expect((selList[0] as { selection_method?: string }).selection_method).toBe("fallback");
      expect((selList[0] as { selection_reason?: string }).selection_reason).toBe("vendor_unavailable");

      // change_log (rejected_reassigned)。
      const changeLogs = await outerTx
        .select()
        .from(transportOrderChangeLogs)
        .where(eq(transportOrderChangeLogs.transportOrderId, orderId));
      expect(changeLogs).toHaveLength(1);
      expect(changeLogs[0]?.changeType).toBe("rejected_reassigned");
      expect(changeLogs[0]?.requiresNotification).toBe(false);

      // outbox invitation.sent → 新 vendor。
      const [outbox] = await outerTx
        .select()
        .from(notificationOutbox)
        .where(eq(notificationOutbox.id, result.notificationOutboxId));
      expect(outbox?.eventType).toBe("transport_order.invitation.sent");
      expect(outbox?.targetId).toBe(newVendorId);

      // status_history に rejected→requested。
      const histories = await outerTx
        .select()
        .from(transportOrderStatusHistory)
        .where(eq(transportOrderStatusHistory.transportOrderId, orderId));
      const reopenHistory = histories.find((h) => h.toStatusId === fixture.statusIds.requested);
      expect(reopenHistory?.fromStatusId).toBe(fixture.statusIds.rejected);
    });
  });

  it("manual: tags selection_method=manual and change_type=vendor_changed", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const { orderId } = await seedRejectedOrder(outerTx, fixture);
      const newVendorId = await seedVendorWithMembership(outerTx, fixture, "Vendor B");

      await reassignTransportOrderVendor(serviceDb(outerTx), fixture.companyId, fixture.userId, {
        transportOrderId: orderId,
        expectedVersion: 1,
        newVendorId,
        mode: "manual",
        selectionReasonNote: "店舗の指名",
      });

      const selLogs = await outerTx.execute(sql`
        SELECT selection_method, selection_reason, selection_reason_note FROM vendor_selection_logs
        WHERE transport_order_id = ${orderId}
      `);
      const selRows = (selLogs as unknown as { rows?: unknown }).rows ?? selLogs;
      const selList = Array.isArray(selRows) ? selRows : [];
      expect((selList[0] as { selection_method?: string }).selection_method).toBe("manual");
      expect((selList[0] as { selection_reason?: string }).selection_reason).toBe("manual_preference");
      expect((selList[0] as { selection_reason_note?: string }).selection_reason_note).toBe("店舗の指名");

      const changeLogs = await outerTx
        .select()
        .from(transportOrderChangeLogs)
        .where(eq(transportOrderChangeLogs.transportOrderId, orderId));
      expect(changeLogs[0]?.changeType).toBe("vendor_changed");
    });
  });

  it("throws ReassignNotRejectedError when order is not in 'rejected' status (requested)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const orderId = await seedOrder(outerTx, fixture, fixture.statusIds.requested);
      const newVendorId = await seedVendorWithMembership(outerTx, fixture, "Vendor B");

      await expect(
        reassignTransportOrderVendor(serviceDb(outerTx), fixture.companyId, fixture.userId, {
          transportOrderId: orderId,
          expectedVersion: 1,
          newVendorId,
          mode: "fallback",
        }),
      ).rejects.toBeInstanceOf(ReassignNotRejectedError);
    });
  });

  it("throws ReassignNotRejectedError for an accepted order", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const orderId = await seedOrder(outerTx, fixture, fixture.statusIds.accepted);
      const newVendorId = await seedVendorWithMembership(outerTx, fixture, "Vendor B");

      await expect(
        reassignTransportOrderVendor(serviceDb(outerTx), fixture.companyId, fixture.userId, {
          transportOrderId: orderId,
          expectedVersion: 1,
          newVendorId,
          mode: "manual",
        }),
      ).rejects.toBeInstanceOf(ReassignNotRejectedError);
    });
  });

  it("throws ConcurrentTransportOrderReassignError on version mismatch", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const { orderId } = await seedRejectedOrder(outerTx, fixture);
      const newVendorId = await seedVendorWithMembership(outerTx, fixture, "Vendor B");

      await expect(
        reassignTransportOrderVendor(serviceDb(outerTx), fixture.companyId, fixture.userId, {
          transportOrderId: orderId,
          expectedVersion: 999,
          newVendorId,
          mode: "fallback",
        }),
      ).rejects.toBeInstanceOf(ConcurrentTransportOrderReassignError);
    });
  });

  it("throws VendorMembershipError for a vendor without active membership", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const { orderId } = await seedRejectedOrder(outerTx, fixture);
      const noMemberVendorId = await seedVendorWithoutMembership(outerTx, fixture);

      await expect(
        reassignTransportOrderVendor(serviceDb(outerTx), fixture.companyId, fixture.userId, {
          transportOrderId: orderId,
          expectedVersion: 1,
          newVendorId: noMemberVendorId,
          mode: "fallback",
        }),
      ).rejects.toBeInstanceOf(VendorMembershipError);
    });
  });

  it("increments attempt_seq across two consecutive reassignments", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const { orderId } = await seedRejectedOrder(outerTx, fixture);
      const vendorB = await seedVendorWithMembership(outerTx, fixture, "Vendor B");
      const vendorC = await seedVendorWithMembership(outerTx, fixture, "Vendor C");

      // 1 回目: A(rejected) → B。
      const r1 = await reassignTransportOrderVendor(serviceDb(outerTx), fixture.companyId, fixture.userId, {
        transportOrderId: orderId,
        expectedVersion: 1,
        newVendorId: vendorB,
        mode: "fallback",
      });
      expect(r1.attemptSeq).toBe(1);

      // B も rejected にする (close を呼ばず手動で order を rejected stall に戻す)。
      await outerTx
        .update(transportOrderInvitations)
        .set({ response: "rejected" })
        .where(
          and(
            eq(transportOrderInvitations.transportOrderId, orderId),
            eq(transportOrderInvitations.vendorId, vendorB),
          ),
        );
      await outerTx
        .update(transportOrders)
        .set({ statusId: fixture.statusIds.rejected, version: r1.newVersion + 1 })
        .where(eq(transportOrders.id, orderId));

      // 2 回目: B(rejected) → C。attempt_seq=2。
      const r2 = await reassignTransportOrderVendor(serviceDb(outerTx), fixture.companyId, fixture.userId, {
        transportOrderId: orderId,
        expectedVersion: r1.newVersion + 1,
        newVendorId: vendorC,
        mode: "fallback",
      });
      expect(r2.attemptSeq).toBe(2);

      const attempts = await outerTx.execute(sql`
        SELECT attempt_seq FROM transport_order_vendor_attempts
        WHERE transport_order_id = ${orderId} ORDER BY attempt_seq
      `);
      const attemptRows = (attempts as unknown as { rows?: unknown }).rows ?? attempts;
      const attemptList = Array.isArray(attemptRows) ? attemptRows : [];
      expect(attemptList).toHaveLength(2);
    });
  });

  it("reuses an existing invitation row when reassigning back to a previously-invited vendor (no UNIQUE violation)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const { orderId } = await seedRejectedOrder(outerTx, fixture);
      const vendorB = await seedVendorWithMembership(outerTx, fixture, "Vendor B");

      // 1 回目: A → B。
      const r1 = await reassignTransportOrderVendor(serviceDb(outerTx), fixture.companyId, fixture.userId, {
        transportOrderId: orderId,
        expectedVersion: 1,
        newVendorId: vendorB,
        mode: "fallback",
      });

      // B も rejected に戻す。
      await outerTx
        .update(transportOrderInvitations)
        .set({ response: "rejected" })
        .where(
          and(
            eq(transportOrderInvitations.transportOrderId, orderId),
            eq(transportOrderInvitations.vendorId, vendorB),
          ),
        );
      await outerTx
        .update(transportOrders)
        .set({ statusId: fixture.statusIds.rejected, version: r1.newVersion + 1 })
        .where(eq(transportOrders.id, orderId));

      // 2 回目: B(rejected) → A (元 vendor を再選択)。A は既存 invitation (revoked) を持つので
      // INSERT すると UNIQUE 衝突するが、upsert で再利用されるはず。
      const r2 = await reassignTransportOrderVendor(serviceDb(outerTx), fixture.companyId, fixture.userId, {
        transportOrderId: orderId,
        expectedVersion: r1.newVersion + 1,
        newVendorId: fixture.vendorId,
        mode: "manual",
      });

      expect(r2.newVendorId).toBe(fixture.vendorId);

      // A の invitation は 1 行のみ (重複なし) で pending に戻っている。
      const aInvitations = await outerTx
        .select()
        .from(transportOrderInvitations)
        .where(
          and(
            eq(transportOrderInvitations.transportOrderId, orderId),
            eq(transportOrderInvitations.vendorId, fixture.vendorId),
          ),
        );
      expect(aInvitations).toHaveLength(1);
      expect(aInvitations[0]?.response).toBe("pending");
      expect(aInvitations[0]?.id).toBe(r2.newInvitationId);
    });
  });

  it("does not re-fire close_transport_order after reassignment (new pending invitation exists)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const { orderId } = await seedRejectedOrder(outerTx, fixture);
      const vendorB = await seedVendorWithMembership(outerTx, fixture, "Vendor B");

      await reassignTransportOrderVendor(serviceDb(outerTx), fixture.companyId, fixture.userId, {
        transportOrderId: orderId,
        expectedVersion: 1,
        newVendorId: vendorB,
        mode: "fallback",
      });

      const result = await outerTx.execute(sql`
        SELECT closed FROM public.close_transport_order(${orderId}::uuid)
      `);
      const rows = (result as unknown as { rows?: unknown }).rows ?? result;
      const row = (Array.isArray(rows) ? rows[0] : rows) as { closed?: boolean } | undefined;
      // 新 pending invitation があるため close は発火しない。
      expect(row?.closed).toBe(false);
    });
  });

  it("isolates cross-tenant: cannot reassign an order from another company", async () => {
    await withRollback(async (outerTx) => {
      const fixtureA = await seedFixture(outerTx);
      const fixtureB = await seedFixture(outerTx);
      const { orderId } = await seedRejectedOrder(outerTx, fixtureA);
      const newVendorId = await seedVendorWithMembership(outerTx, fixtureB, "Vendor B");

      // company B が company A の order を再割当しようとする → NotFound。
      await expect(
        reassignTransportOrderVendor(serviceDb(outerTx), fixtureB.companyId, fixtureB.userId, {
          transportOrderId: orderId,
          expectedVersion: 1,
          newVendorId,
          mode: "fallback",
        }),
      ).rejects.toThrow();
    });
  });
});
