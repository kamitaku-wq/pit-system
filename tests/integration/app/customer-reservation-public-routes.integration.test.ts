// Phase 64-A.31b: 顧客公開予約フロー route (薄い shim) の I/O テスト。
// ---------------------------------------------------------------------------
// route は createPublicReservation / listPublicWorkMenus へ委譲する shim。cross-tenant /
//   visible_to_customers / gate→create 同一 laneId の保証は service 層 integration tests に集約。
//   本テストは route 固有の責務のみを mock service で検証する:
//     - path companyId の UUID 強制 (malformed → 404、service 未呼出)
//     - body / query の zod 検証 (malformed → 400、service 未呼出)
//     - service へ正しい引数 (path companyId / ISO→Date / customer・vehicle) を渡す
//     - service reason → HTTP status の写像 (404 / 409 / 500)
//   service を mock するため DB 不要 (node 環境で NextResponse/Request が動けば実行可)。

import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createPublicReservationMock = vi.fn();
const listPublicWorkMenusMock = vi.fn();

vi.doMock("@/lib/services/customer-reservation-public", () => ({
  createPublicReservation: createPublicReservationMock,
  listPublicWorkMenus: listPublicWorkMenusMock,
}));

const { POST } = await import("@/app/r/reserve/[companyId]/reservations/route");
const { GET } = await import("@/app/r/reserve/[companyId]/menus/route");

function paramsFor(companyId: string): { params: Promise<{ companyId: string }> } {
  return { params: Promise.resolve({ companyId }) };
}

function validBody() {
  return {
    storeId: crypto.randomUUID(),
    workMenuId: crypto.randomUUID(),
    laneId: crypto.randomUUID(),
    startAt: "2026-07-15T00:00:00.000Z",
    endAt: "2026-07-15T01:00:00.000Z",
    customer: { fullName: "山田 太郎", email: "taro@example.test" },
    vehicle: { registrationNumber: "品川 300 あ 12-34" },
  };
}

function postRequest(companyId: string, body: unknown): Request {
  return new Request(`http://localhost/r/reserve/${companyId}/reservations`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
      "user-agent": "test-agent",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  createPublicReservationMock.mockReset();
  listPublicWorkMenusMock.mockReset();
});

