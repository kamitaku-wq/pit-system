import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vendorUsers } from "@/lib/db/schema/vendor_users";
import {
  seedSpotInvitationCaseA,
  type SeededSpotInvitationCaseA,
} from "./_helpers/seed-vendor-spot-e2e";
import {
  seedSpotInvitationCaseC,
  type SeededSpotInvitationCaseC,
} from "./_helpers/seed-vendor-cross-tenant-e2e";

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? "http://localhost:3000";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }

  return value;
}

function createSupabaseAdminClient(): SupabaseClient {
  return createClient(
    requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
    requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isLoginPath(url: URL): boolean {
  return url.pathname === "/vendor/login" || url.pathname === "/login";
}

async function loginAsSpotVendor(
  page: Page,
  fixture: Pick<SeededSpotInvitationCaseA, "inviteeEmail" | "password">,
): Promise<void> {
  const loginResponse = await page.goto(`${BASE_URL}/vendor/login`);
  if (loginResponse?.status() === 404) {
    await page.goto(`${BASE_URL}/login`);
  }

  await page
    .getByLabel(/メールアドレス|email/i)
    .or(page.locator('input[type="email"]'))
    .first()
    .fill(fixture.inviteeEmail);
  await page
    .getByLabel(/パスワード|password/i)
    .or(page.locator('input[type="password"]'))
    .first()
    .fill(fixture.password);

  await Promise.all([
    page.waitForURL((url: URL) => !isLoginPath(url), { timeout: 15_000 }),
    page.getByRole("button", { name: /sign|login|ログイン/i }).click(),
  ]);
}

test.describe.serial("vendor portal spot invitation loop E2E", () => {
  test.describe("case (a) happy path", () => {
    let fixture: SeededSpotInvitationCaseA;
    let supabaseAdmin: SupabaseClient;

    test.beforeAll(async () => {
      supabaseAdmin = createSupabaseAdminClient();
      fixture = await seedSpotInvitationCaseA(supabaseAdmin, db);
    });

    test.afterAll(async () => {
      await fixture?.cleanup();
    });

    test("spot vendor onboarding happy path", async ({ page }) => {
      await page.goto(`${BASE_URL}/vendor/invitations/${fixture.rawToken}`);
      await expect(page.getByText("招待を受け付けました")).toBeVisible();

      const activatedVendorUsers = await db
        .update(vendorUsers)
        .set({ isActive: true, lastLoginAt: new Date() })
        .where(eq(vendorUsers.authUserId, fixture.authUserId))
        .returning({ id: vendorUsers.id });
      expect(activatedVendorUsers.length).toBe(1);

      await loginAsSpotVendor(page, fixture);
      await expect(page).toHaveURL(new RegExp("/vendor/requests$"));

      const orderPattern = new RegExp(escapeRegExp(fixture.transportOrderId));
      const requestLink = page.getByRole("link", { name: orderPattern });

      await expect(requestLink).toBeVisible();
      await requestLink.click();
      await expect(page).toHaveURL(new RegExp(`/vendor/requests/${fixture.invitationId}$`));

      await Promise.all([
        page.waitForURL((url: URL) => url.pathname === "/vendor/requests", { timeout: 15_000 }),
        page.getByRole("button", { name: /accept|承諾/i }).click(),
      ]);

      await page.goto(`${BASE_URL}/vendor/requests`);
      await expect(page.getByRole("link", { name: orderPattern })).toHaveCount(0);

      const [invitation] = await db
        .select({
          response: transportOrderInvitations.response,
          isWinningBid: transportOrderInvitations.isWinningBid,
          boundVendorId: transportOrderInvitations.boundVendorId,
          boundVendorUserId: transportOrderInvitations.boundVendorUserId,
        })
        .from(transportOrderInvitations)
        .where(eq(transportOrderInvitations.id, fixture.invitationId))
        .limit(1);
      expect(invitation).toBeDefined();
      expect(invitation).toMatchObject({
        response: "accepted",
        isWinningBid: true,
      });
      expect(invitation?.boundVendorId).toBeTruthy();
      expect(invitation?.boundVendorUserId).toBeTruthy();

      const [order] = await db
        .select({
          vendorId: transportOrders.vendorId,
        })
        .from(transportOrders)
        .where(eq(transportOrders.id, fixture.transportOrderId))
        .limit(1);
      expect(order).toBeDefined();
      expect(order?.vendorId).toBe(invitation?.boundVendorId);
    });
  });

  test.describe("case (c) cross-tenant", () => {
    let fixture: SeededSpotInvitationCaseC;
    let supabaseAdmin: SupabaseClient;

    test.beforeAll(async () => {
      supabaseAdmin = createSupabaseAdminClient();
      fixture = await seedSpotInvitationCaseC(supabaseAdmin, db);
    });

    test.afterAll(async () => {
      await fixture?.cleanup();
    });

    test("cross-tenant invitation rejected", async ({ page }) => {
      await page.goto(`${BASE_URL}/vendor/invitations/${fixture.rawToken}`);
      await expect(page.getByText("このアカウントでは利用できません")).toBeVisible();
    });
  });
});
