import { and, asc, eq, gte, isNull, lte } from "drizzle-orm";
import { z } from "zod";
import { storeHolidays } from "@/lib/db/schema/store_holidays";
import { stores } from "@/lib/db/schema/stores";

export type StoreHolidaysContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

export type StoreHolidayRow = {
  id: string;
  storeId: string;
  holidayDate: string;
  name: string | null;
  isClosed: boolean;
  createdAt: Date;
  updatedAt: Date;
};

const datePattern = /^\d{4}-\d{2}-\d{2}$/;

const optionalText = z.string().trim().max(255).nullable().optional();

export const CreateStoreHolidayInput = z
  .object({
    storeId: z.string().uuid(),
    holidayDate: z.string().regex(datePattern, "holiday_date は YYYY-MM-DD"),
    name: optionalText,
    isClosed: z.boolean().optional(),
  })
  .strict();
export type CreateStoreHolidayInput = z.input<typeof CreateStoreHolidayInput>;

export const UpdateStoreHolidayInput = z
  .object({
    holidayDate: z.string().regex(datePattern, "holiday_date は YYYY-MM-DD").optional(),
    name: optionalText,
    isClosed: z.boolean().optional(),
  })
  .strict();
export type UpdateStoreHolidayInput = z.input<typeof UpdateStoreHolidayInput>;

export type StoreHolidayListFilters = {
  fromDate?: string;
  toDate?: string;
};

export class StoreNotFoundError extends Error {
  constructor(storeId: string) {
    super(`store ${storeId} not found in this company`);
    this.name = "StoreNotFoundError";
  }
}

export class StoreHolidayNotFoundError extends Error {
  constructor(id: string) {
    super(`store_holiday ${id} not found in this company`);
    this.name = "StoreHolidayNotFoundError";
  }
}

export class StoreHolidayConflictError extends Error {
  constructor(holidayDate: string) {
    super(`store_holiday for date "${holidayDate}" already exists`);
    this.name = "StoreHolidayConflictError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}

function normalizeNullable(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function assertStoreInCompany(
  storeId: string,
  ctx: StoreHolidaysContext,
): Promise<void> {
  const rows = await ctx.db
    .select({ id: stores.id })
    .from(stores)
    .where(
      and(eq(stores.id, storeId), eq(stores.companyId, ctx.companyId), isNull(stores.deletedAt)),
    )
    .limit(1);
  if (rows.length === 0) throw new StoreNotFoundError(storeId);
}

export async function listStoreHolidaysByStoreId(
  storeId: string,
  filters: StoreHolidayListFilters,
  ctx: StoreHolidaysContext,
): Promise<StoreHolidayRow[]> {
  const predicates = [
    eq(storeHolidays.storeId, storeId),
    eq(storeHolidays.companyId, ctx.companyId),
    filters.fromDate ? gte(storeHolidays.holidayDate, filters.fromDate) : undefined,
    filters.toDate ? lte(storeHolidays.holidayDate, filters.toDate) : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const rows = await ctx.db
    .select({
      id: storeHolidays.id,
      storeId: storeHolidays.storeId,
      holidayDate: storeHolidays.holidayDate,
      name: storeHolidays.name,
      isClosed: storeHolidays.isClosed,
      createdAt: storeHolidays.createdAt,
      updatedAt: storeHolidays.updatedAt,
    })
    .from(storeHolidays)
    .where(and(...predicates))
    .orderBy(asc(storeHolidays.holidayDate));
  return rows as StoreHolidayRow[];
}

export async function createStoreHoliday(
  input: CreateStoreHolidayInput,
  ctx: StoreHolidaysContext,
): Promise<StoreHolidayRow> {
  const parsed = CreateStoreHolidayInput.parse(input);
  await assertStoreInCompany(parsed.storeId, ctx);

  try {
    const rows = await ctx.db
      .insert(storeHolidays)
      .values({
        companyId: ctx.companyId,
        storeId: parsed.storeId,
        holidayDate: parsed.holidayDate,
        name: normalizeNullable(parsed.name),
        isClosed: parsed.isClosed ?? true,
      })
      .returning({
        id: storeHolidays.id,
        storeId: storeHolidays.storeId,
        holidayDate: storeHolidays.holidayDate,
        name: storeHolidays.name,
        isClosed: storeHolidays.isClosed,
        createdAt: storeHolidays.createdAt,
        updatedAt: storeHolidays.updatedAt,
      });
    const row = rows[0];
    if (!row) throw new Error("store_holiday insert returned no rows");
    return row as StoreHolidayRow;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new StoreHolidayConflictError(parsed.holidayDate);
    }
    throw err;
  }
}

export async function updateStoreHoliday(
  id: string,
  input: UpdateStoreHolidayInput,
  ctx: StoreHolidaysContext,
): Promise<StoreHolidayRow> {
  const parsed = UpdateStoreHolidayInput.parse(input);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const values: Record<string, any> = { updatedAt: new Date() };
  if ("holidayDate" in parsed && parsed.holidayDate !== undefined) {
    values.holidayDate = parsed.holidayDate;
  }
  if ("name" in parsed) values.name = normalizeNullable(parsed.name);
  if ("isClosed" in parsed && parsed.isClosed !== undefined) {
    values.isClosed = parsed.isClosed;
  }

  try {
    const rows = await ctx.db
      .update(storeHolidays)
      .set(values)
      .where(and(eq(storeHolidays.id, id), eq(storeHolidays.companyId, ctx.companyId)))
      .returning({
        id: storeHolidays.id,
        storeId: storeHolidays.storeId,
        holidayDate: storeHolidays.holidayDate,
        name: storeHolidays.name,
        isClosed: storeHolidays.isClosed,
        createdAt: storeHolidays.createdAt,
        updatedAt: storeHolidays.updatedAt,
      });
    const row = rows[0];
    if (!row) throw new StoreHolidayNotFoundError(id);
    return row as StoreHolidayRow;
  } catch (err) {
    if (isUniqueViolation(err) && typeof values.holidayDate === "string") {
      throw new StoreHolidayConflictError(values.holidayDate);
    }
    throw err;
  }
}

export async function deleteStoreHoliday(
  id: string,
  ctx: StoreHolidaysContext,
): Promise<boolean> {
  // hard delete (schema に deletedAt なし、master 系 holiday と異なり個別レコード)
  const rows = await ctx.db
    .delete(storeHolidays)
    .where(and(eq(storeHolidays.id, id), eq(storeHolidays.companyId, ctx.companyId)))
    .returning({ id: storeHolidays.id });
  return rows.length > 0;
}