describe("POST /r/reserve/[companyId]/reservations", () => {
  it("returns 201 and forwards path companyId, coerced dates and client meta on success", async () => {
    createPublicReservationMock.mockResolvedValueOnce({ ok: true, reservationId: "res-1" });
    const companyId = crypto.randomUUID();
    const body = validBody();

    const res = await POST(postRequest(companyId, body), paramsFor(companyId));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ ok: true, reservationId: "res-1" });

    expect(createPublicReservationMock).toHaveBeenCalledTimes(1);
    const [input, options] = createPublicReservationMock.mock.calls[0]!;
    expect(input.companyId).toBe(companyId); // path から
    expect(input.storeId).toBe(body.storeId);
    expect(input.workMenuId).toBe(body.workMenuId);
    expect(input.laneId).toBe(body.laneId);
    expect(input.startAt).toBeInstanceOf(Date);
    expect(input.startAt.toISOString()).toBe(body.startAt);
    expect(input.endAt.toISOString()).toBe(body.endAt);
    expect(input.customer.fullName).toBe("山田 太郎");
    // x-forwarded-for の先頭 IP のみ。
    expect(options.ipAddress).toBe("203.0.113.9");
    expect(options.userAgent).toBe("test-agent");
  });

  it("returns 404 and does not call the service for a malformed path companyId", async () => {
    const res = await POST(postRequest("not-a-uuid", validBody()), paramsFor("not-a-uuid"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "company_not_found" });
    expect(createPublicReservationMock).not.toHaveBeenCalled();
  });

  it("returns 400 and does not call the service for a body missing required fields", async () => {
    const companyId = crypto.randomUUID();
    const { laneId, ...rest } = validBody();
    void laneId;
    const res = await POST(postRequest(companyId, rest), paramsFor(companyId));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "invalid_body" });
    expect(createPublicReservationMock).not.toHaveBeenCalled();
  });

  it("returns 400 for non-JSON body", async () => {
    const companyId = crypto.randomUUID();
    const res = await POST(postRequest(companyId, "}{ not json"), paramsFor(companyId));
    expect(res.status).toBe(400);
    expect(createPublicReservationMock).not.toHaveBeenCalled();
  });

  it("returns 400 when startAt is not before endAt", async () => {
    const companyId = crypto.randomUUID();
    const body = {
      ...validBody(),
      startAt: "2026-07-15T02:00:00.000Z",
      endAt: "2026-07-15T01:00:00.000Z",
    };
    const res = await POST(postRequest(companyId, body), paramsFor(companyId));
    expect(res.status).toBe(400);
    expect(createPublicReservationMock).not.toHaveBeenCalled();
  });

  it("maps boundary reasons (work_menu_not_found) to 404", async () => {
    createPublicReservationMock.mockResolvedValueOnce({ ok: false, reason: "work_menu_not_found" });
    const companyId = crypto.randomUUID();
    const res = await POST(postRequest(companyId, validBody()), paramsFor(companyId));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "work_menu_not_found" });
  });

  it("maps availability/double-book reasons to 409", async () => {
    for (const reason of ["duration_mismatch", "too_soon", "slot_unavailable"] as const) {
      createPublicReservationMock.mockResolvedValueOnce({ ok: false, reason });
      const companyId = crypto.randomUUID();
      const res = await POST(postRequest(companyId, validBody()), paramsFor(companyId));
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toEqual({ ok: false, reason });
    }
  });

  it("maps status_not_seeded to 500", async () => {
    createPublicReservationMock.mockResolvedValueOnce({ ok: false, reason: "status_not_seeded" });
    const companyId = crypto.randomUUID();
    const res = await POST(postRequest(companyId, validBody()), paramsFor(companyId));
    expect(res.status).toBe(500);
  });
});

describe("GET /r/reserve/[companyId]/menus", () => {
  function getRequest(companyId: string, query: string): Request {
    return new Request(`http://localhost/r/reserve/${companyId}/menus${query}`);
  }

  it("returns 200 and the menus, forwarding path companyId and storeId", async () => {
    const menus = [{ id: "m1", name: "Oil", durationMinutes: 60, priceMinor: 5000 }];
    listPublicWorkMenusMock.mockResolvedValueOnce({ ok: true, menus });
    const companyId = crypto.randomUUID();
    const storeId = crypto.randomUUID();

    const res = await GET(getRequest(companyId, `?storeId=${storeId}`), paramsFor(companyId));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true, menus });
    expect(listPublicWorkMenusMock).toHaveBeenCalledWith(companyId, storeId);
  });

  it("returns 400 and does not call the service when storeId is missing", async () => {
    const companyId = crypto.randomUUID();
    const res = await GET(getRequest(companyId, ""), paramsFor(companyId));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "invalid_query" });
    expect(listPublicWorkMenusMock).not.toHaveBeenCalled();
  });

  it("returns 404 for a malformed path companyId without calling the service", async () => {
    const res = await GET(
      getRequest("not-a-uuid", `?storeId=${crypto.randomUUID()}`),
      paramsFor("not-a-uuid"),
    );
    expect(res.status).toBe(404);
    expect(listPublicWorkMenusMock).not.toHaveBeenCalled();
  });

  it("maps a service not-found reason to 404", async () => {
    listPublicWorkMenusMock.mockResolvedValueOnce({ ok: false, reason: "store_not_found" });
    const companyId = crypto.randomUUID();
    const res = await GET(
      getRequest(companyId, `?storeId=${crypto.randomUUID()}`),
      paramsFor(companyId),
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "store_not_found" });
  });
});
