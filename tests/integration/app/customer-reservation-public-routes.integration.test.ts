// Phase 64-A.31b / A.32b: 顧客公開予約フロー route (薄い shim) の I/O テスト。
// ---------------------------------------------------------------------------
// route は service へ委譲する shim。cross-tenant / visible_to_customers / gate→create 同一 laneId /
//   email 本人確認 の保証は service 層 integration tests に集約。本テストは route 固有の責務のみを
//   mock service で検証する:
//     - path companyId の UUID 強制 (malformed → 404、service 未呼出)
//     - body / query の zod 検証 (malformed / email 欠落 / code 欠落 → 400、service 未呼出)
//     - service へ正しい引数 (path companyId / ISO→Date / customer・vehicle / code) を渡す
//     - service reason → HTTP status の写像 (404 / 409 / 422 / 500)
//     - verification-code route が issue-state を区別せず常に汎用 200 を返す (A.32b)
//   service を mock するため DB 不要 (node 環境で NextResponse/Request が動けば実行可)。

import crypto from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const createVerifiedPublicReservationMock = vi.fn();
const requestReservationVerificationCodeMock = vi.fn();
const listPublicWorkMenusMock = vi.fn();
const listAvailableSlotsForStoreMenuMock = vi.fn();
// A.33: rate limit / Turnstile を route 層で mock する (DB/Cloudflare 非依存)。
const enforcePublicReservationRateLimitMock = vi.fn();
const verifyTurnstileTokenMock = vi.fn();

vi.doMock("@/lib/services/customer-reservation-verification", () => ({
  createVerifiedPublicReservation: createVerifiedPublicReservationMock,
  requestReservationVerificationCode: requestReservationVerificationCodeMock,
}));
vi.doMock("@/lib/services/customer-reservation-public", () => ({
  listPublicWorkMenus: listPublicWorkMenusMock,
  listAvailableSlotsForStoreMenu: listAvailableSlotsForStoreMenuMock,
}));
// enforcePublicReservationRateLimit のみ mock。getClientIp / retryAfterHeader は純関数なので
// 実装と同等の薄実装を返す (DB を引く checkRateLimit/rate-limiter は読み込まない)。
vi.doMock("@/lib/rate-limit/public-reservation-rate-limit", () => ({
  enforcePublicReservationRateLimit: enforcePublicReservationRateLimitMock,
  getClientIp: (request: Request) =>
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown",
  retryAfterHeader: (retryAfterSeconds: number) => ({ "retry-after": String(retryAfterSeconds) }),
}));
vi.doMock("@/lib/services/turnstile", () => ({
  verifyTurnstileToken: verifyTurnstileTokenMock,
}));

const { POST } = await import("@/app/r/reserve/[companyId]/reservations/route");
const { GET } = await import("@/app/r/reserve/[companyId]/menus/route");
const { GET: SLOTS_GET } = await import("@/app/r/reserve/[companyId]/slots/route");
const { POST: VERIFICATION_POST } =
  await import("@/app/r/reserve/[companyId]/verification-code/route");

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
    code: "123456",
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

