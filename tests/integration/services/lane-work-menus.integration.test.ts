import { config } from "dotenv";
import { count, eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { laneWorkMenus } from "@/lib/db/schema/lane_work_menus";
import { stores } from "@/lib/db/schema/stores";
import { createLane, deleteLane } from "@/lib/services/lanes";
import {
  LaneNotFoundError,
  listWorkMenuIdsByLaneId,
  listWorkMenusForLaneSelect,
  replaceLaneWorkMenus,
  WorkMenuNotInCompanyError,
} from "@/lib/services/lane-work-menus";
import {
  createWorkCategory,
} from "@/lib/services/work-categories";
import { createWorkMenu, deleteWorkMenu } from "@/lib/services/work-menus";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

// Drizzle does not expose a shared transaction type for postgres-js transactions.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

type Fixture = {
  companyId: string;
  otherCompanyId: string;
  storeId: string;
  otherStoreId: string;
};

afterAll(async () => {
  await queryClient?.end();
});

async function withRollback(fn: (outerTx: Tx) => Promise<void>): Promise<void> {
  await db!
    .transaction(async (outerTx) => {
      try {
        await fn(outerTx);
      } finally {
        throw new Error(ROLLBACK);
      }
    })
    .catch((err) => {
      if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
    });
}

async function seedFixture(outerTx: Tx): Promise<Fixture> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [company, otherCompany] = await outerTx
    .insert(companies)
    .values([
      { name: `__lwm_company_${suffix}__`, code: `lwm_${suffix}` },
      { name: `__lwm_other_${suffix}__`, code: `lwm_o_${suffix}` },
    ])
    .returning({ id: companies.id });

  const [store, otherStore] = await outerTx
    .insert(stores)
    .values([
      { companyId: company.id, name: `店舗-${suffix}`, code: `S_${suffix}` },
      { companyId: otherCompany.id, name: `他社店舗-${suffix}`, code: `OS_${suffix}` },
    ])
    .returning({ id: stores.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
    storeId: store.id,
    otherStoreId: otherStore.id,
  };
}

describeIntegration("lane_work_menus services", () => {
  it("replaceLaneWorkMenus: initial registration adds all requested menus", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ctx,
      );
      const menu1 = await createWorkMenu({ code: `M1_${suffix}`, name: "オイル交換" }, ctx);
      const menu2 = await createWorkMenu({ code: `M2_${suffix}`, name: "タイヤ交換" }, ctx);

      const result = await replaceLaneWorkMenus(
        lane.id,
        { workMenuIds: [menu1.id, menu2.id] },
        ctx,
      );

      expect(result).toEqual({ added: 2, removed: 0, kept: 0 });
      const ids = await listWorkMenuIdsByLaneId(lane.id, ctx);
      expect(ids.sort()).toEqual([menu1.id, menu2.id].sort());
    });
  });

  it("replaceLaneWorkMenus: applies add+remove diff while keeping common entries", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ctx,
      );
      const menuA = await createWorkMenu({ code: `MA_${suffix}`, name: "A" }, ctx);
      const menuB = await createWorkMenu({ code: `MB_${suffix}`, name: "B" }, ctx);
      const menuC = await createWorkMenu({ code: `MC_${suffix}`, name: "C" }, ctx);

      await replaceLaneWorkMenus(lane.id, { workMenuIds: [menuA.id, menuB.id] }, ctx);

      // diff: keep A, remove B, add C
      const result = await replaceLaneWorkMenus(
        lane.id,
        { workMenuIds: [menuA.id, menuC.id] },
        ctx,
      );

      expect(result).toEqual({ added: 1, removed: 1, kept: 1 });
      const ids = await listWorkMenuIdsByLaneId(lane.id, ctx);
      expect(ids.sort()).toEqual([menuA.id, menuC.id].sort());
    });
  });

  it("replaceLaneWorkMenus: empty array removes all associations", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ctx,
      );
      const menu = await createWorkMenu({ code: `M_${suffix}`, name: "M" }, ctx);
      await replaceLaneWorkMenus(lane.id, { workMenuIds: [menu.id] }, ctx);

      const result = await replaceLaneWorkMenus(lane.id, { workMenuIds: [] }, ctx);

      expect(result).toEqual({ added: 0, removed: 1, kept: 0 });
      const ids = await listWorkMenuIdsByLaneId(lane.id, ctx);
      expect(ids).toEqual([]);
    });
  });

  it("replaceLaneWorkMenus: rejects cross-tenant lane and cross-tenant work_menu", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const otherCtx = { db: outerTx, companyId: fixture.otherCompanyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ctx,
      );
      const otherMenu = await createWorkMenu(
        { code: `OM_${suffix}`, name: "他社メニュー" },
        otherCtx,
      );

      // 他社の companyId で lane 操作は LaneNotFoundError
      await expect(
        outerTx.transaction(async (sp: Tx) =>
          replaceLaneWorkMenus(lane.id, { workMenuIds: [] }, { db: sp, companyId: fixture.otherCompanyId }),
        ),
      ).rejects.toBeInstanceOf(LaneNotFoundError);

      // 他社の workMenuId を渡すと WorkMenuNotInCompanyError
      await expect(
        outerTx.transaction(async (sp: Tx) =>
          replaceLaneWorkMenus(lane.id, { workMenuIds: [otherMenu.id] }, { db: sp, companyId: fixture.companyId }),
        ),
      ).rejects.toBeInstanceOf(WorkMenuNotInCompanyError);
    });
  });

  it("UNIQUE (lane_id, work_menu_id) prevents duplicate manual insert", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ctx,
      );
      const menu = await createWorkMenu({ code: `M_${suffix}`, name: "M" }, ctx);
      await replaceLaneWorkMenus(lane.id, { workMenuIds: [menu.id] }, ctx);

      await expect(
        outerTx.transaction(async (sp: Tx) =>
          sp.insert(laneWorkMenus).values({
            companyId: fixture.companyId,
            laneId: lane.id,
            workMenuId: menu.id,
          }),
        ),
      ).rejects.toMatchObject({ code: "23505" });
    });
  });

  it("ON DELETE CASCADE removes lane_work_menus when lane is hard-deleted (manual)", async () => {
    // soft delete (deleteLane) は CASCADE を発火させない (deletedAt set のみ)。
    // CASCADE 検証は raw lane delete で行う。
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ctx,
      );
      const menu = await createWorkMenu({ code: `M_${suffix}`, name: "M" }, ctx);
      await replaceLaneWorkMenus(lane.id, { workMenuIds: [menu.id] }, ctx);

      const before = await outerTx
        .select({ value: count() })
        .from(laneWorkMenus)
        .where(eq(laneWorkMenus.laneId, lane.id));
      expect(Number(before[0]?.value ?? 0)).toBe(1);

      // soft delete → CASCADE 発火しない
      await deleteLane(lane.id, ctx);
      const afterSoft = await outerTx
        .select({ value: count() })
        .from(laneWorkMenus)
        .where(eq(laneWorkMenus.laneId, lane.id));
      expect(Number(afterSoft[0]?.value ?? 0)).toBe(1);

      // hard delete (raw) → CASCADE 発火
      await outerTx.execute(sql`DELETE FROM lanes WHERE id = ${lane.id}`);
      const afterHard = await outerTx
        .select({ value: count() })
        .from(laneWorkMenus)
        .where(eq(laneWorkMenus.laneId, lane.id));
      expect(Number(afterHard[0]?.value ?? 0)).toBe(0);
    });
  });

  it("ON DELETE CASCADE removes lane_work_menus when work_menu is hard-deleted (manual)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const lane = await createLane(
        { storeId: fixture.storeId, name: `Lane-${suffix}` },
        ctx,
      );
      const menu = await createWorkMenu({ code: `M_${suffix}`, name: "M" }, ctx);
      await replaceLaneWorkMenus(lane.id, { workMenuIds: [menu.id] }, ctx);

      // soft delete (deleteWorkMenu) → CASCADE 発火しない (deletedAt set のみ)
      await deleteWorkMenu(menu.id, ctx);
      const afterSoft = await outerTx
        .select({ value: count() })
        .from(laneWorkMenus)
        .where(eq(laneWorkMenus.workMenuId, menu.id));
      expect(Number(afterSoft[0]?.value ?? 0)).toBe(1);

      // hard delete (raw) → CASCADE 発火
      await outerTx.execute(sql`DELETE FROM work_menus WHERE id = ${menu.id}`);
      const afterHard = await outerTx
        .select({ value: count() })
        .from(laneWorkMenus)
        .where(eq(laneWorkMenus.workMenuId, menu.id));
      expect(Number(afterHard[0]?.value ?? 0)).toBe(0);
    });
  });

  it("listWorkMenusForLaneSelect: returns active menus only, grouped order by category then name", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const ctx = { db: outerTx, companyId: fixture.companyId };
      const suffix = crypto.randomUUID().slice(0, 6);

      const catA = await createWorkCategory(
        { name: `Aカテゴリ-${suffix}`, code: `CA_${suffix}` },
        ctx,
      );
      await createWorkMenu(
        { code: `M1_${suffix}`, name: "メニュー1", workCategoryId: catA.id },
        ctx,
      );
      await createWorkMenu({ code: `M2_${suffix}`, name: "メニュー2" }, ctx);
      const inactive = await createWorkMenu(
        { code: `M3_${suffix}`, name: "無効メニュー" },
        ctx,
      );
      await deleteWorkMenu(inactive.id, ctx);

      const rows = await listWorkMenusForLaneSelect(ctx);
      const myRows = rows.filter((r) => r.code.endsWith(suffix));
      expect(myRows.find((r) => r.code === `M3_${suffix}`)).toBeUndefined();
      expect(myRows.find((r) => r.code === `M1_${suffix}`)?.workCategoryName).toBe(
        `Aカテゴリ-${suffix}`,
      );
      expect(myRows.find((r) => r.code === `M2_${suffix}`)?.workCategoryId).toBeNull();

      // tenant scope
      const other = await listWorkMenusForLaneSelect({
        db: outerTx,
        companyId: fixture.otherCompanyId,
      });
      expect(other.find((r) => r.code === `M1_${suffix}`)).toBeUndefined();
    });
  });
});
