import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { workCategories, type WorkCategory } from "@/lib/db/schema/work_categories";

export type WorkCategoryContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

const sortOrderInput = z.coerce.number().int().min(0).max(99999).optional();

export const CreateWorkCategoryInput = z
  .object({
    code: z.string().trim().min(1, "code is required").max(64),
    name: z.string().trim().min(1, "name is required").max(255),
    sortOrder: sortOrderInput,
  })
  .strict();

export const UpdateWorkCategoryInput = CreateWorkCategoryInput.partial().strict();

export type CreateWorkCategoryInput = z.input<typeof CreateWorkCategoryInput>;
export type UpdateWorkCategoryInput = z.input<typeof UpdateWorkCategoryInput>;

export type WorkCategoryListFilters = {
  q?: string;
  page?: number;
  limit?: number;
};

export type WorkCategoryListItem = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type WorkCategoryDetail = WorkCategoryListItem;

export class WorkCategoryCodeConflictError extends Error {
  constructor(code: string) {
    super(`work_category code "${code}" already exists in this company`);
    this.name = "WorkCategoryCodeConflictError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}

function selectListColumns(ctx: WorkCategoryContext) {
  return ctx.db
    .select({
      id: workCategories.id,
      code: workCategories.code,
      name: workCategories.name,
      sortOrder: workCategories.sortOrder,
      createdAt: workCategories.createdAt,
      updatedAt: workCategories.updatedAt,
    })
    .from(workCategories);
}

export async function createWorkCategory(
  input: CreateWorkCategoryInput,
  ctx: WorkCategoryContext,
): Promise<WorkCategory> {
  const parsed = CreateWorkCategoryInput.parse(input);
  const code = parsed.code.trim();
  try {
    const rows = await ctx.db
      .insert(workCategories)
      .values({
        companyId: ctx.companyId,
        code,
        name: parsed.name.trim(),
        sortOrder: parsed.sortOrder ?? 0,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("work_category insert returned no rows");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new WorkCategoryCodeConflictError(code);
    }
    throw err;
  }
}

export async function updateWorkCategory(
  id: string,
  input: UpdateWorkCategoryInput,
  ctx: WorkCategoryContext,
): Promise<WorkCategory | null> {
  const parsed = UpdateWorkCategoryInput.parse(input);
  const values: Partial<typeof workCategories.$inferInsert> = {};
  if ("code" in parsed && parsed.code !== undefined) values.code = parsed.code.trim();
  if ("name" in parsed && parsed.name !== undefined) values.name = parsed.name.trim();
  if ("sortOrder" in parsed && parsed.sortOrder !== undefined) values.sortOrder = parsed.sortOrder;
  values.updatedAt = new Date();

  try {
    const rows = await ctx.db
      .update(workCategories)
      .set(values)
      .where(and(eq(workCategories.id, id), eq(workCategories.companyId, ctx.companyId)))
      .returning();
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err) && typeof values.code === "string") {
      throw new WorkCategoryCodeConflictError(values.code);
    }
    throw err;
  }
}

export async function deleteWorkCategory(id: string, ctx: WorkCategoryContext): Promise<boolean> {
  // hard delete (deletedAt 列がないため)。
  // 子 work_menus.work_category_id は ON DELETE SET NULL で自動 NULL 化。
  const rows = await ctx.db
    .delete(workCategories)
    .where(and(eq(workCategories.id, id), eq(workCategories.companyId, ctx.companyId)))
    .returning({ id: workCategories.id });
  return rows.length > 0;
}

export async function listWorkCategories(
  filters: WorkCategoryListFilters,
  ctx: WorkCategoryContext,
): Promise<{ rows: WorkCategoryListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const trimmedQ = filters.q?.trim();
  const predicates = [
    eq(workCategories.companyId, ctx.companyId),
    trimmedQ
      ? sql`(${workCategories.name} ILIKE ${"%" + trimmedQ + "%"} OR ${workCategories.code} ILIKE ${"%" + trimmedQ + "%"})`
      : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const [rows, totalRows] = await Promise.all([
    selectListColumns(ctx)
      .where(and(...predicates))
      .orderBy(asc(workCategories.sortOrder), desc(workCategories.createdAt))
      .limit(limit)
      .offset(offset),
    ctx.db.select({ value: count() }).from(workCategories).where(and(...predicates)),
  ]);

  return {
    rows: rows as WorkCategoryListItem[],
    total: Number(totalRows[0]?.value ?? 0),
  };
}

export async function getWorkCategoryById(
  id: string,
  ctx: WorkCategoryContext,
): Promise<WorkCategoryDetail | null> {
  const rows = await selectListColumns(ctx)
    .where(and(eq(workCategories.id, id), eq(workCategories.companyId, ctx.companyId)))
    .limit(1);
  return (rows[0] as WorkCategoryDetail | undefined) ?? null;
}

export async function listAllWorkCategoriesForSelect(
  ctx: WorkCategoryContext,
): Promise<Array<{ id: string; code: string; name: string }>> {
  const rows = await ctx.db
    .select({ id: workCategories.id, code: workCategories.code, name: workCategories.name })
    .from(workCategories)
    .where(eq(workCategories.companyId, ctx.companyId))
    .orderBy(asc(workCategories.sortOrder), asc(workCategories.code));
  return rows as Array<{ id: string; code: string; name: string }>;
}
