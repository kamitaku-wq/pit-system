import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import { afterAll, describe, expect, it, vi } from "vitest";

const { default: postgres } = await import("postgres");

const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const sql = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = sql ? drizzle(sql) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || databaseUrl.length === 0);
const ROLLBACK = "__rollback__";

vi.doMock("@/lib/db/client", () => ({ db }));

const { getVendorsWithInvitationStatus } = await import("@/lib/services/admin-vendors");

// postgres-js transaction type is intentionally kept local to this test helper.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

afterAll(async () => {
  await sql?.end();
});

async function withFixture<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
  let captured: T;
  await sql!
    .begin(async (tx) => {
      try {
        captured = await fn(tx);
      } finally {
        throw new Error(ROLLBACK);
      }
    })
    .catch((err) => {
      if (!(err instanceof Error) || err.message !== ROLLBACK) throw err;
    });
  return captured!;
}

describeIntegration("getVendorsWithInvitationStatus", () => {
  it("converts raw string timestamps to Date objects", async () => {
    const sentAt = "2026-01-02T03:04:05.000Z";
    const createdAt = "2026-01-01T03:04:05.000Z";
    const database = {
      execute: vi.fn(async () => ({
        rows: [
          {
            id: crypto.randomUUID(),
            name: "String Dates Vendor",
            code: null,
            invitation_id: crypto.randomUUID(),
            status: "sent",
            email: "dates@example.test",
            sent_at: sentAt,
            created_at: createdAt,
          },
        ],
      })),
    };

    const [vendor] = await getVendorsWithInvitationStatus(database as never, crypto.randomUUID());

    expect(vendor!.latestInvitationSentAt).toBeInstanceOf(Date);
    expect(vendor!.latestInvitationCreatedAt).toBeInstanceOf(Date);
    expect(vendor!.latestInvitationSentAt!.toISOString()).toBe(sentAt);
    expect(vendor!.latestInvitationCreatedAt!.toISOString()).toBe(createdAt);
  });

  it("returns one latest invitation per non-deleted vendor", async () => {
    await withFixture(async (tx) => {
      const suffix = crypto.randomUUID().slice(0, 8);
      const [company] = await tx<{ id: string }[]>`
        INSERT INTO companies (name, code)
        VALUES (${`__it_av_company_${suffix}__`}, ${`it_av_${suffix}`})
        RETURNING id`;
      const [activeVendor] = await tx<{ id: string }[]>`
        INSERT INTO vendors (company_id, name)
        VALUES (${company!.id}, ${`IT AV Active ${suffix}`})
        RETURNING id`;
      const [emptyVendor] = await tx<{ id: string }[]>`
        INSERT INTO vendors (company_id, name)
        VALUES (${company!.id}, ${`IT AV Empty ${suffix}`})
        RETURNING id`;
      const [deletedVendor] = await tx<{ id: string }[]>`
        INSERT INTO vendors (company_id, name, deleted_at)
        VALUES (${company!.id}, ${`IT AV Deleted ${suffix}`}, now())
        RETURNING id`;
      const [oldInvitation] = await tx<{ id: string }[]>`
        INSERT INTO admin_vendor_invitations (company_id, vendor_id, email, status, sent_at, created_at)
        VALUES (${company!.id}, ${activeVendor!.id}, 'old-it-av@example.test', 'sent',
          '2026-01-01 00:00:00+00'::timestamptz, '2026-01-01 00:00:00+00'::timestamptz)
        RETURNING id`;
      const [newInvitation] = await tx<{ id: string }[]>`
        INSERT INTO admin_vendor_invitations (company_id, vendor_id, email, status, sent_at, created_at)
        VALUES (${company!.id}, ${activeVendor!.id}, 'new-it-av@example.test', 'sent',
          '2026-01-02 00:00:00+00'::timestamptz, '2026-01-02 00:00:00+00'::timestamptz)
        RETURNING id`;
      await tx`
        INSERT INTO admin_vendor_invitations (company_id, vendor_id, email, status, sent_at, created_at)
        VALUES (${company!.id}, ${deletedVendor!.id}, 'deleted-it-av@example.test', 'sent',
          '2026-01-03 00:00:00+00'::timestamptz, '2026-01-03 00:00:00+00'::timestamptz)`;

      const rows = await getVendorsWithInvitationStatus(drizzle(tx) as never, company!.id);
      const active = rows.find((row) => row.vendorId === activeVendor!.id);

      expect(rows.map((row) => row.vendorId).sort()).toEqual(
        [activeVendor!.id, emptyVendor!.id].sort(),
      );
      expect(active?.latestInvitationId).toBe(newInvitation!.id);
      expect(active?.latestInvitationId).not.toBe(oldInvitation!.id);
      expect(active?.latestInvitationEmail).toBe("new-it-av@example.test");
      expect(active?.latestInvitationSentAt).toBeInstanceOf(Date);
      expect(active?.latestInvitationCreatedAt).toBeInstanceOf(Date);
    });
  });
});
