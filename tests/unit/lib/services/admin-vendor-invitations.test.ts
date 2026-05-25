import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUser } from "@/lib/auth/admin-role";

type Row = {
  id?: string;
  companyId?: string;
  vendorUserId?: string | null;
  status?: string;
  email?: string;
  lastResentAt?: Date | null;
  authUserId?: string | null;
  sentAt?: Date | null;
};
type MutableInvitationRow = {
  id: string;
  companyId: string;
  vendorUserId: string | null;
  status: string;
  email: string;
  lastResentAt: Date | null;
  sentAt: Date | null;
};
type MutableVendorUserRow = { id: string; authUserId: string; isActive: boolean };
type TransactionCallback = (tx: {
  insert?: ReturnType<typeof vi.fn>;
  update?: ReturnType<typeof vi.fn>;
}) => Promise<unknown>;

const mocks = vi.hoisted(() => {
  const select = vi.fn();
  const update = vi.fn();
  const transaction = vi.fn();
  const listUsers = vi.fn();
  const inviteUserByEmail = vi.fn();
  const deleteUser = vi.fn();

  return {
    db: { select, update, transaction },
    listUsers,
    inviteUserByEmail,
    deleteUser,
    supabaseAdmin: {
      auth: {
        admin: {
          listUsers,
          inviteUserByEmail,
          deleteUser,
        },
      },
    },
  };
});

vi.mock("@/lib/db/client", () => ({ db: mocks.db }));

import {
  AdminVendorInvitationAuthError,
  AdminVendorInvitationCrossTenantError,
  AdminVendorInvitationDuplicateError,
  AdminVendorInvitationInvalidStateError,
  AdminVendorInvitationNotFoundError,
  AdminVendorInvitationResendTooEarlyError,
  createAdminVendorInvitation,
  resendAdminVendorInvitation,
  revokeAdminVendorInvitation,
} from "@/lib/services/admin-vendor-invitations";

const companyId = "uuid-company-a";
const vendorId = "uuid-vendor";
const adminUser: AdminUser = {
  userId: "uuid-admin",
  companyId,
  roleCode: "admin",
};

function mockSelectRows(rows: Row[]): void {
  const limit = vi.fn<() => Promise<Row[]>>().mockResolvedValueOnce(rows);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));

  mocks.db.select.mockReturnValueOnce({ from });
}

function mockTransactionRows(): void {
  const returningRows: Array<Array<{ id: string }>> = [
    [{ id: "vendor-user-uuid" }],
    [{ id: "invitation-uuid" }],
    [{ id: "outbox-uuid" }],
  ];
  const tx = {
    insert: vi.fn(() => ({
      values: vi.fn(() => ({
        returning: vi.fn(async () => returningRows.shift() ?? []),
      })),
    })),
  };

  mocks.db.transaction.mockImplementationOnce(async (callback: TransactionCallback) => callback(tx));
}

function mockUpdateRows(
  rows: Row[] | (() => Row[]),
  invitation?: MutableInvitationRow,
): { set: ReturnType<typeof vi.fn> } {
  const returning = vi.fn<() => Promise<Row[]>>().mockImplementationOnce(async () => {
    return typeof rows === "function" ? rows() : rows;
  });
  const where = vi.fn(() => ({ returning }));
  const set = vi.fn((values: Partial<MutableInvitationRow>) => {
    if (invitation) {
      Object.assign(invitation, values);
    }
    return { where };
  });

  mocks.db.update.mockReturnValueOnce({ set });
  return { set };
}

function mockRevokeTransactionRows(
  invitation: MutableInvitationRow,
  vendorUser?: MutableVendorUserRow,
): { update: ReturnType<typeof vi.fn>; setValues: unknown[] } {
  const setValues: unknown[] = [];
  const update = vi.fn(() => ({
    set: vi.fn((values: Partial<MutableInvitationRow> | Partial<MutableVendorUserRow>) => {
      setValues.push(values);
      if ("status" in values) {
        Object.assign(invitation, values);
      }
      if (vendorUser && "isActive" in values) {
        Object.assign(vendorUser, values);
      }
      return { where: vi.fn(async () => []) };
    }),
  }));

  mocks.db.transaction.mockImplementationOnce(async (callback: TransactionCallback) => callback({ update }));
  return { update, setValues };
}

