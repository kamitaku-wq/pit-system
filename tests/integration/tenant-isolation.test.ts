import { config } from "dotenv";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DIRECT_URL or DATABASE_URL must be set for integration tests");
}

const sql = postgres(databaseUrl, { prepare: false });

afterAll(async () => {
  await sql.end();
});

const COMPANY_A = "aaaaaaaa-0000-0000-0000-000000000001";
const COMPANY_B = "bbbbbbbb-0000-0000-0000-000000000001";
const ADMIN_A = "11111111-0000-0000-0000-000000000001";
const ADMIN_B = "22222222-0000-0000-0000-000000000001";
const VENDOR_A = "33333333-0000-0000-0000-000000000001";
const VENDOR_USER_A_AUTH = "44444444-0000-0000-0000-000000000001";

const claims = (sub: string) => JSON.stringify({ sub, role: "authenticated" });

type SetupRole = "admin_a" | "admin_b" | "vendor_user" | "anon";
type Tx = Parameters<Parameters<typeof sql.begin>[0]>[0];

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
      tx<{ id: string | null }[]>`SELECT public.current_user_company_id() AS id`,
    );
    expect(result[0]?.id).toBeNull();
  });

  it("current_user_company_id() returns company A for admin A", async () => {
    const result = await withFixture("admin_a", async (tx) =>
      tx<{ id: string | null }[]>`SELECT public.current_user_company_id() AS id`,
    );
    expect(result[0]?.id).toBe(COMPANY_A);
  });
});
