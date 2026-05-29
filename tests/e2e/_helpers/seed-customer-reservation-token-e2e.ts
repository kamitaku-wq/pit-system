/**
 * Seed helper for customer reservation token E2E tests (Phase 64-A.23/A.24).
 * Builds a full reservation graph then issues a customer reservation token.
 * Modelled after seed-vendor-spot-e2e.ts.
 * Reservation graph sourced from
 * tests/integration/services/customer-reservation-detail.integration.test.ts
 */

import * as crypto from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { inArray } from 'drizzle-orm';

import type { DB } from '@/lib/db/client';
import { auditLogs } from '@/lib/db/schema/audit_logs';
import { companies } from '@/lib/db/schema/companies';
import { customerReservationTokens } from '@/lib/db/schema/customer_reservation_tokens';
import { customers } from '@/lib/db/schema/customers';
import { lanes } from '@/lib/db/schema/lanes';
import { reservations } from '@/lib/db/schema/reservations';
import { statuses } from '@/lib/db/schema/statuses';
import { stores } from '@/lib/db/schema/stores';
import { vehicles } from '@/lib/db/schema/vehicles';
import { workMenus } from '@/lib/db/schema/work_menus';
import { issueToken } from '@/lib/services/customer-reservation-tokens';

export interface SeededCustomerReservationToken {
  /** Raw token returned by issueToken -- used as URL path param */
  rawToken: string;
  tokenId: string;
  reservationId: string;
  companyId: string;
  storeId: string;
  /** The store name seeded so E2E can assert it appears in the detail view */
  storeName: string;
  cleanup: () => Promise<void>;
}

type SeedState = {
  companyIds: string[];
  storeIds: string[];
  laneIds: string[];
  workMenuIds: string[];
  vehicleIds: string[];
  customerIds: string[];
  statusIds: string[];
  reservationIds: string[];
  tokenIds: string[];
};

function requireRow<T>(row: T | undefined, label: string): T {
  if (!row) throw new Error(`E2E seed failed: missing ${label}`);
  return row;
}

async function ignoreCleanupError(fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch {
    // Cleanup is best-effort so partial setup failures do not mask the original error.
  }
}

// Cleanup FK order: token -> reservation -> customer/vehicle/workMenu/lane/store/status -> audit_logs -> company
async function cleanupSeed(db: DB, state: SeedState): Promise<void> {
  await ignoreCleanupError(async () => {
    if (state.tokenIds.length > 0)
      await db.delete(customerReservationTokens).where(inArray(customerReservationTokens.id, state.tokenIds));
  });
  await ignoreCleanupError(async () => {
    if (state.reservationIds.length > 0)
      await db.delete(reservations).where(inArray(reservations.id, state.reservationIds));
  });
  await ignoreCleanupError(async () => {
    if (state.customerIds.length > 0)
      await db.delete(customers).where(inArray(customers.id, state.customerIds));
  });
  await ignoreCleanupError(async () => {
    if (state.vehicleIds.length > 0)
      await db.delete(vehicles).where(inArray(vehicles.id, state.vehicleIds));
  });
  await ignoreCleanupError(async () => {
    if (state.workMenuIds.length > 0)
      await db.delete(workMenus).where(inArray(workMenus.id, state.workMenuIds));
  });
  await ignoreCleanupError(async () => {
    if (state.laneIds.length > 0)
      await db.delete(lanes).where(inArray(lanes.id, state.laneIds));
  });
  await ignoreCleanupError(async () => {
    if (state.storeIds.length > 0)
      await db.delete(stores).where(inArray(stores.id, state.storeIds));
  });
  await ignoreCleanupError(async () => {
    if (state.statusIds.length > 0)
      await db.delete(statuses).where(inArray(statuses.id, state.statusIds));
  });
  // audit_logs trigger rows may block companies DELETE (same pattern as seed-vendor-spot-e2e.ts)
  await ignoreCleanupError(async () => {
    if (state.companyIds.length > 0)
      await db.delete(auditLogs).where(inArray(auditLogs.companyId, state.companyIds));
  });
  await ignoreCleanupError(async () => {
    if (state.companyIds.length > 0)
      await db.delete(companies).where(inArray(companies.id, state.companyIds));
  });
}

