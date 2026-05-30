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
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { users } from "@/lib/db/schema/users";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendorCompanyMemberships } from "@/lib/db/schema/vendor_company_memberships";
import { vendors } from "@/lib/db/schema/vendors";
import { createTransportOrderWithNotification } from "@/lib/services/transport-orders";

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

interface InvitationFixture {
  companyId: string;
  transportOrderId: string;
  userId: string;
  vendorId: string;
  statusIds: { requested: string; accepted: string; rejected: string; cancelled: string };
}

interface ServiceFixture {
  companyId: string;
  pickupStoreId: string;
  deliveryStoreId: string;
  vehicleId: string;
  serviceTicketId: string;
  vendorId: string;
  userId: string;
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

async function seedUser(
  outerTx: Tx,
  companyId: string,
  suffix: string,
  label: string,
): Promise<string> {
  const userEmail = `${label}-${suffix}@example.test`;
  const userName = `${label} ${suffix}`;
  const newUserId = crypto.randomUUID();
  // Insert into auth.users first (minimal row required by FK)
  await outerTx.execute(sql`INSERT INTO auth.users (id) VALUES (${newUserId})`);
  // Then insert into public.users using the same id
  const [userRow] = await outerTx
    .insert(users)
    .values({ id: newUserId, companyId, email: userEmail, name: userName, isActive: true })
    .returning({ id: users.id });
  return requireRow(userRow, `user-${label}`).id;
}
async function seedInvitationFixture(
  outerTx: Tx,
  options: { companyLabel?: string } = {},
): Promise<InvitationFixture> {
  const { companyLabel = "Company" } = options;
  const suffix = crypto.randomUUID().slice(0, 8);

  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__toi_fk_${companyLabel}_${suffix}__`, code: `toi_${suffix}` })
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
      vin: `TOI${suffix.toUpperCase()}0000`,
    })
    .returning({ id: vehicles.id });
  const vehicle = requireRow(vehicleRow, "vehicle");

  const [serviceTicketRow] = await outerTx
    .insert(serviceTickets)
    .values({
      companyId: company.id,
      vehicleId: vehicle.id,
      storeId: pickupStore.id,
      ticketNo: `toi-${suffix}`,
      billingStatus: "unbilled",
    })
    .returning({ id: serviceTickets.id });
  const serviceTicket = requireRow(serviceTicketRow, "service ticket");

  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: company.id, name: `Vendor ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  const vendor = requireRow(vendorRow, "vendor");

  await outerTx.insert(vendorCompanyMemberships).values({
    vendorId: vendor.id,
    companyId: company.id,
    isEnabled: true,
  });

  const statusIds = await seedTransportStatuses(outerTx, company.id);

  const userId = await seedUser(outerTx, company.id, suffix, "owner");

  const [transportOrderRow] = await outerTx
    .insert(transportOrders)
    .values({
      companyId: company.id,
      vendorId: vendor.id,
      serviceTicketId: serviceTicket.id,
      vehicleId: vehicle.id,
      pickupStoreId: pickupStore.id,
      deliveryStoreId: deliveryStore.id,
      orderNumber: `TO-${suffix}`,
      movementType: "one_way",
      canDrive: true,
      towRequired: false,
      statusId: statusIds.requested,
    })
    .returning({ id: transportOrders.id });
  const transportOrder = requireRow(transportOrderRow, "transport order");

  return {
    companyId: company.id,
    transportOrderId: transportOrder.id,
    userId,
    vendorId: vendor.id,
    statusIds,
  };
}
async function seedServiceFixture(
  outerTx: Tx,
  options: { companyLabel?: string } = {},
): Promise<ServiceFixture> {
  const { companyLabel = "Svc" } = options;
  const suffix = crypto.randomUUID().slice(0, 8);

  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__toi_svc_${companyLabel}_${suffix}__`, code: `svc_${suffix}` })
    .returning({ id: companies.id });
  const company = requireRow(companyRow, "company");

  const [pickupStoreRow, deliveryStoreRow2] = await outerTx
    .insert(stores)
    .values([
      { companyId: company.id, code: `ps_${suffix}`, name: "Pickup" },
      { companyId: company.id, code: `ds_${suffix}`, name: "Delivery" },
    ])
    .returning({ id: stores.id });
  const pickupStore = requireRow(pickupStoreRow, "pickup store");
  const deliveryStore2 = requireRow(deliveryStoreRow2, "delivery store");

  const [vehicleRow] = await outerTx
    .insert(vehicles)
    .values({
      companyId: company.id,
      storeId: pickupStore.id,
      vin: `SVC${suffix.toUpperCase()}0000`,
    })
    .returning({ id: vehicles.id });
  const vehicle = requireRow(vehicleRow, "vehicle");

  const [serviceTicketRow] = await outerTx
    .insert(serviceTickets)
    .values({
      companyId: company.id,
      vehicleId: vehicle.id,
      storeId: pickupStore.id,
      ticketNo: `svc-${suffix}`,
      billingStatus: "unbilled",
    })
    .returning({ id: serviceTickets.id });
  const serviceTicket = requireRow(serviceTicketRow, "service ticket");

  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: company.id, name: `Vendor ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  const vendor = requireRow(vendorRow, "vendor");

  await outerTx.insert(vendorCompanyMemberships).values({
    vendorId: vendor.id,
    companyId: company.id,
    isEnabled: true,
  });

  const userId = await seedUser(outerTx, company.id, suffix, "acting");

  return {
    companyId: company.id,
    pickupStoreId: pickupStore.id,
    deliveryStoreId: deliveryStore2.id,
    vehicleId: vehicle.id,
    serviceTicketId: serviceTicket.id,
    vendorId: vendor.id,
    userId,
  };
}
describeIntegration("transport_order_invitations invited_by_user_id composite FK", () => {
  // (i) Cross-company user -> FK violation
  it("rejects INSERT with cross-company invited_by_user_id via composite FK", async () => {
    await withRollback(async (outerTx) => {
      const fixtureA = await seedInvitationFixture(outerTx, { companyLabel: "A" });
      const fixtureB = await seedInvitationFixture(outerTx, { companyLabel: "B" });

      await expectPostgresErrorCode(
        () =>
          outerTx.insert(transportOrderInvitations).values({
            companyId: fixtureA.companyId,
            transportOrderId: fixtureA.transportOrderId,
            vendorId: fixtureA.vendorId,
            invitedByUserId: fixtureB.userId,
          }),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  // (ii) Same-company user -> accepted
  it("accepts INSERT with same-company invited_by_user_id", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedInvitationFixture(outerTx);

      const [inserted] = await outerTx
        .insert(transportOrderInvitations)
        .values({
          companyId: fixture.companyId,
          transportOrderId: fixture.transportOrderId,
          vendorId: fixture.vendorId,
          invitedByUserId: fixture.userId,
        })
        .returning({ id: transportOrderInvitations.id });

      const rows = await outerTx
        .select()
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.id, requireRow(inserted, "invitation").id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.invitedByUserId).toBe(fixture.userId);
    });
  });

  // (iii) NULL invited_by_user_id -> accepted (MATCH SIMPLE)
  it("accepts INSERT with NULL invited_by_user_id (MATCH SIMPLE)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedInvitationFixture(outerTx);

      await outerTx.insert(transportOrderInvitations).values({
        companyId: fixture.companyId,
        transportOrderId: fixture.transportOrderId,
        vendorId: fixture.vendorId,
        invitedByUserId: null,
      });

      const rows = await outerTx
        .select()
        .from(transportOrderInvitations)
        .where(
          and(
            eq(transportOrderInvitations.transportOrderId, fixture.transportOrderId),
            isNull(transportOrderInvitations.invitedByUserId),
          ),
        );
      expect(rows).toHaveLength(1);
    });
  });

