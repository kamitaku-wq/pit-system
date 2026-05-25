import { config } from "dotenv";
import { and, eq, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { auditLogs } from "@/lib/db/schema/audit_logs";
import { adminVendorInvitations } from "@/lib/db/schema/admin_vendor_invitations";
import { companies } from "@/lib/db/schema/companies";
import { vendors } from "@/lib/db/schema/vendors";
import { runExpireOnce } from "@/lib/inngest/functions/invitation-expirer";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DIRECT_URL or DATABASE_URL must be set for integration tests");
}

const sql = postgres(databaseUrl, { prepare: false });
const db = drizzle(sql);

afterAll(async () => {
  await sql.end();
});

const COMPANY_A = "aaaaaaaa-0000-0000-0000-000000000001";
const COMPANY_B = "bbbbbbbb-0000-0000-0000-000000000001";
const ADMIN_A = "11111111-0000-0000-0000-000000000001";
const ADMIN_B = "22222222-0000-0000-0000-000000000001";
const VENDOR_A = "33333333-0000-0000-0000-000000000001";
const VENDOR_USER_A_AUTH = "44444444-0000-0000-0000-000000000001";
const EXPIRER_COMPANY = "aaaaaaaa-0000-0000-0000-000000000031";
const EXPIRER_VENDOR = "33333333-0000-0000-0000-000000000031";
const EXPIRER_INVITATION_A = "55555555-0000-0000-0000-000000000031";
const EXPIRER_INVITATION_B = "66666666-0000-0000-0000-000000000031";

const claims = (sub: string) => JSON.stringify({ sub, role: "authenticated" });

type SetupRole = "admin_a" | "admin_b" | "vendor_user" | "anon";
// postgres.js dynamic import で TransactionSql 型が unresolvable のため any 許容
// (test 限定、prod code には及ばない)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

async function withFixture<T>(
  setupRole: SetupRole,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  let captured: T;

  try {
    await sql.begin(async (tx) => {
      await tx`
        INSERT INTO auth.users (id, email, instance_id, aud, role) VALUES
          (${ADMIN_A}::uuid, 'admin_a@test.local', '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated'),
          (${ADMIN_B}::uuid, 'admin_b@test.local', '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated'),
          (${VENDOR_USER_A_AUTH}::uuid, 'vu_a@test.local', '00000000-0000-0000-0000-000000000000'::uuid, 'authenticated', 'authenticated')`;

      await tx`
        INSERT INTO companies (id, name) VALUES
          (${COMPANY_A}::uuid, '__e1_A__'),
          (${COMPANY_B}::uuid, '__e1_B__')`;

      await tx`
        INSERT INTO users (id, company_id, email, name) VALUES
          (${ADMIN_A}::uuid, ${COMPANY_A}::uuid, 'admin_a@test.local', 'Admin A'),
          (${ADMIN_B}::uuid, ${COMPANY_B}::uuid, 'admin_b@test.local', 'Admin B')`;

      await tx`
        INSERT INTO vendors (id, company_id, name) VALUES
          (${VENDOR_A}::uuid, ${COMPANY_A}::uuid, 'VendorA')`;

      await tx`
        INSERT INTO vendor_users (id, vendor_id, company_id, auth_user_id, email, is_active) VALUES
          (gen_random_uuid(), ${VENDOR_A}::uuid, ${COMPANY_A}::uuid, ${VENDOR_USER_A_AUTH}::uuid, 'vu_a@test.local', true)`;

      if (setupRole === "anon") {
        await tx`SET LOCAL ROLE anon`;
      } else {
        const sub =
          setupRole === "admin_a"
            ? ADMIN_A
            : setupRole === "admin_b"
              ? ADMIN_B
              : VENDOR_USER_A_AUTH;
        await tx`SET LOCAL ROLE authenticated`;
        await tx.unsafe(`SET LOCAL request.jwt.claims = '${claims(sub)}'`);
      }

      captured = await fn(tx);
      throw new Error("__rollback__");
    });
  } catch (err) {
    if (!(err instanceof Error) || err.message !== "__rollback__") throw err;
  }

  return captured!;
}

