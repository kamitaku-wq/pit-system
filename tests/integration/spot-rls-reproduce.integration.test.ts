// @vitest-environment node
import { config } from "dotenv";
import { desc, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { afterAll, describe, expect, it } from "vitest";
import { seedTransportStatuses } from "../_helpers/seed-transport-statuses";
import { companies } from "@/lib/db/schema/companies";
import { serviceTickets } from "@/lib/db/schema/service_tickets";
import { statuses } from "@/lib/db/schema/statuses";
import { stores } from "@/lib/db/schema/stores";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vehicles } from "@/lib/db/schema/vehicles";
import { vendorUsers } from "@/lib/db/schema/vendor_users";
import { vendors } from "@/lib/db/schema/vendors";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin: SupabaseClient | undefined =
  supabaseUrl && serviceRoleKey
    ? createClient(supabaseUrl, serviceRoleKey, {
        auth: { autoRefreshToken: false, persistSession: false },
      })
    : undefined;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(
  databaseUrl === undefined || databaseUrl.length === 0 || !supabaseAdmin,
);
const ROLLBACK = "__rollback__";
const createdAuthUserIds: string[] = [];

// Drizzle transaction types vary by driver; this file stays test-only.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

afterAll(async () => {
  try {
    for (const uid of createdAuthUserIds) {
      try {
        await supabaseAdmin!.auth.admin.deleteUser(uid);
      } catch {}
    }
  } finally {
    await queryClient?.end();
  }
});

async function withRollback(fn: (outerTx: Tx) => Promise<void>): Promise<void> {
  let innerError: unknown = null;
  await db!
    .transaction(async (outerTx) => {
      try {
        await fn(outerTx);
      } catch (e) {
        innerError = e;
      } finally {
        throw new Error(ROLLBACK);
      }
    })
    .catch((err) => {
      if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
    });
  if (innerError) throw innerError;
}