  // (iv) User delete restricted by NO ACTION
  it("rejects user hard delete referenced by invitation (ON DELETE NO ACTION = RESTRICT)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedInvitationFixture(outerTx);

      await outerTx.insert(transportOrderInvitations).values({
        companyId: fixture.companyId,
        transportOrderId: fixture.transportOrderId,
        vendorId: fixture.vendorId,
        invitedByUserId: fixture.userId,
      });

      await expectPostgresErrorCode(
        () => outerTx.delete(users).where(eq(users.id, fixture.userId)),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  // (v) Statement-time check (NO ACTION non-deferrable)
  it("raises FK violation at statement time for cross-company user (NO ACTION non-deferrable check)", async () => {
    await withRollback(async (outerTx) => {
      const fixtureA = await seedInvitationFixture(outerTx, { companyLabel: "DefA" });
      const fixtureB = await seedInvitationFixture(outerTx, { companyLabel: "DefB" });

      // PostgreSQL non-DEFERRABLE FK with NO ACTION raises at statement time.
      // Using company A row but company B user triggers composite FK immediately.
      await expectPostgresErrorCode(
        () =>
          outerTx.insert(transportOrderInvitations).values({
            companyId: fixtureA.companyId,
            transportOrderId: fixtureA.transportOrderId,
            vendorId: fixtureA.vendorId,
            invitedByUserId: fixtureB.userId,
          }),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });
  // (vi) createTransportOrderWithNotification active path - BLOCK-1 enforcement
  it("createTransportOrderWithNotification sets invitedByUserId from actingUserId (BLOCK-1)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedServiceFixture(outerTx);
      // seedTransportStatuses is called inside seedInvitationFixture, but seedServiceFixture
      // does not call it - createTransportOrderWithNotification needs transport statuses.
      await seedTransportStatuses(outerTx, fixture.companyId);

      const result = await createTransportOrderWithNotification(outerTx, {
        companyId: fixture.companyId,
        vendorId: fixture.vendorId,
        serviceTicketId: fixture.serviceTicketId,
        vehicleId: fixture.vehicleId,
        orderNumber: `TO-${crypto.randomUUID()}`,
        movementType: "one_way",
        pickupStoreId: fixture.pickupStoreId,
        deliveryStoreId: fixture.deliveryStoreId,
        actingUserId: fixture.userId,
      });

      const [invitation] = await outerTx
        .select()
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.id, result.invitationId));

      expect(invitation).toBeDefined();
      expect(invitation?.invitedByUserId).toBe(fixture.userId);
    });
  });

