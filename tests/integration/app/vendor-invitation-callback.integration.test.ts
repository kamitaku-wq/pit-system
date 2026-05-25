import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { NextRequest } from "next/server";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
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

const exchangeCodeForSessionMock = vi.fn();

vi.doMock("@/lib/db/client", () => ({ db }));
vi.doMock("@/lib/supabase/server", () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: exchangeCodeForSessionMock,
    },
  })),
}));

const { GET } = await import("@/app/(vendor-portal)/vendor/invitations/callback/route");

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
  exchangeCodeForSessionMock.mockReset();
});

async function seedCallbackFixture(
  options: { vendorUser?: boolean; isActive?: boolean; lastLoginAt?: Date | null } = {},
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

  const [vendorUser] = await db!
    .insert(vendorUsers)
    .values({
      authUserId,
      companyId: company!.id,
      vendorId: vendor!.id,
      email: `callback-user-${suffix}@example.test`,
      name: `Callback User ${suffix}`,
      isActive: options.isActive ?? false,
      lastLoginAt: options.lastLoginAt ?? null,
    })
    .returning({ id: vendorUsers.id });

  return {
    companyId: company!.id,
    vendorId: vendor!.id,
    vendorUserId: vendorUser!.id,
    authUserId,
  };
}

async function cleanupCallbackFixture(fixture: Pick<CallbackFixture, "companyId" | "vendorId" | "authUserId">): Promise<void> {
  await db!.delete(vendorUsers).where(eq(vendorUsers.companyId, fixture.companyId));
  await db!.delete(vendors).where(eq(vendors.id, fixture.vendorId));
  await db!.delete(auditLogs).where(eq(auditLogs.companyId, fixture.companyId));
  await db!.delete(companies).where(eq(companies.id, fixture.companyId));
  await db!.execute(sql`DELETE FROM auth.users WHERE id = ${fixture.authUserId}`);
}

function callbackRequest(code?: string): NextRequest {
  const url = new URL("http://localhost/vendor/invitations/callback");
  if (code) {
    url.searchParams.set("code", code);
  }
  return new NextRequest(url);
}

describeIntegration("vendor invitation callback route", () => {
  it("happy path: code valid → vendor_users.is_active=true + last_login_at updated → redirect /vendor/requests", async () => {
    const fixture = await seedCallbackFixture({ isActive: false, lastLoginAt: null });

    try {
      exchangeCodeForSessionMock.mockResolvedValue({
        data: { session: { user: { id: fixture.authUserId } } },
        error: null,
      });

      const response = await GET(callbackRequest("valid-code"));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toMatch(/\/vendor\/requests$/);

      const [vendorUser] = await db!
        .select()
        .from(vendorUsers)
        .where(eq(vendorUsers.id, fixture.vendorUserId))
        .limit(1);
      expect(vendorUser!.isActive).toBe(true);
      expect(vendorUser!.lastLoginAt).not.toBeNull();
    } finally {
      await cleanupCallbackFixture(fixture);
    }
  });

  it("code missing → redirect /vendor/login?error=invalid_callback", async () => {
    const response = await GET(callbackRequest());

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toMatch(
      /\/vendor\/login\?error=invalid_callback$/,
    );
    expect(exchangeCodeForSessionMock).not.toHaveBeenCalled();
  });

  it("valid code but no matching vendor_users → redirect /vendor/login?error=vendor_user_not_found", async () => {
    const fixture = await seedCallbackFixture({ vendorUser: false });

    try {
      exchangeCodeForSessionMock.mockResolvedValue({
        data: { session: { user: { id: fixture.authUserId } } },
        error: null,
      });

      const response = await GET(callbackRequest("valid"));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toMatch(
        /\/vendor\/login\?error=vendor_user_not_found$/,
      );

      const rows = await db!
        .select()
        .from(vendorUsers)
        .where(eq(vendorUsers.authUserId, fixture.authUserId));
      expect(rows).toHaveLength(0);
    } finally {
      await cleanupCallbackFixture(fixture);
    }
  });
});
