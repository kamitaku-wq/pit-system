import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { stores, type Store } from "@/lib/db/schema/stores";

export type StoreContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

const optionalText = z.string().trim().max(255).nullable().optional();

export const CreateStoreInput = z
  .object({
    name: z.string().trim().min(1, "name is required").max(255),
    code: optionalText,
    postalCode: optionalText,
    address: optionalText,
    phone: optionalText,
    isActive: z.boolean().optional(),
  })
  .strict();

export const UpdateStoreInput = CreateStoreInput.partial().strict();

export type CreateStoreInput = z.input<typeof CreateStoreInput>;
export type UpdateStoreInput = z.input<typeof UpdateStoreInput>;

export type StoreListFilters = {
  q?: string;
  isActive?: boolean;
  page?: number;
  limit?: number;
};

export type StoreListItem = {
  id: string;
  code: string | null;
  name: string;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type StoreDetail = StoreListItem;

export class StoreCodeConflictError extends Error {
  constructor(code: string) {
    super(`store code "${code}" already exists in this company`);
    this.name = "StoreCodeConflictError";
  }
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}

function selectListColumns(ctx: StoreContext) {
  return ctx.db
    .select({
      id: stores.id,
      code: stores.code,
      name: stores.name,
      postalCode: stores.postalCode,
      address: stores.address,
      phone: stores.phone,
      isActive: stores.isActive,
      createdAt: stores.createdAt,
      updatedAt: stores.updatedAt,
    })
    .from(stores);
}

export async function createStore(input: CreateStoreInput, ctx: StoreContext): Promise<Store> {
  const parsed = CreateStoreInput.parse(input);
  const code = normalizeNullable(parsed.code);
  try {
    const rows = await ctx.db
      .insert(stores)
      .values({
        companyId: ctx.companyId,
        name: parsed.name.trim(),
        code,
        postalCode: normalizeNullable(parsed.postalCode),
        address: normalizeNullable(parsed.address),
        phone: normalizeNullable(parsed.phone),
        isActive: parsed.isActive ?? true,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("store insert returned no rows");
    return row;
  } catch (err) {
    if (isUniqueViolation(err) && code !== null) {
      throw new StoreCodeConflictError(code);
    }
    throw err;
  }
}

export async function updateStore(
  id: string,
  input: UpdateStoreInput,
  ctx: StoreContext,
): Promise<Store | null> {
  const parsed = UpdateStoreInput.parse(input);
  const values: Partial<typeof stores.$inferInsert> = {};
  if ("name" in parsed && parsed.name !== undefined) values.name = parsed.name.trim();
  if ("code" in parsed) values.code = normalizeNullable(parsed.code);
  if ("postalCode" in parsed) values.postalCode = normalizeNullable(parsed.postalCode);
  if ("address" in parsed) values.address = normalizeNullable(parsed.address);
  if ("phone" in parsed) values.phone = normalizeNullable(parsed.phone);
  if ("isActive" in parsed && parsed.isActive !== undefined) values.isActive = parsed.isActive;
  values.updatedAt = new Date();

  try {
    const rows = await ctx.db
      .update(stores)
      .set(values)
      .where(and(eq(stores.id, id), eq(stores.companyId, ctx.companyId), isNull(stores.deletedAt)))
      .returning();
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err) && typeof values.code === "string") {
      throw new StoreCodeConflictError(values.code);
    }
    throw err;
  }
}

export async function deleteStore(id: string, ctx: StoreContext): Promise<boolean> {
  // soft delete (deletedAt 列があるため hard delete ではなく soft)
  const rows = await ctx.db
    .update(stores)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(stores.id, id), eq(stores.companyId, ctx.companyId), isNull(stores.deletedAt)))
    .returning({ id: stores.id });
  return rows.length > 0;
}

export async function listStores(
  filters: StoreListFilters,
  ctx: StoreContext,
): Promise<{ rows: StoreListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const trimmedQ = filters.q?.trim();
  const predicates = [
    eq(stores.companyId, ctx.companyId),
    isNull(stores.deletedAt),
    filters.isActive !== undefined ? eq(stores.isActive, filters.isActive) : undefined,
    trimmedQ
      ? sql`(${stores.name} ILIKE ${"%" + trimmedQ + "%"} OR ${stores.code} ILIKE ${"%" + trimmedQ + "%"} OR ${stores.address} ILIKE ${"%" + trimmedQ + "%"} OR ${stores.phone} ILIKE ${"%" + trimmedQ + "%"})`
      : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const [rows, totalRows] = await Promise.all([
    selectListColumns(ctx).where(and(...predicates)).orderBy(desc(stores.createdAt)).limit(limit).offset(offset),
    ctx.db.select({ value: count() }).from(stores).where(and(...predicates)),
  ]);

  return {
    rows: rows as StoreListItem[],
    total: Number(totalRows[0]?.value ?? 0),
  };
}

export async function getStoreById(id: string, ctx: StoreContext): Promise<StoreDetail | null> {
  const rows = await selectListColumns(ctx)
    .where(and(eq(stores.id, id), eq(stores.companyId, ctx.companyId), isNull(stores.deletedAt)))
    .limit(1);
  return (rows[0] as StoreDetail | undefined) ?? null;
}