function verificationRequest(companyId: string, body: unknown): Request {
  return new Request(`http://localhost/r/reserve/${companyId}/verification-code`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": "203.0.113.9, 10.0.0.1",
    },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

beforeEach(() => {
  createVerifiedPublicReservationMock.mockReset();
  requestReservationVerificationCodeMock.mockReset();
  listPublicWorkMenusMock.mockReset();
  listAvailableSlotsForStoreMenuMock.mockReset();
  // A.33 デフォルト: rate limit は通過、Turnstile は成功 (各テストが必要なら上書き)。
  enforcePublicReservationRateLimitMock.mockReset();
  enforcePublicReservationRateLimitMock.mockResolvedValue({ ok: true });
  verifyTurnstileTokenMock.mockReset();
  verifyTurnstileTokenMock.mockResolvedValue({ success: true, errorCodes: [] });
  // service の happy-path デフォルト (個別テストは mockResolvedValueOnce で上書きする。Once が優先)。
  requestReservationVerificationCodeMock.mockResolvedValue({ ok: true, outboxId: "ob-default" });
  createVerifiedPublicReservationMock.mockResolvedValue({ ok: true, reservationId: "res-default" });
  listPublicWorkMenusMock.mockResolvedValue({ ok: true, menus: [] });
  listAvailableSlotsForStoreMenuMock.mockResolvedValue({ ok: true, slots: [] });
});

// verification-code の正常 body (email + Turnstile トークン)。
function validVerificationBody(email = "taro@example.test"): {
  email: string;
  turnstileToken: string;
} {
  return { email, turnstileToken: "tok-valid" };
}

describe("POST /r/reserve/[companyId]/reservations (A.32b verify gate)", () => {
  it("returns 201 and forwards path companyId, coerced dates, code and client meta on success", async () => {
    createVerifiedPublicReservationMock.mockResolvedValueOnce({ ok: true, reservationId: "res-1" });
    const companyId = crypto.randomUUID();
    const body = validBody();

    const res = await POST(postRequest(companyId, body), paramsFor(companyId));
    expect(res.status).toBe(201);
    await expect(res.json()).resolves.toEqual({ ok: true, reservationId: "res-1" });

    expect(createVerifiedPublicReservationMock).toHaveBeenCalledTimes(1);
    const [input, options] = createVerifiedPublicReservationMock.mock.calls[0]!;
    expect(input.companyId).toBe(companyId); // path から
    expect(input.storeId).toBe(body.storeId);
    expect(input.workMenuId).toBe(body.workMenuId);
    expect(input.laneId).toBe(body.laneId);
    expect(input.startAt).toBeInstanceOf(Date);
    expect(input.startAt.toISOString()).toBe(body.startAt);
    expect(input.endAt.toISOString()).toBe(body.endAt);
    expect(input.customer.fullName).toBe("山田 太郎");
    expect(input.customer.email).toBe("taro@example.test");
    expect(input.code).toBe("123456");
    // x-forwarded-for の先頭 IP のみ。
    expect(options.ipAddress).toBe("203.0.113.9");
    expect(options.userAgent).toBe("test-agent");
  });

  it("returns 404 and does not call the service for a malformed path companyId", async () => {
    const res = await POST(postRequest("not-a-uuid", validBody()), paramsFor("not-a-uuid"));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "company_not_found" });
    expect(createVerifiedPublicReservationMock).not.toHaveBeenCalled();
  });

  it("returns 400 and does not call the service for a body missing required fields", async () => {
    const companyId = crypto.randomUUID();
    const { laneId, ...rest } = validBody();
    void laneId;
    const res = await POST(postRequest(companyId, rest), paramsFor(companyId));
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "invalid_body" });
    expect(createVerifiedPublicReservationMock).not.toHaveBeenCalled();
  });

  it("returns 400 when email is missing (public flow requires email)", async () => {
    const companyId = crypto.randomUUID();
    const body = { ...validBody(), customer: { fullName: "山田 太郎" } };
    const res = await POST(postRequest(companyId, body), paramsFor(companyId));
    expect(res.status).toBe(400);
    expect(createVerifiedPublicReservationMock).not.toHaveBeenCalled();
  });

  it("returns 400 when the verification code is missing", async () => {
    const companyId = crypto.randomUUID();
    const { code, ...rest } = validBody();
    void code;
    const res = await POST(postRequest(companyId, rest), paramsFor(companyId));
    expect(res.status).toBe(400);
    expect(createVerifiedPublicReservationMock).not.toHaveBeenCalled();
  });

  it("returns 400 for non-JSON body", async () => {
    const companyId = crypto.randomUUID();
    const res = await POST(postRequest(companyId, "}{ not json"), paramsFor(companyId));
    expect(res.status).toBe(400);
    expect(createVerifiedPublicReservationMock).not.toHaveBeenCalled();
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
    expect(createVerifiedPublicReservationMock).not.toHaveBeenCalled();
  });

  it("maps verification_failed to 422 (oracle-unified code failure)", async () => {
    createVerifiedPublicReservationMock.mockResolvedValueOnce({
      ok: false,
      reason: "verification_failed",
    });
    const companyId = crypto.randomUUID();
    const res = await POST(postRequest(companyId, validBody()), paramsFor(companyId));
    expect(res.status).toBe(422);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "verification_failed" });
  });

  it("maps boundary reasons (work_menu_not_found) to 404", async () => {
    createVerifiedPublicReservationMock.mockResolvedValueOnce({
      ok: false,
      reason: "work_menu_not_found",
    });
    const companyId = crypto.randomUUID();
    const res = await POST(postRequest(companyId, validBody()), paramsFor(companyId));
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "work_menu_not_found" });
  });

  it("maps availability/double-book reasons to 409", async () => {
    for (const reason of ["duration_mismatch", "too_soon", "slot_unavailable"] as const) {
      createVerifiedPublicReservationMock.mockResolvedValueOnce({ ok: false, reason });
      const companyId = crypto.randomUUID();
      const res = await POST(postRequest(companyId, validBody()), paramsFor(companyId));
      expect(res.status).toBe(409);
      await expect(res.json()).resolves.toEqual({ ok: false, reason });
    }
  });

  it("maps status_not_seeded to 500", async () => {
    createVerifiedPublicReservationMock.mockResolvedValueOnce({
      ok: false,
      reason: "status_not_seeded",
    });
    const companyId = crypto.randomUUID();
    const res = await POST(postRequest(companyId, validBody()), paramsFor(companyId));
    expect(res.status).toBe(500);
  });
});