export async function seedCustomerReservationToken(
  _supabaseAdmin: SupabaseClient,
  db: DB,
): Promise<SeededCustomerReservationToken> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const storeName = `E2E Store ${suffix}`;
  const state: SeedState = {
    companyIds: [], storeIds: [], laneIds: [], workMenuIds: [],
    vehicleIds: [], customerIds: [], statusIds: [], reservationIds: [], tokenIds: [],
  };
  try {
    const seeded = await db.transaction(async (tx) => {
      // company
      const [company] = await tx
        .insert(companies)
        .values({ name: `E2E CRT Company ${suffix}`, code: `crt_e2e_${suffix}` })
        .returning({ id: companies.id });
      const companyId = requireRow(company, 'company').id;
      state.companyIds.push(companyId);

      // store
      const [store] = await tx
        .insert(stores)
        .values({ companyId, code: `s_${suffix}`, name: storeName })
        .returning({ id: stores.id });
      const storeId = requireRow(store, 'store').id;
      state.storeIds.push(storeId);

      // lane
      const [lane] = await tx
        .insert(lanes)
        .values({ companyId, storeId, name: `Lane ${suffix}` })
        .returning({ id: lanes.id });
      const laneId = requireRow(lane, 'lane').id;
      state.laneIds.push(laneId);

      // workMenu
      const [menu] = await tx
        .insert(workMenus)
        .values({ companyId, code: `wm_${suffix}`, name: `Oil change ${suffix}`, durationMinutes: 30 })
        .returning({ id: workMenus.id });
      const workMenuId = requireRow(menu, 'workMenu').id;
      state.workMenuIds.push(workMenuId);

      // vehicle
      const [vehicle] = await tx
        .insert(vehicles)
        .values({ companyId, registrationNumber: `品川 300 あ ${suffix.slice(0, 4)}`, maker: 'Toyota', model: 'Corolla' })
        .returning({ id: vehicles.id });
      const vehicleId = requireRow(vehicle, 'vehicle').id;
      state.vehicleIds.push(vehicleId);

      // customer
      const [customer] = await tx
        .insert(customers)
        .values({ companyId, fullName: `山田 太郎 ${suffix}`, phone: '090-0000-0000' })
        .returning({ id: customers.id });
      const customerId = requireRow(customer, 'customer').id;
      state.customerIds.push(customerId);

      // status (reservation type)
      const [status] = await tx
        .insert(statuses)
        .values({ companyId, statusType: 'reservation', key: `confirmed_${suffix}`, name: '確定' })
        .returning({ id: statuses.id });
      const statusId = requireRow(status, 'status').id;
      state.statusIds.push(statusId);

      // reservation
      const [reservation] = await tx
        .insert(reservations)
        .values({
          companyId, storeId, laneId, workMenuId, vehicleId, customerId, statusId,
          startAt: new Date('2026-06-01T09:00:00Z'),
          endAt: new Date('2026-06-01T10:00:00Z'),
          notes: 'E2E smoke test reservation',
        })
        .returning({ id: reservations.id });
      const reservationId = requireRow(reservation, 'reservation').id;
      state.reservationIds.push(reservationId);
      return { companyId, storeId, reservationId };
    });

    const tokenResult = await issueToken(
      { reservationId: seeded.reservationId, ttlMinutes: 60, purpose: 'view' },
      { db, companyId: seeded.companyId },
    );
    state.tokenIds.push(tokenResult.id);
    return {
      rawToken: tokenResult.rawToken,
      tokenId: tokenResult.id,
      reservationId: seeded.reservationId,
      companyId: seeded.companyId,
      storeId: seeded.storeId,
      storeName,
      cleanup: async () => cleanupSeed(db, state),
    };
  } catch (error) {
    await cleanupSeed(db, state);
    throw error;
  }
}
