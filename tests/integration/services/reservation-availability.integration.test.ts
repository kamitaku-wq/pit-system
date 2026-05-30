import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { laneWorkingHours } from "@/lib/db/schema/lane_working_hours";
import { laneWorkMenus } from "@/lib/db/schema/lane_work_menus";
import { lanes } from "@/lib/db/schema/lanes";
import { reservations } from "@/lib/db/schema/reservations";
import { reservationSettings } from "@/lib/db/schema/reservation_settings";
import { storeBusinessHours } from "@/lib/db/schema/store_business_hours";
import { storeHolidays } from "@/lib/db/schema/store_holidays";
import { stores } from "@/lib/db/schema/stores";
import { workMenus } from "@/lib/db/schema/work_menus";
import {
  checkReservationSlotAvailable,
  listAvailableSlots,
} from "@/lib/services/reservation-availability";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

// アンカー: 09:00 JST = 00:00 UTC (JST = UTC+9, DST なし)。
// 営業時間 09:00-18:00 JST = 00:00-09:00 UTC。
const TEST_DATE = "2026-07-15"; // 任意の暦日 (営業時間は全曜日 seed のため dow 非依存)。
const NOW = new Date("2026-07-01T00:00:00Z"); // TEST_DATE の 14 日前 (lead 0 / advance 90 内)。

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

type Tenant = { companyId: string; storeId: string; laneId: string };

async function seedTenant(outerTx: Tx, label: string): Promise<Tenant> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [company] = await outerTx
    .insert(companies)
    .values({ name: `__resa_${label}_${suffix}__`, code: `resa_${label}_${suffix}` })
    .returning({ id: companies.id });
  const [store] = await outerTx
    .insert(stores)
    .values({ companyId: company.id, code: `s_${suffix}`, name: "Store" })
    .returning({ id: stores.id });
  const [lane] = await outerTx
    .insert(lanes)
    .values({ companyId: company.id, storeId: store.id, name: `Lane ${suffix}` })
    .returning({ id: lanes.id });
  return { companyId: company.id, storeId: store.id, laneId: lane.id };
}

// 全曜日 (0-6) に営業時間 / lane 稼働を seed (dow 非依存にするため)。
async function seedHours(
  outerTx: Tx,
  tenant: Tenant,
  opts: {
    storeOpens?: string;
    storeCloses?: string;
    laneStarts?: string;
    laneEnds?: string;
  } = {},
): Promise<void> {
  const storeOpens = opts.storeOpens ?? "09:00:00";
  const storeCloses = opts.storeCloses ?? "18:00:00";
  const laneStarts = opts.laneStarts ?? "09:00:00";
  const laneEnds = opts.laneEnds ?? "18:00:00";
  for (let dow = 0; dow <= 6; dow += 1) {
    await outerTx.insert(storeBusinessHours).values({
      companyId: tenant.companyId,
      storeId: tenant.storeId,
      dayOfWeek: dow,
      opensAt: storeOpens,
      closesAt: storeCloses,
      acceptsReservations: true,
    });
    await outerTx.insert(laneWorkingHours).values({
      companyId: tenant.companyId,
      laneId: tenant.laneId,
      dayOfWeek: dow,
      startsAt: laneStarts,
      endsAt: laneEnds,
    });
  }
}

// 特定 1 曜日だけ営業時間 / lane 稼働を seed (dayOfWeek 変換のアンカー用)。
async function seedHoursForDow(outerTx: Tx, tenant: Tenant, dow: number): Promise<void> {
  await outerTx.insert(storeBusinessHours).values({
    companyId: tenant.companyId,
    storeId: tenant.storeId,
    dayOfWeek: dow,
    opensAt: "09:00:00",
    closesAt: "18:00:00",
    acceptsReservations: true,
  });
  await outerTx.insert(laneWorkingHours).values({
    companyId: tenant.companyId,
    laneId: tenant.laneId,
    dayOfWeek: dow,
    startsAt: "09:00:00",
    endsAt: "18:00:00",
  });
}

