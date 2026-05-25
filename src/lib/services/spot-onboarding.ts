// Phase 24 sprint beta day 1 sub-task epsilon.
// Server-only onboarding flow for spot invitations.
// ADR-0010 補項: this runs with service_role privileges and performs compensating cleanup on failure.
import { createHash } from "node:crypto";
import type { SupabaseClient, User } from "@supabase/supabase-js";
import { and, eq, sql } from "drizzle-orm";
import { transportOrderInvitations } from "@/lib/db/schema/transport_order_invitations";
import { transportOrders } from "@/lib/db/schema/transport_orders";
import { vendors } from "@/lib/db/schema/vendors";
import { vendorUsers } from "@/lib/db/schema/vendor_users";

export class InvitationTokenInvalidError extends Error {
  static readonly code = "INVITATION_TOKEN_INVALID";

  readonly code = InvitationTokenInvalidError.code;

  constructor(message = "Invitation token is invalid") {
    super(message);
    this.name = "InvitationTokenInvalidError";
  }
}

export class VendorCrossTenantError extends Error {
  static readonly code = "VENDOR_CROSS_TENANT";

  readonly code = VendorCrossTenantError.code;

  constructor(message = "spot invitation cross-tenant denial") {
    super(message);
    this.name = "VendorCrossTenantError";
  }
}

export class OnboardingError extends Error {
  static readonly code = "ONBOARDING_ERROR";

  readonly code = OnboardingError.code;

  constructor(message = "Spot invitation onboarding failed") {
    super(message);
    this.name = "OnboardingError";
  }
}

export type OnboardResult = {
  case: "new" | "existing";
  invitationId: string;
  transportOrderId: string;
  companyId: string;
  vendorId: string;
  vendorUserId: string;
  authUserId: string;
};

type InvitationRow = {
  id: string;
  companyId: string;
  transportOrderId: string;
  inviteeEmail: string | null;
  inviteeName: string | null;
  inviteePhone: string | null;
};

type TransportOrderRow = {
  id: string;
  companyId: string;
};

type VendorUserRow = {
  id: string;
  authUserId: string | null;
  companyId: string;
  vendorId: string;
  email: string;
  name: string | null;
};

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

