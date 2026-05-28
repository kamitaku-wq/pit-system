import { aliasedTable } from "drizzle-orm";
import { and, asc, count, desc, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { statuses } from "@/lib/db/schema/statuses";
import { statusTransitions, type StatusTransition } from "@/lib/db/schema/status_transitions";
import { STATUS_TYPES, type StatusType } from "@/lib/services/statuses";

export type StatusTransitionContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

const statusTypeSchema = z.enum(STATUS_TYPES);
const optionalUuid = z
  .string()
  .uuid()
  .nullable()
  .optional();
const optionalKey = z.string().trim().min(1).max(128).nullable().optional();

export const CreateStatusTransitionInput = z
  .object({
    statusType: statusTypeSchema,
    fromStatusId: optionalUuid,
    toStatusId: z.string().uuid(),
    requiredPermissionKey: optionalKey,
    requiredRoleKey: optionalKey,
    triggersNotification: z.boolean().optional(),
  })
  .strict();

export const UpdateStatusTransitionInput = z
  .object({
    statusType: statusTypeSchema.optional(),
    fromStatusId: optionalUuid,
    toStatusId: z.string().uuid().optional(),
    requiredPermissionKey: optionalKey,
    requiredRoleKey: optionalKey,
    triggersNotification: z.boolean().optional(),
  })
  .strict();

export type CreateStatusTransitionInput = z.input<typeof CreateStatusTransitionInput>;
export type UpdateStatusTransitionInput = z.input<typeof UpdateStatusTransitionInput>;

export type StatusTransitionListFilters = {
  statusType?: StatusType;
  fromStatusId?: string | null;
  toStatusId?: string;
  page?: number;
  limit?: number;
};

export type StatusTransitionListItem = {
  id: string;
  statusType: string;
  fromStatusId: string | null;
  fromStatusName: string | null;
  fromStatusKey: string | null;
  toStatusId: string;
  toStatusName: string | null;
  toStatusKey: string | null;
  requiredPermissionKey: string | null;
  requiredRoleKey: string | null;
  triggersNotification: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type StatusTransitionDetail = StatusTransitionListItem;

export class StatusTransitionConflictError extends Error {
  constructor(statusType: string, fromStatusId: string | null, toStatusId: string) {
    super(
      `status_transition (${statusType}, from=${fromStatusId ?? "NULL"}, to=${toStatusId}) already exists in this company`,
    );
    this.name = "StatusTransitionConflictError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}

function selectListColumns(ctx: StatusTransitionContext) {
  const fromStatus = aliasedTable(statuses, "from_status");
  const toStatus = aliasedTable(statuses, "to_status");
  return ctx.db
    .select({
      id: statusTransitions.id,
      statusType: statusTransitions.statusType,
      fromStatusId: statusTransitions.fromStatusId,
      fromStatusName: fromStatus.name,
      fromStatusKey: fromStatus.key,
      toStatusId: statusTransitions.toStatusId,
      toStatusName: toStatus.name,
      toStatusKey: toStatus.key,
      requiredPermissionKey: statusTransitions.requiredPermissionKey,
      requiredRoleKey: statusTransitions.requiredRoleKey,
      triggersNotification: statusTransitions.triggersNotification,
      createdAt: statusTransitions.createdAt,
      updatedAt: statusTransitions.updatedAt,
    })
    .from(statusTransitions)
    .leftJoin(fromStatus, eq(fromStatus.id, statusTransitions.fromStatusId))
    .leftJoin(toStatus, eq(toStatus.id, statusTransitions.toStatusId));
}

export async function createStatusTransition(
  input: CreateStatusTransitionInput,
  ctx: StatusTransitionContext,
): Promise<StatusTransition> {
  const parsed = CreateStatusTransitionInput.parse(input);
  const fromStatusId = parsed.fromStatusId ?? null;
  const toStatusId = parsed.toStatusId;
  try {
    const rows = await ctx.db
      .insert(statusTransitions)
      .values({
        companyId: ctx.companyId,
        statusType: parsed.statusType,
        fromStatusId,
        toStatusId,
        requiredPermissionKey: parsed.requiredPermissionKey ?? null,
        requiredRoleKey: parsed.requiredRoleKey ?? null,
        triggersNotification: parsed.triggersNotification ?? false,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("status_transition insert returned no rows");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new StatusTransitionConflictError(parsed.statusType, fromStatusId, toStatusId);
    }
    throw err;
  }
}

export async function updateStatusTransition(
  id: string,
  input: UpdateStatusTransitionInput,
  ctx: StatusTransitionContext,
): Promise<StatusTransition | null> {
  const parsed = UpdateStatusTransitionInput.parse(input);
  const values: Partial<typeof statusTransitions.$inferInsert> = {};
  if ("statusType" in parsed && parsed.statusType !== undefined) values.statusType = parsed.statusType;
  if ("fromStatusId" in parsed) values.fromStatusId = parsed.fromStatusId ?? null;
  if ("toStatusId" in parsed && parsed.toStatusId !== undefined) values.toStatusId = parsed.toStatusId;
  if ("requiredPermissionKey" in parsed) values.requiredPermissionKey = parsed.requiredPermissionKey ?? null;
  if ("requiredRoleKey" in parsed) values.requiredRoleKey = parsed.requiredRoleKey ?? null;
  if ("triggersNotification" in parsed && parsed.triggersNotification !== undefined) {
    values.triggersNotification = parsed.triggersNotification;
  }
  values.updatedAt = new Date();

  try {
    const rows = await ctx.db
      .update(statusTransitions)
      .set(values)
      .where(and(eq(statusTransitions.id, id), eq(statusTransitions.companyId, ctx.companyId)))
      .returning();
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const st = typeof values.statusType === "string" ? values.statusType : "(unchanged)";
      const from = "fromStatusId" in values ? (values.fromStatusId as string | null) : null;
      const to = typeof values.toStatusId === "string" ? values.toStatusId : "(unchanged)";
      throw new StatusTransitionConflictError(st, from, to);
    }
    throw err;
  }
}

export async function deleteStatusTransition(
  id: string,
  ctx: StatusTransitionContext,
): Promise<boolean> {
  // hard delete (schema に deletedAt なし)。
  // 子テーブルなしなので FK 違反 wrap は不要。
  const rows = await ctx.db
    .delete(statusTransitions)
    .where(and(eq(statusTransitions.id, id), eq(statusTransitions.companyId, ctx.companyId)))
    .returning({ id: statusTransitions.id });
  return rows.length > 0;
}

export async function listStatusTransitions(
  filters: StatusTransitionListFilters,
  ctx: StatusTransitionContext,
): Promise<{ rows: StatusTransitionListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;

  const predicates = [
    eq(statusTransitions.companyId, ctx.companyId),
    filters.statusType ? eq(statusTransitions.statusType, filters.statusType) : undefined,
    filters.fromStatusId === null
      ? sql`${statusTransitions.fromStatusId} IS NULL`
      : filters.fromStatusId !== undefined
        ? eq(statusTransitions.fromStatusId, filters.fromStatusId)
        : undefined,
    filters.toStatusId ? eq(statusTransitions.toStatusId, filters.toStatusId) : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const [rows, totalRows] = await Promise.all([
    selectListColumns(ctx)
      .where(and(...predicates))
      .orderBy(asc(statusTransitions.statusType), desc(statusTransitions.createdAt))
      .limit(limit)
      .offset(offset),
    ctx.db.select({ value: count() }).from(statusTransitions).where(and(...predicates)),
  ]);

  return {
    rows: rows as StatusTransitionListItem[],
    total: Number(totalRows[0]?.value ?? 0),
  };
}

export async function getStatusTransitionById(
  id: string,
  ctx: StatusTransitionContext,
): Promise<StatusTransitionDetail | null> {
  const rows = await selectListColumns(ctx)
    .where(and(eq(statusTransitions.id, id), eq(statusTransitions.companyId, ctx.companyId)))
    .limit(1);
  return (rows[0] as StatusTransitionDetail | undefined) ?? null;
}
