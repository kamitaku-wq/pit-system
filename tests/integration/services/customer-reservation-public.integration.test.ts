// Phase 64-A.31a: 顧客公開予約フロー read surface の integration tests。
// ---------------------------------------------------------------------------
// listPublicStores / listPublicWorkMenus / listAvailableSlotsForStoreMenu を検証。
// 重点: cross-tenant 境界 (URL companyId 改竄) / visible_to_customers filter (社内専用
//   メニュー漏洩防止) / lane 集約 union + slot→laneId bind + 重複 collapse。
//
// アンカー: 09:00-18:00 JST = 00:00-09:00 UTC。slot_interval default 30、menu duration 60。
//   reservation_settings は seed しない (行なし → SETTINGS_DEFAULTS が正常ケース、A.30 と同じ)。

import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { laneWorkingHours } from "@/lib/db/schema/lane_working_hours";
import { laneWorkMenus } from "@/lib/db/schema/lane_work_menus";
import { lanes } from "@/lib/db/schema/lanes";
import { reservations } from "@/lib/db/schema/reservations";
import { storeBusinessHours } from "@/lib/db/schema/store_business_hours";
import { stores } from "@/lib/db/schema/stores";
import { workMenus } from "@/lib/db/schema/work_menus";
import {
  listAvailableSlotsForStoreMenu,
  listPublicStores,
  listPublicWorkMenus,
} from "@/lib/services/customer-reservation-public";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

const TEST_DATE = "2026-07-15";
const NOW = new Date("2026-07-01T00:00:00Z");

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

async function seedCompany(
  outerTx: Tx,
  label: string,
  opts: { isActive?: boolean } = {},
): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [company] = await outerTx
    .insert(companies)
    .values({
      name: `__pub_${label}_${suffix}__`,
      code: `pub_${label}_${suffix}`,
      isActive: opts.isActive ?? true,
    })
    .returning({ id: companies.id });
  return company.id;
}

async function seedStore(
  outerTx: Tx,
  companyId: string,
  opts: { name?: string; isActive?: boolean; deleted?: boolean } = {},
): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [store] = await outerTx
    .insert(stores)
    .values({
      companyId,
      code: `s_${suffix}`,
      name: opts.name ?? "Store",
      isActive: opts.isActive ?? true,
      deletedAt: opts.deleted ? new Date() : null,
    })
    .returning({ id: stores.id });
  return store.id;
}

async function seedLane(
  outerTx: Tx,
  companyId: string,
  storeId: string,
  opts: { isActive?: boolean; deleted?: boolean; laneStarts?: string; laneEnds?: string } = {},
): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [lane] = await outerTx
    .insert(lanes)
    .values({
      companyId,
      storeId,
      name: `Lane ${suffix}`,
      isActive: opts.isActive ?? true,
      deletedAt: opts.deleted ? new Date() : null,
    })
    .returning({ id: lanes.id });
  // lane 稼働時間 (全曜日 09-18、dow 非依存)。
  for (let dow = 0; dow <= 6; dow += 1) {
    await outerTx.insert(laneWorkingHours).values({
      companyId,
      laneId: lane.id,
      dayOfWeek: dow,
      startsAt: opts.laneStarts ?? "09:00:00",
      endsAt: opts.laneEnds ?? "18:00:00",
    });
  }
  return lane.id;
}

async function seedStoreHours(outerTx: Tx, companyId: string, storeId: string): Promise<void> {
  for (let dow = 0; dow <= 6; dow += 1) {
    await outerTx.insert(storeBusinessHours).values({
      companyId,
      storeId,
      dayOfWeek: dow,
      opensAt: "09:00:00",
      closesAt: "18:00:00",
      acceptsReservations: true,
    });
  }
}