describeIntegration("checkReservationSlotAvailable (gate)", () => {
  it("anchors JST day-of-week: only the seeded weekday is open (07-15 open, 07-16 closed)", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "dow");
      // TEST_DATE の JST 曜日を SUT 非依存に算出 (noon JST instant の UTC weekday = その暦日の曜日)。
      const dow = new Date(`${TEST_DATE}T12:00:00+09:00`).getUTCDay();
      await seedHoursForDow(outerTx, tenant, dow);

      // TEST_DATE (seed した曜日) は予約可。
      const open = await checkReservationSlotAvailable(
        {
          storeId: tenant.storeId,
          laneId: tenant.laneId,
          startAt: new Date("2026-07-15T00:00:00Z"),
          endAt: new Date("2026-07-15T01:00:00Z"),
        },
        { db: outerTx, now: NOW },
      );
      expect(open.ok).toBe(true);

      // 翌日 2026-07-16 (異なる曜日、未 seed) は closed。
      // jstDayOfWeek が誤っていればこの 2 アサートが両立しない (アンカー)。
      const closed = await checkReservationSlotAvailable(
        {
          storeId: tenant.storeId,
          laneId: tenant.laneId,
          startAt: new Date("2026-07-16T00:00:00Z"),
          endAt: new Date("2026-07-16T01:00:00Z"),
        },
        { db: outerTx, now: NOW },
      );
      expect(closed.ok).toBe(false);
      if (closed.ok) return;
      expect(closed.reason).toBe("closed");
    });
  });

  it("accepts a slot inside business hours (09:00-10:00 JST = 00:00-01:00 UTC)", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "ok");
      await seedHours(outerTx, tenant);

      const result = await checkReservationSlotAvailable(
        {
          storeId: tenant.storeId,
          laneId: tenant.laneId,
          startAt: new Date("2026-07-15T00:00:00Z"),
          endAt: new Date("2026-07-15T01:00:00Z"),
        },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(true);
    });
  });

  it("rejects a slot before opening (08:00 JST) with outside_business_hours", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "early");
      await seedHours(outerTx, tenant);

      // 2026-07-14T23:00Z = 2026-07-15T08:00 JST (同 JST 暦日、開店前)。
      const result = await checkReservationSlotAvailable(
        {
          storeId: tenant.storeId,
          laneId: tenant.laneId,
          startAt: new Date("2026-07-14T23:00:00Z"),
          endAt: new Date("2026-07-15T00:00:00Z"),
        },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("outside_business_hours");
    });
  });

  it("rejects a slot after closing (18:00-19:00 JST) with outside_business_hours", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "late");
      await seedHours(outerTx, tenant);

      // 2026-07-15T09:00Z = 18:00 JST (閉店時刻), end 19:00 JST → 窓外。
      const result = await checkReservationSlotAvailable(
        {
          storeId: tenant.storeId,
          laneId: tenant.laneId,
          startAt: new Date("2026-07-15T09:00:00Z"),
          endAt: new Date("2026-07-15T10:00:00Z"),
        },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("outside_business_hours");
    });
  });

  it("rejects a closed holiday with closed", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "holi");
      await seedHours(outerTx, tenant);
      await outerTx.insert(storeHolidays).values({
        companyId: tenant.companyId,
        storeId: tenant.storeId,
        holidayDate: TEST_DATE,
        isClosed: true,
      });

      const result = await checkReservationSlotAvailable(
        {
          storeId: tenant.storeId,
          laneId: tenant.laneId,
          startAt: new Date("2026-07-15T00:00:00Z"),
          endAt: new Date("2026-07-15T01:00:00Z"),
        },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("closed");
    });
  });

  it("rejects a slot before the min lead time with too_soon", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "soon");
      await seedHours(outerTx, tenant);
      await outerTx.insert(reservationSettings).values({
        companyId: tenant.companyId,
        storeId: tenant.storeId,
        minLeadTimeMinutes: 60,
      });

      // now = slot 開始 15 分前、lead 60 分 → too_soon。
      const result = await checkReservationSlotAvailable(
        {
          storeId: tenant.storeId,
          laneId: tenant.laneId,
          startAt: new Date("2026-07-15T00:00:00Z"),
          endAt: new Date("2026-07-15T01:00:00Z"),
        },
        { db: outerTx, now: new Date("2026-07-14T23:45:00Z") },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("too_soon");
    });
  });

  it("rejects a slot beyond the advance window with too_far", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "far");
      await seedHours(outerTx, tenant);
      await outerTx.insert(reservationSettings).values({
        companyId: tenant.companyId,
        storeId: tenant.storeId,
        maxAdvanceDays: 7,
      });

      // now=2026-07-01, advance 7 日 → 上限 2026-07-08。TEST_DATE(07-15) は窓外。
      const result = await checkReservationSlotAvailable(
        {
          storeId: tenant.storeId,
          laneId: tenant.laneId,
          startAt: new Date("2026-07-15T00:00:00Z"),
          endAt: new Date("2026-07-15T01:00:00Z"),
        },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("too_far");
    });
  });

  it("rejects a duration that does not match the work menu with duration_mismatch", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "dur");
      await seedHours(outerTx, tenant);
      const [menu] = await outerTx
        .insert(workMenus)
        .values({ companyId: tenant.companyId, code: "oil", name: "Oil", durationMinutes: 60 })
        .returning({ id: workMenus.id });
      await outerTx
        .insert(laneWorkMenus)
        .values({ companyId: tenant.companyId, laneId: tenant.laneId, workMenuId: menu.id });

      // menu = 60 分だが client は 30 分窓を送る → duration_mismatch。
      const result = await checkReservationSlotAvailable(
        {
          storeId: tenant.storeId,
          laneId: tenant.laneId,
          workMenuId: menu.id,
          startAt: new Date("2026-07-15T00:00:00Z"),
          endAt: new Date("2026-07-15T00:30:00Z"),
        },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("duration_mismatch");
    });
  });

  it("accepts a slot whose duration matches the work menu", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "durok");
      await seedHours(outerTx, tenant);
      const [menu] = await outerTx
        .insert(workMenus)
        .values({ companyId: tenant.companyId, code: "oil", name: "Oil", durationMinutes: 60 })
        .returning({ id: workMenus.id });
      await outerTx
        .insert(laneWorkMenus)
        .values({ companyId: tenant.companyId, laneId: tenant.laneId, workMenuId: menu.id });

      const result = await checkReservationSlotAvailable(
        {
          storeId: tenant.storeId,
          laneId: tenant.laneId,
          workMenuId: menu.id,
          startAt: new Date("2026-07-15T00:00:00Z"),
          endAt: new Date("2026-07-15T01:00:00Z"),
        },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(true);
    });
  });

  it("rejects a work menu the lane does not provide with lane_menu_unsupported", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "nolink");
      await seedHours(outerTx, tenant);
      // menu は同 company だが lane_work_menus link を作らない。
      const [menu] = await outerTx
        .insert(workMenus)
        .values({ companyId: tenant.companyId, code: "oil", name: "Oil", durationMinutes: 60 })
        .returning({ id: workMenus.id });

      const result = await checkReservationSlotAvailable(
        {
          storeId: tenant.storeId,
          laneId: tenant.laneId,
          workMenuId: menu.id,
          startAt: new Date("2026-07-15T00:00:00Z"),
          endAt: new Date("2026-07-15T01:00:00Z"),
        },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("lane_menu_unsupported");
    });
  });

  it("rejects a lane belonging to another company with lane_not_found", async () => {
    await withRollback(async (outerTx) => {
      const cur = await seedTenant(outerTx, "cur");
      const other = await seedTenant(outerTx, "oth");
      await seedHours(outerTx, cur);

      const result = await checkReservationSlotAvailable(
        {
          storeId: cur.storeId,
          laneId: other.laneId,
          startAt: new Date("2026-07-15T00:00:00Z"),
          endAt: new Date("2026-07-15T01:00:00Z"),
        },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("lane_not_found");
    });
  });

  it("returns store_not_found for an unknown store", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "unk");
      await seedHours(outerTx, tenant);

      const result = await checkReservationSlotAvailable(
        {
          storeId: crypto.randomUUID(),
          laneId: tenant.laneId,
          startAt: new Date("2026-07-15T00:00:00Z"),
          endAt: new Date("2026-07-15T01:00:00Z"),
        },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("store_not_found");
    });
  });
});

