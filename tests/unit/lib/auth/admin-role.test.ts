import { beforeEach, describe, expect, it, vi } from "vitest";

type AdminRoleRow = {
  userId: string;
  companyId: string;
  roleCode: string;
};

type AuthUserResponse = Promise<{
  data: {
    user: { id: string } | null;
  };
}>;

const mocks = vi.hoisted(() => {
  const limit = vi.fn<() => Promise<AdminRoleRow[]>>();
  const where = vi.fn(() => ({ limit }));
  const innerJoin = vi.fn(() => ({ where }));
  const from = vi.fn(() => ({ innerJoin }));
  const select = vi.fn(() => ({ from }));
  const getUser = vi.fn<() => AuthUserResponse>();
  const createClient = vi.fn(async () => ({ auth: { getUser } }));

  return { createClient, getUser, select, from, innerJoin, where, limit };
});

vi.mock("server-only", () => ({}));
vi.mock("@/lib/supabase/server", () => ({ createClient: mocks.createClient }));
vi.mock("@/lib/db/client", () => ({ db: { select: mocks.select } }));

import { getAdminUser } from "@/lib/auth/admin-role";

const userId = "11111111-1111-4111-8111-111111111111";
const companyId = "22222222-2222-4222-8222-222222222222";

describe("getAdminUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the admin user when auth and role match", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
    mocks.limit.mockResolvedValueOnce([{ userId, companyId, roleCode: "admin" }]);

    await expect(getAdminUser()).resolves.toEqual({ userId, companyId, roleCode: "admin" });
  });

  it("returns null when there is no authenticated user", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: null } });

    await expect(getAdminUser()).resolves.toBeNull();
    expect(mocks.select).not.toHaveBeenCalled();
  });

  it("returns null when the authenticated user is not an admin", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
    mocks.limit.mockResolvedValueOnce([]);

    await expect(getAdminUser()).resolves.toBeNull();
  });

  it("returns null when the role query fails", async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { id: userId } } });
    mocks.limit.mockRejectedValueOnce(new Error("database unavailable"));

    await expect(getAdminUser()).resolves.toBeNull();
  });
});
