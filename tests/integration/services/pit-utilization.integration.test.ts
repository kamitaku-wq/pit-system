import { config } from "dotenv";
import crypto from "node:crypto";
import path from "node:path";
import { drizzle } from "drizzle-orm/postgres-js";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { laneWorkingHours } from "@/lib/db/schema/lane_working_hours";
import { lanes } from "@/lib/db/schema/lanes";
import { reservations } from "@/lib/db/schema/reservations";
import { storeHolidays } from "@/lib/db/schema/store_holidays";
import { stores } from "@/lib/db/schema/stores";
import { getStorePitUtilization } from "@/lib/services/pit-utilization";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

// 2026-06-01 は月曜 (JST)。lane_working_hours の dayOfWeek=1 と一致する (DAY_LABELS は 0=日)。
const DATE = "2026-06-01";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

afterAll(async () => {
  await queryClient?.end();
});

async function withRollback(fn: (outerTx: Tx) => Promise<void>): Promise<void> {
  await db!
    .transaction(async (outerTx: Tx) => {
      try {
        await fn(outerTx);
      } finally {
        throw new Error(ROLLBACK);
      }
    })
    .catch((err: unknown) => {
      if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
    });
}

describeIntegration("getStorePitUtilization", () => {
  it("aggregates utilization per store and treats holidays as zero availability", async () => {
    await withRollback(async (tx) => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const [company] = await tx
        .insert(companies)
        .values({ name: `__pit_${suffix}__`, code: `pit_${suffix}` })
        .returning({ id: companies.id });

      const [openStore, holidayStore] = await tx
        .insert(stores)
        .values([
          { companyId: company.id, code: `o_${suffix}`, name: "稼働店舗" },
          { companyId: company.id, code: `h_${suffix}`, name: "休業店舗" },
        ])
        .returning({ id: stores.id });

      const [openLane, holidayLane] = await tx
        .insert(lanes)
        .values([
          { companyId: company.id, storeId: openStore.id, name: "L1", capacity: 2, isActive: true },
          { companyId: company.id, storeId: holidayStore.id, name: "L1", capacity: 1, isActive: true },
        ])
        .returning({ id: lanes.id });

      // 月曜 09:00-18:00 = 540 分 (両レーン)
      await tx.insert(laneWorkingHours).values([
        { companyId: company.id, laneId: openLane.id, dayOfWeek: 1, startsAt: "09:00:00", endsAt: "18:00:00" },
        { companyId: company.id, laneId: holidayLane.id, dayOfWeek: 1, startsAt: "09:00:00", endsAt: "18:00:00" },
      ]);

      // 稼働店舗に 2 予約 (60 + 120 = 180 分)。JST の当日内。
      await tx.insert(reservations).values([
        {
          companyId: company.id,
          storeId: openStore.id,
          laneId: openLane.id,
          startAt: new Date("2026-06-01T09:00:00+09:00"),
          endAt: new Date("2026-06-01T10:00:00+09:00"),
        },
        {
          companyId: company.id,
          storeId: openStore.id,
          laneId: openLane.id,
          startAt: new Date("2026-06-01T13:00:00+09:00"),
          endAt: new Date("2026-06-01T15:00:00+09:00"),
        },
      ]);

      // 休業店舗を当日休業に
      await tx.insert(storeHolidays).values({
        companyId: company.id,
        storeId: holidayStore.id,
        holidayDate: DATE,
        isClosed: true,
      });

      const result = await getStorePitUtilization({ db: tx, companyId: company.id }, { date: DATE });
      const byId = new Map(result.map((r) => [r.storeId, r]));

      const open = byId.get(openStore.id)!;
      expect(open.laneCount).toBe(1);
      expect(open.totalCapacity).toBe(2);
      expect(open.availableMinutes).toBe(540);
      expect(open.reservedMinutes).toBe(180);
      expect(open.reservationCount).toBe(2);
      expect(open.utilizationRate).toBe(33); // round(180/540*100)
      expect(open.isHoliday).toBe(false);

      const holiday = byId.get(holidayStore.id)!;
      expect(holiday.isHoliday).toBe(true);
      expect(holiday.availableMinutes).toBe(0);
      expect(holiday.utilizationRate).toBe(0);
    });
  });
});