async function seedMenu(
  outerTx: Tx,
  companyId: string,
  opts: {
    name?: string;
    visible?: boolean;
    isActive?: boolean;
    deleted?: boolean;
    durationMinutes?: number;
  } = {},
): Promise<string> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [menu] = await outerTx
    .insert(workMenus)
    .values({
      companyId,
      code: `m_${suffix}`,
      name: opts.name ?? "Menu",
      durationMinutes: opts.durationMinutes ?? 60,
      visibleToCustomers: opts.visible ?? true,
      isActive: opts.isActive ?? true,
      deletedAt: opts.deleted ? new Date() : null,
    })
    .returning({ id: workMenus.id });
  return menu.id;
}

async function linkLaneMenu(
  outerTx: Tx,
  companyId: string,
  laneId: string,
  menuId: string,
): Promise<void> {
  await outerTx
    .insert(laneWorkMenus)
    .values({ companyId, laneId, workMenuId: menuId });
}

// ---------------------------------------------------------------------------
describeIntegration("listPublicStores", () => {
  it("returns active not-deleted stores, excludes inactive/soft-deleted", async () => {
    await withRollback(async (outerTx) => {
      const companyId = await seedCompany(outerTx, "stores");
      await seedStore(outerTx, companyId, { name: "Alpha" });
      await seedStore(outerTx, companyId, { name: "Bravo" });
      await seedStore(outerTx, companyId, { name: "InactiveStore", isActive: false });
      await seedStore(outerTx, companyId, { name: "DeletedStore", deleted: true });

      const result = await listPublicStores(companyId, { db: outerTx });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      const names = result.stores.map((s) => s.name);
      expect(names).toEqual(["Alpha", "Bravo"]); // name 昇順、inactive/deleted 除外
    });
  });

  it("does not leak another company's stores (cross-tenant)", async () => {
    await withRollback(async (outerTx) => {
      const companyA = await seedCompany(outerTx, "a");
      const companyB = await seedCompany(outerTx, "b");
      await seedStore(outerTx, companyA, { name: "A-Store" });
      await seedStore(outerTx, companyB, { name: "B-Store" });

      const result = await listPublicStores(companyA, { db: outerTx });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.stores.map((s) => s.name)).toEqual(["A-Store"]);
    });
  });

  it("returns company_not_found for an inactive company", async () => {
    await withRollback(async (outerTx) => {
      const companyId = await seedCompany(outerTx, "inactive", { isActive: false });
      await seedStore(outerTx, companyId, { name: "X" });

      const result = await listPublicStores(companyId, { db: outerTx });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("company_not_found");
    });
  });

  it("returns company_not_found for a malformed companyId", async () => {
    await withRollback(async (outerTx) => {
      const result = await listPublicStores("not-a-uuid", { db: outerTx });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("company_not_found");
    });
  });
});

// ---------------------------------------------------------------------------
describeIntegration("listPublicWorkMenus", () => {
  it("returns only visible menus served by an active lane at the store", async () => {
    await withRollback(async (outerTx) => {
      const companyId = await seedCompany(outerTx, "menus");
      const storeId = await seedStore(outerTx, companyId);
      const laneId = await seedLane(outerTx, companyId, storeId);

      const visibleLinked = await seedMenu(outerTx, companyId, { name: "VisibleLinked", visible: true });
      const hiddenLinked = await seedMenu(outerTx, companyId, { name: "HiddenLinked", visible: false });
      const visibleUnlinked = await seedMenu(outerTx, companyId, { name: "VisibleUnlinked", visible: true });
      await linkLaneMenu(outerTx, companyId, laneId, visibleLinked);
      await linkLaneMenu(outerTx, companyId, laneId, hiddenLinked); // 非公開: filter で除外
      // visibleUnlinked は lane に link しない: 候補 lane なし dead-end → 除外
      void visibleUnlinked;

      const result = await listPublicWorkMenus(companyId, storeId, { db: outerTx });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.menus.map((m) => m.name)).toEqual(["VisibleLinked"]);
    });
  });

  it("excludes inactive/soft-deleted menus even if visible and linked", async () => {
    await withRollback(async (outerTx) => {
      const companyId = await seedCompany(outerTx, "menus2");
      const storeId = await seedStore(outerTx, companyId);
      const laneId = await seedLane(outerTx, companyId, storeId);

      const ok = await seedMenu(outerTx, companyId, { name: "Ok", visible: true });
      const inactive = await seedMenu(outerTx, companyId, { name: "Inactive", visible: true, isActive: false });
      const deleted = await seedMenu(outerTx, companyId, { name: "Deleted", visible: true, deleted: true });
      await linkLaneMenu(outerTx, companyId, laneId, ok);
      await linkLaneMenu(outerTx, companyId, laneId, inactive);
      await linkLaneMenu(outerTx, companyId, laneId, deleted);

      const result = await listPublicWorkMenus(companyId, storeId, { db: outerTx });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.menus.map((m) => m.name)).toEqual(["Ok"]);
    });
  });

  it("returns store_not_found when the store belongs to another company (cross-tenant)", async () => {
    await withRollback(async (outerTx) => {
      const companyA = await seedCompany(outerTx, "a2");
      const companyB = await seedCompany(outerTx, "b2");
      const storeB = await seedStore(outerTx, companyB);

      // companyA の id で companyB の store を要求 → URL 改竄。
      const result = await listPublicWorkMenus(companyA, storeB, { db: outerTx });
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("store_not_found");
    });
  });
});