function localPart(email: string): string {
  const parts: string[] = email.split("@");
  return parts[0] ?? email;
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

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

function isExplicitOnboardingError(error: unknown): boolean {
  return (
    error instanceof InvitationTokenInvalidError ||
    error instanceof VendorCrossTenantError ||
    error instanceof OnboardingError
  );
}

async function cleanupNewVendorResources(
  supabaseAdmin: SupabaseClient,
  // Drizzle does not export a shared public type for both DB and transactions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  vendorId: string | null,
  authUserId: string | null,
): Promise<void> {
  try {
    if (authUserId) {
      const { error } = await supabaseAdmin.auth.admin.deleteUser(authUserId);
      if (error) {
        throw error;
      }
    }
  } finally {
    if (vendorId) {
      await db.delete(vendors).where(eq(vendors.id, vendorId));
    }
  }
}

export async function verifyAndOnboardSpotInvitation(
  // Drizzle does not export a shared public type for both DB and transactions.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  db: any,
  supabaseAdmin: SupabaseClient,
  rawToken: string,
): Promise<OnboardResult> {
  const invitationTokenHash: string = sha256Hex(rawToken);

  const invitationRows: InvitationRow[] = await db
    .select({
      id: transportOrderInvitations.id,
      companyId: transportOrderInvitations.companyId,
      transportOrderId: transportOrderInvitations.transportOrderId,
      inviteeEmail: transportOrderInvitations.inviteeEmail,
      inviteeName: transportOrderInvitations.inviteeName,
      inviteePhone: transportOrderInvitations.inviteePhone,
    })
    .from(transportOrderInvitations)
    .where(
        and(
        eq(transportOrderInvitations.invitationTokenHash, invitationTokenHash),
        eq(transportOrderInvitations.response, "pending"),
        sql`${transportOrderInvitations.vendorId} IS NULL`,
        sql`(${transportOrderInvitations.expiresAt} IS NULL OR ${transportOrderInvitations.expiresAt} > now())`,
        sql`${transportOrderInvitations.inviteeEmail} IS NOT NULL`,
      ),
    )
    .limit(1);

  const invitation: InvitationRow | undefined = invitationRows[0];
  if (!invitation) {
    throw new InvitationTokenInvalidError();
  }

  const transportOrderRows: TransportOrderRow[] = await db
    .select({
      id: transportOrders.id,
      companyId: transportOrders.companyId,
    })
    .from(transportOrders)
    .where(eq(transportOrders.id, invitation.transportOrderId))
    .limit(1);

  const transportOrder: TransportOrderRow | undefined = transportOrderRows[0];
  if (!transportOrder) {
    throw new OnboardingError("transport order not found for spot invitation");
  }

  const invitationEmail: string = invitation.inviteeEmail ?? "";
  const existingVendorUsers: VendorUserRow[] = await db
    .select({
      id: vendorUsers.id,
      authUserId: vendorUsers.authUserId,
      companyId: vendorUsers.companyId,
      vendorId: vendorUsers.vendorId,
      email: vendorUsers.email,
      name: vendorUsers.name,
    })
    .from(vendorUsers)
    .where(sql`lower(${vendorUsers.email}) = lower(${invitationEmail})`)
    .limit(1);

  const existingVendorUser: VendorUserRow | undefined = existingVendorUsers[0];

  if (existingVendorUser) {
    if (existingVendorUser.companyId !== transportOrder.companyId) {
      throw new VendorCrossTenantError();
    }

    if (!existingVendorUser.authUserId) {
      throw new OnboardingError("existing vendor user is missing auth_user_id");
    }

    return {
      case: "existing",
      invitationId: invitation.id,
      transportOrderId: transportOrder.id,
      companyId: transportOrder.companyId,
      vendorId: existingVendorUser.vendorId,
      vendorUserId: existingVendorUser.id,
      authUserId: existingVendorUser.authUserId,
    };
  }

  const redirectTo: string = `${process.env.NEXT_PUBLIC_APP_URL ?? ""}/vendor/invitations/callback`;

  // Phase 25 ε-patch (F3): idempotency lookup — reuse existing vendor row on retry/race.
  const existingVendorRows: { id: string }[] = await db
    .select({ id: vendors.id })
    .from(vendors)
    .where(
      and(
        sql`lower(${vendors.email}) = lower(${invitationEmail})`,
        eq(vendors.companyId, transportOrder.companyId),
      ),
    )
    .limit(1);
  const reusedVendorId: string | null = existingVendorRows[0]?.id ?? null;

  let createdVendorId: string | null = null;
  let createdAuthUserId: string | null = null;

  try {
    const existingAuthUser: User | null = await findAuthUserByEmail(supabaseAdmin, invitationEmail);

    let vendorIdToUse: string;
    if (reusedVendorId) {
      vendorIdToUse = reusedVendorId;
    } else {
      const vendorName: string = invitation.inviteeName ?? localPart(invitationEmail);
      const createdVendors = await db
        .insert(vendors)
        .values({
          companyId: transportOrder.companyId,
          name: vendorName,
          email: invitationEmail,
          phone: invitation.inviteePhone,
          notificationMethod: "both",
          isShared: false,
        })
        .returning({ id: vendors.id });

      const createdVendor = createdVendors[0];
      if (!createdVendor) {
        throw new OnboardingError("vendor insert returned no row");
      }
      createdVendorId = createdVendor.id;
      vendorIdToUse = createdVendor.id;
    }

    let authUser: User | null = existingAuthUser;
    if (!authUser) {
      const { data, error } = await supabaseAdmin.auth.admin.inviteUserByEmail(invitationEmail, {
        redirectTo,
      });

      if (error) {
        throw error;
      }

      authUser = data.user ?? null;
      if (!authUser) {
        throw new OnboardingError("auth admin did not return a user");
      }
      createdAuthUserId = authUser.id;
    }

    const createdVendorUsers = await db
      .insert(vendorUsers)
      .values({
        companyId: transportOrder.companyId,
        vendorId: vendorIdToUse,
        authUserId: authUser.id,
        email: invitationEmail,
        name: invitation.inviteeName ?? null,
        isActive: false,
      })
      .returning({ id: vendorUsers.id });

    const createdVendorUser = createdVendorUsers[0];
    if (!createdVendorUser) {
      throw new OnboardingError("vendor user insert returned no row");
    }

    return {
      case: "new",
      invitationId: invitation.id,
      transportOrderId: transportOrder.id,
      companyId: transportOrder.companyId,
      vendorId: vendorIdToUse,
      vendorUserId: createdVendorUser.id,
      authUserId: authUser.id,
    };
  } catch (error: unknown) {
    try {
      await cleanupNewVendorResources(supabaseAdmin, db, createdVendorId, createdAuthUserId);
    } catch {
      // Best-effort cleanup only; preserve the original failure below.
    }

    if (isExplicitOnboardingError(error)) {
      throw error;
    }

    throw new OnboardingError(getErrorMessage(error));
  }
}
