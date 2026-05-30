import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { stores } from "@/lib/db/schema/stores";
import { vendors } from "@/lib/db/schema/vendors";
import {
  vendorSlaOverrides,
  type VendorSlaOverride,
} from "@/lib/db/schema/vendor_sla_overrides";

export type VendorSlaOverrideContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

export class VendorNotFoundError extends Error {
  constructor(vendorId: string) {
    super(`vendor ${vendorId} not found in this company`);
    this.name = "VendorNotFoundError";
  }
}

export class StoreNotInCompanyError extends Error {
  constructor(storeId: string) {
    super(`store ${storeId} does not belong to this company`);
    this.name = "StoreNotInCompanyError";
  }
}

export class VendorSlaOverrideConflictError extends Error {
  constructor(vendorId: string, storeId: string | null) {
    super(`vendor_sla_overrides conflict: vendor ${vendorId} + store ${storeId ?? "(共通)"}`);
    this.name = "VendorSlaOverrideConflictError";
  }
}

export class VendorSlaOverrideNotFoundError extends Error {
  constructor() {
    super("vendor_sla_override not found");
    this.name = "VendorSlaOverrideNotFoundError";
  }
}

const optionalPositiveInt = z.coerce.number().int().min(0).max(100_000).nullable().optional();

// MVP では storeId 必須化 (storeId=NULL = 全店共通 override は schema は許すが UI/service は未対応)
export const CreateVendorSlaOverrideInput = z
  .object({
    storeId: z.string().uuid(),
    responseDeadlineMinutes: optionalPositiveInt,
    pickupDeadlineMinutes: optionalPositiveInt,
  })
  .strict();

export const UpdateVendorSlaOverrideInput = z
  .object({
    responseDeadlineMinutes: optionalPositiveInt,
    pickupDeadlineMinutes: optionalPositiveInt,
  })
  .strict();

export type CreateVendorSlaOverrideInput = z.input<typeof CreateVendorSlaOverrideInput>;
export type UpdateVendorSlaOverrideInput = z.input<typeof UpdateVendorSlaOverrideInput>;

export type VendorSlaOverrideListItem = {
  id: string;
  vendorId: string;
  storeId: string | null;
  storeName: string | null;
  responseDeadlineMinutes: number | null;
  pickupDeadlineMinutes: number | null;
  createdAt: Date;
  updatedAt: Date;
};

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}

async function assertVendorInCompany(
  ctx: VendorSlaOverrideContext,
  vendorId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: any,
): Promise<void> {
  const exec = tx ?? ctx.db;
  const rows = await exec
    .select({ id: vendors.id })
    .from(vendors)
    .where(and(eq(vendors.id, vendorId), eq(vendors.companyId, ctx.companyId), isNull(vendors.deletedAt)))
    .limit(1);
  if (rows.length === 0) throw new VendorNotFoundError(vendorId);
}

async function assertStoreInCompany(
  ctx: VendorSlaOverrideContext,
  storeId: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx?: any,
): Promise<void> {
  const exec = tx ?? ctx.db;
  const rows = await exec
    .select({ id: stores.id })
    .from(stores)
    .where(and(eq(stores.id, storeId), eq(stores.companyId, ctx.companyId), isNull(stores.deletedAt)))
    .limit(1);
  if (rows.length === 0) throw new StoreNotInCompanyError(storeId);
}

export async function listVendorSlaOverridesByVendorId(
  vendorId: string,
  ctx: VendorSlaOverrideContext,
): Promise<VendorSlaOverrideListItem[]> {
  await assertVendorInCompany(ctx, vendorId);
  const rows = await ctx.db
    .select({
      id: vendorSlaOverrides.id,
      vendorId: vendorSlaOverrides.vendorId,
      storeId: vendorSlaOverrides.storeId,
      storeName: stores.name,
      responseDeadlineMinutes: vendorSlaOverrides.responseDeadlineMinutes,
      pickupDeadlineMinutes: vendorSlaOverrides.pickupDeadlineMinutes,
      createdAt: vendorSlaOverrides.createdAt,
      updatedAt: vendorSlaOverrides.updatedAt,
    })
    .from(vendorSlaOverrides)
    .leftJoin(stores, eq(vendorSlaOverrides.storeId, stores.id))
    .where(
      and(
        eq(vendorSlaOverrides.vendorId, vendorId),
        eq(vendorSlaOverrides.companyId, ctx.companyId),
      ),
    )
    .orderBy(asc(stores.name));
  return rows as VendorSlaOverrideListItem[];
}

export async function createVendorSlaOverride(
  vendorId: string,
  input: CreateVendorSlaOverrideInput,
  ctx: VendorSlaOverrideContext,
): Promise<VendorSlaOverride> {
  const parsed = CreateVendorSlaOverrideInput.parse(input);

  await assertVendorInCompany(ctx, vendorId);
  await assertStoreInCompany(ctx, parsed.storeId);

  try {
    const rows = await ctx.db
      .insert(vendorSlaOverrides)
      .values({
        companyId: ctx.companyId,
        vendorId,
        storeId: parsed.storeId,
        responseDeadlineMinutes: parsed.responseDeadlineMinutes ?? null,
        pickupDeadlineMinutes: parsed.pickupDeadlineMinutes ?? null,
      })
      .returning();
    const row = rows[0] as VendorSlaOverride | undefined;
    if (!row) throw new Error("vendor_sla_overrides insert returned no rows");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new VendorSlaOverrideConflictError(vendorId, parsed.storeId);
    }
    throw err;
  }
}

export async function updateVendorSlaOverride(
  id: string,
  input: UpdateVendorSlaOverrideInput,
  ctx: VendorSlaOverrideContext,
): Promise<VendorSlaOverride> {
  const parsed = UpdateVendorSlaOverrideInput.parse(input);

  const values: Partial<typeof vendorSlaOverrides.$inferInsert> = {
    updatedAt: new Date(),
  };
  if ("responseDeadlineMinutes" in parsed) values.responseDeadlineMinutes = parsed.responseDeadlineMinutes ?? null;
  if ("pickupDeadlineMinutes" in parsed) values.pickupDeadlineMinutes = parsed.pickupDeadlineMinutes ?? null;

  const rows = await ctx.db
    .update(vendorSlaOverrides)
    .set(values)
    .where(
      and(
        eq(vendorSlaOverrides.id, id),
        eq(vendorSlaOverrides.companyId, ctx.companyId),
      ),
    )
    .returning();
  const row = rows[0] as VendorSlaOverride | undefined;
  if (!row) throw new VendorSlaOverrideNotFoundError();
  return row;
}

export async function deleteVendorSlaOverride(
  id: string,
  ctx: VendorSlaOverrideContext,
): Promise<boolean> {
  // hard delete (schema に deletedAt 列なし)
  const rows = await ctx.db
    .delete(vendorSlaOverrides)
    .where(
      and(
        eq(vendorSlaOverrides.id, id),
        eq(vendorSlaOverrides.companyId, ctx.companyId),
      ),
    )
    .returning({ id: vendorSlaOverrides.id });
  return rows.length > 0;
}
