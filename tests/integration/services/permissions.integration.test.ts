import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { permissions } from "@/lib/db/schema/permissions";
import { roles } from "@/lib/db/schema/roles";
import {
  createPermission,
  deletePermission,
  getPermissionById,
  listPermissions,
  PermissionConflictError,
  PermissionRoleGuardError,
  updatePermission,
} from "@/lib/services/permissions";

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
  tenantRoleId: string;
  otherTenantRoleId: string;
  systemRoleId: string;
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
      { name: `__perm_company_${suffix}__`, code: `perm_${suffix}` },
      { name: `__perm_other_${suffix}__`, code: `perm_o_${suffix}` },
    ])
    .returning({ id: companies.id });

  const [tenantRole] = await outerTx
    .insert(roles)
    .values({
      companyId: company.id,
      code: `perm_tenant_${suffix}`,
      name: `tenant role ${suffix}`,
    })
    .returning({ id: roles.id });

  const [otherTenantRole] = await outerTx
    .insert(roles)
    .values({
      companyId: otherCompany.id,
      code: `perm_other_role_${suffix}`,
      name: `other tenant role ${suffix}`,
    })
    .returning({ id: roles.id });

  const [systemRole] = await outerTx
    .insert(roles)
    .values({
      companyId: null,
      code: `perm_sys_${suffix}`,
      name: `system role ${suffix}`,
      isSystem: true,
    })
    .returning({ id: roles.id });

  return {
    companyId: company.id,
    otherCompanyId: otherCompany.id,
    tenantRoleId: tenantRole.id,
    otherTenantRoleId: otherTenantRole.id,
    systemRoleId: systemRole.id,
  };
}

