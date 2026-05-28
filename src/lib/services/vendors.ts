import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { vendors, type Vendor } from "@/lib/db/schema/vendors";

export type VendorContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

const optionalText = z.string().trim().max(255).nullable().optional();

const notificationMethodEnum = z.enum(["email", "portal", "both"]);

export const CreateVendorInput = z
  .object({
    name: z.string().trim().min(1, "name is required").max(255),
    contactPersonName: optionalText,
    email: optionalText,
    phone: optionalText,
    notificationMethod: notificationMethodEnum.optional(),
    isShared: z.boolean().optional(),
    priority: z.coerce.number().int().nullable().optional(),
    isActive: z.boolean().nullable().optional(),
    displayOrder: z.coerce.number().int().nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict();

export const UpdateVendorInput = CreateVendorInput.partial().strict();

export type CreateVendorInput = z.input<typeof CreateVendorInput>;
export type UpdateVendorInput = z.input<typeof UpdateVendorInput>;

export type VendorListFilters = {
  q?: string;
  isActive?: boolean;
  isShared?: boolean;
  page?: number;
  limit?: number;
};

export type VendorListItem = {
  id: string;
  name: string;
  contactPersonName: string | null;
  email: string | null;
  phone: string | null;
  notificationMethod: string;
  isShared: boolean;
  priority: number | null;
  isActive: boolean | null;
  displayOrder: number | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type VendorDetail = VendorListItem;

function normalizeNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function selectListColumns(ctx: VendorContext) {
  return ctx.db
    .select({
      id: vendors.id,
      name: vendors.name,
      contactPersonName: vendors.contactPersonName,
      email: vendors.email,
      phone: vendors.phone,
      notificationMethod: vendors.notificationMethod,
      isShared: vendors.isShared,
      priority: vendors.priority,
      isActive: vendors.isActive,
      displayOrder: vendors.displayOrder,
      notes: vendors.notes,
      createdAt: vendors.createdAt,
      updatedAt: vendors.updatedAt,
    })
    .from(vendors);
}

export async function createVendor(input: CreateVendorInput, ctx: VendorContext): Promise<Vendor> {
  const parsed = CreateVendorInput.parse(input);
  const rows = await ctx.db
    .insert(vendors)
    .values({
      companyId: ctx.companyId,
      name: parsed.name.trim(),
      contactPersonName: normalizeNullable(parsed.contactPersonName),
      email: normalizeNullable(parsed.email),
      phone: normalizeNullable(parsed.phone),
      notificationMethod: parsed.notificationMethod ?? "both",
      isShared: parsed.isShared ?? false,
      priority: parsed.priority ?? null,
      isActive: parsed.isActive ?? null,
      displayOrder: parsed.displayOrder ?? null,
      notes: normalizeNullable(parsed.notes),
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("vendor insert returned no rows");
  return row;
}

export async function updateVendor(
  id: string,
  input: UpdateVendorInput,
  ctx: VendorContext,
): Promise<Vendor | null> {
  const parsed = UpdateVendorInput.parse(input);
  const values: Partial<typeof vendors.$inferInsert> = {};
  if ("name" in parsed && parsed.name !== undefined) values.name = parsed.name.trim();
  if ("contactPersonName" in parsed) values.contactPersonName = normalizeNullable(parsed.contactPersonName);
  if ("email" in parsed) values.email = normalizeNullable(parsed.email);
  if ("phone" in parsed) values.phone = normalizeNullable(parsed.phone);
  if ("notificationMethod" in parsed && parsed.notificationMethod !== undefined) values.notificationMethod = parsed.notificationMethod;
  if ("isShared" in parsed && parsed.isShared !== undefined) values.isShared = parsed.isShared;
  if ("priority" in parsed) values.priority = parsed.priority ?? null;
  if ("isActive" in parsed) values.isActive = parsed.isActive ?? null;
  if ("displayOrder" in parsed) values.displayOrder = parsed.displayOrder ?? null;
  if ("notes" in parsed) values.notes = normalizeNullable(parsed.notes);
  values.updatedAt = new Date();

  const rows = await ctx.db
    .update(vendors)
    .set(values)
    .where(and(eq(vendors.id, id), eq(vendors.companyId, ctx.companyId), isNull(vendors.deletedAt)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteVendor(id: string, ctx: VendorContext): Promise<boolean> {
  // soft delete (deletedAt 列があるため hard delete ではなく soft)
  const rows = await ctx.db
    .update(vendors)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(vendors.id, id), eq(vendors.companyId, ctx.companyId), isNull(vendors.deletedAt)))
    .returning({ id: vendors.id });
  return rows.length > 0;
}

export async function listVendors(
  filters: VendorListFilters,
  ctx: VendorContext,
): Promise<{ rows: VendorListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const trimmedQ = filters.q?.trim();
  const predicates = [
    eq(vendors.companyId, ctx.companyId),
    isNull(vendors.deletedAt),
    filters.isActive !== undefined ? eq(vendors.isActive, filters.isActive) : undefined,
    filters.isShared !== undefined ? eq(vendors.isShared, filters.isShared) : undefined,
    trimmedQ
      ? sql`(${vendors.name} ILIKE ${"%" + trimmedQ + "%"} OR ${vendors.contactPersonName} ILIKE ${"%" + trimmedQ + "%"} OR ${vendors.email} ILIKE ${"%" + trimmedQ + "%"} OR ${vendors.phone} ILIKE ${"%" + trimmedQ + "%"})`
      : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const [rows, totalRows] = await Promise.all([
    selectListColumns(ctx).where(and(...predicates)).orderBy(desc(vendors.createdAt)).limit(limit).offset(offset),
    ctx.db.select({ value: count() }).from(vendors).where(and(...predicates)),
  ]);

  return {
    rows: rows as VendorListItem[],
    total: Number(totalRows[0]?.value ?? 0),
  };
}

export async function getVendorById(id: string, ctx: VendorContext): Promise<VendorDetail | null> {
  const rows = await selectListColumns(ctx)
    .where(and(eq(vendors.id, id), eq(vendors.companyId, ctx.companyId), isNull(vendors.deletedAt)))
    .limit(1);
  return (rows[0] as VendorDetail | undefined) ?? null;
}

export async function listAllVendorsForSelect(
  ctx: VendorContext,
): Promise<Array<{ id: string; name: string }>> {
  const rows = await ctx.db
    .select({ id: vendors.id, name: vendors.name })
    .from(vendors)
    .where(and(eq(vendors.companyId, ctx.companyId), isNull(vendors.deletedAt)))
    .orderBy(asc(vendors.name));
  return rows as Array<{ id: string; name: string }>;
}
