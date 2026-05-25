// Phase 31-B admin vendor invitation service for admins inviting vendor portal users.
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { and, eq } from "drizzle-orm";
import type { AdminUser } from "@/lib/auth/admin-role";
import { db } from "@/lib/db/client";
import { adminVendorInvitations } from "@/lib/db/schema/admin_vendor_invitations";
import { notificationOutbox } from "@/lib/db/schema/notification_outbox";
import { vendorUsers } from "@/lib/db/schema/vendor_users";
import { vendors } from "@/lib/db/schema/vendors";

export class AdminVendorInvitationDuplicateError extends Error {
  static readonly code = "ADMIN_VENDOR_INVITATION_DUPLICATE";
  readonly code = AdminVendorInvitationDuplicateError.code;
  constructor(message = "Pending admin vendor invitation already exists") {
    super(message); this.name = "AdminVendorInvitationDuplicateError";
  }
}

export class AdminVendorInvitationCrossTenantError extends Error {
  static readonly code = "ADMIN_VENDOR_INVITATION_CROSS_TENANT";
  readonly code = AdminVendorInvitationCrossTenantError.code;
  constructor(message = "admin vendor invitation cross-tenant denial") {
    super(message); this.name = "AdminVendorInvitationCrossTenantError";
  }
}

export class AdminVendorInvitationAuthError extends Error {
  static readonly code = "ADMIN_VENDOR_INVITATION_AUTH_ERROR";
  readonly code = AdminVendorInvitationAuthError.code;
  constructor(message = "Admin vendor invitation auth failed", options?: ErrorOptions) {
    super(message, options); this.name = "AdminVendorInvitationAuthError";
  }
}

export interface CreateAdminVendorInvitationInput {
  vendorId: string; email: string; name?: string | null; role?: "vendor_admin" | "vendor_member";
}

export interface CreateAdminVendorInvitationResult {
  companyId: string; vendorId: string; vendorUserId: string; invitationId: string;
  outboxId: string; authUserId: string; idempotencyKey: string;
}

type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type VendorRow = { id: string; companyId: string };
type AuthUserResult = { authUserId: string; created: boolean };
type InvitationRole = "vendor_admin" | "vendor_member";
type InsertInvitationContext = {
  adminUser: AdminUser; vendor: VendorRow; authUserId: string;
  email: string; name: string | null; role: InvitationRole;
};

function getCallbackUrl(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL ?? process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";
  return `${base}/vendor/admin-invite-callback`;
}

async function findVendor(database: typeof db, vendorId: string): Promise<VendorRow | null> {
  const rows = await database.select({ id: vendors.id, companyId: vendors.companyId })
    .from(vendors).where(eq(vendors.id, vendorId)).limit(1);
  return rows[0] ?? null;
}

async function ensureNoPendingDuplicate(
  database: typeof db,
  vendorId: string,
  email: string,
): Promise<void> {
  const rows = await database.select({ id: adminVendorInvitations.id }).from(adminVendorInvitations)
    .where(
      and(
        eq(adminVendorInvitations.vendorId, vendorId),
        eq(adminVendorInvitations.email, email),
        eq(adminVendorInvitations.status, "pending"),
      ),
    )
    .limit(1);
  if (rows[0]) {
    throw new AdminVendorInvitationDuplicateError();
  }
}

async function findAuthUserByEmail(supabase: SupabaseClient, email: string): Promise<User | null> {
  const normalizedEmail: string = email.toLowerCase();
  const perPage: number = 1000;
  let page: number = 1;

  while (true) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage });
    if (error) {
      throw error;
    }

    const users: User[] = data.users;
    const match: User | undefined = users.find((user: User): boolean => {
      return user.email?.toLowerCase() === normalizedEmail;
    });
    if (match) {
      return match;
    }
    if (users.length < perPage) {
      return null;
    }
    page += 1;
  }
}

async function getOrInviteAuthUser(
  supabaseAdmin: SupabaseClient,
  email: string,
): Promise<AuthUserResult> {
  try {
    const existingAuthUser: User | null = await findAuthUserByEmail(supabaseAdmin, email);
    if (existingAuthUser) {
      return { authUserId: existingAuthUser.id, created: false };
    }

    const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(email, {
      redirectTo: getCallbackUrl(),
    });
    if (error) {
      throw error;
    }
    if (!data.user) {
      throw new Error("auth admin did not return a user");
    }
    return { authUserId: data.user.id, created: true };
  } catch (error: unknown) {
    throw new AdminVendorInvitationAuthError(getErrorMessage(error), { cause: error });
  }
}

