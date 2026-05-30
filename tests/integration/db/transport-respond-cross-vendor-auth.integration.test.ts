import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import { sql } from "drizzle-orm";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { seedTransportStatuses } from "../../_helpers/seed-transport-statuses";
import { companies } from "@/lib/db/schema/companies";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { stores } from "@/lib/db/schema/stores";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendorCompanyMemberships } from "@/lib/db/schema/vendor_company_memberships";
import { vendorUsers } from "@/lib/db/schema/vendor_users";
import { vendors } from "@/lib/db/schema/vendors";

// Phase 64-C follow-up #2 (security hardening / post/0032):
//   accept_invitation_and_revoke_others の認可ガード復元を検証する。post/0006 が Phase 27 で
//   認可ガードを巻き添え削除したため、respond_to_transport_order の accept 経路で任意の
//   authenticated user が他 vendor の pending invitation を accept できる cross-tenant bypass が
//   あった。post/0032 で guard を復元し、(a) 他 vendor の accept が 42501 で拒否されること、
//   (b) 正規の自 vendor accept は従来通り成功すること、(c) helper の直接 EXECUTE が authenticated
//   から剥奪されていること (BLOCK 2 defense-in-depth) を確認する。
//
//   harness: tenant-isolation / FK テスト方式 (drizzle withRollback で seed → SET LOCAL ROLE
//   authenticated + request.jwt.claims でロール切替 → RPC 実行)。withAuthenticatedDb と同じ機構。

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

interface CrossVendorFixture {
  invitationId: string;
  vendorAUserAuthId: string;
  vendorBUserAuthId: string;
}

