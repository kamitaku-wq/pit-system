import { config } from "dotenv";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { companies } from "@/lib/db/schema/companies";
import { lanes } from "@/lib/db/schema/lanes";
import { reservations } from "@/lib/db/schema/reservations";
import { stores } from "@/lib/db/schema/stores";
import {
  ATTACHMENTS_BUCKET,
  buildAttachmentStorageKey,
  issueAttachmentSignedUrl,
  SIGNED_URL_TTL_SECONDS,
  type StorageSigner,
} from "@/lib/services/attachment-download";
import { registerAttachment, softDeleteAttachment } from "@/lib/services/attachments";

// Phase 64-A.28 signed URL gate logic の integration test。
//
// 注意: signer を fake で注入するため、本テストが検証するのは
// **ownership gate + defense-in-depth + 戻り型** であって、
// 「Supabase が実際に署名する」ことではない。実署名は bucket 実在時のみ
// 検証される (handoff の bucket 作成コマンド参照)。緑 = end-to-end 署名成功 ではない。

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(
  databaseUrl === undefined || databaseUrl.length === 0,
);
const ROLLBACK = "__rollback__";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Tx = any;

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

type Tenant = { companyId: string; reservationId: string };

async function seedTenant(outerTx: Tx, label: string): Promise<Tenant> {
  const suffix = crypto.randomUUID().slice(0, 8);
  const [companyRow] = await outerTx
    .insert(companies)
    .values({ name: `__sig_${label}_${suffix}__`, code: `sig_${label}_${suffix}` })
    .returning({ id: companies.id });
  const company = requireRow(companyRow, "company");

  const [storeRow] = await outerTx
    .insert(stores)
    .values({ companyId: company.id, code: `s_${suffix}`, name: "Store" })
    .returning({ id: stores.id });
  const store = requireRow(storeRow, "store");

  const [laneRow] = await outerTx
    .insert(lanes)
    .values({ companyId: company.id, storeId: store.id, name: `Lane ${suffix}` })
    .returning({ id: lanes.id });
  const lane = requireRow(laneRow, "lane");

  const start = new Date("2026-07-01T01:00:00.000Z");
  const end = new Date("2026-07-01T02:00:00.000Z");
  const [reservationRow] = await outerTx
    .insert(reservations)
    .values({
      companyId: company.id,
      storeId: store.id,
      laneId: lane.id,
      startAt: start,
      endAt: end,
    })
    .returning({ id: reservations.id });
  const reservation = requireRow(reservationRow, "reservation");

  return { companyId: company.id, reservationId: reservation.id };
}

const okSigner: StorageSigner = {
  async createSignedUrl(bucket, key, ttl) {
    return { signedUrl: `https://signed.example/${bucket}/${key}?ttl=${ttl}` };
  },
};

const errSigner: StorageSigner = {
  async createSignedUrl() {
    return { error: "simulated storage error" };
  },
};

// 正しい bucket / prefix で attachment を登録するヘルパ。
async function registerCanonical(
  outerTx: Tx,
  tenant: Tenant,
  overrides: { storageBucket?: string; storageKey?: string } = {},
) {
  const ctx = { db: outerTx, companyId: tenant.companyId };
  const attachmentLocalId = crypto.randomUUID();
  const storageKey =
    overrides.storageKey ??
    buildAttachmentStorageKey(
      tenant.companyId,
      "reservation",
      tenant.reservationId,
      attachmentLocalId,
    );
  const att = await registerAttachment(
    {
      parentType: "reservation",
      parentId: tenant.reservationId,
      storageBucket: overrides.storageBucket ?? ATTACHMENTS_BUCKET,
      storageKey,
      fileName: "report.pdf",
      contentType: "application/pdf",
      byteSize: 1024,
    },
    ctx,
  );
  return { att, ctx };
}

