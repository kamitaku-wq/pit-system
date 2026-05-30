// Phase 65 (Sprint β-1): listReservationCalendarEvents の検証。
//
// 検証対象:
//   - reservation を CalendarEventDto (id/title/start/end) で返す。
//   - companyId scope: 他社の reservation は返さない。
//   - deleted_at IS NULL 除外。
//   - title 構築: 顧客名 / 車番 (registration_number) / フォールバック "予約"。
//   - cross-tenant join filter (A.24): 他社 customer/vehicle を指す reservation でも join が
//     company で縛られるため関連を拾わず title はフォールバックになる。
//   - from/to 日時範囲フィルタ (startAt)。

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { customers } from "@/lib/db/schema/customers";
import { lanes } from "@/lib/db/schema/lanes";
import { reservations } from "@/lib/db/schema/reservations";
import { stores } from "@/lib/db/schema/stores";
import { vehicles } from "@/lib/db/schema/vehicles";
import { listReservationCalendarEvents } from "@/lib/services/calendar-events";

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

function serviceDb(outerTx: Tx): Db {
  return outerTx as unknown as Db;
}

interface Fixture {
  companyId: string;
  storeId: string;
  laneId: string;
  customerId: string;
  vehicleId: string;
}

async function seedFixture(outerTx: Tx, label = "co"): Promise<Fixture> {
  const s = crypto.randomUUID().slice(0, 8);
  const [company] = await outerTx
    .insert(companies)
    .values({ name: `__cal_${label}_${s}__`, code: `cal_${label}_${s}` })
    .returning({ id: companies.id });
  const companyId = requireRow(company, "company").id;

  const [store] = await outerTx
    .insert(stores)
    .values({ companyId, code: `st_${s}`, name: `Store ${s}` })
    .returning({ id: stores.id });
  const storeId = requireRow(store, "store").id;

  const [lane] = await outerTx
    .insert(lanes)
    .values({ companyId, storeId, name: `Lane ${s}` })
    .returning({ id: lanes.id });
  const laneId = requireRow(lane, "lane").id;

  const [customer] = await outerTx
    .insert(customers)
    .values({ companyId, fullName: `山田太郎 ${s}` })
    .returning({ id: customers.id });
  const customerId = requireRow(customer, "customer").id;

  const [vehicle] = await outerTx
    .insert(vehicles)
    .values({
      companyId,
      storeId,
      vin: `CAL${s.toUpperCase()}0000000`,
      registrationNumber: `品川300あ${s.slice(0, 4)}`,
    })
    .returning({ id: vehicles.id });
  const vehicleId = requireRow(vehicle, "vehicle").id;

  return { companyId, storeId, laneId, customerId, vehicleId };
}

async function seedReservation(
  outerTx: Tx,
  fixture: Fixture,
  overrides: {
    startAt?: Date;
    endAt?: Date;
    customerId?: string | null;
    vehicleId?: string | null;
    deletedAt?: Date | null;
  } = {},
): Promise<string> {
  const start = overrides.startAt ?? new Date("2026-06-03T01:00:00.000Z");
  const end = overrides.endAt ?? new Date("2026-06-03T02:00:00.000Z");
  const [row] = await outerTx
    .insert(reservations)
    .values({
      companyId: fixture.companyId,
      storeId: fixture.storeId,
      laneId: fixture.laneId,
      customerId: overrides.customerId === undefined ? fixture.customerId : overrides.customerId,
      vehicleId: overrides.vehicleId === undefined ? fixture.vehicleId : overrides.vehicleId,
      startAt: start,
      endAt: end,
      deletedAt: overrides.deletedAt ?? null,
    })
    .returning({ id: reservations.id });
  return requireRow(row, "reservation").id;
}

describeIntegration("listReservationCalendarEvents", () => {
  it("returns a reservation as a CalendarEventDto with built title", async () => {
    await withRollback(async (outerTx) => {
      const fx = await seedFixture(outerTx);
      const id = await seedReservation(outerTx, fx);

      const events = await listReservationCalendarEvents(serviceDb(outerTx), {
        companyId: fx.companyId,
      });
      const event = events.find((e) => e.id === id);
      expect(event).toBeDefined();
      expect(event?.start).toBe("2026-06-03T01:00:00.000Z");
      expect(event?.end).toBe("2026-06-03T02:00:00.000Z");
      expect(event?.title).toContain("山田太郎");
      expect(event?.title).toContain("品川");
    });
  });

  it("scopes to companyId", async () => {
    await withRollback(async (outerTx) => {
      const fxA = await seedFixture(outerTx, "A");
      const fxB = await seedFixture(outerTx, "B");
      const idA = await seedReservation(outerTx, fxA);
      const idB = await seedReservation(outerTx, fxB);

      const events = await listReservationCalendarEvents(serviceDb(outerTx), {
        companyId: fxA.companyId,
      });
      const ids = events.map((e) => e.id);
      expect(ids).toContain(idA);
      expect(ids).not.toContain(idB);
    });
  });

  it("excludes soft-deleted reservations", async () => {
    await withRollback(async (outerTx) => {
      const fx = await seedFixture(outerTx);
      const live = await seedReservation(outerTx, fx);
      const deleted = await seedReservation(outerTx, fx, { deletedAt: new Date() });

      const events = await listReservationCalendarEvents(serviceDb(outerTx), {
        companyId: fx.companyId,
      });
      const ids = events.map((e) => e.id);
      expect(ids).toContain(live);
      expect(ids).not.toContain(deleted);
    });
  });

  it("falls back to '予約' when customer and vehicle are absent", async () => {
    await withRollback(async (outerTx) => {
      const fx = await seedFixture(outerTx);
      const id = await seedReservation(outerTx, fx, { customerId: null, vehicleId: null });

      const events = await listReservationCalendarEvents(serviceDb(outerTx), {
        companyId: fx.companyId,
      });
      expect(events.find((e) => e.id === id)?.title).toBe("予約");
    });
  });

  it("does not pull cross-tenant customer/vehicle into the title (join company filter)", async () => {
    await withRollback(async (outerTx) => {
      const fxA = await seedFixture(outerTx, "A");
      const fxB = await seedFixture(outerTx, "B");
      // company A の reservation が company B の customer/vehicle を指す異常データ。
      const id = await seedReservation(outerTx, fxA, {
        customerId: fxB.customerId,
        vehicleId: fxB.vehicleId,
      });

      const events = await listReservationCalendarEvents(serviceDb(outerTx), {
        companyId: fxA.companyId,
      });
      // join が company で縛られるため B の customer/vehicle は拾われず title はフォールバック。
      expect(events.find((e) => e.id === id)?.title).toBe("予約");
    });
  });

  it("applies from/to range on startAt", async () => {
    await withRollback(async (outerTx) => {
      const fx = await seedFixture(outerTx);
      const inRange = await seedReservation(outerTx, fx, {
        startAt: new Date("2026-06-10T01:00:00.000Z"),
        endAt: new Date("2026-06-10T02:00:00.000Z"),
      });
      const outOfRange = await seedReservation(outerTx, fx, {
        startAt: new Date("2026-07-01T01:00:00.000Z"),
        endAt: new Date("2026-07-01T02:00:00.000Z"),
      });

      const events = await listReservationCalendarEvents(serviceDb(outerTx), {
        companyId: fx.companyId,
        from: new Date("2026-06-01T00:00:00.000Z"),
        to: new Date("2026-06-30T23:59:59.000Z"),
      });
      const ids = events.map((e) => e.id);
      expect(ids).toContain(inRange);
      expect(ids).not.toContain(outOfRange);
    });
  });
});