function expectRow<T>(row: T | undefined, message: string): T {
  if (!row) {
    throw new Error(message);
  }
  return row;
}

async function insertVendorUser(tx: DbTransaction, context: InsertInvitationContext): Promise<string> {
  const rows = await tx.insert(vendorUsers)
    .values({
      companyId: context.adminUser.companyId, vendorId: context.vendor.id,
      authUserId: context.authUserId, email: context.email, name: context.name, isActive: false,
    })
    .returning({ id: vendorUsers.id });
  return expectRow(rows[0], "vendor user insert returned no row").id;
}

async function insertInvitation(
  tx: DbTransaction,
  context: InsertInvitationContext,
  vendorUserId: string,
): Promise<string> {
  const rows = await tx.insert(adminVendorInvitations)
    .values({
      companyId: context.adminUser.companyId, vendorId: context.vendor.id,
      invitedByUserId: context.adminUser.userId, vendorUserId, email: context.email,
      name: context.name, role: context.role, status: "sent", sentAt: new Date(),
    })
    .returning({ id: adminVendorInvitations.id });
  return expectRow(rows[0], "admin vendor invitation insert returned no row").id;
}

async function insertOutbox(
  tx: DbTransaction,
  context: InsertInvitationContext,
  vendorUserId: string,
  invitationId: string,
): Promise<{ id: string; idempotencyKey: string }> {
  const idempotencyKey = `admin-vendor-invitation:${invitationId}`;
  const rows = await tx.insert(notificationOutbox)
    .values({
      companyId: context.adminUser.companyId, idempotencyKey,
      eventType: "admin_vendor_invitation.sent", targetType: "vendor_user", targetId: vendorUserId,
      payload: { invitationId, vendorId: context.vendor.id, vendorUserId, email: context.email, name: context.name, role: context.role },
    })
    .returning({ id: notificationOutbox.id });
  return { id: expectRow(rows[0], "notification outbox insert returned no row").id, idempotencyKey };
}

async function insertInvitationRows(
  database: typeof db,
  context: InsertInvitationContext,
): Promise<CreateAdminVendorInvitationResult> {
  return database.transaction(async (tx): Promise<CreateAdminVendorInvitationResult> => {
    const vendorUserId = await insertVendorUser(tx, context);
    const invitationId = await insertInvitation(tx, context, vendorUserId);
    const outbox = await insertOutbox(tx, context, vendorUserId, invitationId);
    return {
      companyId: context.adminUser.companyId, vendorId: context.vendor.id, vendorUserId,
      invitationId, outboxId: outbox.id, authUserId: context.authUserId,
      idempotencyKey: outbox.idempotencyKey,
    };
  });
}

async function cleanupCreatedAuthUser(supabaseAdmin: SupabaseClient, authUserId: string): Promise<void> {
  const { error } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
  if (error) {
    throw error;
  }
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function getErrorCode(error: unknown): string | null {
  const candidate = error as { code?: unknown; cause?: { code?: unknown } };
  if (typeof candidate.code === "string") return candidate.code;
  return typeof candidate.cause?.code === "string" ? candidate.cause.code : null;
}

function isVendorTenancyError(error: unknown): boolean {
  const code = getErrorCode(error);
  const message = getErrorMessage(error).toLowerCase();
  return message.includes("enforce_vendor_user_tenancy") ||
    (code === "23514" && message.includes("vendor_users.company_id"));
}

export async function createAdminVendorInvitation(
  database: typeof db, supabaseAdmin: SupabaseClient, adminUser: AdminUser, input: CreateAdminVendorInvitationInput,
): Promise<CreateAdminVendorInvitationResult> {
  const email: string = input.email.trim().toLowerCase();
  const role: InvitationRole = input.role ?? "vendor_admin";
  const name: string | null = input.name ?? null;

  const vendor: VendorRow | null = await findVendor(database, input.vendorId);
  if (!vendor || vendor.companyId !== adminUser.companyId) {
    throw new AdminVendorInvitationCrossTenantError();
  }

  await ensureNoPendingDuplicate(database, vendor.id, email);
  const authUser: AuthUserResult = await getOrInviteAuthUser(supabaseAdmin, email);
  try {
    return await insertInvitationRows(database, { adminUser, vendor, authUserId: authUser.authUserId, email, name, role });
  } catch (error: unknown) {
    if (authUser.created) {
      try {
        await cleanupCreatedAuthUser(supabaseAdmin, authUser.authUserId);
      } catch { /* Best-effort cleanup only; preserve the original failure below. */ }
    }
    if (isVendorTenancyError(error)) {
      throw new AdminVendorInvitationCrossTenantError(getErrorMessage(error));
    }
    throw error;
  }
}