describeIntegration("permission services", () => {
  it("creates a permission scoped to the admin company's role", async () => {
    await withRollback(async (outerTx) => {
      const f = await seedFixture(outerTx);
      const created = await createPermission(
        {
          roleId: f.tenantRoleId,
          code: "ticket.create",
          resource: "service_tickets",
          action: "create",
        },
        { db: outerTx, companyId: f.companyId },
      );

      expect(created.companyId).toBe(f.companyId);
      expect(created.roleId).toBe(f.tenantRoleId);
      expect(created.code).toBe("ticket.create");
      expect(created.resource).toBe("service_tickets");
      expect(created.action).toBe("create");
    });
  });

  it("lists tenant permissions plus system role permissions but excludes other tenants", async () => {
    await withRollback(async (outerTx) => {
      const f = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);

      // self tenant permission
      await createPermission(
        { roleId: f.tenantRoleId, code: `tenant_${suffix}` },
        { db: outerTx, companyId: f.companyId },
      );

      // system role permission (insert directly because service rejects system role create)
      await outerTx.insert(permissions).values({
        companyId: null,
        roleId: f.systemRoleId,
        code: `sys_${suffix}`,
      });

      // other tenant permission (via direct insert with other company context)
      await outerTx.insert(permissions).values({
        companyId: f.otherCompanyId,
        roleId: f.otherTenantRoleId,
        code: `other_${suffix}`,
      });

      const includeSys = await listPermissions(
        { q: suffix, includeSystem: true, limit: 100 },
        { db: outerTx, companyId: f.companyId },
      );
      const codes = includeSys.rows.map((r) => r.code);
      expect(codes).toContain(`tenant_${suffix}`);
      expect(codes).toContain(`sys_${suffix}`);
      expect(codes).not.toContain(`other_${suffix}`);

      const excludeSys = await listPermissions(
        { q: suffix, includeSystem: false, limit: 100 },
        { db: outerTx, companyId: f.companyId },
      );
      const excludeCodes = excludeSys.rows.map((r) => r.code);
      expect(excludeCodes).toContain(`tenant_${suffix}`);
      expect(excludeCodes).not.toContain(`sys_${suffix}`);
      expect(excludeCodes).not.toContain(`other_${suffix}`);
    });
  });

  it("updates a tenant permission (code/resource/action)", async () => {
    await withRollback(async (outerTx) => {
      const f = await seedFixture(outerTx);
      const created = await createPermission(
        { roleId: f.tenantRoleId, code: "old.code", resource: "old_res", action: "old_act" },
        { db: outerTx, companyId: f.companyId },
      );

      const updated = await updatePermission(
        created.id,
        { code: "new.code", resource: "new_res", action: "new_act" },
        { db: outerTx, companyId: f.companyId },
      );
      expect(updated?.code).toBe("new.code");
      expect(updated?.resource).toBe("new_res");
      expect(updated?.action).toBe("new_act");
    });
  });

  it("throws PermissionConflictError on duplicate (role_id, code)", async () => {
    await withRollback(async (outerTx) => {
      const f = await seedFixture(outerTx);
      await createPermission(
        { roleId: f.tenantRoleId, code: "dup.code" },
        { db: outerTx, companyId: f.companyId },
      );

      await expect(
        createPermission(
          { roleId: f.tenantRoleId, code: "dup.code" },
          { db: outerTx, companyId: f.companyId },
        ),
      ).rejects.toBeInstanceOf(PermissionConflictError);
    });
  });

  it("rejects create against a system role with PermissionRoleGuardError", async () => {
    await withRollback(async (outerTx) => {
      const f = await seedFixture(outerTx);
      await expect(
        createPermission(
          { roleId: f.systemRoleId, code: "sys.attempt" },
          { db: outerTx, companyId: f.companyId },
        ),
      ).rejects.toBeInstanceOf(PermissionRoleGuardError);
    });
  });

  it("rejects create against another tenant's role with PermissionRoleGuardError", async () => {
    await withRollback(async (outerTx) => {
      const f = await seedFixture(outerTx);
      await expect(
        createPermission(
          { roleId: f.otherTenantRoleId, code: "other.attempt" },
          { db: outerTx, companyId: f.companyId },
        ),
      ).rejects.toBeInstanceOf(PermissionRoleGuardError);
    });
  });

  it("blocks updatePermission on system role permissions with PermissionRoleGuardError", async () => {
    await withRollback(async (outerTx) => {
      const f = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const [sysPerm] = await outerTx
        .insert(permissions)
        .values({
          companyId: null,
          roleId: f.systemRoleId,
          code: `sys_${suffix}`,
        })
        .returning({ id: permissions.id });

      await expect(
        updatePermission(
          sysPerm.id,
          { code: "rewritten" },
          { db: outerTx, companyId: f.companyId },
        ),
      ).rejects.toBeInstanceOf(PermissionRoleGuardError);
    });
  });

  it("blocks deletePermission on system role permissions with PermissionRoleGuardError", async () => {
    await withRollback(async (outerTx) => {
      const f = await seedFixture(outerTx);
      const suffix = crypto.randomUUID().slice(0, 6);
      const [sysPerm] = await outerTx
        .insert(permissions)
        .values({
          companyId: null,
          roleId: f.systemRoleId,
          code: `sys_${suffix}`,
        })
        .returning({ id: permissions.id });

      await expect(
        deletePermission(sysPerm.id, { db: outerTx, companyId: f.companyId }),
      ).rejects.toBeInstanceOf(PermissionRoleGuardError);
    });
  });

  it("hard-deletes a tenant permission and getPermissionById returns null afterwards (cross-tenant invisible)", async () => {
    await withRollback(async (outerTx) => {
      const f = await seedFixture(outerTx);
      const created = await createPermission(
        { roleId: f.tenantRoleId, code: "del.target" },
        { db: outerTx, companyId: f.companyId },
      );

      // 別 tenant からは取得不可
      const otherView = await getPermissionById(created.id, {
        db: outerTx,
        companyId: f.otherCompanyId,
      });
      expect(otherView).toBeNull();

      const ok = await deletePermission(created.id, {
        db: outerTx,
        companyId: f.companyId,
      });
      expect(ok).toBe(true);

      const after = await getPermissionById(created.id, {
        db: outerTx,
        companyId: f.companyId,
      });
      expect(after).toBeNull();
    });
  });

  it("rejects invalid Zod input (empty code, oversized code, non-uuid roleId)", async () => {
    await withRollback(async (outerTx) => {
      const f = await seedFixture(outerTx);
      await expect(
        createPermission(
          { roleId: f.tenantRoleId, code: "" },
          { db: outerTx, companyId: f.companyId },
        ),
      ).rejects.toThrow();
      await expect(
        createPermission(
          { roleId: f.tenantRoleId, code: "x".repeat(100) },
          { db: outerTx, companyId: f.companyId },
        ),
      ).rejects.toThrow();
      await expect(
        createPermission(
          { roleId: "not-a-uuid", code: "ok.code" },
          { db: outerTx, companyId: f.companyId },
        ),
      ).rejects.toThrow();
    });
  });
});
