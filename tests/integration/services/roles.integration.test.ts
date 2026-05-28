import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { roles } from "@/lib/db/schema/roles";
import {
  createRole,
  deleteRole,
  getRoleById,
  listRoles,
  RoleConflictError,
  RoleSystemGuardError,
  updateRole,
} from "@/lib/services/roles";

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
      { name: `__role_company_${suffix}__`, code: `role_${suffix}` },
      { name: `__role_other_${suffix}__`, code: `role_o_${suffix}` },
    ])
    .returning({ id: companies.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
  };
}

describeIntegration("role services", () => {
  it("creates a role scoped to the admin company", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const created = await createRole(
        {
          code: `manager_${suffix}`,
          name: "店舗マネージャー",
          description: "店舗運用責任者",
        },
        { db: outerTx, companyId: fixture.companyId },
      );

      expect(created.companyId).toBe(fixture.companyId);
      expect(created.code).toBe(`manager_${suffix}`);
      expect(created.name).toBe("店舗マネージャー");
      expect(created.description).toBe("店舗運用責任者");
      expect(created.isSystem).toBe(false);
    });
  });

  it("lists tenant roles plus system roles (company_id IS NULL) but excludes other tenants", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const other = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      // tenant role
      await createRole(
        { code: `tenant_${suffix}`, name: `T-${suffix}` },
        { db: outerTx, companyId: fixture.companyId },
      );
      // system role (company_id NULL + is_system true) — visible to all tenants
      await outerTx.insert(roles).values({
        companyId: null,
        code: `sys_${suffix}`,
        name: `SYS-${suffix}`,
        isSystem: true,
      });
      // other tenant role
      await createRole(
        { code: `other_${suffix}`, name: `O-${suffix}` },
        { db: outerTx, companyId: other.companyId },
      );

      const includeSys = await listRoles(
        { q: suffix, includeSystem: true, limit: 100 },
        { db: outerTx, companyId: fixture.companyId },
      );
      const codes = includeSys.rows.map((r) => r.code);
      expect(codes).toContain(`tenant_${suffix}`);
      expect(codes).toContain(`sys_${suffix}`);
      expect(codes).not.toContain(`other_${suffix}`);

      const excludeSys = await listRoles(
        { q: suffix, includeSystem: false, limit: 100 },
        { db: outerTx, companyId: fixture.companyId },
      );
      const excludeCodes = excludeSys.rows.map((r) => r.code);
      expect(excludeCodes).toContain(`tenant_${suffix}`);
      expect(excludeCodes).not.toContain(`sys_${suffix}`);
      expect(excludeCodes).not.toContain(`other_${suffix}`);
    });
  });

  it("updates a tenant role (code/name/description)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const created = await createRole(
        { code: `before_${suffix}`, name: "旧名" },
        { db: outerTx, companyId: fixture.companyId },
      );

      const updated = await updateRole(
        created.id,
        { code: `after_${suffix}`, name: "新名", description: "メモ" },
        { db: outerTx, companyId: fixture.companyId },
      );
      expect(updated?.code).toBe(`after_${suffix}`);
      expect(updated?.name).toBe("新名");
      expect(updated?.description).toBe("メモ");
    });
  });

  it("throws RoleConflictError on duplicate (company_id, code)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      await createRole(
        { code: `dup_${suffix}`, name: "A" },
        { db: outerTx, companyId: fixture.companyId },
      );

      await expect(
        createRole(
          { code: `dup_${suffix}`, name: "B" },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toBeInstanceOf(RoleConflictError);
    });
  });

  it("blocks updateRole on is_system rows with RoleSystemGuardError", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      // is_system + companyId = fixture.companyId (現テナントが触れる seed 行)
      const [sysRow] = await outerTx
        .insert(roles)
        .values({
          companyId: fixture.companyId,
          code: `seed_${suffix}`,
          name: "seed",
          isSystem: true,
        })
        .returning({ id: roles.id });

      await expect(
        updateRole(
          sysRow.id,
          { name: "改変試行" },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toBeInstanceOf(RoleSystemGuardError);
    });
  });

  it("blocks deleteRole on is_system rows with RoleSystemGuardError", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const [sysRow] = await outerTx
        .insert(roles)
        .values({
          companyId: fixture.companyId,
          code: `seed_${suffix}`,
          name: "seed",
          isSystem: true,
        })
        .returning({ id: roles.id });

      await expect(
        deleteRole(sysRow.id, { db: outerTx, companyId: fixture.companyId }),
      ).rejects.toBeInstanceOf(RoleSystemGuardError);
    });
  });

  it("hard-deletes a tenant role and getRoleById returns null afterwards (cross-tenant invisible)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      const other = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const created = await createRole(
        { code: `del_${suffix}`, name: "削除対象" },
        { db: outerTx, companyId: fixture.companyId },
      );

      // 別 tenant からは取得不可
      const otherView = await getRoleById(created.id, {
        db: outerTx,
        companyId: other.companyId,
      });
      expect(otherView).toBeNull();

      const ok = await deleteRole(created.id, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(ok).toBe(true);

      const after = await getRoleById(created.id, {
        db: outerTx,
        companyId: fixture.companyId,
      });
      expect(after).toBeNull();
    });
  });

  it("rejects invalid Zod input (empty code or oversized name)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedFixture(outerTx);
      await expect(
        createRole(
          { code: "", name: "valid" },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toThrow();
      await expect(
        createRole(
          { code: "valid_code", name: "x".repeat(300) },
          { db: outerTx, companyId: fixture.companyId },
        ),
      ).rejects.toThrow();
    });
  });
});
