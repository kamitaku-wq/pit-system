// Phase 66: 社内ユーザー管理 service (internal-users.ts) の integration テスト。
// テスト方針: withRollback / seedFixture / service を outerTx 上で実行。
// auth.users への INSERT は transport-orders-reassign と同パターン (CTE)。
// global roles (company_id IS NULL) は seed 済みを SELECT して使う (INSERT しない)。

vi.mock("server-only", () => ({}));
import { config } from "dotenv";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { roles } from "@/lib/db/schema/roles";
import { stores } from "@/lib/db/schema/stores";
import { userStoreMemberships } from "@/lib/db/schema/user_store_memberships";
import { users } from "@/lib/db/schema/users";
import {
  getInternalUserDetail,
  listAssignableRoles,
  listInternalUsers,
  setInternalUserActive,
  setInternalUserStores,
  updateInternalUserRole,
} from "@/lib/services/internal-users";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

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

// auth.users -> public.users の順で INSERT (非 deferrable FK 対応)。
async function seedUser(
  outerTx: Tx,
  companyId: string,
  suffix: string,
  opts: { isActive?: boolean; setDeletedAt?: boolean } = {},
): Promise<string> {
  const email = "user-" + suffix + "@example.test";
  const isActive = opts.isActive !== false;
  const userResult = await outerTx.execute(sql`
    WITH auth_user AS (
      INSERT INTO auth.users (id, aud, role, email, email_confirmed_at, created_at, updated_at)
      VALUES (gen_random_uuid(), 'authenticated', 'authenticated', ${email}, now(), now(), now())
      RETURNING id
    )
    INSERT INTO users (id, company_id, email, name, is_active)
    SELECT id, ${companyId}, ${email}, ${"User " + suffix}, ${isActive}
    FROM auth_user
    RETURNING id
  `);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const rows = (userResult as any).rows ?? userResult;
  const userId = (rows[0] as { id: string }).id;
  if (opts.setDeletedAt) {
    await outerTx
      .update(users)
      .set({ deletedAt: new Date() })
      .where(eq(users.id, userId));
  }
  return userId;
}

interface Fixture {
  companyId: string;
  otherCompanyId: string;
}

async function seedFixture(outerTx: Tx): Promise<Fixture> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const inserted = await outerTx
    .insert(companies)
    .values([
      { name: "__iusr_" + suffix + "__", code: "iu_" + suffix },
      { name: "__iusr_o_" + suffix + "__", code: "iuo_" + suffix },
    ])
    .returning({ id: companies.id });
  return {
    companyId: (inserted[0] as { id: string }).id,
    otherCompanyId: (inserted[1] as { id: string }).id,
  };
}

async function getGlobalRole(outerTx: Tx, code: string): Promise<{ id: string; name: string; code: string }> {
  const rows = await outerTx
    .select({ id: roles.id, name: roles.name, code: roles.code })
    .from(roles)
    .where(and(isNull(roles.companyId), eq(roles.code, code)))
    .limit(1);
  const row = rows[0] as { id: string; name: string; code: string } | undefined;
  if (!row) throw new Error("Global role " + code + " not found.");
  return row;
}

