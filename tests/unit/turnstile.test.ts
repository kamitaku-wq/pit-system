// Phase 64-A.33: Turnstile 検証 service の logic を fetchImpl 注入で決定論的に検証する (network 非依存)。
// 実 Cloudflare 経路 (always-pass テストキー) は tests/integration/poc-11-turnstile.test.ts でカバー。

import { describe, expect, it, vi } from "vitest";
import { verifyTurnstileToken } from "@/lib/services/turnstile";

const SECRET = "test-secret";

function jsonResponse(data: unknown): Response {
  return { json: async () => data } as unknown as Response;
}

describe("verifyTurnstileToken (A.33)", () => {
  it("returns success on a success:true response", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ success: true })) as unknown as typeof fetch;
    const r = await verifyTurnstileToken("tok", null, { secret: SECRET, fetchImpl });
    expect(r).toEqual({ success: true, errorCodes: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("returns failure + error-codes on a success:false response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        success: false,
        "error-codes": ["invalid-input-response", "timeout-or-duplicate"],
      }),
    ) as unknown as typeof fetch;
    const r = await verifyTurnstileToken("tok", null, { secret: SECRET, fetchImpl });
    expect(r.success).toBe(false);
    expect(r.errorCodes).toEqual(["invalid-input-response", "timeout-or-duplicate"]);
  });

  it("returns failure without calling fetch when the token is empty", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await verifyTurnstileToken("", null, { secret: SECRET, fetchImpl });
    expect(r).toEqual({ success: false, errorCodes: ["missing-input-response"] });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("fails closed when fetch throws (Cloudflare unreachable)", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const r = await verifyTurnstileToken("tok", null, { secret: SECRET, fetchImpl });
    expect(r).toEqual({ success: false, errorCodes: ["internal-error"] });
  });

  it("fails closed on a malformed verify response", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ unexpected: true }),
    ) as unknown as typeof fetch;
    const r = await verifyTurnstileToken("tok", null, { secret: SECRET, fetchImpl });
    expect(r).toEqual({ success: false, errorCodes: ["bad-verify-response"] });
  });

  it("throws when the secret is not configured", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(verifyTurnstileToken("tok", null, { secret: "", fetchImpl })).rejects.toThrow(
      /TURNSTILE_SECRET_KEY/,
    );
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("passes a real remoteip to siteverify but omits 'unknown'", async () => {
    const bodies: string[] = [];
    const fetchImpl = vi.fn(async (_url: unknown, init: { body?: BodyInit }) => {
      bodies.push(String(init?.body ?? ""));
      return jsonResponse({ success: true });
    }) as unknown as typeof fetch;

    await verifyTurnstileToken("tok", "203.0.113.7", { secret: SECRET, fetchImpl });
    await verifyTurnstileToken("tok", "unknown", { secret: SECRET, fetchImpl });
    await verifyTurnstileToken("tok", null, { secret: SECRET, fetchImpl });

    expect(bodies[0]).toContain("remoteip=203.0.113.7");
    expect(bodies[1]).not.toContain("remoteip");
    expect(bodies[2]).not.toContain("remoteip");
  });
});
