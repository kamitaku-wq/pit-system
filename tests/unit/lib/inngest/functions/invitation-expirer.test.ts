import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const chain = {
    set: vi.fn(),
    where: vi.fn(),
    returning: vi.fn(),
  };
  const update = vi.fn(() => chain);
  const and = vi.fn();
  const inArray = vi.fn();
  const isNotNull = vi.fn();
  const lt = vi.fn();

  chain.set.mockReturnValue(chain);
  chain.where.mockReturnValue(chain);

  return {
    db: { update },
    chain,
    and,
    inArray,
    isNotNull,
    lt,
  };
});

vi.mock("@/lib/db/client", () => ({ db: mocks.db }));
vi.mock("drizzle-orm", async (importActual) => {
  const actual = await importActual<typeof import("drizzle-orm")>();

  mocks.and.mockImplementation(actual.and);
  mocks.inArray.mockImplementation(actual.inArray);
  mocks.isNotNull.mockImplementation(actual.isNotNull);
  mocks.lt.mockImplementation(actual.lt);

  return {
    ...actual,
    and: mocks.and,
    inArray: mocks.inArray,
    isNotNull: mocks.isNotNull,
    lt: mocks.lt,
  };
});

import { adminVendorInvitations } from "@/lib/db/schema/admin_vendor_invitations";
import { runExpireOnce } from "@/lib/inngest/functions/invitation-expirer";

describe("runExpireOnce", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.chain.set.mockReturnValue(mocks.chain);
    mocks.chain.where.mockReturnValue(mocks.chain);
  });

  it("returns {expired: 2} when two rows match", async () => {
    mocks.chain.returning.mockResolvedValueOnce([{ id: "x" }, { id: "y" }]);

    const result = await runExpireOnce(mocks.db as never);

    expect(result.expired).toBe(2);
  });

  it("returns {expired: 0} when no rows match", async () => {
    mocks.chain.returning.mockResolvedValueOnce([]);

    const result = await runExpireOnce(mocks.db as never);

    expect(result.expired).toBe(0);
  });

  it("calls .where() with isNotNull, lt, inArray conditions", async () => {
    mocks.chain.returning.mockResolvedValueOnce([]);

    await runExpireOnce(mocks.db as never);

    expect(mocks.chain.where).toHaveBeenCalledTimes(1);
    expect(mocks.isNotNull).toHaveBeenCalledWith(adminVendorInvitations.expiresAt);
    expect(mocks.lt).toHaveBeenCalledWith(adminVendorInvitations.expiresAt, expect.any(Date));
    expect(mocks.inArray).toHaveBeenCalledWith(adminVendorInvitations.status, ["pending", "sent"]);
    expect(mocks.and).toHaveBeenCalledWith(
      mocks.isNotNull.mock.results[0]?.value,
      mocks.lt.mock.results[0]?.value,
      mocks.inArray.mock.results[0]?.value,
    );
  });
});