describeIntegration("issueAttachmentSignedUrl (Phase 64-A.28)", () => {
  it("issues a signed URL for a live, correctly-prefixed attachment", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "happy");
      const { att, ctx } = await registerCanonical(outerTx, tenant);

      const result = await issueAttachmentSignedUrl(att.id, ctx, {
        signer: okSigner,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.url).toContain(att.storageKey);
        expect(result.expiresInSeconds).toBe(SIGNED_URL_TTL_SECONDS);
        expect(result.fileName).toBe("report.pdf");
        expect(result.contentType).toBe("application/pdf");
        expect(result.url).toContain(`ttl=${SIGNED_URL_TTL_SECONDS}`);
      }
    });
  });

  it("rejects cross-tenant access (other company's ctx) as not_found", async () => {
    await withRollback(async (outerTx) => {
      const owner = await seedTenant(outerTx, "owner");
      const other = await seedTenant(outerTx, "other");
      const { att } = await registerCanonical(outerTx, owner);

      const result = await issueAttachmentSignedUrl(
        att.id,
        { db: outerTx, companyId: other.companyId },
        { signer: okSigner },
      );

      expect(result).toEqual({ ok: false, reason: "not_found" });
    });
  });

  it("rejects a soft-deleted attachment as not_found", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "deleted");
      const { att, ctx } = await registerCanonical(outerTx, tenant);
      await softDeleteAttachment(att.id, ctx);

      const result = await issueAttachmentSignedUrl(att.id, ctx, {
        signer: okSigner,
      });

      expect(result).toEqual({ ok: false, reason: "not_found" });
    });
  });

  it("rejects a row whose bucket is not the canonical bucket (invalid_storage_path)", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "bucket");
      const { att, ctx } = await registerCanonical(outerTx, tenant, {
        storageBucket: "some-other-bucket",
      });

      const result = await issueAttachmentSignedUrl(att.id, ctx, {
        signer: okSigner,
      });

      expect(result).toEqual({ ok: false, reason: "invalid_storage_path" });
    });
  });

  it("rejects a key outside the company prefix (invalid_storage_path)", async () => {
    await withRollback(async (outerTx) => {
      const owner = await seedTenant(outerTx, "prefix-owner");
      const other = await seedTenant(outerTx, "prefix-other");
      // bucket は canonical だが key prefix が別 company を指す (corruption / cross-tenant 試行)。
      const { att, ctx } = await registerCanonical(outerTx, owner, {
        storageKey: buildAttachmentStorageKey(
          other.companyId,
          "reservation",
          owner.reservationId,
          crypto.randomUUID(),
        ),
      });

      const result = await issueAttachmentSignedUrl(att.id, ctx, {
        signer: okSigner,
      });

      expect(result).toEqual({ ok: false, reason: "invalid_storage_path" });
    });
  });

  it("rejects a key with path traversal (invalid_storage_path)", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "traversal");
      const { att, ctx } = await registerCanonical(outerTx, tenant, {
        storageKey: `${tenant.companyId}/../evil/key`,
      });

      const result = await issueAttachmentSignedUrl(att.id, ctx, {
        signer: okSigner,
      });

      expect(result).toEqual({ ok: false, reason: "invalid_storage_path" });
    });
  });

  it("returns storage_unavailable when no signer is configured", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "nosigner");
      const { att, ctx } = await registerCanonical(outerTx, tenant);

      const result = await issueAttachmentSignedUrl(att.id, ctx, {
        signer: null,
      });

      expect(result).toEqual({ ok: false, reason: "storage_unavailable" });
    });
  });

  it("returns sign_failed when the signer errors", async () => {
    await withRollback(async (outerTx) => {
      const tenant = await seedTenant(outerTx, "signerr");
      const { att, ctx } = await registerCanonical(outerTx, tenant);

      const result = await issueAttachmentSignedUrl(att.id, ctx, {
        signer: errSigner,
      });

      expect(result).toEqual({ ok: false, reason: "sign_failed" });
    });
  });
});