describeIntegration("spot vendor invitation RLS reproduction", () => {
  it("keeps a spot email invitation visible through the vendor requests page query", async () => {
    const suffix = crypto.randomUUID().slice(0, 8);
    const inviteeEmail = `spot-rls-${suffix}@example.test`;
    const { data: authData, error: authErr } = await supabaseAdmin!.auth.admin.createUser({
      email: inviteeEmail,
      email_confirm: true,
      password: "TestPass123!",
    });
    if (authErr) throw authErr;
    if (!authData.user) throw new Error("auth user not returned");
    const spotAuthUserId = authData.user.id;
    createdAuthUserIds.push(spotAuthUserId);

    await withRollback(async (tx) => {
      const [company] = await tx
        .insert(companies)
        .values({ name: `__spot_rls_${suffix}__`, code: `spot_rls_${suffix}` })
        .returning({ id: companies.id });
      const companyId = company.id;

      const statusIds = await seedTransportStatuses(tx, companyId);

      const [pickupStore] = await tx
        .insert(stores)
        .values({ companyId, code: `p_${suffix}`, name: "Pickup" })
        .returning({ id: stores.id });
      const pickupStoreId = pickupStore.id;

      const [deliveryStore] = await tx
        .insert(stores)
        .values({ companyId, code: `d_${suffix}`, name: "Delivery" })
        .returning({ id: stores.id });
      const deliveryStoreId = deliveryStore.id;

      const [vehicle] = await tx
        .insert(vehicles)
        .values({ companyId, storeId: pickupStoreId, vin: `PITSPOTRLS${suffix}` })
        .returning({ id: vehicles.id });
      const vehicleId = vehicle.id;

      const [serviceTicket] = await tx
        .insert(serviceTickets)
        .values({
          companyId,
          vehicleId,
          storeId: pickupStoreId,
          ticketNo: `spot-rls-${suffix}`,
          billingStatus: "unbilled",
        })
        .returning({ id: serviceTickets.id });
      const serviceTicketId = serviceTicket.id;

      const [transportOrder] = await tx
        .insert(transportOrders)
        .values({
          companyId,
          orderNumber: `SPOT-RLS-${suffix}`,
          serviceTicketId,
          vehicleId,
          vendorId: null,
          movementType: "one_way",
          pickupStoreId,
          deliveryStoreId,
          statusId: statusIds.requested,
          vendorResponse: "pending",
          confirmationMode: "auto",
          canDrive: true,
          towRequired: false,
        })
        .returning({ id: transportOrders.id });
      const orderId = transportOrder.id;

      const [vendor] = await tx
        .insert(vendors)
        .values({
          companyId,
          name: `Spot Vendor ${suffix}`,
          email: inviteeEmail,
          notificationMethod: "both",
          isShared: false,
          isActive: true,
        })
        .returning({ id: vendors.id });
      const vendorId = vendor.id;

      await tx.insert(vendorUsers).values({
        vendorId,
        authUserId: spotAuthUserId,
        email: inviteeEmail,
        isActive: true,
      });

      const [invitation] = await tx
        .insert(transportOrderInvitations)
        .values({
          companyId,
          transportOrderId: orderId,
          vendorId: null,
          inviteeEmail,
          response: "pending",
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          invitationTokenHash: `spot-rls-${crypto.randomUUID()}`,
        })
        .returning({ id: transportOrderInvitations.id });
      const invitationId = invitation.id;

      await tx.execute(sql`SET LOCAL ROLE authenticated`);
      await tx.execute(sql`
        SELECT set_config(
          'request.jwt.claims',
          jsonb_build_object('sub', ${spotAuthUserId}::text, 'role', 'authenticated')::text,
          true
        )
      `);

      const layer1 = await tx.execute(sql`
        SELECT
          public.current_vendor_id() AS current_vendor_id,
          public.current_vendor_user_id() AS current_vendor_user_id,
          ARRAY(
            SELECT public.vendor_invited_transport_order_ids(${vendorId}::uuid)
          ) AS invited_transport_order_ids
      `);
      console.log("spot rls layer 1 - RPC functions", layer1);

      const layer1a = await tx.execute(sql`
        SELECT
          current_user AS current_user_name,
          current_setting('role', true) AS current_role,
          current_setting('request.jwt.claims', true) AS jwt_claims,
          auth.uid() AS auth_uid
      `);
      console.log("spot rls layer 1a - auth context", layer1a);

      const layer1b = await tx.execute(sql`
        SELECT id, vendor_id, auth_user_id, email, is_active
        FROM public.vendor_users
        WHERE auth_user_id = ${spotAuthUserId}::uuid
           OR email = ${inviteeEmail}
      `);
      console.log("spot rls layer 1b - vendor_users with RLS", layer1b);

      const layer1c = await tx.execute(sql`
        SELECT id, company_id, email, is_active, is_shared
        FROM public.vendors
        WHERE id = ${vendorId}::uuid
      `);
      console.log("spot rls layer 1c - vendors with RLS", layer1c);

      const layer1d = await tx.execute(sql`
        SELECT id, company_id, transport_order_id, vendor_id, invitee_email, response
        FROM public.transport_order_invitations
        WHERE id = ${invitationId}::uuid
      `);
      console.log("spot rls layer 1d - invitations with RLS", layer1d);

      const layer2 = await tx.execute(sql`
        SELECT public.vendor_accessible_company_ids(public.current_vendor_id()) AS company_id
      `);
      console.log("spot rls layer 2 - vendor accessible companies", layer2);

      const layer3 = await tx.execute(sql`
        SELECT public.vendor_invited_transport_order_ids(public.current_vendor_id()) AS transport_order_id
      `);
      console.log("spot rls layer 3 - vendor invited transport order IDs", layer3);

      const layer4a = await tx.execute(sql`
        SELECT count(*)::int AS invitation_count
        FROM public.transport_order_invitations
        WHERE response = 'pending'
      `);
      console.log("spot rls layer 4a - invitations count", layer4a);

      const layer4b = await tx.execute(sql`
        SELECT id, company_id, vendor_id, status_id
        FROM public.transport_orders
        WHERE id = ${orderId}::uuid
      `);
      console.log("spot rls layer 4b - transport_orders with RLS", layer4b);

      const layer4c = await tx.execute(sql`
        SELECT id, company_id, key, name
        FROM public.statuses
        WHERE id = ${statusIds.requested}::uuid
      `);
      console.log("spot rls layer 4c - statuses with RLS", layer4c);

      const layer5a = await tx.execute(sql`
        SELECT
          toi.id AS invitation_id,
          tro.id AS transport_order_id,
          toi.vendor_id AS invitation_vendor_id,
          tro.vendor_id AS order_vendor_id
        FROM public.transport_order_invitations toi
        INNER JOIN public.transport_orders tro ON toi.transport_order_id = tro.id
        WHERE toi.id = ${invitationId}::uuid
          AND toi.response = 'pending'
      `);
      console.log("spot rls layer 5a - invitations JOIN transport_orders", layer5a);

      const layer5b = await tx
        .select({
          invitationId: transportOrderInvitations.id,
          transportOrderId: transportOrders.id,
          title: transportOrders.orderNumber,
          pickupAt: transportOrders.requestedPickupAt,
          dropAt: transportOrders.requestedDeliveryAt,
          statusLabel: statuses.name,
          invitedAt: transportOrderInvitations.invitedAt,
          expiresAt: transportOrderInvitations.expiresAt,
        })
        .from(transportOrderInvitations)
        .innerJoin(
          transportOrders,
          eq(transportOrderInvitations.transportOrderId, transportOrders.id),
        )
        .innerJoin(statuses, eq(transportOrders.statusId, statuses.id))
        .where(eq(transportOrderInvitations.response, "pending"))
        .orderBy(desc(transportOrderInvitations.invitedAt))
        .limit(50);
      console.log("spot rls layer 5b - full 3-table JOIN", layer5b);

      expect(layer5b).toHaveLength(1);
      expect(layer5b[0]?.invitationId).toBe(invitationId);
      expect(layer5b[0]?.transportOrderId).toBe(orderId);
    });
  });
});
