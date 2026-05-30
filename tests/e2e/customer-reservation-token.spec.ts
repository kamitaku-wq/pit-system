import { test, expect } from '@playwright/test';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { eq } from 'drizzle-orm';

import { db } from '@/lib/db/client';
import { customerReservationTokens } from '@/lib/db/schema/customer_reservation_tokens';
import {
  seedCustomerReservationToken,
  type SeededCustomerReservationToken,
} from './_helpers/seed-customer-reservation-token-e2e';

const BASE_URL = process.env.PLAYWRIGHT_BASE_URL ?? `http://localhost:3000`;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

function createSupabaseAdminClient(): SupabaseClient {
  return createClient(
    requireEnv('NEXT_PUBLIC_SUPABASE_URL'),
    requireEnv('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}

test.describe.serial('customer reservation token /r/[token] E2E', () => {
  test.describe('case (1) happy path: GET-safe -> consume -> detail', () => {
    let fixture: SeededCustomerReservationToken;
    let supabaseAdmin: SupabaseClient;

    test.beforeAll(async () => {
      supabaseAdmin = createSupabaseAdminClient();
      fixture = await seedCustomerReservationToken(supabaseAdmin, db);
    });

    test.afterAll(async () => {
      await fixture?.cleanup();
    });

    test('GET /r/{rawToken} shows landing page and token is not yet consumed', async ({ page }) => {
      // 1. Navigate to the token URL via GET.
      await page.goto(`${BASE_URL}/r/${fixture.rawToken}`);

      // 2. Assert landing page content.
      await expect(page.getByRole('heading', { name: '予約確認リンク' })).toBeVisible();
      await expect(page.getByRole('button', { name: '予約を表示する' })).toBeVisible();

      // 3. GET-safe proof: token must NOT be consumed yet.
      //    Unfurl/prefetch/email scanners hitting GET must not burn the token.
      const [tokenRow] = await db
        .select({ usedAt: customerReservationTokens.usedAt })
        .from(customerReservationTokens)
        .where(eq(customerReservationTokens.id, fixture.tokenId))
        .limit(1);
      expect(tokenRow).toBeDefined();
      expect(tokenRow?.usedAt).toBeNull();
    });

    test('clicking confirm button consumes token and shows reservation detail', async ({ page }) => {
      await page.goto(`${BASE_URL}/r/${fixture.rawToken}`);

      // 1. Click the confirm button (form POST -> consume).
      await page.getByRole('button', { name: '予約を表示する' }).click();

      // 2. Assert the reservation detail section is visible.
      await expect(page.getByRole('heading', { name: '予約のご確認' })).toBeVisible();
      // Store name from seeded data must appear in the detail.
      await expect(page.getByText(fixture.storeName)).toBeVisible();

      // 3. Single-use proof: token must be consumed (usedAt != null).
      const [tokenRow] = await db
        .select({ usedAt: customerReservationTokens.usedAt })
        .from(customerReservationTokens)
        .where(eq(customerReservationTokens.id, fixture.tokenId))
        .limit(1);
      expect(tokenRow?.usedAt).not.toBeNull();
    });
  });

  test.describe('case (2) failure path: non-existent token', () => {
    test('GET /r/{invalid-token} shows error message', async ({ page }) => {
      // Use a random 64-hex token that will never exist in the DB.
      const nonExistentToken = Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');
      await page.goto(`${BASE_URL}/r/${nonExistentToken}`);

      await expect(
        page.getByRole('heading', { name: 'リンクが見つかりません' })
      ).toBeVisible();
    });
  });
});
