import { test, expect, type Page } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';
import * as crypto from 'node:crypto';

import { db } from '@/lib/db/client';
import { vendors } from '@/lib/db/schema/vendors';
import {
  cleanupAdminE2E,
  seedAdminE2E,
  type SeededAdminE2E,
} from '../_helpers/seed-admin-e2e';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? 'http://localhost:3000';

async function loginAsAdmin(
  page: Page,
  admin: SeededAdminE2E,
  targetPath: string,
) {
  await page.goto(BASE_URL + targetPath);
  await page
    .getByLabel(/メールアドレス|email/i)
    .or(page.locator('input[type="email"]'))
    .first()
    .fill(admin.email);
  await page
    .getByLabel(/パスワード|password/i)
    .or(page.locator('input[type="password"]'))
    .first()
    .fill(admin.password);
  await Promise.all([
    page.waitForURL((url) => url.pathname === targetPath, { timeout: 15_000 }),
    page.getByRole('button', { name: /sign|login|ログイン/i }).click(),
  ]);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`${name} is not set`);
  }
  return value;
}

function createSupabaseAdminClient(): SupabaseClient {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    },
  );
}

test.describe.serial('admin vendor invite E2E', () => {
  let supabaseAdmin: SupabaseClient;
  let admin: SeededAdminE2E;
  let vendorId: string;
  let inviteeEmail: string;

  test.beforeAll(async () => {
    supabaseAdmin = createSupabaseAdminClient();
    admin = await seedAdminE2E(db, supabaseAdmin);
    const vendorUuid = crypto.randomUUID();
    const [vendor] = await db
      .insert(vendors)
      .values({
        companyId: admin.companyId,
        name: `E2E Invite Vendor ${vendorUuid}`,
        email: `e2e-invite-vendor-${vendorUuid}@test.local`,
      })
      .returning({ id: vendors.id });
    vendorId = vendor!.id;
    inviteeEmail = `e2e-invitee-${vendorUuid}@test.local`;
  });

  test.afterAll(async () => {
    try {
      const { data: authList } = await supabaseAdmin.auth.admin.listUsers();
      const invited = authList?.users.find((u) => u.email === inviteeEmail);
      if (invited) await supabaseAdmin.auth.admin.deleteUser(invited.id);
    } catch {
      // best-effort
    }
    await db.delete(vendors).where(eq(vendors.id, vendorId)).catch(() => {});
    await cleanupAdminE2E(db, supabaseAdmin, admin);
  });

  test('admin logs in via /vendor/login and lands on /admin/vendors via ?next=', async ({ page }) => {
    await page.goto(`${BASE_URL}/admin/vendors`);
    await page
      .getByLabel(/メールアドレス|email/i)
      .or(page.locator('input[type="email"]'))
      .first()
      .fill(admin.email);
    await page
      .getByLabel(/パスワード|password/i)
      .or(page.locator('input[type="password"]'))
      .first()
      .fill(admin.password);
    await Promise.all([
      page.waitForURL((url) => url.pathname === '/admin/vendors', { timeout: 15_000 }),
      page.getByRole('button', { name: /sign|login|ログイン/i }).click(),
    ]);
    expect(new URL(page.url()).pathname).toBe('/admin/vendors');
  });

  test('admin invites a vendor and sees success banner', async ({ page }) => {
    await loginAsAdmin(page, admin, '/admin/vendors/invite');
    await page.locator('#vendorId').selectOption(vendorId);
    await page.locator('#email').fill(inviteeEmail);
    await Promise.all([
      page.waitForURL(/\/admin\/vendors\?invited=ok/, { timeout: 15_000 }),
      page.getByRole('button', { name: /招待を送信/ }).click(),
    ]);
    await expect(
      page.getByText('業者ユーザーへの招待を送信しました。'),
    ).toBeVisible();
  });

  test('invited user accepts via generateLink → /vendor/requests', async ({ page }) => {
    const callbackUrl = `${BASE_URL}/vendor/admin-invite-callback`;
    const { data, error } = await supabaseAdmin.auth.admin.generateLink({
      type: 'invite',
      email: inviteeEmail,
      options: { redirectTo: callbackUrl },
    });
    if (error) throw error;
    const actionLink = (data as { properties?: { action_link?: string } })
      ?.properties?.action_link;
    if (!actionLink) throw new Error('generateLink returned no action_link');
    await page.goto(actionLink);
    await page.waitForURL(/\/vendor\/requests/, { timeout: 20_000 });
    await expect(page).toHaveURL(/\/vendor\/requests/);
  });
});
