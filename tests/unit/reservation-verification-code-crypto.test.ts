import { describe, expect, it } from "vitest";
import {
  generateNumericCode,
  hashCode,
  normalizeEmail,
  PEPPER_MIN_LENGTH,
  RESERVATION_VERIFICATION_CODE_LENGTH,
  resolvePepper,
  timingSafeEqualHex,
} from "@/lib/services/reservation-verification-code-crypto";

const PEPPER = "test-pepper-0123456789abcdef"; // >= PEPPER_MIN_LENGTH
const COMPANY = "11111111-1111-1111-1111-111111111111";
const OTHER_COMPANY = "22222222-2222-2222-2222-222222222222";

describe("normalizeEmail", () => {
  it("trims and lowercases", () => {
    expect(normalizeEmail("  User@Example.COM  ")).toBe("user@example.com");
  });
  it("is idempotent", () => {
    const once = normalizeEmail("A@B.C");
    expect(normalizeEmail(once)).toBe(once);
  });
});

describe("generateNumericCode", () => {
  it("always returns exactly N digits (default 6), zero-padded, numeric", () => {
    for (let i = 0; i < 1000; i++) {
      const code = generateNumericCode();
      expect(code).toMatch(/^\d{6}$/);
      expect(code.length).toBe(RESERVATION_VERIFICATION_CODE_LENGTH);
    }
  });

  it("respects a custom length and can emit leading-zero values", () => {
    for (let i = 0; i < 200; i++) {
      expect(generateNumericCode(4)).toMatch(/^\d{4}$/);
    }
  });

  it("produces a varied distribution (not a constant)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(generateNumericCode());
    // 200 draws from 10^6 should be essentially all distinct; require strong variety.
    expect(seen.size).toBeGreaterThan(150);
  });

  it("throws on invalid length", () => {
    expect(() => generateNumericCode(0)).toThrow();
    expect(() => generateNumericCode(13)).toThrow();
    expect(() => generateNumericCode(1.5)).toThrow();
  });
});

describe("hashCode (HMAC-SHA256 with pepper, email/company folded in)", () => {
  const base = { companyId: COMPANY, email: "user@example.com", code: "123456", pepper: PEPPER };

  it("is deterministic and 64 hex chars", () => {
    const h1 = hashCode(base);
    const h2 = hashCode(base);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs when the code differs", () => {
    expect(hashCode(base)).not.toBe(hashCode({ ...base, code: "123457" }));
  });

  it("binds to email: different email -> different hash (email binding)", () => {
    expect(hashCode(base)).not.toBe(hashCode({ ...base, email: "other@example.com" }));
  });

  it("binds to company: different companyId -> different hash (cross-tenant)", () => {
    expect(hashCode(base)).not.toBe(hashCode({ ...base, companyId: OTHER_COMPANY }));
  });

  it("depends on the pepper: different pepper -> different hash", () => {
    expect(hashCode(base)).not.toBe(hashCode({ ...base, pepper: PEPPER + "x" }));
  });

  it("normalizes email internally (case/space insensitive)", () => {
    expect(hashCode(base)).toBe(hashCode({ ...base, email: "  USER@Example.com " }));
  });
});

describe("timingSafeEqualHex", () => {
  it("returns true for identical strings", () => {
    expect(timingSafeEqualHex("deadbeef", "deadbeef")).toBe(true);
  });
  it("returns false for different same-length strings", () => {
    expect(timingSafeEqualHex("deadbeef", "deadbee0")).toBe(false);
  });
  it("returns false (no throw) for length mismatch", () => {
    expect(timingSafeEqualHex("deadbeef", "dead")).toBe(false);
    expect(timingSafeEqualHex("", "a")).toBe(false);
  });
});

describe("resolvePepper", () => {
  it("uses the override when provided", () => {
    expect(resolvePepper(PEPPER)).toBe(PEPPER);
  });
  it("throws when missing", () => {
    const prev = process.env.RESERVATION_VERIFICATION_CODE_PEPPER;
    delete process.env.RESERVATION_VERIFICATION_CODE_PEPPER;
    try {
      expect(() => resolvePepper()).toThrow();
    } finally {
      if (prev !== undefined) process.env.RESERVATION_VERIFICATION_CODE_PEPPER = prev;
    }
  });
  it("throws when too short", () => {
    expect(() => resolvePepper("x".repeat(PEPPER_MIN_LENGTH - 1))).toThrow();
  });
  it("accepts exactly the minimum length", () => {
    expect(resolvePepper("y".repeat(PEPPER_MIN_LENGTH))).toBe("y".repeat(PEPPER_MIN_LENGTH));
  });
});
