import { config } from "dotenv";
import { and, count, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { workMenus } from "@/lib/db/schema/work_menus";
import { createWorkCategory, deleteWorkCategory } from "@/lib/services/work-categories";
import {
  createWorkMenu,
  deleteWorkMenu,
  getWorkMenuById,
  listWorkMenus,
  updateWorkMenu,
  WorkMenuCodeConflictError,
} from "@/lib/services/work-menus";

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
      { name: `__wm_company_${suffix}__`, code: `wm_${suffix}` },
      { name: `__wm_other_${suffix}__`, code: `wm_o_${suffix}` },
    ])
    .returning({ id: companies.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
  };
}

describeIntegration("work_menu services", () => {
  it("creates a work_menu with category and defaults", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const category = await createWorkCategory(
        { name: `板金-${suffix}`, code: `BAN_${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );
      const created = await createWorkMenu(
        {
          name: `バンパー脱着-${suffix}`,
          code: `BP_${suffix}`,
          workCategoryId: category.id,
          durationMinutes: 90,
          priceMinor: 12000,
          isActive: true,
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.companyId).toBe(fixture.companyId);
      expect(created.workCategoryId).toBe(category.id);
      expect(created.durationMinutes).toBe(90);
      expect(created.priceMinor).toBe(12000);
      expect(created.isActive).toBe(true);
    });
  });

  it("lists menus with category name join and filters by isActive/category/q", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const other = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const catA = await createWorkCategory({ name: `CAT-A-${suffix}`, code: `A_${suffix}` }, { db: outerTx, companyId: fixture.companyId });
      const catB = await createWorkCategory({ name: `CAT-B-${suffix}`, code: `B_${suffix}` }, { db: outerTx, companyId: fixture.companyId });
      await createWorkMenu({ name: `MENU-AA-${suffix}`, code: `AA_${suffix}`, workCategoryId: catA.id, isActive: true }, { db: outerTx, companyId: fixture.companyId });
      await createWorkMenu({ name: `MENU-AB-${suffix}`, code: `AB_${suffix}`, workCategoryId: catA.id, isActive: false }, { db: outerTx, companyId: fixture.companyId });
      await createWorkMenu({ name: `MENU-B-${suffix}`, code: `B2_${suffix}`, workCategoryId: catB.id, isActive: true }, { db: outerTx, companyId: fixture.companyId });
      await createWorkMenu({ name: `MENU-NONE-${suffix}`, code: `N_${suffix}`, workCategoryId: null, isActive: true }, { db: outerTx, companyId: fixture.companyId });
      await createWorkMenu({ name: `MENU-OTHER-${suffix}`, code: `O_${suffix}` }, { db: outerTx, companyId: other.companyId });

      const all = await listWorkMenus({}, { db: outerTx, companyId: fixture.companyId });
      const allNames = all.rows.map((r) => r.name);
      expect(allNames).toContain(`MENU-AA-${suffix}`);
      expect(allNames).not.toContain(`MENU-OTHER-${suffix}`);
      const aa = all.rows.find((r) => r.name === `MENU-AA-${suffix}`);
      expect(aa?.workCategoryName).toBe(`CAT-A-${suffix}`);

      const activeOnly = await listWorkMenus({ isActive: true }, { db: outerTx, companyId: fixture.companyId });
      const activeNames = activeOnly.rows.map((r) => r.name);
      expect(activeNames).toContain(`MENU-AA-${suffix}`);
      expect(activeNames).not.toContain(`MENU-AB-${suffix}`);

      const byCategory = await listWorkMenus({ workCategoryId: catA.id }, { db: outerTx, companyId: fixture.companyId });
      const byCategoryNames = byCategory.rows.map((r) => r.name);
      expect(byCategoryNames).toContain(`MENU-AA-${suffix}`);
      expect(byCategoryNames).toContain(`MENU-AB-${suffix}`);
      expect(byCategoryNames).not.toContain(`MENU-B-${suffix}`);

      const noneOnly = await listWorkMenus({ workCategoryId: null }, { db: outerTx, companyId: fixture.companyId });
      expect(noneOnly.rows.find((r) => r.name === `MENU-NONE-${suffix}`)).toBeDefined();
      expect(noneOnly.rows.find((r) => r.name === `MENU-AA-${suffix}`)).toBeUndefined();
    });
  });

  it("updates a menu in company scope and supports category reassignment", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const cat = await createWorkCategory({ name: "車検", code: "INSP" }, { db: outerTx, companyId: fixture.companyId });
      const created = await createWorkMenu(
        { name: "車検24ヶ月", code: "INSP24", priceMinor: 50000 },
        { db: outerTx, companyId: fixture.companyId },
      );

      const updated = await updateWorkMenu(
        created.id,
        { name: "車検24ヶ月(改)", workCategoryId: cat.id, priceMinor: 55000, isActive: false },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(updated?.name).toBe("車検24ヶ月(改)");
      expect(updated?.workCategoryId).toBe(cat.id);
      expect(updated?.priceMinor).toBe(55000);
      expect(updated?.isActive).toBe(false);
    });
  });

  it("soft-deletes a menu and rejects cross-tenant delete", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createWorkMenu(
        { name: "削除対象", code: "DELME" },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(deleteWorkMenu(created.id, { db: outerTx, companyId: fixture.otherCompanyId })).resolves.toBe(false);
      await expect(deleteWorkMenu(created.id, { db: outerTx, companyId: fixture.companyId })).resolves.toBe(true);

      const rows = await outerTx
        .select({ value: count() })
        .from(workMenus)
        .where(and(eq(workMenus.id, created.id), isNull(workMenus.deletedAt)));
      expect(Number(rows[0]?.value ?? 0)).toBe(0);

      const detail = await getWorkMenuById(created.id, { db: outerTx, companyId: fixture.companyId });
      expect(detail).toBeNull();
    });
  });

  it("rejects duplicate menu code within the same company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const code = `DUP_${suffix}`;

      await createWorkMenu(
        { name: `初回-${suffix}`, code },
        { db: outerTx, companyId: fixture.companyId },
      );

      // UNIQUE 違反は transaction を abort するため savepoint で隔離
      await expect(
        outerTx.transaction(async (savepoint: Tx) =>
          createWorkMenu(
            { name: `重複-${suffix}`, code },
            { db: savepoint, companyId: fixture.companyId },
          ),
        ),
      ).rejects.toBeInstanceOf(WorkMenuCodeConflictError);

      // 別 company であれば同じ code でも許容される
      await expect(
        createWorkMenu(
          { name: `別社-${suffix}`, code },
          { db: outerTx, companyId: fixture.otherCompanyId },
        ),
      ).resolves.toMatchObject({ code });
    });
  });

  it("sets workCategoryId to NULL when parent category is hard-deleted (ON DELETE SET NULL)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const category = await createWorkCategory(
        { name: `親-${suffix}`, code: `P_${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );
      const menu = await createWorkMenu(
        { name: `子-${suffix}`, code: `C_${suffix}`, workCategoryId: category.id },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(menu.workCategoryId).toBe(category.id);

      // 親 category を hard delete
      await expect(deleteWorkCategory(category.id, { db: outerTx, companyId: fixture.companyId })).resolves.toBe(true);

      // 子 menu は残り、workCategoryId が NULL になる
      const detail = await getWorkMenuById(menu.id, { db: outerTx, companyId: fixture.companyId });
      expect(detail).not.toBeNull();
      expect(detail?.workCategoryId).toBeNull();
      expect(detail?.workCategoryName).toBeNull();
    });
  });
});
