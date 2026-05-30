import { and, asc, count, desc, eq, isNull, or, sql } from "drizzle-orm";
import { z } from "zod";
import { permissions, type Permission } from "@/lib/db/schema/permissions";
import { roles } from "@/lib/db/schema/roles";

export type PermissionContext = {
  // Drizzle does not expose a common DB/transaction interface that fits this project.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any;
  companyId: string;
};

const optionalText = z.string().trim().max(64).nullable().optional();

export const CreatePermissionInput = z
  .object({
    roleId: z.string().uuid(),
    code: z.string().trim().min(1, "code is required").max(64),
    resource: optionalText,
    action: optionalText,
  })
  .strict();

export const UpdatePermissionInput = z
  .object({
    code: z.string().trim().min(1, "code is required").max(64).optional(),
    resource: optionalText,
    action: optionalText,
  })
  .strict();

export type CreatePermissionInput = z.input<typeof CreatePermissionInput>;
export type UpdatePermissionInput = z.input<typeof UpdatePermissionInput>;

export type PermissionListFilters = {
  q?: string;
  roleId?: string;
  includeSystem?: boolean;
  page?: number;
  limit?: number;
};

export type PermissionListItem = {
  id: string;
  companyId: string | null;
  roleId: string | null;
  roleName: string | null;
  roleCode: string | null;
  roleIsSystem: boolean;
  code: string;
  resource: string | null;
  action: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type PermissionDetail = PermissionListItem;

export class PermissionConflictError extends Error {
  constructor(roleId: string, code: string) {
    super(`permission code "${code}" already exists for role ${roleId}`);
    this.name = "PermissionConflictError";
  }
}

export class PermissionRoleGuardError extends Error {
  constructor(roleId: string) {
    super(
      `role ${roleId} is not editable in this tenant (system role or belongs to another company)`,
    );
    this.name = "PermissionRoleGuardError";
  }
}

function isUniqueViolation(err: unknown): boolean {
  if (typeof err !== "object" || err === null) return false;
  const code = (err as { code?: unknown }).code;
  return code === "23505";
}

function selectListColumns(ctx: PermissionContext) {
  return ctx.db
    .select({
      id: permissions.id,
      companyId: permissions.companyId,
      roleId: permissions.roleId,
      roleName: roles.name,
      roleCode: roles.code,
      roleIsSystem: roles.isSystem,
      code: permissions.code,
      resource: permissions.resource,
      action: permissions.action,
      createdAt: permissions.createdAt,
      updatedAt: permissions.updatedAt,
    })
    .from(permissions)
    .leftJoin(roles, eq(permissions.roleId, roles.id));
}

async function assertRoleEditable(roleId: string, ctx: PermissionContext): Promise<void> {
  const rows = await ctx.db
    .select({
      id: roles.id,
      companyId: roles.companyId,
      isSystem: roles.isSystem,
    })
    .from(roles)
    .where(eq(roles.id, roleId))
    .limit(1);
  const role = rows[0];
  if (!role || role.companyId !== ctx.companyId || role.isSystem === true) {
    throw new PermissionRoleGuardError(roleId);
  }
}

export async function createPermission(
  input: CreatePermissionInput,
  ctx: PermissionContext,
): Promise<Permission> {
  const parsed = CreatePermissionInput.parse(input);
  await assertRoleEditable(parsed.roleId, ctx);
  const code = parsed.code.trim();
  try {
    const rows = await ctx.db
      .insert(permissions)
      .values({
        companyId: ctx.companyId,
        roleId: parsed.roleId,
        code,
        resource: parsed.resource?.trim() ?? null,
        action: parsed.action?.trim() ?? null,
      })
      .returning();
    const row = rows[0];
    if (!row) throw new Error("permission insert returned no rows");
    return row;
  } catch (err) {
    if (isUniqueViolation(err)) {
      throw new PermissionConflictError(parsed.roleId, code);
    }
    throw err;
  }
}

export async function updatePermission(
  id: string,
  input: UpdatePermissionInput,
  ctx: PermissionContext,
): Promise<Permission | null> {
  // 既存 permission + 親 role の所有者検証を先に行う。
  const existing = await ctx.db
    .select({
      id: permissions.id,
      roleId: permissions.roleId,
      roleCompanyId: roles.companyId,
      roleIsSystem: roles.isSystem,
    })
    .from(permissions)
    .leftJoin(roles, eq(permissions.roleId, roles.id))
    .where(eq(permissions.id, id))
    .limit(1);
  if (existing.length === 0) return null;
  const row = existing[0];
  const editable =
    row.roleId !== null &&
    row.roleCompanyId === ctx.companyId &&
    row.roleIsSystem === false;
  if (!editable) {
    throw new PermissionRoleGuardError(row.roleId ?? "(null)");
  }

  const parsed = UpdatePermissionInput.parse(input);
  const values: Partial<typeof permissions.$inferInsert> = {};
  if ("code" in parsed && parsed.code !== undefined) values.code = parsed.code.trim();
  if ("resource" in parsed) values.resource = parsed.resource?.trim() ?? null;
  if ("action" in parsed) values.action = parsed.action?.trim() ?? null;
  values.updatedAt = new Date();

  try {
    const rows = await ctx.db
      .update(permissions)
      .set(values)
      .where(eq(permissions.id, id))
      .returning();
    return rows[0] ?? null;
  } catch (err) {
    if (isUniqueViolation(err)) {
      const c = typeof values.code === "string" ? values.code : "(unchanged)";
      throw new PermissionConflictError(row.roleId ?? "(null)", c);
    }
    throw err;
  }
}

export async function deletePermission(
  id: string,
  ctx: PermissionContext,
): Promise<boolean> {
  // hard delete (schema に deletedAt なし)。
  // 親 role が自社かつ非 system のもののみ削除可。
  const existing = await ctx.db
    .select({
      id: permissions.id,
      roleId: permissions.roleId,
      roleCompanyId: roles.companyId,
      roleIsSystem: roles.isSystem,
    })
    .from(permissions)
    .leftJoin(roles, eq(permissions.roleId, roles.id))
    .where(eq(permissions.id, id))
    .limit(1);
  if (existing.length === 0) return false;
  const row = existing[0];
  const editable =
    row.roleId !== null &&
    row.roleCompanyId === ctx.companyId &&
    row.roleIsSystem === false;
  if (!editable) {
    throw new PermissionRoleGuardError(row.roleId ?? "(null)");
  }

  const rows = await ctx.db
    .delete(permissions)
    .where(eq(permissions.id, id))
    .returning({ id: permissions.id });
  return rows.length > 0;
}

export async function listPermissions(
  filters: PermissionListFilters,
  ctx: PermissionContext,
): Promise<{ rows: PermissionListItem[]; total: number }> {
  // 自社 role の permissions と、system role (roles.company_id IS NULL) の permissions を表示。
  // includeSystem=false で system 分は除外。
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
    filters.roleId ? eq(permissions.roleId, filters.roleId) : undefined,
    trimmedQ
      ? sql`(${permissions.code} ILIKE ${"%" + trimmedQ + "%"} OR ${permissions.resource} ILIKE ${"%" + trimmedQ + "%"} OR ${permissions.action} ILIKE ${"%" + trimmedQ + "%"})`
      : undefined,
  ].filter((predicate): predicate is NonNullable<typeof predicate> => predicate !== undefined);

  const [rows, totalRows] = await Promise.all([
    selectListColumns(ctx)
      .where(and(...predicates))
      .orderBy(
        asc(roles.isSystem),
        asc(roles.code),
        asc(permissions.code),
        desc(permissions.createdAt),
      )
      .limit(limit)
      .offset(offset),
    ctx.db
      .select({ value: count() })
      .from(permissions)
      .leftJoin(roles, eq(permissions.roleId, roles.id))
      .where(and(...predicates)),
  ]);

  return {
    rows: (rows as PermissionListItem[]).map((r) => ({
      ...r,
      roleIsSystem: r.roleIsSystem ?? false,
    })),
    total: Number(totalRows[0]?.value ?? 0),
  };
}

export async function getPermissionById(
  id: string,
  ctx: PermissionContext,
): Promise<PermissionDetail | null> {
  const rows = await selectListColumns(ctx)
    .where(
      and(
        eq(permissions.id, id),
        or(eq(roles.companyId, ctx.companyId), isNull(roles.companyId)),
      ),
    )
    .limit(1);
  const r = rows[0] as PermissionDetail | undefined;
  if (!r) return null;
  return { ...r, roleIsSystem: r.roleIsSystem ?? false };
}