describeIntegration("internal-users service", () => {
  // 1. listInternalUsers
  describe("listInternalUsers", () => {
    it("returns active users with role/store names and excludes logically deleted users", async () => {
      await withRollback(async (outerTx) => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const { companyId } = await seedFixture(outerTx);
        const adminRole = await getGlobalRole(outerTx, "admin");
        const activeUserId = await seedUser(outerTx, companyId, "a_" + suffix);
        const deletedUserId = await seedUser(outerTx, companyId, "d_" + suffix, { setDeletedAt: true });
        await outerTx.update(users).set({ roleId: adminRole.id }).where(eq(users.id, activeUserId));
        const storeInserted = await outerTx
          .insert(stores)
          .values([
            { companyId, name: "Store-A-" + suffix, code: "sa_" + suffix },
            { companyId, name: "Store-B-" + suffix, code: "sb_" + suffix },
          ])
          .returning({ id: stores.id });
        const storeAId = (storeInserted[0] as { id: string }).id;
        const storeBId = (storeInserted[1] as { id: string }).id;
        await outerTx.insert(userStoreMemberships).values([
          { companyId, userId: activeUserId, storeId: storeAId },
          { companyId, userId: activeUserId, storeId: storeBId },
        ]);
        const result = await listInternalUsers(outerTx, companyId);
        const activeEntry = result.find((u) => u.id === activeUserId);
        expect(activeEntry).toBeDefined();
        expect(activeEntry?.roleCode).toBe("admin");
        expect(activeEntry?.roleName).toBe(adminRole.name);
        expect(activeEntry?.storeNames).toHaveLength(2);
        expect(activeEntry?.storeNames).toContain("Store-A-" + suffix);
        expect(activeEntry?.storeNames).toContain("Store-B-" + suffix);
        expect(result.find((u) => u.id === deletedUserId)).toBeUndefined();
      });
    });
  });

  // 2. listAssignableRoles
  describe("listAssignableRoles", () => {
    it("returns only global roles (company_id IS NULL), excluding company-scoped roles", async () => {
      await withRollback(async (outerTx) => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const { companyId } = await seedFixture(outerTx);
        const scopedInserted = await outerTx
          .insert(roles)
          .values({ companyId, code: "scoped_" + suffix, name: "Scoped-" + suffix })
          .returning({ id: roles.id });
        const scopedRoleId = (scopedInserted[0] as { id: string }).id;
        const result = await listAssignableRoles(outerTx);
        for (const role of result) { expect(role.companyId).toBeNull(); }
        expect(result.find((r) => r.id === scopedRoleId)).toBeUndefined();
        expect(result.find((r) => r.code === "admin")).toBeDefined();
      });
    });
  });

  // 3. getInternalUserDetail
  describe("getInternalUserDetail", () => {
    it("returns correct storeIds for the user", async () => {
      await withRollback(async (outerTx) => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const { companyId } = await seedFixture(outerTx);
        const userId = await seedUser(outerTx, companyId, suffix);
        const si = await outerTx.insert(stores)
          .values([
            { companyId, name: "Detail-S1-" + suffix, code: "ds1_" + suffix },
            { companyId, name: "Detail-S2-" + suffix, code: "ds2_" + suffix },
          ])
          .returning({ id: stores.id });
        const s1 = (si[0] as { id: string }).id;
        const s2 = (si[1] as { id: string }).id;
        await outerTx.insert(userStoreMemberships).values([
          { companyId, userId, storeId: s1 },
          { companyId, userId, storeId: s2 },
        ]);
        const detail = await getInternalUserDetail(outerTx, companyId, userId);
        expect(detail).not.toBeNull();
        expect(detail?.storeIds).toHaveLength(2);
        expect(detail?.storeIds).toContain(s1);
        expect(detail?.storeIds).toContain(s2);
      });
    });
    it("returns null for a userId belonging to another company", async () => {
      await withRollback(async (outerTx) => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const { companyId, otherCompanyId } = await seedFixture(outerTx);
        const otherUserId = await seedUser(outerTx, otherCompanyId, "other_" + suffix);
        expect(await getInternalUserDetail(outerTx, companyId, otherUserId)).toBeNull();
      });
    });
  });

  // 4. updateInternalUserRole
  describe("updateInternalUserRole", () => {
    it("updates role for own-company user", async () => {
      await withRollback(async (outerTx) => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const { companyId } = await seedFixture(outerTx);
        const userId = await seedUser(outerTx, companyId, suffix);
        const adminRole = await getGlobalRole(outerTx, "admin");
        const dispatcherRole = await getGlobalRole(outerTx, "dispatcher");
        await outerTx.update(users).set({ roleId: adminRole.id }).where(eq(users.id, userId));
        await updateInternalUserRole(outerTx, companyId, userId, dispatcherRole.id);
        const rows = await outerTx.select({ roleId: users.roleId }).from(users).where(eq(users.id, userId));
        expect((rows[0] as { roleId: string }).roleId).toBe(dispatcherRole.id);
      });
    });
    it("does not change a user from another company (company scope enforcement)", async () => {
      await withRollback(async (outerTx) => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const { companyId, otherCompanyId } = await seedFixture(outerTx);
        const adminRole = await getGlobalRole(outerTx, "admin");
        const dispatcherRole = await getGlobalRole(outerTx, "dispatcher");
        const otherUserId = await seedUser(outerTx, otherCompanyId, "other_" + suffix);
        await outerTx.update(users).set({ roleId: adminRole.id }).where(eq(users.id, otherUserId));
        await updateInternalUserRole(outerTx, companyId, otherUserId, dispatcherRole.id);
        const rows = await outerTx.select({ roleId: users.roleId }).from(users).where(eq(users.id, otherUserId));
        expect((rows[0] as { roleId: string }).roleId).toBe(adminRole.id);
      });
    });
  });

  // 5. setInternalUserActive
  describe("setInternalUserActive", () => {
    it("sets is_active to false for an active user", async () => {
      await withRollback(async (outerTx) => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const { companyId } = await seedFixture(outerTx);
        const userId = await seedUser(outerTx, companyId, suffix, { isActive: true });
        await setInternalUserActive(outerTx, companyId, userId, false);
        const rows = await outerTx.select({ isActive: users.isActive }).from(users).where(eq(users.id, userId));
        expect((rows[0] as { isActive: boolean }).isActive).toBe(false);
      });
    });
    it("sets is_active back to true (re-activate)", async () => {
      await withRollback(async (outerTx) => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const { companyId } = await seedFixture(outerTx);
        const userId = await seedUser(outerTx, companyId, suffix, { isActive: false });
        await setInternalUserActive(outerTx, companyId, userId, true);
        const rows = await outerTx.select({ isActive: users.isActive }).from(users).where(eq(users.id, userId));
        expect((rows[0] as { isActive: boolean }).isActive).toBe(true);
      });
    });
  });

  // 6. setInternalUserStores
  describe("setInternalUserStores", () => {
    it("6a: assigns 2 stores where there were none before -> 2 active memberships", async () => {
      await withRollback(async (outerTx) => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const { companyId } = await seedFixture(outerTx);
        const userId = await seedUser(outerTx, companyId, suffix);
        const si = await outerTx.insert(stores)
          .values([
            { companyId, name: "S1-" + suffix, code: "s1_" + suffix },
            { companyId, name: "S2-" + suffix, code: "s2_" + suffix },
          ])
          .returning({ id: stores.id });
        const s1 = (si[0] as { id: string }).id;
        const s2 = (si[1] as { id: string }).id;
        await setInternalUserStores(outerTx, companyId, userId, [s1, s2]);
        const mb = await outerTx.select({ storeId: userStoreMemberships.storeId, deletedAt: userStoreMemberships.deletedAt })
          .from(userStoreMemberships)
          .where(and(eq(userStoreMemberships.userId, userId), eq(userStoreMemberships.companyId, companyId)));
        expect(mb).toHaveLength(2);
        for (const m of mb as Array<{ storeId: string; deletedAt: Date | null }>) { expect(m.deletedAt).toBeNull(); }
        const ids = (mb as Array<{ storeId: string }>).map((m) => m.storeId);
        expect(ids).toContain(s1);
        expect(ids).toContain(s2);
      });
    });
    it("6b: removing one store soft-deletes its membership, keeping the other active", async () => {
      await withRollback(async (outerTx) => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const { companyId } = await seedFixture(outerTx);
        const userId = await seedUser(outerTx, companyId, suffix);
        const si = await outerTx.insert(stores)
          .values([
            { companyId, name: "S1-" + suffix, code: "s1_" + suffix },
            { companyId, name: "S2-" + suffix, code: "s2_" + suffix },
          ])
          .returning({ id: stores.id });
        const s1 = (si[0] as { id: string }).id;
        const s2 = (si[1] as { id: string }).id;
        await setInternalUserStores(outerTx, companyId, userId, [s1, s2]);
        await setInternalUserStores(outerTx, companyId, userId, [s1]);
        const mb = await outerTx.select({ storeId: userStoreMemberships.storeId, deletedAt: userStoreMemberships.deletedAt })
          .from(userStoreMemberships)
          .where(and(eq(userStoreMemberships.userId, userId), eq(userStoreMemberships.companyId, companyId)));
        expect(mb).toHaveLength(2);
        const typed = mb as Array<{ storeId: string; deletedAt: Date | null }>;
        expect(typed.find((m) => m.storeId === s1)?.deletedAt).toBeNull();
        expect(typed.find((m) => m.storeId === s2)?.deletedAt).not.toBeNull();
      });
    });
    it("6c: re-assigning a previously removed store restores the membership (deletedAt -> null)", async () => {
      await withRollback(async (outerTx) => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const { companyId } = await seedFixture(outerTx);
        const userId = await seedUser(outerTx, companyId, suffix);
        const si = await outerTx.insert(stores)
          .values([{ companyId, name: "S1-" + suffix, code: "s1_" + suffix }])
          .returning({ id: stores.id });
        const s1 = (si[0] as { id: string }).id;
        await setInternalUserStores(outerTx, companyId, userId, [s1]);
        await setInternalUserStores(outerTx, companyId, userId, []);
        await setInternalUserStores(outerTx, companyId, userId, [s1]);
        const mb = await outerTx.select({ storeId: userStoreMemberships.storeId, deletedAt: userStoreMemberships.deletedAt })
          .from(userStoreMemberships)
          .where(and(eq(userStoreMemberships.userId, userId), eq(userStoreMemberships.companyId, companyId)));
        expect(mb).toHaveLength(1);
        expect((mb[0] as { deletedAt: Date | null }).deletedAt).toBeNull();
      });
    });
    it("6d: cross-tenant storeId is silently ignored (validStoreIds filter)", async () => {
      await withRollback(async (outerTx) => {
        const suffix = crypto.randomUUID().slice(0, 8);
        const { companyId, otherCompanyId } = await seedFixture(outerTx);
        const userId = await seedUser(outerTx, companyId, suffix);
        const ownSi = await outerTx.insert(stores)
          .values([{ companyId, name: "Own-" + suffix, code: "own_" + suffix }])
          .returning({ id: stores.id });
        const ownId = (ownSi[0] as { id: string }).id;
        const othSi = await outerTx.insert(stores)
          .values([{ companyId: otherCompanyId, name: "Other-" + suffix, code: "other_" + suffix }])
          .returning({ id: stores.id });
        const othId = (othSi[0] as { id: string }).id;
        await setInternalUserStores(outerTx, companyId, userId, [ownId, othId]);
        const mb = await outerTx.select({ storeId: userStoreMemberships.storeId, deletedAt: userStoreMemberships.deletedAt })
          .from(userStoreMemberships)
          .where(and(eq(userStoreMemberships.userId, userId), eq(userStoreMemberships.companyId, companyId)));
        const active = (mb as Array<{ storeId: string; deletedAt: Date | null }>).filter((m) => m.deletedAt === null);
        expect(active).toHaveLength(1);
        expect(active[0]?.storeId).toBe(ownId);
        expect((mb as Array<{ storeId: string }>).find((m) => m.storeId === othId)).toBeUndefined();
      });
    });
  });
});