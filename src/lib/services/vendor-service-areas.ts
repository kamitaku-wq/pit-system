import { and, asc, eq, isNull } from "drizzle-orm";
import { z } from "zod";
import { vendors } from "@/lib/db/schema/vendors";
import {
  vendorServiceAreas,
  type VendorServiceArea,
} from "@/lib/db/schema/vendor_service_areas";

export type VendorServiceAreaContext = {
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

export class VendorServiceAreaNotFoundError extends Error {
  constructor() {
    super("vendor_service_area not found");
    this.name = "VendorServiceAreaNotFoundError";
  }
}

const prefectureField = z.string().trim().min(1).max(50);
const cityField = z
  .string()
  .trim()
  .max(100)
  .nullable()
  .optional()
  .transform((v) => (v === undefined || v === null || v === "" ? null : v));

export const CreateVendorServiceAreaInput = z
  .object({
    prefecture: prefectureField,
    city: cityField,
  })
  .strict();

export const UpdateVendorServiceAreaInput = z
  .object({
    prefecture: prefectureField.optional(),
    city: cityField,
  })
  .strict();

export type CreateVendorServiceAreaInput = z.input<typeof CreateVendorServiceAreaInput>;
export type UpdateVendorServiceAreaInput = z.input<typeof UpdateVendorServiceAreaInput>;

async function assertVendorInCompany(
  ctx: VendorServiceAreaContext,
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

export async function listVendorServiceAreasByVendorId(
  vendorId: string,
  ctx: VendorServiceAreaContext,
): Promise<VendorServiceArea[]> {
  await assertVendorInCompany(ctx, vendorId);
  const rows = await ctx.db
    .select()
    .from(vendorServiceAreas)
    .where(
      and(
        eq(vendorServiceAreas.vendorId, vendorId),
        eq(vendorServiceAreas.companyId, ctx.companyId),
      ),
    )
    .orderBy(asc(vendorServiceAreas.prefecture), asc(vendorServiceAreas.city));
  return rows as VendorServiceArea[];
}

export async function createVendorServiceArea(
  vendorId: string,
  input: CreateVendorServiceAreaInput,
  ctx: VendorServiceAreaContext,
): Promise<VendorServiceArea> {
  const parsed = CreateVendorServiceAreaInput.parse(input);

  await assertVendorInCompany(ctx, vendorId);

  const rows = await ctx.db
    .insert(vendorServiceAreas)
    .values({
      companyId: ctx.companyId,
      vendorId,
      prefecture: parsed.prefecture,
      city: parsed.city ?? null,
    })
    .returning();
  const row = rows[0] as VendorServiceArea | undefined;
  if (!row) throw new Error("vendor_service_areas insert returned no rows");
  return row;
}

export async function updateVendorServiceArea(
  id: string,
  input: UpdateVendorServiceAreaInput,
  ctx: VendorServiceAreaContext,
): Promise<VendorServiceArea> {
  const parsed = UpdateVendorServiceAreaInput.parse(input);

  const values: Partial<typeof vendorServiceAreas.$inferInsert> = {
    updatedAt: new Date(),
  };
  if (parsed.prefecture !== undefined) values.prefecture = parsed.prefecture;
  if ("city" in parsed) values.city = parsed.city ?? null;

  const rows = await ctx.db
    .update(vendorServiceAreas)
    .set(values)
    .where(
      and(
        eq(vendorServiceAreas.id, id),
        eq(vendorServiceAreas.companyId, ctx.companyId),
      ),
    )
    .returning();
  const row = rows[0] as VendorServiceArea | undefined;
  if (!row) throw new VendorServiceAreaNotFoundError();
  return row;
}

export async function deleteVendorServiceArea(
  id: string,
  ctx: VendorServiceAreaContext,
): Promise<boolean> {
  // hard delete (schema に deletedAt 列なし、A.14 vendor_sla_overrides と同パターン)
  const rows = await ctx.db
    .delete(vendorServiceAreas)
    .where(
      and(
        eq(vendorServiceAreas.id, id),
        eq(vendorServiceAreas.companyId, ctx.companyId),
      ),
    )
    .returning({ id: vendorServiceAreas.id });
  return rows.length > 0;
}
