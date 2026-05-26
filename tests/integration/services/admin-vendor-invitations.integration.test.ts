import type { SupabaseClient } from "@supabase/supabase-js";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";
import type { AdminUser } from "@/lib/auth/admin-role";

const { default: postgres } = await import("postgres");

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const sql = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = sql ? drizzle(sql) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

vi.doMock("@/lib/db/client", () => ({ db }));

const {
  AdminVendorInvitationCrossTenantError,
  AdminVendorInvitationDuplicateError,
  AdminVendorInvitationInvalidStateError,
  createAdminVendorInvitation,
  resendAdminVendorInvitation,
  revokeAdminVendorInvitation,
} = await import("@/lib/services/admin-vendor-invitations");

// postgres-js transaction type is intentionally kept local to this test helper.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;
type Fixture = {
  companyId: string;
  vendorId: string;
  adminUser: AdminUser;
};
type ScopedDb = NonNullable<typeof db>;
type InvitationRow = {
  status: string;
  sent_at: Date | string | null;
  last_resent_at: Date | string | null;
  role: string;
  updated_at: Date | string | null;
};
type VendorUserRow = { company_id: string; vendor_id: string; auth_user_id: string; is_active: boolean };
type OutboxRow = { idempotency_key: string };

afterAll(async () => {
  await sql?.end();
});

async function withFixture<T>(fn: (tx: Tx, fixture: Fixture) => Promise<T>): Promise<T> {
  let captured: T;
  await sql!
    .begin(async (tx) => {
      try {
        const fixture = await seedFixture(tx);
        captured = await fn(tx, fixture);
      } finally {
        throw new Error(ROLLBACK);
      }
    })
    .catch((err) => {
      if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
    });
  return captured!;
}

async function seedFixture(tx: Tx): Promise<Fixture> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const adminUserId = crypto.randomUUID();
  const [company] = await tx<{ id: string }[]>`
    INSERT INTO companies (name, code)
    VALUES (${`__it_avi_company_${suffix}__`}, ${`it_avi_${suffix}`})
    RETURNING id`;
  await tx`INSERT INTO auth.users (id) VALUES (${adminUserId})`;
  await tx`
    INSERT INTO users (id, company_id, email, name)
    VALUES (${adminUserId}, ${company!.id}, ${`it-avi-admin-${suffix}@example.test`}, 'IT AVI Admin')`;
  const [vendor] = await tx<{ id: string }[]>`
    INSERT INTO vendors (company_id, name)
    VALUES (${company!.id}, ${`IT AVI Vendor ${suffix}`})
    RETURNING id`;
  return {
    companyId: company!.id,
    vendorId: vendor!.id,
    adminUser: { userId: adminUserId, companyId: company!.id, roleCode: "admin" },
  };
}

async function seedAuthUser(tx: Tx, email: string): Promise<string> {
  const authUserId = crypto.randomUUID();
  await tx`INSERT INTO auth.users (id, email) VALUES (${authUserId}, ${email})`;
  return authUserId;
}

function mockSupabaseAdmin(authUserId: string, email: string): SupabaseClient {
  return {
    auth: {
      admin: {
        listUsers: vi.fn().mockResolvedValue({ data: { users: [] }, error: null }),
        inviteUserByEmail: vi.fn().mockResolvedValue({
          data: { user: { id: authUserId, email } },
          error: null,
        }),
        deleteUser: vi.fn().mockResolvedValue({ error: null }),
      },
    },
  } as unknown as SupabaseClient;
}

function txDb(tx: Tx): ScopedDb {
  const database = drizzle(tx) as ScopedDb;
  (
    database as unknown as {
      transaction: (callback: (innerTx: ScopedDb) => Promise<unknown>) => Promise<unknown>;
    }
  ).transaction = async (callback) => callback(database);
  return database;
}

