import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { statuses, type Status } from "@/lib/db/schema/statuses";

export type StatusContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

export const STATUS_TYPES = ["reservation", "service", "transport", "vendor"] as const;
export type StatusType = (typeof STATUS_TYPES)[number];

const statusTypeSchema = z.enum(STATUS_TYPES);
const displayOrderInput = z.coerce.number().int().min(0).max(99999).nullable().optional();
const isActiveInput = z.boolean().nullable().optional();

export const CreateStatusInput = z
  .object({
    statusType: statusTypeSchema,
    key: z.string().trim().min(1, "key is required").max(64),
    name: z.string().trim().min(1, "name is required").max(255),
    displayOrder: displayOrderInput,
    isInitial: z.boolean().optional(),
    isTerminal: z.boolean().optional(),
    isActive: isActiveInput,
  })
  .strict();

export const UpdateStatusInput = z
  .object({
    statusType: statusTypeSchema.optional(),
    key: z.string().trim().min(1, "key is required").max(64).optional(),
    name: z.string().trim().min(1, "name is required").max(255).optional(),
    displayOrder: displayOrderInput,
    isInitial: z.boolean().optional(),
    isTerminal: z.boolean().optional(),
    isActive: isActiveInput,
  })
  .strict();

export type CreateStatusInput = z.input<typeof CreateStatusInput>;
export type UpdateStatusInput = z.input<typeof UpdateStatusInput>;

export type StatusListFilters = {
  statusType?: StatusType;
  q?: string;
  page?: number;
  limit?: number;
};

export type StatusListItem = {
  id: string;
  statusType: string;
  key: string;
  name: string;
  displayOrder: number | null;
  isInitial: boolean;
  isTerminal: boolean;
  isActive: boolean | null;
  createdAt: Date;
  updatedAt: Date;
};

export type StatusDetail = StatusListItem;

export class StatusConflictError extends Error {
  constructor(statusType: string, key: string) {
    super(`status (${statusType}, ${key}) already exists in this company`);
    this.name = "StatusConflictError";
  }
}

export class StatusInUseError extends Error {
  constructor(id: string) {
    super(`status ${id} is referenced by reservations/service_tickets/transport_orders/status_transitions and cannot be deleted`);
    this.name = "StatusInUseError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}

function isForeignKeyViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "23503";
}

function selectListColumns(ctx: StatusContext) {
  return ctx.db
    .select({
      id: statuses.id,
      statusType: statuses.statusType,
      key: statuses.key,
      name: statuses.name,
      displayOrder: statuses.displayOrder,
      isInitial: statuses.isInitial,
      isTerminal: statuses.isTerminal,
      isActive: statuses.isActive,
      createdAt: statuses.createdAt,
      updatedAt: statuses.updatedAt,
    })
    .from(statuses);
}

export async function createStatus(
  input: CreateStatusInput,
  ctx: StatusContext,
): Promise<Status> {
  const parsed = CreateStatusInput.parse(input);
  const key = parsed.key.trim();
  const statusType = parsed.statusType;
  try {
    const rows = await ctx.db
      .insert(statuses)
      .values({
        companyId: ctx.companyId,
        statusType,
        key,
        name: parsed.name.trim(),
        displayOrder: parsed.displayOrder ?? null,
        isInitial: parsed.isInitial ?? false,
        isTerminal: parsed.isTerminal ?? false,
        isActive: parsed.isActive ?? null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("status insert returned no rows");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new StatusConflictError(statusType, key);
    }
    throw err;
  }
}

export async function updateStatus(
  id: string,
  input: UpdateStatusInput,
  ctx: StatusContext,
): Promise<Status | null> {
  const parsed = UpdateStatusInput.parse(input);
  const values: Partial<typeof statuses.$inferInsert> = {};
  if ("statusType" in parsed && parsed.statusType !== undefined) values.statusType = parsed.statusType;
  if ("key" in parsed && parsed.key !== undefined) values.key = parsed.key.trim();
  if ("name" in parsed && parsed.name !== undefined) values.name = parsed.name.trim();
  if ("displayOrder" in parsed) values.displayOrder = parsed.displayOrder ?? null;
  if ("isInitial" in parsed && parsed.isInitial !== undefined) values.isInitial = parsed.isInitial;
  if ("isTerminal" in parsed && parsed.isTerminal !== undefined) values.isTerminal = parsed.isTerminal;
  if ("isActive" in parsed) values.isActive = parsed.isActive ?? null;
  values.updatedAt = new Date();

  try {
    const rows = await ctx.db
      .update(statuses)
      .set(values)
      .where(and(eq(statuses.id, id), eq(statuses.companyId, ctx.companyId)))
      .returning();
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const st = typeof values.statusType === "string" ? values.statusType : "(unchanged)";
      const k = typeof values.key === "string" ? values.key : "(unchanged)";
      throw new StatusConflictError(st, k);
    }
    throw err;
  }
}

export async function deleteStatus(id: string, ctx: StatusContext): Promise<boolean> {
  // hard delete (schema に deletedAt なし)。
  // reservations.status_id / service_tickets / transport_orders / status_transitions などから参照中の場合は FK 違反 (23503) を wrap して投げる。
  try {
    const rows = await ctx.db
      .delete(statuses)
      .where(and(eq(statuses.id, id), eq(statuses.companyId, ctx.companyId)))
      .returning({ id: statuses.id });
    return rows.length > 0;
  } catch (err) {
    if (isForeignKeyViolation(err)) {
      throw new StatusInUseError(id);
    }
    throw err;
  }
}

export async function listStatuses(
  filters: StatusListFilters,
  ctx: StatusContext,
): Promise<{ rows: StatusListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const trimmedQ = filters.q?.trim();
  const predicates = [
    eq(statuses.companyId, ctx.companyId),
    filters.statusType ? eq(statuses.statusType, filters.statusType) : undefined,
    trimmedQ
      ? sql`(${statuses.name} ILIKE ${"%" + trimmedQ + "%"} OR ${statuses.key} ILIKE ${"%" + trimmedQ + "%"})`
      : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const [rows, totalRows] = await Promise.all([
    selectListColumns(ctx)
      .where(and(...predicates))
      .orderBy(asc(statuses.statusType), asc(statuses.displayOrder), desc(statuses.createdAt))
      .limit(limit)
      .offset(offset),
    ctx.db.select({ value: count() }).from(statuses).where(and(...predicates)),
  ]);

  return {
    rows: rows as StatusListItem[],
    total: Number(totalRows[0]?.value ?? 0),
  };
}

export async function getStatusById(
  id: string,
  ctx: StatusContext,
): Promise<StatusDetail | null> {
  const rows = await selectListColumns(ctx)
    .where(and(eq(statuses.id, id), eq(statuses.companyId, ctx.companyId)))
    .limit(1);
  return (rows[0] as StatusDetail | undefined) ?? null;
}