describeIntegration("listAvailableSlots (picker)", () => {
  it("lists 30-min-stepped 60-min slots across 09:00-18:00 JST", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "list");
      await seedHours(outerTx, tenant);

      const result = await listAvailableSlots(
        { storeId: tenant.storeId, laneId: tenant.laneId, date: TEST_DATE, durationMinutes: 60 },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // 540..1020 step 30 (start+60<=1080) → 17 枠。
      expect(result.slots).toHaveLength(17);
      // 最初の枠 = 09:00 JST = 00:00 UTC (JST↔UTC アンカー)。
      expect(result.slots[0]!.startAt.toISOString()).toBe("2026-07-15T00:00:00.000Z");
      expect(result.slots[0]!.endAt.toISOString()).toBe("2026-07-15T01:00:00.000Z");
      // 最後の枠 = 17:00-18:00 JST = 08:00-09:00 UTC。
      const last = result.slots[result.slots.length - 1]!;
      expect(last.startAt.toISOString()).toBe("2026-07-15T08:00:00.000Z");
      expect(last.endAt.toISOString()).toBe("2026-07-15T09:00:00.000Z");
    });
  });

  it("excludes slots overlapping an existing reservation (10:00-11:00 JST)", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "excl");
      await seedHours(outerTx, tenant);
      // 既存予約 10:00-11:00 JST = 01:00-02:00 UTC。
      await outerTx.insert(reservations).values({
        companyId: tenant.companyId,
        storeId: tenant.storeId,
        laneId: tenant.laneId,
        startAt: new Date("2026-07-15T01:00:00Z"),
        endAt: new Date("2026-07-15T02:00:00Z"),
      });

      const result = await listAvailableSlots(
        { storeId: tenant.storeId, laneId: tenant.laneId, date: TEST_DATE, durationMinutes: 60 },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const starts = result.slots.map((s) => s.startAt.toISOString());
      // 09:30/10:00/10:30 JST 始まりの枠は overlap で除外。
      expect(starts).not.toContain("2026-07-15T00:30:00.000Z"); // 09:30 JST
      expect(starts).not.toContain("2026-07-15T01:00:00.000Z"); // 10:00 JST
      expect(starts).not.toContain("2026-07-15T01:30:00.000Z"); // 10:30 JST
      // 09:00 (10:00 に接するが overlap せず) と 11:00 は残る。
      expect(starts).toContain("2026-07-15T00:00:00.000Z"); // 09:00 JST
      expect(starts).toContain("2026-07-15T02:00:00.000Z"); // 11:00 JST
    });
  });

  it("intersects store and lane hours (lane 13:00-18:00 → first slot 13:00 JST)", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "isect");
      // 店舗 09:00-18:00、lane 13:00-18:00 → 交差 13:00-18:00。
      await seedHours(outerTx, tenant, { laneStarts: "13:00:00", laneEnds: "18:00:00" });

      const result = await listAvailableSlots(
        { storeId: tenant.storeId, laneId: tenant.laneId, date: TEST_DATE, durationMinutes: 60 },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // 13:00 JST = 04:00 UTC。
      expect(result.slots[0]!.startAt.toISOString()).toBe("2026-07-15T04:00:00.000Z");
    });
  });

  it("returns empty slots on a closed holiday", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "hol2");
      await seedHours(outerTx, tenant);
      await outerTx.insert(storeHolidays).values({
        companyId: tenant.companyId,
        storeId: tenant.storeId,
        holidayDate: TEST_DATE,
        isClosed: true,
      });

      const result = await listAvailableSlots(
        { storeId: tenant.storeId, laneId: tenant.laneId, date: TEST_DATE, durationMinutes: 60 },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.slots).toHaveLength(0);
    });
  });
});