function timestampMs(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

async function createInvitation(
  tx: Tx,
  fixture: Fixture,
  email: string,
): Promise<{ authUserId: string; invitationId: string; vendorUserId: string }> {
  const authUserId = await seedAuthUser(tx, email);
  const result = await createAdminVendorInvitation(
    txDb(tx) as never,
    mockSupabaseAdmin(authUserId, email),
    fixture.adminUser,
    { vendorId: fixture.vendorId, email, name: "IT AVI User", role: "vendor_member" },
  );
  return { authUserId, invitationId: result.invitationId, vendorUserId: result.vendorUserId };
}

describeIntegration("admin vendor invitation services", () => {
  it("creates an invitation through DB constraints and rejects a duplicate", async () => {
    await withFixture(async (tx, fixture) => {
      const email = `it-avi-create-${crypto.randomUUID()}@example.test`;
      const authUserId = await seedAuthUser(tx, email);
      const supabaseAdmin = mockSupabaseAdmin(authUserId, email);

      const result = await createAdminVendorInvitation(
        txDb(tx) as never,
        supabaseAdmin,
        fixture.adminUser,
        { vendorId: fixture.vendorId, email, name: "Create User", role: "vendor_member" },
      );

      const [vendorUser] = await tx<VendorUserRow[]>`
        SELECT company_id, vendor_id, auth_user_id, is_active
        FROM vendor_users WHERE id = ${result.vendorUserId}`;
      const [invitation] = await tx<InvitationRow[]>`
        SELECT status, sent_at, last_resent_at, role
        FROM admin_vendor_invitations WHERE id = ${result.invitationId}`;
      const [outbox] = await tx<OutboxRow[]>`
        SELECT idempotency_key FROM notification_outbox WHERE id = ${result.outboxId}`;

      expect(result.companyId).toBe(fixture.companyId);
      expect(vendorUser!.company_id).toBe(fixture.companyId);
      expect(vendorUser!.vendor_id).toBe(fixture.vendorId);
      expect(vendorUser!.auth_user_id).toBe(authUserId);
      expect(vendorUser!.is_active).toBe(false);
      expect(invitation!.status).toBe("sent");
      expect(invitation!.sent_at).toBeTruthy();
      expect(invitation!.role).toBe("vendor_member");
      expect(outbox!.idempotency_key).toBe(`admin-vendor-invitation:${result.invitationId}`);

      await expect(
        createAdminVendorInvitation(
          txDb(tx) as never,
          supabaseAdmin,
          fixture.adminUser,
          { vendorId: fixture.vendorId, email },
        ),
      ).rejects.toBeInstanceOf(AdminVendorInvitationDuplicateError);
    });
  });

  it("resends an invitation and updates sent timestamps without regenerating outbox", async () => {
    await withFixture(async (tx, fixture) => {
      const email = `it-avi-resend-${crypto.randomUUID()}@example.test`;
      const { authUserId, invitationId } = await createInvitation(tx, fixture, email);
      const [before] = await tx<Pick<InvitationRow, "sent_at">[]>`
        SELECT sent_at FROM admin_vendor_invitations WHERE id = ${invitationId}`;
      const outboxBefore = await tx`
        SELECT id, idempotency_key
        FROM notification_outbox
        WHERE idempotency_key = ${"admin-vendor-invitation:" + invitationId}`;
      const result = await resendAdminVendorInvitation(
        txDb(tx) as never,
        mockSupabaseAdmin(authUserId, email),
        fixture.adminUser,
        invitationId,
      );
      const outboxAfter = await tx`
        SELECT id, idempotency_key
        FROM notification_outbox
        WHERE idempotency_key = ${"admin-vendor-invitation:" + invitationId}`;

      const [invitation] = await tx<InvitationRow[]>`
        SELECT status, sent_at, last_resent_at, role
        FROM admin_vendor_invitations WHERE id = ${invitationId}`;

      expect(result.invitationId).toBe(invitationId);
      expect(result.sentAt).toBeInstanceOf(Date);
      expect(invitation!.status).toBe("sent");
      expect(timestampMs(invitation!.sent_at!)).toBeGreaterThanOrEqual(
        timestampMs(before!.sent_at!),
      );
      expect(invitation!.last_resent_at).toBeTruthy();
      expect(timestampMs(invitation!.last_resent_at!)).toBe(timestampMs(invitation!.sent_at!));
      // Design: resend は Supabase 経由で再送、outbox は create 時のみ作成し再生成しない。
      expect(outboxBefore).toHaveLength(1);
      expect(outboxAfter).toHaveLength(1);
      expect(outboxAfter[0]!.id).toBe(outboxBefore[0]!.id);
    });
  });

  it("revokes same-tenant invitations and rejects cross-tenant revoke", async () => {
    await withFixture(async (tx, fixture) => {
      const email = `it-avi-revoke-${crypto.randomUUID()}@example.test`;
      const { invitationId, vendorUserId } = await createInvitation(tx, fixture, email);

      const [beforeRevoke] = await tx<Pick<InvitationRow, "updated_at">[]>`
        SELECT updated_at FROM admin_vendor_invitations WHERE id = ${invitationId}`;
      await expect(
        revokeAdminVendorInvitation(txDb(tx) as never, fixture.adminUser, invitationId),
      ).resolves.toEqual({ invitationId, revoked: true });

      const [revoked] = await tx<Pick<InvitationRow, "status" | "updated_at">[]>`
        SELECT status, updated_at FROM admin_vendor_invitations WHERE id = ${invitationId}`;
      const [vendorUser] = await tx<Pick<VendorUserRow, "is_active">[]>`
        SELECT is_active FROM vendor_users WHERE id = ${vendorUserId}`;
      expect(revoked!.status).toBe("revoked");
      expect(vendorUser!.is_active).toBe(false);
      // T4-#4: revoked_at column は schema に存在しない (spec 要求外)。
      // revoke 時刻は updated_at + status='revoked' の組み合わせで追跡する。
      expect(revoked!.updated_at).toBeTruthy();
      expect(timestampMs(revoked!.updated_at!)).toBeGreaterThan(
        timestampMs(beforeRevoke!.updated_at!),
      );

      const other = await seedFixture(tx);
      const otherEmail = `it-avi-cross-${crypto.randomUUID()}@example.test`;
      const otherInvitation = await createInvitation(tx, other, otherEmail);
      await expect(
        revokeAdminVendorInvitation(
          txDb(tx) as never,
          fixture.adminUser,
          otherInvitation.invitationId,
        ),
      ).rejects.toBeInstanceOf(AdminVendorInvitationCrossTenantError);
    });
  });

  it("rejects revoke of an already-accepted invitation", async () => {
    await withFixture(async (tx, fixture) => {
      const email = `it-avi-accepted-revoke-${crypto.randomUUID()}@example.test`;
      const { invitationId } = await createInvitation(tx, fixture, email);

      // Simulate the admin-invite-callback finalize having accepted the invitation.
      await tx`
        UPDATE admin_vendor_invitations
        SET status = 'accepted', accepted_at = now()
        WHERE id = ${invitationId}`;

      await expect(
        revokeAdminVendorInvitation(txDb(tx) as never, fixture.adminUser, invitationId),
      ).rejects.toBeInstanceOf(AdminVendorInvitationInvalidStateError);

      const [stillAccepted] = await tx`SELECT status FROM admin_vendor_invitations WHERE id = ${invitationId}`;
      expect(stillAccepted!.status).toBe("accepted");
    });
  });
});
