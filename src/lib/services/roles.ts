import { and, asc, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { roles, type Role } from "@/lib/db/schema/roles";

export type RoleContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

export const CreateRoleInput = z
  .object({
    code: z.string().trim().min(1, "code is required").max(64),
    name: z.string().trim().min(1, "name is required").max(255),
    description: z.string().trim().max(1024).nullable().optional(),
    isSystem: z.boolean().optional(),
  })
  .strict();

export const UpdateRoleInput = z
  .object({
    code: z.string().trim().min(1, "code is required").max(64).optional(),
    name: z.string().trim().min(1, "name is required").max(255).optional(),
    description: z.string().trim().max(1024).nullable().optional(),
  })
  .strict();

export type CreateRoleInput = z.input<typeof CreateRoleInput>;
export type UpdateRoleInput = z.input<typeof UpdateRoleInput>;

export type RoleListFilters = {
  q?: string;
  includeSystem?: boolean;
  page?: number;
  limit?: number;
};

export type RoleListItem = {
  id: string;
  companyId: string | null;
  code: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  createdAt: Date;
  updatedAt: Date;
};

export type RoleDetail = RoleListItem;

export class RoleConflictError extends Error {
  constructor(code: string) {
    super(`role code "${code}" already exists in this company`);
    this.name = "RoleConflictError";
  }
}

export class RoleSystemGuardError extends Error {
  constructor(id: string) {
    super(`role ${id} is a system role (company_id IS NULL or is_system=true) and cannot be modified`);
    this.name = "RoleSystemGuardError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}

function selectListColumns(ctx: RoleContext) {
  return ctx.db
    .select({
      id: roles.id,
      companyId: roles.companyId,
      code: roles.code,
      name: roles.name,
      description: roles.description,
      isSystem: roles.isSystem,
      createdAt: roles.createdAt,
      updatedAt: roles.updatedAt,
    })
    .from(roles);
}

export async function createRole(
  input: CreateRoleInput,
  ctx: RoleContext,
): Promise<Role> {
  const parsed = CreateRoleInput.parse(input);
  const code = parsed.code.trim();
  try {
    const rows = await ctx.db
      .insert(roles)
      .values({
        companyId: ctx.companyId,
        code,
        name: parsed.name.trim(),
        description: parsed.description?.trim() ?? null,
        isSystem: parsed.isSystem ?? false,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("role insert returned no rows");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new RoleConflictError(code);
    }
    throw err;
  }
}

export async function updateRole(
  id: string,
  input: UpdateRoleInput,
  ctx: RoleContext,
): Promise<Role | null> {
  // is_system / company_id IS NULL 行は編集不可。
  const existing = await ctx.db
    .select({
      id: roles.id,
      companyId: roles.companyId,
      isSystem: roles.isSystem,
    })
    .from(roles)
    .where(and(eq(roles.id, id), eq(roles.companyId, ctx.companyId)))
    .limit(1);
  if (existing.length === 0) return null;
  if (existing[0].isSystem) {
    throw new RoleSystemGuardError(id);
  }

  const parsed = UpdateRoleInput.parse(input);
  const values: Partial<typeof roles.$inferInsert> = {};
  if ("code" in parsed && parsed.code !== undefined) values.code = parsed.code.trim();
  if ("name" in parsed && parsed.name !== undefined) values.name = parsed.name.trim();
  if ("description" in parsed) values.description = parsed.description?.trim() ?? null;
  values.updatedAt = new Date();

  try {
    const rows = await ctx.db
      .update(roles)
      .set(values)
      .where(and(eq(roles.id, id), eq(roles.companyId, ctx.companyId)))
      .returning();
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const c = typeof values.code === "string" ? values.code : "(unchanged)";
      throw new RoleConflictError(c);
    }
    throw err;
  }
}

export async function deleteRole(id: string, ctx: RoleContext): Promise<boolean> {
  // hard delete (schema に deletedAt なし)。
  // is_system / company_id IS NULL 行は削除不可。
  // permissions / users / user_store_memberships からの参照は CASCADE / SET NULL のため FK 違反は起こらない。
  const existing = await ctx.db
    .select({
      id: roles.id,
      companyId: roles.companyId,
      isSystem: roles.isSystem,
    })
    .from(roles)
    .where(and(eq(roles.id, id), eq(roles.companyId, ctx.companyId)))
    .limit(1);
  if (existing.length === 0) return false;
  if (existing[0].isSystem) {
    throw new RoleSystemGuardError(id);
  }

  const rows = await ctx.db
    .delete(roles)
    .where(and(eq(roles.id, id), eq(roles.companyId, ctx.companyId)))
    .returning({ id: roles.id });
  return rows.length > 0;
}

export async function listRoles(
  filters: RoleListFilters,
  ctx: RoleContext,
): Promise<{ rows: RoleListItem[]; total: number }> {
  // company_id IS NULL のシステム標準ロールは全テナント SELECT 可 (spec §3.4 RLS 補足)。
  // デフォルトでは includeSystem=true で全 tenant 共通 system role も含める。
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const offset = (page - 1) * limit;
  const includeSystem = filters.includeSystem ?? true;

  const trimmedQ = filters.q?.trim();
  const tenantScope = includeSystem
    ? or(eq(roles.companyId, ctx.companyId), isNull(roles.companyId))
    : eq(roles.companyId, ctx.companyId);

  const predicates = [
    tenantScope,
    trimmedQ
      ? sql`(${roles.name} ILIKE ${"%" + trimmedQ + "%"} OR ${roles.code} ILIKE ${"%" + trimmedQ + "%"})`
      : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const [rows, totalRows] = await Promise.all([
    selectListColumns(ctx)
      .where(and(...predicates))
      .orderBy(asc(roles.isSystem), asc(roles.code), desc(roles.createdAt))
      .limit(limit)
      .offset(offset),
    ctx.db.select({ value: count() }).from(roles).where(and(...predicates)),
  ]);

  return {
    rows: rows as RoleListItem[],
    total: Number(totalRows[0]?.value ?? 0),
  };
}

export async function getRoleById(
  id: string,
  ctx: RoleContext,
): Promise<RoleDetail | null> {
  // 自社 role または system role (company_id IS NULL) のみ取得可。
  const rows = await selectListColumns(ctx)
    .where(
      and(
        eq(roles.id, id),
        or(eq(roles.companyId, ctx.companyId), isNull(roles.companyId)),
      ),
    )
    .limit(1);
  return (rows[0] as RoleDetail | undefined) ?? null;
}