async function cleanupExpirerFixture(): Promise<void> {
  await db.delete(auditLogs).where(eq(auditLogs.companyId, EXPIRER_COMPANY));
  await db.delete(adminVendorInvitations).where(eq(adminVendorInvitations.companyId, EXPIRER_COMPANY));
  await db.delete(vendors).where(eq(vendors.id, EXPIRER_VENDOR));
  await db.delete(auditLogs).where(eq(auditLogs.companyId, EXPIRER_COMPANY));
  await db.delete(companies).where(eq(companies.id, EXPIRER_COMPANY));
}

describe("tenant-isolation RLS (PoC #6移植)", () => {
  it("admin A sees own company vendor only", async () => {
    const vendors = await withFixture("admin_a", async (tx) =>
      tx<{ id: string }[]>`SELECT id FROM vendors ORDER BY id`,
    );
    expect(vendors.map((v: { id: string }) => v.id)).toEqual([VENDOR_A]);
  });

  it("admin B sees 0 vendors (different company)", async () => {
    const vendors = await withFixture("admin_b", async (tx) =>
      tx<{ id: string }[]>`SELECT id FROM vendors`,
    );
    expect(vendors).toHaveLength(0);
  });

  it("admin_vendor_invitations are isolated by company", async () => {
    const invitations = await withFixture("admin_a", async (tx) => {
      await tx`
        INSERT INTO admin_vendor_invitations (company_id, vendor_id, invited_by_user_id, email)
        VALUES (${COMPANY_A}::uuid, ${VENDOR_A}::uuid, ${ADMIN_A}::uuid, 'invite_a@test.local')`;

      await tx.unsafe(`SET LOCAL request.jwt.claims = '${claims(ADMIN_B)}'`);

      return tx<{ id: string }[]>`SELECT id FROM admin_vendor_invitations`;
    });
    expect(invitations).toHaveLength(0);
  });

  it("audit_logs for admin_vendor_invitations are isolated by company", async () => {
    const auditLogs = await withFixture("admin_a", async (tx) => {
      await tx`
        INSERT INTO admin_vendor_invitations (company_id, vendor_id, invited_by_user_id, email)
        VALUES (${COMPANY_A}::uuid, ${VENDOR_A}::uuid, ${ADMIN_A}::uuid, 'invite_a@test.local')`;

      await tx.unsafe(`SET LOCAL request.jwt.claims = '${claims(ADMIN_B)}'`);

      return tx<{ id: string }[]>`
        SELECT id
        FROM audit_logs
        WHERE entity_type = 'admin_vendor_invitations'`;
    });
    expect(auditLogs).toHaveLength(0);
  });

  it("vendor_user sees 0 vendors (vendors is internal-admin only)", async () => {
    const vendors = await withFixture("vendor_user", async (tx) =>
      tx<{ id: string }[]>`SELECT id FROM vendors`,
    );
    expect(vendors).toHaveLength(0);
  });

  it("anon sees 0 vendors", async () => {
    const vendors = await withFixture("anon", async (tx) =>
      tx<{ id: string }[]>`SELECT id FROM vendors`,
    );
    expect(vendors).toHaveLength(0);
  });

  it("current_vendor_id() works for vendor_user", async () => {
    const result = await withFixture("vendor_user", async (tx) =>
      tx<{ id: string | null }[]>`SELECT public.current_vendor_id() AS id`,
    );
    expect(result[0]?.id).toBe(VENDOR_A);
  });

  it("vendor_accessible_company_ids(vendor_id) works for vendor_user", async () => {
    const ids = await withFixture("vendor_user", async (tx) =>
      tx<{ company_id: string }[]>`
        SELECT public.vendor_accessible_company_ids(${VENDOR_A}::uuid) AS company_id`,
    );
    expect(ids.map((r: { company_id: string }) => r.company_id)).toEqual([COMPANY_A]);
  });

  it("current_user_company_id() returns NULL for vendor_user", async () => {
    const result = await withFixture("vendor_user", async (tx) =>
      tx<{ id: string }[]>`SELECT public.current_user_company_id() AS id`,
    );
    expect(result[0]?.id).toBeNull();
  });

  it("current_user_company_id() returns company A for admin A", async () => {
    const result = await withFixture("admin_a", async (tx) =>
      tx<{ id: string }[]>`SELECT public.current_user_company_id() AS id`,
    );
    expect(result[0]?.id).toBe(COMPANY_A);
  });

  it("admin_vendor_invitations INSERT records masked audit_logs payload", async () => {
    const auditLog = await withFixture("admin_a", async (tx) => {
      let invitationId: string | undefined;

      try {
        const inserted = await tx<{ id: string }[]>`
          INSERT INTO admin_vendor_invitations (
            company_id,
            vendor_id,
            invited_by_user_id,
            email,
            name,
            status
          )
          VALUES (
            ${COMPANY_A}::uuid,
            ${VENDOR_A}::uuid,
            ${ADMIN_A}::uuid,
            'test@example.com',
            'テスト太郎',
            'pending'
          )
          RETURNING id`;
        invitationId = inserted[0]?.id;
        expect(invitationId).toBeDefined();

        const rows = await tx<
          {
            before_json: unknown | null;
            masked_email: string | null;
            masked_name: string | null;
          }[]
        >`
          SELECT
            before_json,
            after_json ->> 'email' AS masked_email,
            after_json ->> 'name' AS masked_name
          FROM audit_logs
          WHERE entity_type = 'admin_vendor_invitations'
            AND entity_id = ${invitationId}::uuid`;

        expect(rows).toHaveLength(1);
        return rows[0];
      } finally {
        if (invitationId !== undefined) {
          await tx`RESET ROLE`;
          await tx`
            DELETE FROM admin_vendor_invitations
            WHERE id = ${invitationId}::uuid`;
          await tx`
            DELETE FROM audit_logs
            WHERE entity_type = 'admin_vendor_invitations'
              AND entity_id = ${invitationId}::uuid`;
        }
      }
    });

    expect(auditLog?.masked_email).toBe("t***@example.com");
    expect(auditLog?.masked_name).toBe("テ***");
    expect(auditLog?.before_json).toBeNull();
  });
});

