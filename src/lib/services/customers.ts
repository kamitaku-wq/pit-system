import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { customers, type Customer } from "@/lib/db/schema/customers";

export type CustomerContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

const optionalText = z.string().trim().max(255).nullable().optional();
const optionalLongText = z.string().trim().max(2000).nullable().optional();
const optionalEmail = z
  .union([z.string().trim().email(), z.literal(""), z.null()])
  .optional();

export const CreateCustomerInput = z
  .object({
    fullName: z.string().trim().min(1, "fullName is required").max(255),
    fullNameKana: optionalText,
    email: optionalEmail,
    phone: optionalText,
    postalCode: optionalText,
    address: optionalText,
    notes: optionalLongText,
  })
  .strict();

export const UpdateCustomerInput = CreateCustomerInput.partial().strict();

export type CreateCustomerInput = z.input<typeof CreateCustomerInput>;
export type UpdateCustomerInput = z.input<typeof UpdateCustomerInput>;

export type CustomerListFilters = {
  q?: string;
  page?: number;
  limit?: number;
};

export type CustomerListItem = {
  id: string;
  fullName: string;
  fullNameKana: string | null;
  email: string | null;
  phone: string | null;
  postalCode: string | null;
  address: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type CustomerDetail = CustomerListItem & {
  notes: string | null;
};

function normalizeNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function selectListColumns(ctx: CustomerContext) {
  return ctx.db
    .select({
      id: customers.id,
      fullName: customers.fullName,
      fullNameKana: customers.fullNameKana,
      email: customers.email,
      phone: customers.phone,
      postalCode: customers.postalCode,
      address: customers.address,
      createdAt: customers.createdAt,
      updatedAt: customers.updatedAt,
    })
    .from(customers);
}

function selectDetailColumns(ctx: CustomerContext) {
  return ctx.db
    .select({
      id: customers.id,
      fullName: customers.fullName,
      fullNameKana: customers.fullNameKana,
      email: customers.email,
      phone: customers.phone,
      postalCode: customers.postalCode,
      address: customers.address,
      notes: customers.notes,
      createdAt: customers.createdAt,
      updatedAt: customers.updatedAt,
    })
    .from(customers);
}

export async function createCustomer(
  input: CreateCustomerInput,
  ctx: CustomerContext,
): Promise<Customer> {
  const parsed = CreateCustomerInput.parse(input);
  const rows = await ctx.db
    .insert(customers)
    .values({
      companyId: ctx.companyId,
      fullName: parsed.fullName.trim(),
      fullNameKana: normalizeNullable(parsed.fullNameKana),
      email: normalizeNullable(parsed.email ?? null),
      phone: normalizeNullable(parsed.phone),
      postalCode: normalizeNullable(parsed.postalCode),
      address: normalizeNullable(parsed.address),
      notes: normalizeNullable(parsed.notes),
    })
    .returning();
  const row = rows[0];
  if (!row) throw new Error("customer insert returned no rows");
  return row;
}

export async function updateCustomer(
  id: string,
  input: UpdateCustomerInput,
  ctx: CustomerContext,
): Promise<Customer | null> {
  const parsed = UpdateCustomerInput.parse(input);
  const values: Partial<typeof customers.$inferInsert> = {};
  if ("fullName" in parsed && parsed.fullName !== undefined) values.fullName = parsed.fullName.trim();
  if ("fullNameKana" in parsed) values.fullNameKana = normalizeNullable(parsed.fullNameKana);
  if ("email" in parsed) values.email = normalizeNullable(parsed.email ?? null);
  if ("phone" in parsed) values.phone = normalizeNullable(parsed.phone);
  if ("postalCode" in parsed) values.postalCode = normalizeNullable(parsed.postalCode);
  if ("address" in parsed) values.address = normalizeNullable(parsed.address);
  if ("notes" in parsed) values.notes = normalizeNullable(parsed.notes);
  values.updatedAt = new Date();

  const rows = await ctx.db
    .update(customers)
    .set(values)
    .where(and(eq(customers.id, id), eq(customers.companyId, ctx.companyId), isNull(customers.deletedAt)))
    .returning();
  return rows[0] ?? null;
}

export async function deleteCustomer(id: string, ctx: CustomerContext): Promise<boolean> {
  // soft delete (deletedAt 列があるため hard delete ではなく soft)
  const rows = await ctx.db
    .update(customers)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(customers.id, id), eq(customers.companyId, ctx.companyId), isNull(customers.deletedAt)))
    .returning({ id: customers.id });
  return rows.length > 0;
}

export async function listCustomers(
  filters: CustomerListFilters,
  ctx: CustomerContext,
): Promise<{ rows: CustomerListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const trimmedQ = filters.q?.trim();
  const predicates = [
    eq(customers.companyId, ctx.companyId),
    isNull(customers.deletedAt),
    trimmedQ
      ? sql`(${customers.fullName} ILIKE ${"%" + trimmedQ + "%"} OR ${customers.fullNameKana} ILIKE ${"%" + trimmedQ + "%"} OR ${customers.email} ILIKE ${"%" + trimmedQ + "%"} OR ${customers.phone} ILIKE ${"%" + trimmedQ + "%"})`
      : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const [rows, totalRows] = await Promise.all([
    selectListColumns(ctx).where(and(...predicates)).orderBy(desc(customers.createdAt)).limit(limit).offset(offset),
    ctx.db.select({ value: count() }).from(customers).where(and(...predicates)),
  ]);

  return {
    rows: rows as CustomerListItem[],
    total: Number(totalRows[0]?.value ?? 0),
  };
}

export async function getCustomerById(id: string, ctx: CustomerContext): Promise<CustomerDetail | null> {
  const rows = await selectDetailColumns(ctx)
    .where(and(eq(customers.id, id), eq(customers.companyId, ctx.companyId), isNull(customers.deletedAt)))
    .limit(1);
  return (rows[0] as CustomerDetail | undefined) ?? null;
}
