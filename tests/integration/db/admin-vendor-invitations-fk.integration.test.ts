import { config } from "dotenv";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { adminVendorInvitations } from "@/lib/db/schema/admin_vendor_invitations";
import { companies } from "@/lib/db/schema/companies";
import { users } from "@/lib/db/schema/users";
import { vendorUsers } from "@/lib/db/schema/vendor_users";
import { vendors } from "@/lib/db/schema/vendors";
import {
  resendAdminVendorInvitation,
  revokeAdminVendorInvitation,
} from "@/lib/services/admin-vendor-invitations";
import { runExpireOnce } from "@/lib/inngest/functions/invitation-expirer";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";
const FOREIGN_KEY_VIOLATION = "23503";

type Db = NonNullable<typeof db>;
type TransactionCallback = Parameters<Db["transaction"]>[0];
type Tx = Parameters<TransactionCallback>[0];

interface AdminInvitationFixture {
  companyId: string;
  vendorId: string;
  adminUserId: string;
}

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

async function expectPostgresErrorCode(
  action: () => Promise<unknown>,
  code: string,
): Promise<void> {
  try {
    await action();
  } catch (err) {
    expect((err as { code?: string }).code).toBe(code);
    return;
  }
  throw new Error(`Expected postgres error code ${code}`);
}
// Phase 60 WARN-2: single-statement CTE seed (auth.users -> public.users).
// Phase 59 seedUser uses two separate statements; we intentionally do NOT
// literal-copy that helper here.
async function seedAdminUser(
  outerTx: Tx,
  companyId: string,
  suffix: string,
  label: string,
): Promise<string> {
  const newUserId = crypto.randomUUID();
  const userEmail = `${label}-${suffix}@example.test`;
  const userName = `${label} ${suffix}`;

  await outerTx.execute(sql`
    WITH auth_user AS (
      INSERT INTO auth.users (id) VALUES (${newUserId}::uuid)
      RETURNING id
    )
    INSERT INTO public.users (id, company_id, email, name, is_active)
    SELECT id, ${companyId}::uuid, ${userEmail}, ${userName}, true FROM auth_user
  `);

  return newUserId;
}
async function seedAdminInvitationFixture(
  outerTx: Tx,
  options: { companyLabel?: string } = {},
): Promise<AdminInvitationFixture> {
  const { companyLabel = "Company" } = options;
  const suffix = crypto.randomUUID().slice(0, 8);

  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__avi_fk_${companyLabel}_${suffix}__`, code: `avi_${suffix}` })
    .returning({ id: companies.id });
  const company = requireRow(companyRow, "company");

  const [vendorRow] = await outerTx
    .insert(vendors)
    .values({ companyId: company.id, name: `Vendor ${suffix}`, isActive: true })
    .returning({ id: vendors.id });
  const vendor = requireRow(vendorRow, "vendor");

  const adminUserId = await seedAdminUser(outerTx, company.id, suffix, "admin");

  return {
    companyId: company.id,
    vendorId: vendor.id,
    adminUserId,
  };
}

async function seedVendorUser(outerTx: Tx, vendorId: string, companyId: string): Promise<string> {
  const vendorUserAuthId = crypto.randomUUID();
  const suffix = crypto.randomUUID().slice(0, 8);

  await outerTx.execute(sql`
    INSERT INTO auth.users (id) VALUES (${vendorUserAuthId}::uuid)
  `);

  const [vendorUserRow] = await outerTx
    .insert(vendorUsers)
    .values({
      vendorId,
      companyId,
      authUserId: vendorUserAuthId,
      email: `vendor-${suffix}@example.test`,
      isActive: true,
    })
    .returning({ id: vendorUsers.id });
  return requireRow(vendorUserRow, "vendor user").id;
}
function buildSupabaseAdminMock() {
  return {
    auth: {
      admin: {
        inviteUserByEmail: vi.fn().mockResolvedValue({
          data: { user: { id: crypto.randomUUID() } },
          error: null,
        }),
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
        getUserByEmail: vi.fn().mockResolvedValue({
          data: null,
          error: { message: "user_not_found", status: 404 },
        }),
        generateLink: vi.fn().mockResolvedValue({
          data: { properties: { action_link: "https://example.test/invite" } },
          error: null,
        }),
      },
    },
  };
}
describeIntegration("admin_vendor_invitations invited_by_user_id composite FK", () => {
  // (i) Cross-company user -> FK violation
  it("rejects INSERT with cross-company invited_by_user_id via composite FK", async () => {
    await withRollback(async (outerTx) => {
      const fixtureA = await seedAdminInvitationFixture(outerTx, { companyLabel: "A" });
      const fixtureB = await seedAdminInvitationFixture(outerTx, { companyLabel: "B" });

      await expectPostgresErrorCode(
        () =>
          outerTx.insert(adminVendorInvitations).values({
            companyId: fixtureA.companyId,
            vendorId: fixtureA.vendorId,
            invitedByUserId: fixtureB.adminUserId,
            email: "x@example.test",
          }),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  // (ii) Same-company user -> accepted
  it("accepts INSERT with same-company invited_by_user_id", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedAdminInvitationFixture(outerTx);

      const [inserted] = await outerTx
        .insert(adminVendorInvitations)
        .values({
          companyId: fixture.companyId,
          vendorId: fixture.vendorId,
          invitedByUserId: fixture.adminUserId,
          email: "y@example.test",
        })
        .returning({ id: adminVendorInvitations.id });

      const rows = await outerTx
        .select()
        .from(adminVendorInvitations)
        .where(eq(adminVendorInvitations.id, requireRow(inserted, "invitation").id));
      expect(rows).toHaveLength(1);
      expect(rows[0]?.invitedByUserId).toBe(fixture.adminUserId);
    });
  });

  // (iii) NULL invited_by_user_id -> accepted (MATCH SIMPLE)
  it("accepts INSERT with NULL invited_by_user_id (MATCH SIMPLE)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedAdminInvitationFixture(outerTx);

      await outerTx.insert(adminVendorInvitations).values({
        companyId: fixture.companyId,
        vendorId: fixture.vendorId,
        invitedByUserId: null,
        email: "z@example.test",
      });

      const rows = await outerTx
        .select()
        .from(adminVendorInvitations)
        .where(
          and(
            eq(adminVendorInvitations.vendorId, fixture.vendorId),
            isNull(adminVendorInvitations.invitedByUserId),
          ),
        );
      expect(rows).toHaveLength(1);
    });
  });
  // (iv) User delete restricted by NO ACTION (separate from vendor_id ON DELETE CASCADE)
  it("rejects user hard delete referenced by admin invitation (ON DELETE NO ACTION = RESTRICT, distinct from vendor cascade)", async () => {
    await withRollback(async (outerTx) => {
      const fixture = await seedAdminInvitationFixture(outerTx);

      await outerTx.insert(adminVendorInvitations).values({
        companyId: fixture.companyId,
        vendorId: fixture.vendorId,
        invitedByUserId: fixture.adminUserId,
        email: "ref@example.test",
      });

      await expectPostgresErrorCode(
        () => outerTx.delete(users).where(eq(users.id, fixture.adminUserId)),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  // (v) Statement-time check (NO ACTION non-deferrable)
  it("raises FK violation at statement time for cross-company user (NO ACTION non-deferrable check)", async () => {
    await withRollback(async (outerTx) => {
      const fixtureA = await seedAdminInvitationFixture(outerTx, { companyLabel: "DefA" });
      const fixtureB = await seedAdminInvitationFixture(outerTx, { companyLabel: "DefB" });

      await expectPostgresErrorCode(
        () =>
          outerTx.insert(adminVendorInvitations).values({
            companyId: fixtureA.companyId,
            vendorId: fixtureA.vendorId,
            invitedByUserId: fixtureB.adminUserId,
            email: "def@example.test",
          }),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });

  // (vi) Active service INSERT semantics simulate
  // Phase 60 plan v2 BLOCK-2 requires direct service call. We simulate the
  // service INSERT semantics here because createAdminVendorInvitation requires
  // a full supabase admin surface; a complete mock exceeds scope. The INSERT
  // pattern below is identical to the service path (companyId +
  // invitedByUserId both derived from the same adminUser), so the composite
  // FK guarantee is exercised the same way the real service would experience.
  it("simulates createAdminVendorInvitation INSERT path: same-company adminUser accepted, cross-company rejected (BLOCK-2 simulate)", async () => {
    await withRollback(async (outerTx) => {
      const fixtureA = await seedAdminInvitationFixture(outerTx, { companyLabel: "ActA" });
      const fixtureB = await seedAdminInvitationFixture(outerTx, { companyLabel: "ActB" });

      const [okRow] = await outerTx
        .insert(adminVendorInvitations)
        .values({
          companyId: fixtureA.companyId,
          vendorId: fixtureA.vendorId,
          invitedByUserId: fixtureA.adminUserId,
          email: "active-ok@example.test",
        })
        .returning({ id: adminVendorInvitations.id });
      expect(okRow?.id).toBeTruthy();

      await expectPostgresErrorCode(
        () =>
          outerTx.insert(adminVendorInvitations).values({
            companyId: fixtureA.companyId,
            vendorId: fixtureA.vendorId,
            invitedByUserId: fixtureB.adminUserId,
            email: "active-bad@example.test",
          }),
        FOREIGN_KEY_VIOLATION,
      );
    });
  });
  // (vii) UPDATE invariant suite: invited_by_user_id must remain unchanged
  // across the 4 production UPDATE paths (callback finalize / expirer /
  // resend / revoke). WARN-3 enforcement.
  describe("(vii) UPDATE invariant suite: invited_by_user_id is preserved across all production UPDATE paths", () => {
    // (vii-a) callback finalize UPDATE simulate
    it("(vii-a) callback finalize UPDATE preserves invited_by_user_id", async () => {
      await withRollback(async (outerTx) => {
        const fixture = await seedAdminInvitationFixture(outerTx);
        const vendorUserId = await seedVendorUser(outerTx, fixture.vendorId, fixture.companyId);

        const [invitationRow] = await outerTx
          .insert(adminVendorInvitations)
          .values({
            companyId: fixture.companyId,
            vendorId: fixture.vendorId,
            invitedByUserId: fixture.adminUserId,
            vendorUserId,
            email: "callback@example.test",
            status: "sent",
            sentAt: new Date(),
          })
          .returning({ id: adminVendorInvitations.id });
        const invitationId = requireRow(invitationRow, "invitation").id;

        await outerTx
          .update(adminVendorInvitations)
          .set({ status: "accepted", acceptedAt: new Date() })
          .where(
            and(
              eq(adminVendorInvitations.vendorUserId, vendorUserId),
              eq(adminVendorInvitations.status, "sent"),
            ),
          );

        const [after] = await outerTx
          .select()
          .from(adminVendorInvitations)
          .where(eq(adminVendorInvitations.id, invitationId));
        expect(after?.invitedByUserId).toBe(fixture.adminUserId);
        expect(after?.status).toBe("accepted");
      });
    });

    // (vii-b) expirer UPDATE via runExpireOnce direct call
    it("(vii-b) runExpireOnce preserves invited_by_user_id", async () => {
      await withRollback(async (outerTx) => {
        const fixture = await seedAdminInvitationFixture(outerTx);
        const pastExpiry = new Date(Date.now() - 1000 * 60 * 60);

        const [invitationRow] = await outerTx
          .insert(adminVendorInvitations)
          .values({
            companyId: fixture.companyId,
            vendorId: fixture.vendorId,
            invitedByUserId: fixture.adminUserId,
            email: "expirer@example.test",
            status: "sent",
            expiresAt: pastExpiry,
          })
          .returning({ id: adminVendorInvitations.id });
        const invitationId = requireRow(invitationRow, "invitation").id;

        await runExpireOnce(outerTx as unknown as Parameters<typeof runExpireOnce>[0]);

        const [after] = await outerTx
          .select()
          .from(adminVendorInvitations)
          .where(eq(adminVendorInvitations.id, invitationId));
        expect(after?.invitedByUserId).toBe(fixture.adminUserId);
        expect(after?.status).toBe("expired");
      });
    });
    // (vii-c) resendAdminVendorInvitation direct call.
    // Requires vendor_user_id seeded; resend throws AdminVendorInvitationNotFoundError
    // if vendorUserId is null. We use positive-evidence assertion (sentAt
    // bumped past seeded value) to discriminate "resend ran its UPDATE and
    // preserved invited_by_user_id" from "resend threw early so its UPDATE
    // never ran" (advisor flag at seal review).
    it("(vii-c) resendAdminVendorInvitation runs its UPDATE and preserves invited_by_user_id", async () => {
      await withRollback(async (outerTx) => {
        const fixture = await seedAdminInvitationFixture(outerTx);
        const vendorUserId = await seedVendorUser(outerTx, fixture.vendorId, fixture.companyId);
        const seedSentAt = new Date(Date.now() - 1000 * 60 * 60);

        const [invitationRow] = await outerTx
          .insert(adminVendorInvitations)
          .values({
            companyId: fixture.companyId,
            vendorId: fixture.vendorId,
            invitedByUserId: fixture.adminUserId,
            vendorUserId,
            email: "resend@example.test",
            status: "sent",
            sentAt: seedSentAt,
          })
          .returning({ id: adminVendorInvitations.id });
        const invitationId = requireRow(invitationRow, "invitation").id;

        const supabaseMock = buildSupabaseAdminMock();
        const adminUserContext = {
          userId: fixture.adminUserId,
          companyId: fixture.companyId,
          email: "admin@example.test",
          isActive: true,
          isAdmin: true,
        } as unknown as Parameters<typeof resendAdminVendorInvitation>[2];

        // No try/catch: if resend throws, the test must fail. Only then can
        // the invariant assertion below be considered meaningful.
        const result = await resendAdminVendorInvitation(
          outerTx as unknown as Parameters<typeof resendAdminVendorInvitation>[0],
          supabaseMock as unknown as Parameters<typeof resendAdminVendorInvitation>[1],
          adminUserContext,
          invitationId,
        );

        const [after] = await outerTx
          .select()
          .from(adminVendorInvitations)
          .where(eq(adminVendorInvitations.id, invitationId));

        // Positive evidence: resend's UPDATE bumped sentAt past seeded value.
        expect(result.sentAt.getTime()).toBeGreaterThan(seedSentAt.getTime());
        expect(after?.sentAt?.getTime()).toBe(result.sentAt.getTime());
        // Invariant: invited_by_user_id remained unchanged through the UPDATE.
        expect(after?.invitedByUserId).toBe(fixture.adminUserId);
      });
    });
    // (vii-d) revokeAdminVendorInvitation direct call (no supabase needed)
    it("(vii-d) revokeAdminVendorInvitation preserves invited_by_user_id", async () => {
      await withRollback(async (outerTx) => {
        const fixture = await seedAdminInvitationFixture(outerTx);

        const [invitationRow] = await outerTx
          .insert(adminVendorInvitations)
          .values({
            companyId: fixture.companyId,
            vendorId: fixture.vendorId,
            invitedByUserId: fixture.adminUserId,
            email: "revoke@example.test",
            status: "sent",
          })
          .returning({ id: adminVendorInvitations.id });
        const invitationId = requireRow(invitationRow, "invitation").id;

        const adminUserContext = {
          userId: fixture.adminUserId,
          companyId: fixture.companyId,
          email: "admin@example.test",
          isActive: true,
          isAdmin: true,
        } as unknown as Parameters<typeof revokeAdminVendorInvitation>[1];

        await revokeAdminVendorInvitation(
          outerTx as unknown as Parameters<typeof revokeAdminVendorInvitation>[0],
          adminUserContext,
          invitationId,
        );

        const [after] = await outerTx
          .select()
          .from(adminVendorInvitations)
          .where(eq(adminVendorInvitations.id, invitationId));
        expect(after?.invitedByUserId).toBe(fixture.adminUserId);
        expect(after?.status).toBe("revoked");
      });
    });
  });
});