describe("runExpireOnce integration", () => {
  it("expires past-due rows and leaves NULL-expiresAt rows untouched", async () => {
    await cleanupExpirerFixture();

    try {
      await db.insert(companies).values({
        id: EXPIRER_COMPANY,
        name: "__expirer_company__",
        code: "__expirer_company__",
      });
      await db.insert(vendors).values({
        id: EXPIRER_VENDOR,
        companyId: EXPIRER_COMPANY,
        name: "__expirer_vendor__",
      });
      await db.insert(adminVendorInvitations).values([
        {
          id: EXPIRER_INVITATION_A,
          companyId: EXPIRER_COMPANY,
          vendorId: EXPIRER_VENDOR,
          email: "expirer-a@test.local",
          status: "sent",
          expiresAt: new Date("2020-01-01T00:00:00.000Z"),
        },
        {
          id: EXPIRER_INVITATION_B,
          companyId: EXPIRER_COMPANY,
          vendorId: EXPIRER_VENDOR,
          email: "expirer-b@test.local",
          status: "pending",
          expiresAt: null,
        },
      ]);

      const result = await runExpireOnce(db);
      expect(result.expired).toBe(1);

      const rows = await db
        .select({
          id: adminVendorInvitations.id,
          status: adminVendorInvitations.status,
        })
        .from(adminVendorInvitations)
        .where(eq(adminVendorInvitations.companyId, EXPIRER_COMPANY));
      expect(rows.find((row) => row.id === EXPIRER_INVITATION_A)?.status).toBe("expired");
      expect(rows.find((row) => row.id === EXPIRER_INVITATION_B)?.status).toBe("pending");

      const auditRows = await db
        .select({ id: auditLogs.id })
        .from(auditLogs)
        .where(
          and(
            eq(auditLogs.actorKind, "system"),
            isNull(auditLogs.actorUserId),
            eq(auditLogs.entityType, "admin_vendor_invitations"),
            eq(auditLogs.entityId, EXPIRER_INVITATION_A),
            eq(auditLogs.action, "update"),
          ),
        );
      expect(auditRows).toHaveLength(1);
    } finally {
      await cleanupExpirerFixture();
    }
  });

  it("returns {expired: 0} with no expirable rows", async () => {
    await cleanupExpirerFixture();

    const result = await runExpireOnce(db);

    expect(result.expired).toBe(0);
  });
});