  // (vii) accept_invitation_and_revoke_others RPC - WARN-2 immutability
  it("accept_invitation_and_revoke_others preserves invited_by_user_id after accepting (WARN-2)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedInvitationFixture(outerTx);

      const [invitationRow] = await outerTx
        .insert(transportOrderInvitations)
        .values({
          companyId: fixture.companyId,
          transportOrderId: fixture.transportOrderId,
          vendorId: fixture.vendorId,
          invitedByUserId: fixture.userId,
        })
        .returning({ id: transportOrderInvitations.id });
      const invitation = requireRow(invitationRow, "invitation");

      // Phase 64-C follow-up #2 (post/0032): accept_invitation_and_revoke_others は認可ガードを
      // 復元し current_vendor_user_id() が招待 vendor に属することを要求する + authenticated への
      // 直接 EXECUTE を剥奪。helper が呼ばれる唯一の正規経路は respond_to_transport_order
      // (SECURITY DEFINER=owner 実行) 経由ゆえ、本テストも招待 vendor の vendor_user を seed し
      // vendor session (SET LOCAL ROLE authenticated + claims) で respond 経由に accept させる
      // (tenant-isolation の実証済み機構)。WARN-2 (invited_by_user_id 不変) の検証意図は維持。
      const vendorUserAuthId = crypto.randomUUID();
      await outerTx.execute(sql`INSERT INTO auth.users (id) VALUES (${vendorUserAuthId})`);
      await outerTx.execute(sql`
        INSERT INTO vendor_users (vendor_id, company_id, auth_user_id, email, is_active)
        VALUES (
          ${fixture.vendorId},
          ${fixture.companyId},
          ${vendorUserAuthId},
          ${`vu-warn2-${crypto.randomUUID().slice(0, 8)}@example.test`},
          true
        )
      `);
      await outerTx.execute(sql`SET LOCAL ROLE authenticated`);
      await outerTx.execute(
        sql`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: vendorUserAuthId, role: "authenticated" })}, true)`,
      );

      await outerTx.execute(
        sql`SELECT * FROM public.respond_to_transport_order(${invitation.id}, 'accepted')`,
      );

      // 検証は RLS 非依存に owner で読む。
      await outerTx.execute(sql`RESET ROLE`);
      const [after] = await outerTx
        .select()
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.id, invitation.id));

      expect(after).toBeDefined();
      // invited_by_user_id must be preserved (immutable) after RPC
      expect(after?.invitedByUserId).toBe(fixture.userId);
      // and the invitation should be accepted/winning
      expect(after?.response).toBe("accepted");
      expect(after?.isWinningBid).toBe(true);
    });
  });
});