describe("createAdminVendorInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("returns inserted invitation identifiers when the vendor invite succeeds", async () => {
    mockSelectRows([{ id: vendorId, companyId }]);
    mockSelectRows([]);
    mockTransactionRows();
    mocks.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: null });
    mocks.inviteUserByEmail.mockResolvedValueOnce({
      data: { user: { id: "auth-uuid" } },
      error: null,
    });

    await expect(
      createAdminVendorInvitation(mocks.db as never, mocks.supabaseAdmin as never, adminUser, {
        vendorId,
        email: "Vendor@Example.com",
        name: "Vendor User",
      }),
    ).resolves.toEqual({
      companyId,
      vendorId,
      vendorUserId: "vendor-user-uuid",
      invitationId: "invitation-uuid",
      outboxId: "outbox-uuid",
      authUserId: "auth-uuid",
      idempotencyKey: "admin-vendor-invitation:invitation-uuid",
    });
    expect(mocks.db.transaction).toHaveBeenCalledTimes(1);
  });

  it("throws cross-tenant when the vendor belongs to another company", async () => {
    mockSelectRows([{ id: vendorId, companyId: "uuid-company-b" }]);

    await expect(
      createAdminVendorInvitation(mocks.db as never, mocks.supabaseAdmin as never, adminUser, {
        vendorId,
        email: "vendor@example.com",
      }),
    ).rejects.toBeInstanceOf(AdminVendorInvitationCrossTenantError);
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("throws duplicate when a pending invitation already exists", async () => {
    mockSelectRows([{ id: vendorId, companyId }]);
    mockSelectRows([{ id: "pending-invitation-uuid" }]);

    await expect(
      createAdminVendorInvitation(mocks.db as never, mocks.supabaseAdmin as never, adminUser, {
        vendorId,
        email: "vendor@example.com",
      }),
    ).rejects.toBeInstanceOf(AdminVendorInvitationDuplicateError);
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled();
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("throws auth error when the invite API fails", async () => {
    mockSelectRows([{ id: vendorId, companyId }]);
    mockSelectRows([]);
    mocks.listUsers.mockResolvedValueOnce({ data: { users: [] }, error: null });
    mocks.inviteUserByEmail.mockResolvedValueOnce({
      data: null,
      error: { message: "auth fail" },
    });

    await expect(
      createAdminVendorInvitation(mocks.db as never, mocks.supabaseAdmin as never, adminUser, {
        vendorId,
        email: "vendor@example.com",
      }),
    ).rejects.toBeInstanceOf(AdminVendorInvitationAuthError);
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });
});

describe("resendAdminVendorInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("updates sent timestamps when a sent invitation is resent", async () => {
    const invitation: MutableInvitationRow = {
      id: "invitation-uuid",
      companyId,
      vendorUserId: "vendor-user-uuid",
      status: "sent",
      email: "vendor@example.com",
      lastResentAt: null,
      sentAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    mockSelectRows([invitation]);
    mockSelectRows([{ authUserId: "auth-uuid" }]);
    mocks.inviteUserByEmail.mockResolvedValueOnce({
      data: { user: { id: "auth-uuid" } },
      error: null,
    });
    const update = mockUpdateRows(() => [{ sentAt: invitation.sentAt }], invitation);

    const result = await resendAdminVendorInvitation(
      mocks.db as never,
      mocks.supabaseAdmin as never,
      adminUser,
      invitation.id,
    );

    expect(result).toEqual({
      invitationId: invitation.id,
      sentAt: invitation.sentAt,
    });
    expect(mocks.inviteUserByEmail).toHaveBeenCalledWith("vendor@example.com", {
      redirectTo: "http://localhost:3000/vendor/admin-invite-callback",
    });
    expect(invitation.status).toBe("sent");
    expect(invitation.sentAt).toBeInstanceOf(Date);
    expect(invitation.lastResentAt).toBe(invitation.sentAt);
    expect(update.set).toHaveBeenCalledWith({
      sentAt: invitation.sentAt,
      lastResentAt: invitation.sentAt,
    });
  });

  it("throws not found when the invitation does not exist for resend", async () => {
    mockSelectRows([]);

    await expect(
      resendAdminVendorInvitation(mocks.db as never, mocks.supabaseAdmin as never, adminUser, "missing-invitation"),
    ).rejects.toBeInstanceOf(AdminVendorInvitationNotFoundError);
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("throws invalid state when a revoked invitation is resent", async () => {
    mockSelectRows([{
      id: "invitation-uuid",
      companyId,
      vendorUserId: "vendor-user-uuid",
      status: "revoked",
      email: "vendor@example.com",
      lastResentAt: null,
    }]);

    await expect(
      resendAdminVendorInvitation(mocks.db as never, mocks.supabaseAdmin as never, adminUser, "invitation-uuid"),
    ).rejects.toBeInstanceOf(AdminVendorInvitationInvalidStateError);
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("throws resend-too-early when the invitation was resent less than sixty seconds ago", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:01:00.000Z"));
    mockSelectRows([{
      id: "invitation-uuid",
      companyId,
      vendorUserId: "vendor-user-uuid",
      status: "sent",
      email: "vendor@example.com",
      lastResentAt: new Date("2026-01-01T00:00:30.000Z"),
    }]);

    await expect(
      resendAdminVendorInvitation(mocks.db as never, mocks.supabaseAdmin as never, adminUser, "invitation-uuid"),
    ).rejects.toBeInstanceOf(AdminVendorInvitationResendTooEarlyError);
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });

  it("throws cross-tenant when the invitation belongs to another company for resend", async () => {
    mockSelectRows([{
      id: "invitation-uuid",
      companyId: "uuid-company-b",
      vendorUserId: "vendor-user-uuid",
      status: "sent",
      email: "vendor@example.com",
      lastResentAt: null,
    }]);

    await expect(
      resendAdminVendorInvitation(mocks.db as never, mocks.supabaseAdmin as never, adminUser, "invitation-uuid"),
    ).rejects.toBeInstanceOf(AdminVendorInvitationCrossTenantError);
    expect(mocks.inviteUserByEmail).not.toHaveBeenCalled();
    expect(mocks.db.update).not.toHaveBeenCalled();
  });
});

describe("revokeAdminVendorInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it("revokes a pending invitation and deactivates the vendor user", async () => {
    const invitation: MutableInvitationRow = {
      id: "pending-invitation-uuid",
      companyId,
      vendorUserId: "vendor-user-uuid",
      status: "pending",
      email: "vendor@example.com",
      lastResentAt: null,
      sentAt: null,
    };
    const vendorUser: MutableVendorUserRow = {
      id: "vendor-user-uuid",
      authUserId: "auth-uuid",
      isActive: true,
    };
    mockSelectRows([invitation]);
    const transaction = mockRevokeTransactionRows(invitation, vendorUser);

    await expect(
      revokeAdminVendorInvitation(mocks.db as never, adminUser, invitation.id),
    ).resolves.toEqual({ invitationId: invitation.id, revoked: true });
    expect(transaction.update).toHaveBeenCalledTimes(2);
    expect(transaction.setValues).toEqual([{ isActive: false }, { status: "revoked" }]);
    expect(invitation.status).toBe("revoked");
    expect(vendorUser.isActive).toBe(false);
  });

  it("revokes a sent invitation and deactivates the vendor user", async () => {
    const invitation: MutableInvitationRow = {
      id: "sent-invitation-uuid",
      companyId,
      vendorUserId: "vendor-user-uuid",
      status: "sent",
      email: "vendor@example.com",
      lastResentAt: null,
      sentAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const vendorUser: MutableVendorUserRow = {
      id: "vendor-user-uuid",
      authUserId: "auth-uuid",
      isActive: true,
    };
    mockSelectRows([invitation]);
    const transaction = mockRevokeTransactionRows(invitation, vendorUser);

    await expect(
      revokeAdminVendorInvitation(mocks.db as never, adminUser, invitation.id),
    ).resolves.toEqual({ invitationId: invitation.id, revoked: true });
    expect(transaction.update).toHaveBeenCalledTimes(2);
    expect(transaction.setValues).toEqual([{ isActive: false }, { status: "revoked" }]);
    expect(invitation.status).toBe("revoked");
    expect(vendorUser.isActive).toBe(false);
  });

  it("throws invalid state when an accepted invitation is revoked", async () => {
    mockSelectRows([{
      id: "accepted-invitation-uuid",
      companyId,
      vendorUserId: "vendor-user-uuid",
      status: "accepted",
    }]);

    await expect(
      revokeAdminVendorInvitation(mocks.db as never, adminUser, "accepted-invitation-uuid"),
    ).rejects.toMatchObject({
      name: "AdminVendorInvitationInvalidStateError",
      message: "cannot revoke accepted invitation",
    });
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("throws not found when the invitation does not exist for revoke", async () => {
    mockSelectRows([]);

    await expect(
      revokeAdminVendorInvitation(mocks.db as never, adminUser, "missing-invitation"),
    ).rejects.toBeInstanceOf(AdminVendorInvitationNotFoundError);
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("throws cross-tenant when the invitation belongs to another company for revoke", async () => {
    mockSelectRows([{
      id: "invitation-uuid",
      companyId: "uuid-company-b",
      vendorUserId: "vendor-user-uuid",
      status: "sent",
    }]);

    await expect(
      revokeAdminVendorInvitation(mocks.db as never, adminUser, "invitation-uuid"),
    ).rejects.toBeInstanceOf(AdminVendorInvitationCrossTenantError);
    expect(mocks.db.transaction).not.toHaveBeenCalled();
  });

  it("revokes an invitation with no vendor user id", async () => {
    const invitation: MutableInvitationRow = {
      id: "null-vendor-user-invitation-uuid",
      companyId,
      vendorUserId: null,
      status: "pending",
      email: "vendor@example.com",
      lastResentAt: null,
      sentAt: null,
    };
    mockSelectRows([invitation]);
    const transaction = mockRevokeTransactionRows(invitation);

    await expect(
      revokeAdminVendorInvitation(mocks.db as never, adminUser, invitation.id),
    ).resolves.toEqual({ invitationId: invitation.id, revoked: true });
    expect(transaction.update).toHaveBeenCalledTimes(1);
    expect(transaction.setValues).toEqual([{ status: "revoked" }]);
    expect(invitation.status).toBe("revoked");
  });
});
