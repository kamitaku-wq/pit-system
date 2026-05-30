import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { laneTypes, type LaneType } from "@/lib/db/schema/lane_types";

export type LaneTypeContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

const sortOrderInput = z.coerce.number().int().min(0).max(99999).optional();

export const CreateLaneTypeInput = z
  .object({
    code: z.string().trim().min(1, "code is required").max(64),
    name: z.string().trim().min(1, "name is required").max(255),
    sortOrder: sortOrderInput,
  })
  .strict();

export const UpdateLaneTypeInput = CreateLaneTypeInput.partial().strict();

export type CreateLaneTypeInput = z.input<typeof CreateLaneTypeInput>;
export type UpdateLaneTypeInput = z.input<typeof UpdateLaneTypeInput>;

export type LaneTypeListFilters = {
  q?: string;
  page?: number;
  limit?: number;
};

export type LaneTypeListItem = {
  id: string;
  code: string;
  name: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
};

export type LaneTypeDetail = LaneTypeListItem;

export class LaneTypeCodeConflictError extends Error {
  constructor(code: string) {
    super(`lane_type code "${code}" already exists in this company`);
    this.name = "LaneTypeCodeConflictError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}

function selectListColumns(ctx: LaneTypeContext) {
  return ctx.db
    .select({
      id: laneTypes.id,
      code: laneTypes.code,
      name: laneTypes.name,
      sortOrder: laneTypes.sortOrder,
      createdAt: laneTypes.createdAt,
      updatedAt: laneTypes.updatedAt,
    })
    .from(laneTypes);
}

export async function createLaneType(
  input: CreateLaneTypeInput,
  ctx: LaneTypeContext,
): Promise<LaneType> {
  const parsed = CreateLaneTypeInput.parse(input);
  const code = parsed.code.trim();
  try {
    const rows = await ctx.db
      .insert(laneTypes)
      .values({
        companyId: ctx.companyId,
        code,
        name: parsed.name.trim(),
        sortOrder: parsed.sortOrder ?? 0,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("lane_type insert returned no rows");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new LaneTypeCodeConflictError(code);
    }
    throw err;
  }
}

export async function updateLaneType(
  id: string,
  input: UpdateLaneTypeInput,
  ctx: LaneTypeContext,
): Promise<LaneType | null> {
  const parsed = UpdateLaneTypeInput.parse(input);
  const values: Partial<typeof laneTypes.$inferInsert> = {};
  if ("code" in parsed && parsed.code !== undefined) values.code = parsed.code.trim();
  if ("name" in parsed && parsed.name !== undefined) values.name = parsed.name.trim();
  if ("sortOrder" in parsed && parsed.sortOrder !== undefined) values.sortOrder = parsed.sortOrder;
  values.updatedAt = new Date();

  try {
    const rows = await ctx.db
      .update(laneTypes)
      .set(values)
      .where(and(eq(laneTypes.id, id), eq(laneTypes.companyId, ctx.companyId)))
      .returning();
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err) && typeof values.code === "string") {
      throw new LaneTypeCodeConflictError(values.code);
    }
    throw err;
  }
}

export async function deleteLaneType(id: string, ctx: LaneTypeContext): Promise<boolean> {
  // hard delete (deletedAt 列がないため)。
  // 子 lanes.lane_type_id は ON DELETE SET NULL で自動 NULL 化。
  const rows = await ctx.db
    .delete(laneTypes)
    .where(and(eq(laneTypes.id, id), eq(laneTypes.companyId, ctx.companyId)))
    .returning({ id: laneTypes.id });
  return rows.length > 0;
}

export async function listLaneTypes(
  filters: LaneTypeListFilters,
  ctx: LaneTypeContext,
): Promise<{ rows: LaneTypeListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const trimmedQ = filters.q?.trim();
  const predicates = [
    eq(laneTypes.companyId, ctx.companyId),
    trimmedQ
      ? sql`(${laneTypes.name} ILIKE ${"%" + trimmedQ + "%"} OR ${laneTypes.code} ILIKE ${"%" + trimmedQ + "%"})`
      : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const [rows, totalRows] = await Promise.all([
    selectListColumns(ctx)
      .where(and(...predicates))
      .orderBy(asc(laneTypes.sortOrder), desc(laneTypes.createdAt))
      .limit(limit)
      .offset(offset),
    ctx.db.select({ value: count() }).from(laneTypes).where(and(...predicates)),
  ]);

  return {
    rows: rows as LaneTypeListItem[],
    total: Number(totalRows[0]?.value ?? 0),
  };
}

export async function getLaneTypeById(
  id: string,
  ctx: LaneTypeContext,
): Promise<LaneTypeDetail | null> {
  const rows = await selectListColumns(ctx)
    .where(and(eq(laneTypes.id, id), eq(laneTypes.companyId, ctx.companyId)))
    .limit(1);
  return (rows[0] as LaneTypeDetail | undefined) ?? null;
}

export async function listAllLaneTypesForSelect(
  ctx: LaneTypeContext,
): Promise<Array<{ id: string; code: string; name: string }>> {
  const rows = await ctx.db
    .select({ id: laneTypes.id, code: laneTypes.code, name: laneTypes.name })
    .from(laneTypes)
    .where(eq(laneTypes.companyId, ctx.companyId))
    .orderBy(asc(laneTypes.sortOrder), asc(laneTypes.code));
  return rows as Array<{ id: string; code: string; name: string }>;
}