// ---------------------------------------------------------------------------
describeIntegration("listAvailableSlotsForStoreMenu (lane aggregation)", () => {
  it("returns slots bound to the single serving lane", async () => {
    await withRollback(async (outerTx) => {
      const companyId = await seedCompany(outerTx, "agg1");
      const storeId = await seedStore(outerTx, companyId);
      await seedStoreHours(outerTx, companyId, storeId);
      const laneId = await seedLane(outerTx, companyId, storeId);
      const menuId = await seedMenu(outerTx, companyId, { durationMinutes: 60 });
      await linkLaneMenu(outerTx, companyId, laneId, menuId);

      const result = await listAvailableSlotsForStoreMenu(
        { companyId, storeId, workMenuId: menuId, date: TEST_DATE },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // 09:00-18:00 / step30 / dur60 → 17 枠。すべて唯一の lane に bind。
      expect(result.slots).toHaveLength(17);
      expect(result.slots.every((s) => s.laneId === laneId)).toBe(true);
      expect(result.slots[0]!.startAt.toISOString()).toBe("2026-07-15T00:00:00.000Z");
    });
  });

  it("unions two serving lanes and collapses duplicate times to the min laneId", async () => {
    await withRollback(async (outerTx) => {
      const companyId = await seedCompany(outerTx, "agg2");
      const storeId = await seedStore(outerTx, companyId);
      await seedStoreHours(outerTx, companyId, storeId);
      const laneA = await seedLane(outerTx, companyId, storeId);
      const laneB = await seedLane(outerTx, companyId, storeId);
      const menuId = await seedMenu(outerTx, companyId, { durationMinutes: 60 });
      await linkLaneMenu(outerTx, companyId, laneA, menuId);
      await linkLaneMenu(outerTx, companyId, laneB, menuId);

      const result = await listAvailableSlotsForStoreMenu(
        { companyId, storeId, workMenuId: menuId, date: TEST_DATE },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // 同一時刻が 2 lane で空く → 1 枠へ collapse (17 枠のまま)。
      expect(result.slots).toHaveLength(17);
      // 決定論的に最小 laneId へ bind。
      const minLane = laneA < laneB ? laneA : laneB;
      expect(result.slots.every((s) => s.laneId === minLane)).toBe(true);
    });
  });

  it("surfaces a time from the free lane when the other lane is booked (slot→laneId bind)", async () => {
    await withRollback(async (outerTx) => {
      const companyId = await seedCompany(outerTx, "agg3");
      const storeId = await seedStore(outerTx, companyId);
      await seedStoreHours(outerTx, companyId, storeId);
      const laneA = await seedLane(outerTx, companyId, storeId);
      const laneB = await seedLane(outerTx, companyId, storeId);
      const menuId = await seedMenu(outerTx, companyId, { durationMinutes: 60 });
      await linkLaneMenu(outerTx, companyId, laneA, menuId);
      await linkLaneMenu(outerTx, companyId, laneB, menuId);
      // laneA の 09:00-10:00 JST (00:00-01:00 UTC) を既存予約で塞ぐ。
      await outerTx.insert(reservations).values({
        companyId,
        storeId,
        laneId: laneA,
        startAt: new Date("2026-07-15T00:00:00Z"),
        endAt: new Date("2026-07-15T01:00:00Z"),
      });

      const result = await listAvailableSlotsForStoreMenu(
        { companyId, storeId, workMenuId: menuId, date: TEST_DATE },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      // 09:00 枠は laneA では塞がれているが laneB で空く → laneB に bind して出現。
      const nineAm = result.slots.find((s) => s.startAt.toISOString() === "2026-07-15T00:00:00.000Z");
      expect(nineAm).toBeDefined();
      expect(nineAm!.laneId).toBe(laneB);
    });
  });

  it("returns store_not_found when companyId does not match the store (cross-tenant)", async () => {
    await withRollback(async (outerTx) => {
      const companyA = await seedCompany(outerTx, "ct1");
      const companyB = await seedCompany(outerTx, "ct2");
      const storeB = await seedStore(outerTx, companyB);
      await seedStoreHours(outerTx, companyB, storeB);
      const laneB = await seedLane(outerTx, companyB, storeB);
      const menuB = await seedMenu(outerTx, companyB, {});
      await linkLaneMenu(outerTx, companyB, laneB, menuB);

      // companyA の id で companyB の store/menu の枠を要求。
      const result = await listAvailableSlotsForStoreMenu(
        { companyId: companyA, storeId: storeB, workMenuId: menuB, date: TEST_DATE },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("store_not_found");
    });
  });

  it("rejects a non-visible menu with work_menu_not_found (defense-in-depth)", async () => {
    await withRollback(async (outerTx) => {
      const companyId = await seedCompany(outerTx, "hid");
      const storeId = await seedStore(outerTx, companyId);
      await seedStoreHours(outerTx, companyId, storeId);
      const laneId = await seedLane(outerTx, companyId, storeId);
      // active だが visible_to_customers=false。lane に link されていても枠を返さない。
      const menuId = await seedMenu(outerTx, companyId, { visible: false });
      await linkLaneMenu(outerTx, companyId, laneId, menuId);

      const result = await listAvailableSlotsForStoreMenu(
        { companyId, storeId, workMenuId: menuId, date: TEST_DATE },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("work_menu_not_found");
    });
  });

  it("returns empty slots when no lane at the store serves the menu", async () => {
    await withRollback(async (outerTx) => {
      const companyId = await seedCompany(outerTx, "noserve");
      const storeId = await seedStore(outerTx, companyId);
      await seedStoreHours(outerTx, companyId, storeId);
      await seedLane(outerTx, companyId, storeId); // lane はあるが menu に link しない
      const menuId = await seedMenu(outerTx, companyId, { visible: true });

      const result = await listAvailableSlotsForStoreMenu(
        { companyId, storeId, workMenuId: menuId, date: TEST_DATE },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.slots).toHaveLength(0);
    });
  });

  it("returns company_not_found for an inactive company", async () => {
    await withRollback(async (outerTx) => {
      const companyId = await seedCompany(outerTx, "ci", { isActive: false });
      const storeId = await seedStore(outerTx, companyId);
      await seedStoreHours(outerTx, companyId, storeId);
      const laneId = await seedLane(outerTx, companyId, storeId);
      const menuId = await seedMenu(outerTx, companyId, {});
      await linkLaneMenu(outerTx, companyId, laneId, menuId);

      const result = await listAvailableSlotsForStoreMenu(
        { companyId, storeId, workMenuId: menuId, date: TEST_DATE },
        { db: outerTx, now: NOW },
      );
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.reason).toBe("company_not_found");
    });
  });
});
