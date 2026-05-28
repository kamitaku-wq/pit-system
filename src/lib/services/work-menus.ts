import { and, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { workCategories } from "@/lib/db/schema/work_categories";
import { workMenus, type WorkMenu } from "@/lib/db/schema/work_menus";

export type WorkMenuContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

const uuidNullable = z.string().uuid().nullable().optional();
const positiveInt = z.coerce.number().int().min(1).max(1440);
const nonNegativeInt = z.coerce.number().int().min(0).max(100_000_000);

export const CreateWorkMenuInput = z
  .object({
    code: z.string().trim().min(1, "code is required").max(64),
    name: z.string().trim().min(1, "name is required").max(255),
    workCategoryId: uuidNullable,
    durationMinutes: positiveInt.optional(),
    priceMinor: nonNegativeInt.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const UpdateWorkMenuInput = CreateWorkMenuInput.partial().strict();

export type CreateWorkMenuInput = z.input<typeof CreateWorkMenuInput>;
export type UpdateWorkMenuInput = z.input<typeof UpdateWorkMenuInput>;

export type WorkMenuListFilters = {
  q?: string;
  isActive?: boolean;
  workCategoryId?: string | null;
  page?: number;
  limit?: number;
};

export type WorkMenuListItem = {
  id: string;
  code: string;
  name: string;
  workCategoryId: string | null;
  workCategoryName: string | null;
  durationMinutes: number;
  priceMinor: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkMenuDetail = WorkMenuListItem;

export class WorkMenuCodeConflictError extends Error {
  constructor(code: string) {
    super(`work_menu code "${code}" already exists in this company`);
    this.name = "WorkMenuCodeConflictError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}

function normalizeUuid(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function selectListColumns(ctx: WorkMenuContext) {
  return ctx.db
    .select({
      id: workMenus.id,
      code: workMenus.code,
      name: workMenus.name,
      workCategoryId: workMenus.workCategoryId,
      workCategoryName: workCategories.name,
      durationMinutes: workMenus.durationMinutes,
      priceMinor: workMenus.priceMinor,
      isActive: workMenus.isActive,
      createdAt: workMenus.createdAt,
      updatedAt: workMenus.updatedAt,
    })
    .from(workMenus)
    .leftJoin(workCategories, eq(workMenus.workCategoryId, workCategories.id));
}

export async function createWorkMenu(
  input: CreateWorkMenuInput,
  ctx: WorkMenuContext,
): Promise<WorkMenu> {
  const parsed = CreateWorkMenuInput.parse(input);
  const code = parsed.code.trim();
  try {
    const rows = await ctx.db
      .insert(workMenus)
      .values({
        companyId: ctx.companyId,
        workCategoryId: normalizeUuid(parsed.workCategoryId),
        code,
        name: parsed.name.trim(),
        durationMinutes: parsed.durationMinutes ?? 60,
        priceMinor: parsed.priceMinor ?? 0,
        isActive: parsed.isActive ?? true,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("work_menu insert returned no rows");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new WorkMenuCodeConflictError(code);
    }
    throw err;
  }
}

export async function updateWorkMenu(
  id: string,
  input: UpdateWorkMenuInput,
  ctx: WorkMenuContext,
): Promise<WorkMenu | null> {
  const parsed = UpdateWorkMenuInput.parse(input);
  const values: Partial<typeof workMenus.$inferInsert> = {};
  if ("code" in parsed && parsed.code !== undefined) values.code = parsed.code.trim();
  if ("name" in parsed && parsed.name !== undefined) values.name = parsed.name.trim();
  if ("workCategoryId" in parsed) values.workCategoryId = normalizeUuid(parsed.workCategoryId);
  if ("durationMinutes" in parsed && parsed.durationMinutes !== undefined)
    values.durationMinutes = parsed.durationMinutes;
  if ("priceMinor" in parsed && parsed.priceMinor !== undefined)
    values.priceMinor = parsed.priceMinor;
  if ("isActive" in parsed && parsed.isActive !== undefined) values.isActive = parsed.isActive;
  values.updatedAt = new Date();

  try {
    const rows = await ctx.db
      .update(workMenus)
      .set(values)
      .where(
        and(eq(workMenus.id, id), eq(workMenus.companyId, ctx.companyId), isNull(workMenus.deletedAt)),
      )
      .returning();
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err) && typeof values.code === "string") {
      throw new WorkMenuCodeConflictError(values.code);
    }
    throw err;
  }
}

export async function deleteWorkMenu(id: string, ctx: WorkMenuContext): Promise<boolean> {
  const rows = await ctx.db
    .update(workMenus)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(
      and(eq(workMenus.id, id), eq(workMenus.companyId, ctx.companyId), isNull(workMenus.deletedAt)),
    )
    .returning({ id: workMenus.id });
  return rows.length > 0;
}

export async function listWorkMenus(
  filters: WorkMenuListFilters,
  ctx: WorkMenuContext,
): Promise<{ rows: WorkMenuListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const trimmedQ = filters.q?.trim();
  const predicates = [
    eq(workMenus.companyId, ctx.companyId),
    isNull(workMenus.deletedAt),
    filters.isActive !== undefined ? eq(workMenus.isActive, filters.isActive) : undefined,
    filters.workCategoryId === null
      ? isNull(workMenus.workCategoryId)
      : filters.workCategoryId
        ? eq(workMenus.workCategoryId, filters.workCategoryId)
        : undefined,
    trimmedQ
      ? sql`(${workMenus.name} ILIKE ${"%" + trimmedQ + "%"} OR ${workMenus.code} ILIKE ${"%" + trimmedQ + "%"})`
      : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const [rows, totalRows] = await Promise.all([
    selectListColumns(ctx)
      .where(and(...predicates))
      .orderBy(desc(workMenus.createdAt))
      .limit(limit)
      .offset(offset),
    ctx.db.select({ value: count() }).from(workMenus).where(and(...predicates)),
  ]);

  return {
    rows: rows as WorkMenuListItem[],
    total: Number(totalRows[0]?.value ?? 0),
  };
}

export async function getWorkMenuById(
  id: string,
  ctx: WorkMenuContext,
): Promise<WorkMenuDetail | null> {
  const rows = await selectListColumns(ctx)
    .where(
      and(eq(workMenus.id, id), eq(workMenus.companyId, ctx.companyId), isNull(workMenus.deletedAt)),
    )
    .limit(1);
  return (rows[0] as WorkMenuDetail | undefined) ?? null;
}
