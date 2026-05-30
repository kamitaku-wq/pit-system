import { describe, it, expect } from "vitest";
import {
  resolveStatusColor,
  statusBadgeStyle,
  isHexColor,
  NEUTRAL_STATUS_COLOR,
} from "@/lib/statuses/status-color";

describe("status-color", () => {
  it("prefers a valid DB hex color over key defaults", () => {
    expect(resolveStatusColor({ color: "#123abc", key: "confirmed" })).toBe("#123abc");
  });

  it("falls back to key default when color is null/invalid", () => {
    expect(resolveStatusColor({ color: null, key: "confirmed" })).toBe("#16a34a");
    expect(resolveStatusColor({ color: "blue", key: "pending" })).toBe("#d97706");
    expect(resolveStatusColor({ key: "in_progress" })).toBe("#2563eb");
  });

  it("is case-insensitive on key and neutral for unknown/empty", () => {
    expect(resolveStatusColor({ key: "CONFIRMED" })).toBe("#16a34a");
    expect(resolveStatusColor({ key: "weird_key" })).toBe(NEUTRAL_STATUS_COLOR);
    expect(resolveStatusColor({})).toBe(NEUTRAL_STATUS_COLOR);
  });

  it("validates hex format", () => {
    expect(isHexColor("#abcabc")).toBe(true);
    expect(isHexColor("#xyz")).toBe(false);
    expect(isHexColor(null)).toBe(false);
  });

  it("derives badge style with alpha bg/border from base", () => {
    const s = statusBadgeStyle({ key: "confirmed" });
    expect(s.color).toBe("#16a34a");
    expect(s.backgroundColor).toBe("#16a34a1a");
    expect(s.borderColor).toBe("#16a34a33");
  });
});
