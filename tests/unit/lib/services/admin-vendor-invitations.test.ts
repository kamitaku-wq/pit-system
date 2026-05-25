import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AdminUser } from "@/lib/auth/admin-role";

type Row = { id: string; companyId?: string };
type TransactionCallback = (tx: { insert: ReturnType<typeof vi.fn> }) => Promise<unknown>;

const mocks = vi.hoisted(() => {
  const select = vi.fn();
  const transaction = vi.fn();
  const listUsers = vi.fn();
  const inviteUserByEmail = vi.fn();
  const deleteUser = vi.fn();

  return {
    db: { select, transaction },
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
  createAdminVendorInvitation,
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

describe("createAdminVendorInvitation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
