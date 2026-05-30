import { and, asc, count, desc, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { laneTypes } from "@/lib/db/schema/lane_types";
import { lanes, type Lane } from "@/lib/db/schema/lanes";
import { stores } from "@/lib/db/schema/stores";

export type LaneContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

const uuidRequired = z.string().uuid();
const uuidNullable = z.string().uuid().nullable().optional();
const codeNullable = z.string().trim().max(64).nullable().optional();
const capacityInput = z.coerce.number().int().min(1).max(10000);

export const CreateLaneInput = z
  .object({
    storeId: uuidRequired,
    laneTypeId: uuidNullable,
    code: codeNullable,
    name: z.string().trim().min(1, "name is required").max(255),
    capacity: capacityInput.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export const UpdateLaneInput = z
  .object({
    laneTypeId: uuidNullable,
    code: codeNullable,
    name: z.string().trim().min(1, "name is required").max(255).optional(),
    capacity: capacityInput.optional(),
    isActive: z.boolean().optional(),
  })
  .strict();

export type CreateLaneInput = z.input<typeof CreateLaneInput>;
export type UpdateLaneInput = z.input<typeof UpdateLaneInput>;

export type LaneListFilters = {
  q?: string;
  isActive?: boolean;
  storeId?: string;
  laneTypeId?: string | null;
  page?: number;
  limit?: number;
};

export type LaneListItem = {
  id: string;
  storeId: string;
  storeName: string | null;
  laneTypeId: string | null;
  laneTypeName: string | null;
  code: string | null;
  name: string;
  capacity: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type LaneDetail = LaneListItem;

export class LaneCodeConflictError extends Error {
  constructor(code: string | null) {
    super(`lane code "${code ?? "(null)"}" already exists in this store`);
    this.name = "LaneCodeConflictError";
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

function normalizeCode(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function selectListColumns(ctx: LaneContext) {
  return ctx.db
    .select({
      id: lanes.id,
      storeId: lanes.storeId,
      storeName: stores.name,
      laneTypeId: lanes.laneTypeId,
      laneTypeName: laneTypes.name,
      code: lanes.code,
      name: lanes.name,
      capacity: lanes.capacity,
      isActive: lanes.isActive,
      createdAt: lanes.createdAt,
      updatedAt: lanes.updatedAt,
    })
    .from(lanes)
    .leftJoin(stores, eq(lanes.storeId, stores.id))
    .leftJoin(laneTypes, eq(lanes.laneTypeId, laneTypes.id));
}

export async function createLane(input: CreateLaneInput, ctx: LaneContext): Promise<Lane> {
  const parsed = CreateLaneInput.parse(input);
  const code = normalizeCode(parsed.code);
  try {
    const rows = await ctx.db
      .insert(lanes)
      .values({
        companyId: ctx.companyId,
        storeId: parsed.storeId,
        laneTypeId: normalizeUuid(parsed.laneTypeId),
        code,
        name: parsed.name.trim(),
        capacity: parsed.capacity ?? 1,
        isActive: parsed.isActive ?? true,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("lane insert returned no rows");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new LaneCodeConflictError(code);
    }
    throw err;
  }
}

export async function updateLane(
  id: string,
  input: UpdateLaneInput,
  ctx: LaneContext,
): Promise<Lane | null> {
  const parsed = UpdateLaneInput.parse(input);
  const values: Partial<typeof lanes.$inferInsert> = {};
  if ("code" in parsed) values.code = normalizeCode(parsed.code);
  if ("name" in parsed && parsed.name !== undefined) values.name = parsed.name.trim();
  if ("laneTypeId" in parsed) values.laneTypeId = normalizeUuid(parsed.laneTypeId);
  if ("capacity" in parsed && parsed.capacity !== undefined) values.capacity = parsed.capacity;
  if ("isActive" in parsed && parsed.isActive !== undefined) values.isActive = parsed.isActive;
  values.updatedAt = new Date();

  try {
    const rows = await ctx.db
      .update(lanes)
      .set(values)
      .where(and(eq(lanes.id, id), eq(lanes.companyId, ctx.companyId), isNull(lanes.deletedAt)))
      .returning();
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new LaneCodeConflictError(
        typeof values.code === "string" || values.code === null ? values.code : null,
      );
    }
    throw err;
  }
}

export async function deleteLane(id: string, ctx: LaneContext): Promise<boolean> {
  const rows = await ctx.db
    .update(lanes)
    .set({ deletedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(lanes.id, id), eq(lanes.companyId, ctx.companyId), isNull(lanes.deletedAt)))
    .returning({ id: lanes.id });
  return rows.length > 0;
}

export async function listLanes(
  filters: LaneListFilters,
  ctx: LaneContext,
): Promise<{ rows: LaneListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const trimmedQ = filters.q?.trim();
  const predicates = [
    eq(lanes.companyId, ctx.companyId),
    isNull(lanes.deletedAt),
    filters.isActive !== undefined ? eq(lanes.isActive, filters.isActive) : undefined,
    filters.storeId ? eq(lanes.storeId, filters.storeId) : undefined,
    filters.laneTypeId === null
      ? isNull(lanes.laneTypeId)
      : filters.laneTypeId
        ? eq(lanes.laneTypeId, filters.laneTypeId)
        : undefined,
    trimmedQ
      ? sql`(${lanes.name} ILIKE ${"%" + trimmedQ + "%"} OR ${lanes.code} ILIKE ${"%" + trimmedQ + "%"})`
      : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const [rows, totalRows] = await Promise.all([
    selectListColumns(ctx)
      .where(and(...predicates))
      .orderBy(asc(stores.name), asc(lanes.name), desc(lanes.createdAt))
      .limit(limit)
      .offset(offset),
    ctx.db.select({ value: count() }).from(lanes).where(and(...predicates)),
  ]);

  return {
    rows: rows as LaneListItem[],
    total: Number(totalRows[0]?.value ?? 0),
  };
}

export async function getLaneById(id: string, ctx: LaneContext): Promise<LaneDetail | null> {
  const rows = await selectListColumns(ctx)
    .where(and(eq(lanes.id, id), eq(lanes.companyId, ctx.companyId), isNull(lanes.deletedAt)))
    .limit(1);
  return (rows[0] as LaneDetail | undefined) ?? null;
}