// 同一 company 内に vendor A / vendor B を用意し、vendor A 宛の pending invitation を持つ
// requested な transport_order を seed する。vendor B が vendor A の invitation を accept できないことを
// 検証するための最小 fixture。
async function seedCrossVendorFixture(outerTx: Tx): Promise<CrossVendorFixture> {
  const suffix = crypto.randomUUID().slice(0, 8);

  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__xv_${suffix}__`, code: `xv_${suffix}` })
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
      vin: `XV${suffix.toUpperCase()}000000`,
    })
    .returning({ id: vehicles.id });
  const vehicle = requireRow(vehicleRow, "vehicle");

  const [serviceTicketRow] = await outerTx
    .insert(serviceTickets)
    .values({
      companyId: company.id,
      vehicleId: vehicle.id,
      storeId: pickupStore.id,
      ticketNo: `xv-${suffix}`,
      billingStatus: "unbilled",
    })
    .returning({ id: serviceTickets.id });
  const serviceTicket = requireRow(serviceTicketRow, "service ticket");

  const [vendorARow, vendorBRow] = await outerTx
    .insert(vendors)
    .values([
      { companyId: company.id, name: `Vendor A ${suffix}`, isActive: true },
      { companyId: company.id, name: `Vendor B ${suffix}`, isActive: true },
    ])
    .returning({ id: vendors.id });
  const vendorA = requireRow(vendorARow, "vendor A");
  const vendorB = requireRow(vendorBRow, "vendor B");

  await outerTx.insert(vendorCompanyMemberships).values([
    { vendorId: vendorA.id, companyId: company.id, isEnabled: true },
    { vendorId: vendorB.id, companyId: company.id, isEnabled: true },
  ]);

  // vendor user (auth.users → vendor_users)。current_vendor_user_id() は jwt.sub と
  // vendor_users.auth_user_id を突合する。
  const vendorAUserAuthId = crypto.randomUUID();
  const vendorBUserAuthId = crypto.randomUUID();
  await outerTx.execute(
    sql`INSERT INTO auth.users (id) VALUES (${vendorAUserAuthId}), (${vendorBUserAuthId})`,
  );
  await outerTx.insert(vendorUsers).values([
    {
      vendorId: vendorA.id,
      companyId: company.id,
      authUserId: vendorAUserAuthId,
      email: `vua-${suffix}@example.test`,
      isActive: true,
    },
    {
      vendorId: vendorB.id,
      companyId: company.id,
      authUserId: vendorBUserAuthId,
      email: `vub-${suffix}@example.test`,
      isActive: true,
    },
  ]);

  const statusIds = await seedTransportStatuses(outerTx, company.id);

  const [transportOrderRow] = await outerTx
    .insert(transportOrders)
    .values({
      companyId: company.id,
      vendorId: vendorA.id,
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

  // vendor A 宛の pending invitation
  const [invitationRow] = await outerTx
    .insert(transportOrderInvitations)
    .values({
      companyId: company.id,
      transportOrderId: transportOrder.id,
      vendorId: vendorA.id,
      response: "pending",
    })
    .returning({ id: transportOrderInvitations.id });
  const invitation = requireRow(invitationRow, "invitation");

  return { invitationId: invitation.id, vendorAUserAuthId, vendorBUserAuthId };
}

async function actAsVendor(tx: Tx, authUserId: string): Promise<void> {
  await tx.execute(sql`SET LOCAL ROLE authenticated`);
  await tx.execute(
    sql`SELECT set_config('request.jwt.claims', ${JSON.stringify({ sub: authUserId, role: "authenticated" })}, true)`,
  );
}

describeIntegration(
  "respond_to_transport_order cross-vendor auth (Phase 64-C follow-up #2 / post/0032)",
  () => {
    it("rejects accept of another vendor's invitation with 42501 (vendor B → vendor A invitation)", async () => {
      await withRollback(async (outerTx) => {
        const fx = await seedCrossVendorFixture(outerTx);
        await actAsVendor(outerTx, fx.vendorBUserAuthId);

        let code: string | undefined;
        let message: string | undefined;
        try {
          await outerTx.execute(
            sql`SELECT * FROM public.respond_to_transport_order(${fx.invitationId}, 'accepted')`,
          );
        } catch (err) {
          code = (err as { code?: string }).code;
          message = (err as { message?: string }).message;
        }
        expect(code).toBe("42501");
        // 汎用的な "ある 42501" ではなく vendor-mismatch ガード分岐が発火したことを確認する
        // (NULL vendor-user / spot 等の別 42501 と区別)。
        expect(message ?? "").toContain("does not belong to invitation vendor");
      });
    });

    it("allows the assigned vendor to accept its own invitation (vendor A → vendor A invitation)", async () => {
      await withRollback(async (outerTx) => {
        const fx = await seedCrossVendorFixture(outerTx);
        await actAsVendor(outerTx, fx.vendorAUserAuthId);

        const result = await outerTx.execute(
          sql`SELECT * FROM public.respond_to_transport_order(${fx.invitationId}, 'accepted')`,
        );
        const rows = (result as { rows?: unknown[] }).rows ?? (result as unknown[]);
        expect(Array.isArray(rows) ? rows.length : 0).toBe(1);

        // invitation が accepted / winning に遷移していること (RPC は definer 内部で owner 実行)。
        // 検証 SELECT は RLS 非依存に owner で読む。
        await outerTx.execute(sql`RESET ROLE`);
        const invRows = await outerTx.execute(
          sql`SELECT response, is_winning_bid FROM public.transport_order_invitations WHERE id = ${fx.invitationId}`,
        );
        const inv = ((invRows as { rows?: unknown[] }).rows ?? (invRows as unknown[]))[0] as
          | { response?: string; is_winning_bid?: boolean }
          | undefined;
        expect(inv?.response).toBe("accepted");
        expect(inv?.is_winning_bid).toBe(true);
      });
    });

    it("revokes EXECUTE on accept_invitation_and_revoke_others from authenticated (BLOCK 2 defense-in-depth)", async () => {
      const rows = await db!.execute(
        sql`SELECT has_function_privilege('authenticated', 'public.accept_invitation_and_revoke_others(uuid)', 'EXECUTE') AS can_exec`,
      );
      const row = ((rows as { rows?: unknown[] }).rows ?? (rows as unknown[]))[0] as
        | { can_exec?: boolean }
        | undefined;
      expect(row?.can_exec).toBe(false);
    });
  },
);
