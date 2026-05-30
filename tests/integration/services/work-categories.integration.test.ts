import { config } from "dotenv";
import { and, count, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { workCategories } from "@/lib/db/schema/work_categories";
import {
  createWorkCategory,
  deleteWorkCategory,
  getWorkCategoryById,
  listWorkCategories,
  updateWorkCategory,
  WorkCategoryCodeConflictError,
} from "@/lib/services/work-categories";

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
      { name: `__wc_company_${suffix}__`, code: `wc_${suffix}` },
      { name: `__wc_other_${suffix}__`, code: `wc_o_${suffix}` },
    ])
    .returning({ id: companies.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
  };
}

describeIntegration("work_category services", () => {
  it("creates a work_category scoped to the admin company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const created = await createWorkCategory(
        { name: `板金 ${suffix}`, code: `BAN_${suffix}`, sortOrder: 10 },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.companyId).toBe(fixture.companyId);
      expect(created.name).toBe(`板金 ${suffix}`);
      expect(created.code).toBe(`BAN_${suffix}`);
      expect(created.sortOrder).toBe(10);
    });
  });

  it("lists only categories for the requested company ordered by sortOrder", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const other = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      await createWorkCategory({ name: `CAT-B-${suffix}`, code: `B_${suffix}`, sortOrder: 20 }, { db: outerTx, companyId: fixture.companyId });
      await createWorkCategory({ name: `CAT-A-${suffix}`, code: `A_${suffix}`, sortOrder: 10 }, { db: outerTx, companyId: fixture.companyId });
      await createWorkCategory({ name: `CAT-OTHER-${suffix}`, code: `O_${suffix}` }, { db: outerTx, companyId: other.companyId });

      const result = await listWorkCategories({}, { db: outerTx, companyId: fixture.companyId });
      const names = result.rows.map((r) => r.name);
      expect(names).toContain(`CAT-A-${suffix}`);
      expect(names).toContain(`CAT-B-${suffix}`);
      expect(names).not.toContain(`CAT-OTHER-${suffix}`);
      // sortOrder ASC: A (10) が B (20) より前
      const idxA = names.indexOf(`CAT-A-${suffix}`);
      const idxB = names.indexOf(`CAT-B-${suffix}`);
      expect(idxA).toBeLessThan(idxB);
    });
  });

  it("updates a work_category in company scope", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createWorkCategory(
        { name: "車検", code: "INSP", sortOrder: 0 },
        { db: outerTx, companyId: fixture.companyId },
      );

      const updated = await updateWorkCategory(
        created.id,
        { name: "車検 (改)", sortOrder: 99 },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(updated?.name).toBe("車検 (改)");
      expect(updated?.sortOrder).toBe(99);
      expect(updated?.code).toBe("INSP");
    });
  });

  it("hard-deletes a work_category and rejects cross-tenant delete", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const created = await createWorkCategory(
        { name: "削除対象", code: "DELME" },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(deleteWorkCategory(created.id, { db: outerTx, companyId: fixture.otherCompanyId })).resolves.toBe(false);
      await expect(deleteWorkCategory(created.id, { db: outerTx, companyId: fixture.companyId })).resolves.toBe(true);

      const rows = await outerTx
        .select({ value: count() })
        .from(workCategories)
        .where(eq(workCategories.id, created.id));
      expect(Number(rows[0]?.value ?? 0)).toBe(0);

      const detail = await getWorkCategoryById(created.id, { db: outerTx, companyId: fixture.companyId });
      expect(detail).toBeNull();
    });
  });

  it("filters categories by q (name / code partial match)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      await createWorkCategory({ name: `板金-${suffix}`, code: `BAN_${suffix}` }, { db: outerTx, companyId: fixture.companyId });
      await createWorkCategory({ name: `塗装-${suffix}`, code: `PNT_${suffix}` }, { db: outerTx, companyId: fixture.companyId });

      const byName = await listWorkCategories({ q: `板金-${suffix}` }, { db: outerTx, companyId: fixture.companyId });
      expect(byName.rows.map((r) => r.name)).toEqual([`板金-${suffix}`]);

      const byCode = await listWorkCategories({ q: `PNT_${suffix}` }, { db: outerTx, companyId: fixture.companyId });
      expect(byCode.rows.find((r) => r.name === `塗装-${suffix}`)).toBeDefined();
    });
  });

  it("rejects duplicate code within the same company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const code = `DUP_${suffix}`;

      await createWorkCategory(
        { name: `初回-${suffix}`, code },
        { db: outerTx, companyId: fixture.companyId },
      );

      // UNIQUE 違反は transaction を abort するため savepoint で隔離
      await expect(
        outerTx.transaction(async (savepoint: Tx) =>
          createWorkCategory(
            { name: `重複-${suffix}`, code },
            { db: savepoint, companyId: fixture.companyId },
          ),
        ),
      ).rejects.toBeInstanceOf(WorkCategoryCodeConflictError);

      // 別 company であれば同じ code でも許容される
      await expect(
        createWorkCategory(
          { name: `別社-${suffix}`, code },
          { db: outerTx, companyId: fixture.otherCompanyId },
        ),
      ).resolves.toMatchObject({ code });

      // 同一 outer transaction 内では別カテゴリは継続して作成できる (savepoint 隔離確認)
      const sentinel = await createWorkCategory(
        { name: `健全-${suffix}`, code: `OK_${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(sentinel.code).toBe(`OK_${suffix}`);
    });
  });
});
