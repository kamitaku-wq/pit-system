import { test, expect, type Page } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import {
  cleanupVendorE2ELoop,
  seedVendorE2ELoop,
  type SeededVendorE2ELoop,
} from "../_helpers/seed-vendor-e2e";

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

async function loginAsVendorA(page: Page, fixture: SeededVendorE2ELoop): Promise<void> {
  const loginResponse = await page.goto(`${BASE_URL}/vendor/login`);
  if (loginResponse?.status() === 404) {
    await page.goto(`${BASE_URL}/login`);
  }

  // Prefer labels from the actual login form; keep input-type fallbacks for route variants.
  await page
    .getByLabel(/メールアドレス|email/i)
    .or(page.locator('input[type="email"]'))
    .first()
    .fill(fixture.vendorUsers.a.email);
  await page
    .getByLabel(/パスワード|password/i)
    .or(page.locator('input[type="password"]'))
    .first()
    .fill(fixture.vendorUsers.a.password);

  await Promise.all([
    page.waitForURL((url: URL) => !isLoginPath(url), { timeout: 15_000 }),
    page.getByRole("button", { name: /sign|login|ログイン/i }).click(),
  ]);
}

test.describe.serial("vendor portal loop E2E", () => {
  let fixture: SeededVendorE2ELoop;
  let supabaseAdmin: SupabaseClient;

  test.beforeAll(async () => {
    supabaseAdmin = createSupabaseAdminClient();
    fixture = await seedVendorE2ELoop(db, supabaseAdmin);
  });

  test.afterAll(async () => {
    await cleanupVendorE2ELoop(db, supabaseAdmin, fixture);
  });

  test("vendor A can accept invitation and order disappears from list", async ({ page }) => {
    await loginAsVendorA(page, fixture);
    await page.goto(`${BASE_URL}/vendor/requests`);

    const orderLabel = fixture.orderNumber || fixture.orderId;
    const orderPattern = new RegExp(escapeRegExp(orderLabel));
    const requestLink = page.getByRole("link", { name: orderPattern });

    // The list item is a semantic link, so selecting by accessible name exercises the row click.
    await expect(requestLink).toBeVisible();
    await requestLink.click();
    await expect(page).toHaveURL(
      (url) => url.pathname === `/vendor/requests/${fixture.invitationIds[0]}`,
    );

    // RespondForm renders the accept action as a visible submit button.
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
      })
      .from(transportOrderInvitations)
      .where(eq(transportOrderInvitations.id, fixture.invitationIds[0]))
      .limit(1);
    expect(invitation).toBeDefined();
    expect(invitation).toMatchObject({
      response: "accepted",
      isWinningBid: true,
    });

    const [order] = await db
      .select({
        vendorId: transportOrders.vendorId,
      })
      .from(transportOrders)
      .where(eq(transportOrders.id, fixture.orderId))
      .limit(1);
    expect(order).toBeDefined();
    expect(order?.vendorId).toBe(fixture.vendorUsers.a.vendorId);
  });

  test("vendor A cannot view a transport order they have no invitation for (RLS)", async ({
    page,
  }) => {
    await loginAsVendorA(page, fixture);

    const randomId = crypto.randomUUID();
    await page.goto(`${BASE_URL}/vendor/requests/${randomId}`);

    await expect(page.getByText(/404|not found|見つかりません/i)).toBeVisible();
  });
});
