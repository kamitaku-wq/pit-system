import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { adminVendorInvitations } from "@/lib/db/schema/admin_vendor_invitations";
import { auditLogs } from "@/lib/db/schema/audit_logs";
import { companies } from "@/lib/db/schema/companies";
import { vendorUsers } from "@/lib/db/schema/vendor_users";
import { vendors } from "@/lib/db/schema/vendors";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DATABASE_URL ?? process.env.DIRECT_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);

const getUserMock = vi.fn();

vi.doMock("@/lib/db/client", () => ({ db }));
vi.doMock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      getUser: getUserMock,
    },
  })),
}));

const { POST } = await import("@/app/(vendor-portal)/vendor/admin-invite-callback/finalize/route");

type CallbackFixture = {
  companyId: string;
  vendorId: string;
  vendorUserId: string;
  authUserId: string;
};

afterAll(async () => {
  await queryClient?.end();
});

beforeEach(() => {
  vi.clearAllMocks();
  getUserMock.mockReset();
});

async function seedCallbackFixture(
  options: {
    vendorUser?: boolean;
    isActive?: boolean;
    lastLoginAt?: Date | null;
    withSentInvitation?: boolean;
  } = {},
): Promise<CallbackFixture> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const authUserId = crypto.randomUUID();
  await db!.execute(sql`INSERT INTO auth.users (id) VALUES (${authUserId})`);
  const [company] = await db!
    .insert(companies)
    .values({ name: `__callback_${suffix}__`, code: `callback_${suffix}` })
    .returning({ id: companies.id });
  const [vendor] = await db!
    .insert(vendors)
    .values({
      companyId: company!.id,
      name: `Callback Vendor ${suffix}`,
      email: `callback-${suffix}@example.test`,
      isActive: true,
    })
    .returning({ id: vendors.id });

  if (options.vendorUser === false) {
    return { companyId: company!.id, vendorId: vendor!.id, vendorUserId: "", authUserId };
  }

  const email = `callback-user-${suffix}@example.test`;
  const [vendorUser] = await db!
    .insert(vendorUsers)
    .values({
      authUserId,
      companyId: company!.id,
      vendorId: vendor!.id,
      email,
      name: `Callback User ${suffix}`,
      isActive: options.isActive ?? false,
      lastLoginAt: options.lastLoginAt ?? null,
    })
    .returning({ id: vendorUsers.id });

  if (options.withSentInvitation === true) {
    await db!.insert(adminVendorInvitations).values({
      companyId: company!.id,
      vendorId: vendor!.id,
      email,
      role: "vendor_admin",
      status: "sent",
      sentAt: new Date(),
      vendorUserId: vendorUser!.id,
    });
  }

  return {
    companyId: company!.id,
    vendorId: vendor!.id,
    vendorUserId: vendorUser!.id,
    authUserId,
  };
}

async function cleanupCallbackFixture(fixture: CallbackFixture): Promise<void> {
  if (fixture.vendorUserId) {
    await db!.delete(adminVendorInvitations).where(eq(adminVendorInvitations.vendorUserId, fixture.vendorUserId));
  }
  await db!.delete(vendorUsers).where(eq(vendorUsers.companyId, fixture.companyId));
  await db!.delete(vendors).where(eq(vendors.id, fixture.vendorId));
  await db!.delete(auditLogs).where(eq(auditLogs.companyId, fixture.companyId));
  await db!.delete(companies).where(eq(companies.id, fixture.companyId));
  await db!.execute(sql`DELETE FROM auth.users WHERE id = ${fixture.authUserId}`);
}

describeIntegration("admin invite callback finalize route", () => {
  it("returns 401 when no session", async () => {
    getUserMock.mockResolvedValue({
      data: { user: null },
      error: new Error("no session"),
    });

    const response = await POST();

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ ok: false, error: "no_session" });
  });

  it("returns 404 when vendor user not found", async () => {
    const fixture = await seedCallbackFixture({ vendorUser: false });

    try {
      getUserMock.mockResolvedValue({
        data: { user: { id: fixture.authUserId } },
        error: null,
      });

      const response = await POST();

      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toEqual({
        ok: false,
        error: "vendor_user_not_found",
      });

      const rows = await db!
        .select()
        .from(vendorUsers)
        .where(eq(vendorUsers.authUserId, fixture.authUserId));
      expect(rows).toHaveLength(0);
    } finally {
      await cleanupCallbackFixture(fixture);
    }
  });

  it("returns 200 and updates invitation when ok", async () => {
    const fixture = await seedCallbackFixture({
      isActive: false,
      lastLoginAt: null,
      withSentInvitation: true,
    });

    try {
      getUserMock.mockResolvedValue({
        data: { user: { id: fixture.authUserId } },
        error: null,
      });

      const response = await POST();

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ ok: true });

      const [vendorUser] = await db!
        .select()
        .from(vendorUsers)
        .where(eq(vendorUsers.id, fixture.vendorUserId))
        .limit(1);
      expect(vendorUser!.isActive).toBe(true);
      expect(vendorUser!.lastLoginAt).toBeInstanceOf(Date);

      const [invitation] = await db!
        .select()
        .from(adminVendorInvitations)
        .where(eq(adminVendorInvitations.vendorUserId, fixture.vendorUserId))
        .limit(1);
      expect(invitation!.status).toBe("accepted");
      expect(invitation!.acceptedAt instanceof Date).toBe(true);
    } finally {
      await cleanupCallbackFixture(fixture);
    }
  });
});