describe("POST /r/reserve/[companyId]/verification-code (A.32b issue)", () => {
  it("returns 200 and forwards companyId + email to the service", async () => {
    requestReservationVerificationCodeMock.mockResolvedValueOnce({ ok: true, outboxId: "ob-1" });
    const companyId = crypto.randomUUID();

    const res = await VERIFICATION_POST(
      verificationRequest(companyId, validVerificationBody("Taro@Example.test")),
      paramsFor(companyId),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(requestReservationVerificationCodeMock).toHaveBeenCalledTimes(1);
    // route は service へ companyId + email のみ転送する (turnstileToken は route 層で消費)。
    expect(requestReservationVerificationCodeMock).toHaveBeenCalledWith({
      companyId,
      email: "Taro@Example.test",
    });
    expect(verifyTurnstileTokenMock).toHaveBeenCalledTimes(1);
  });

  it("returns a generic 200 even when issue is rate_limited (no issue-state leak)", async () => {
    requestReservationVerificationCodeMock.mockResolvedValueOnce({
      ok: false,
      reason: "rate_limited",
    });
    const companyId = crypto.randomUUID();
    const res = await VERIFICATION_POST(
      verificationRequest(companyId, validVerificationBody()),
      paramsFor(companyId),
    );
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ ok: true });
    expect(requestReservationVerificationCodeMock).toHaveBeenCalledTimes(1);
  });

  it("maps a service company_not_found result to 404 (not a 500/200 oracle)", async () => {
    requestReservationVerificationCodeMock.mockResolvedValueOnce({
      ok: false,
      reason: "company_not_found",
    });
    const companyId = crypto.randomUUID();
    const res = await VERIFICATION_POST(
      verificationRequest(companyId, validVerificationBody()),
      paramsFor(companyId),
    );
    expect(res.status).toBe(404);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "company_not_found" });
  });

  it("returns 404 and does not call the service for a malformed companyId", async () => {
    const res = await VERIFICATION_POST(
      verificationRequest("not-a-uuid", { email: "taro@example.test" }),
      paramsFor("not-a-uuid"),
    );
    expect(res.status).toBe(404);
    expect(requestReservationVerificationCodeMock).not.toHaveBeenCalled();
  });

  it("returns 400 and does not call the service for an invalid email", async () => {
    const companyId = crypto.randomUUID();
    const res = await VERIFICATION_POST(
      verificationRequest(companyId, { email: "not-an-email", turnstileToken: "tok-valid" }),
      paramsFor(companyId),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "invalid_body" });
    expect(requestReservationVerificationCodeMock).not.toHaveBeenCalled();
  });

  it("returns 400 for a non-JSON body", async () => {
    const companyId = crypto.randomUUID();
    const res = await VERIFICATION_POST(
      verificationRequest(companyId, "}{ not json"),
      paramsFor(companyId),
    );
    expect(res.status).toBe(400);
    expect(requestReservationVerificationCodeMock).not.toHaveBeenCalled();
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

// ---------------------------------------------------------------------------
// A.33: 多層防御 (rate limit + Turnstile) の route 層配線。
// ---------------------------------------------------------------------------
describe("A.33 公開 surface 多層防御 (rate limit + Turnstile)", () => {
  function slotsRequest(companyId: string): Request {
    const storeId = crypto.randomUUID();
    const workMenuId = crypto.randomUUID();
    return new Request(
      `http://localhost/r/reserve/${companyId}/slots?storeId=${storeId}&workMenuId=${workMenuId}&date=2026-07-15`,
      { headers: { "x-forwarded-for": "203.0.113.9" } },
    );
  }
  function menusRequest(companyId: string): Request {
    return new Request(
      `http://localhost/r/reserve/${companyId}/menus?storeId=${crypto.randomUUID()}`,
      { headers: { "x-forwarded-for": "203.0.113.9" } },
    );
  }

  it("verification-code: rate limit を最前段で適用し 429 + retry-after、Turnstile/service は呼ばない", async () => {
    enforcePublicReservationRateLimitMock.mockResolvedValueOnce({
      ok: false,
      retryAfterSeconds: 42,
    });
    const companyId = crypto.randomUUID();
    const res = await VERIFICATION_POST(
      verificationRequest(companyId, validVerificationBody()),
      paramsFor(companyId),
    );
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "rate_limited" });
    expect(res.headers.get("retry-after")).toBe("42");
    // rate limit が最前段 = Turnstile も service も呼ばれない (順序不変条件)。
    expect(verifyTurnstileTokenMock).not.toHaveBeenCalled();
    expect(requestReservationVerificationCodeMock).not.toHaveBeenCalled();
  });

  it("verification-code: Turnstile 失敗で 403 turnstile_failed、service は呼ばない", async () => {
    verifyTurnstileTokenMock.mockResolvedValueOnce({
      success: false,
      errorCodes: ["invalid-input-response"],
    });
    const companyId = crypto.randomUUID();
    const res = await VERIFICATION_POST(
      verificationRequest(companyId, validVerificationBody()),
      paramsFor(companyId),
    );
    expect(res.status).toBe(403);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "turnstile_failed" });
    // Turnstile は company lookup より前 = service は呼ばれない (oracle 非漏洩 + 順序不変条件)。
    expect(requestReservationVerificationCodeMock).not.toHaveBeenCalled();
  });

  it("verification-code: Turnstile に client IP を渡す", async () => {
    const companyId = crypto.randomUUID();
    await VERIFICATION_POST(
      verificationRequest(companyId, validVerificationBody()),
      paramsFor(companyId),
    );
    expect(verifyTurnstileTokenMock).toHaveBeenCalledWith("tok-valid", "203.0.113.9");
  });

  it("verification-code: turnstileToken 欠落は 400 invalid_body (Turnstile/service 未呼出)", async () => {
    const companyId = crypto.randomUUID();
    const res = await VERIFICATION_POST(
      verificationRequest(companyId, { email: "taro@example.test" }),
      paramsFor(companyId),
    );
    expect(res.status).toBe(400);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "invalid_body" });
    expect(verifyTurnstileTokenMock).not.toHaveBeenCalled();
    expect(requestReservationVerificationCodeMock).not.toHaveBeenCalled();
  });

  it("reservations: rate limit 超過で 429 + retry-after、service は呼ばない (Turnstile なし)", async () => {
    enforcePublicReservationRateLimitMock.mockResolvedValueOnce({
      ok: false,
      retryAfterSeconds: 30,
    });
    const companyId = crypto.randomUUID();
    const res = await POST(postRequest(companyId, validBody()), paramsFor(companyId));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "rate_limited" });
    expect(res.headers.get("retry-after")).toBe("30");
    expect(createVerifiedPublicReservationMock).not.toHaveBeenCalled();
    // reservations に Turnstile は付けない。
    expect(verifyTurnstileTokenMock).not.toHaveBeenCalled();
  });

  it("slots(GET): rate limit 超過で 429、service は呼ばない", async () => {
    enforcePublicReservationRateLimitMock.mockResolvedValueOnce({
      ok: false,
      retryAfterSeconds: 5,
    });
    const companyId = crypto.randomUUID();
    const res = await SLOTS_GET(slotsRequest(companyId), paramsFor(companyId));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "rate_limited" });
    expect(listAvailableSlotsForStoreMenuMock).not.toHaveBeenCalled();
  });

  it("menus(GET): rate limit 超過で 429、service は呼ばない", async () => {
    enforcePublicReservationRateLimitMock.mockResolvedValueOnce({
      ok: false,
      retryAfterSeconds: 5,
    });
    const companyId = crypto.randomUUID();
    const res = await GET(menusRequest(companyId), paramsFor(companyId));
    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ ok: false, reason: "rate_limited" });
    expect(listPublicWorkMenusMock).not.toHaveBeenCalled();
  });

  it("各 route は rate limit を正しい route キーで呼ぶ", async () => {
    const companyId = crypto.randomUUID();
    await VERIFICATION_POST(
      verificationRequest(companyId, validVerificationBody()),
      paramsFor(companyId),
    );
    await POST(postRequest(companyId, validBody()), paramsFor(companyId));
    await SLOTS_GET(slotsRequest(companyId), paramsFor(companyId));
    await GET(menusRequest(companyId), paramsFor(companyId));
    const routeKeys = enforcePublicReservationRateLimitMock.mock.calls.map((c) => c[1]);
    expect(routeKeys).toEqual(["vcode", "create", "slots", "menus"]);
  });
});
