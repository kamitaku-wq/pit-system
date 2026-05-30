import { describe, it, expect } from "vitest";
import {
  buildVendorRequestEmail,
  escapeHtml,
  formatDateTimeJa,
  MOVEMENT_TYPE_LABELS,
  type VendorRequestEmailData,
} from "@/lib/notifications/vendor-emails";

const base: VendorRequestEmailData = {
  vendorName: "テスト回送",
  orderNumber: "TO-123",
  movementType: "one_way",
  portalUrl: "https://app.example.com/vendor/requests",
};

describe("buildVendorRequestEmail", () => {
  it("produces non-empty subject/html/text (dispatcher reads these keys)", () => {
    const out = buildVendorRequestEmail(base);
    expect(out.subject.length).toBeGreaterThan(0);
    expect(out.html.length).toBeGreaterThan(0);
    expect(out.text.length).toBeGreaterThan(0);
    // dispatcher が読む payload key と一致することを構造で固定 (将来の drift を fail させる)。
    expect(Object.keys(out).sort()).toEqual(["html", "subject", "text"]);
  });

  it("includes core fields and the movement-type label, not the raw enum", () => {
    const out = buildVendorRequestEmail({ ...base, movementType: "round_trip" });
    expect(out.html).toContain("TO-123");
    expect(out.html).toContain("テスト回送");
    expect(out.html).toContain(MOVEMENT_TYPE_LABELS.round_trip); // 往復
    expect(out.html).not.toContain("round_trip");
    expect(out.html).toContain("https://app.example.com/vendor/requests");
    expect(out.text).toContain("https://app.example.com/vendor/requests");
  });

  it("escapes HTML in admin-entered values (injection防止)", () => {
    const out = buildVendorRequestEmail({
      ...base,
      vendorName: "<script>alert(1)</script>",
      notes: "A & B <img src=x>",
    });
    expect(out.html).not.toContain("<script>");
    expect(out.html).toContain("&lt;script&gt;");
    expect(out.html).toContain("A &amp; B");
  });

  it("omits empty optional rows and includes provided ones", () => {
    const withStores = buildVendorRequestEmail({
      ...base,
      pickupStoreName: "渋谷店",
      deliveryStoreName: "横浜整備工場",
      vehicleLabel: "トヨタ プリウス",
    });
    expect(withStores.html).toContain("渋谷店");
    expect(withStores.html).toContain("横浜整備工場");
    expect(withStores.html).toContain("引取店舗");
    // 未指定の返却店舗ラベルは出さない
    expect(withStores.html).not.toContain("返却店舗");
  });

  it("renders canDrive=false as レッカー要", () => {
    const out = buildVendorRequestEmail({ ...base, canDrive: false });
    expect(out.html).toContain("レッカー要");
  });
});

describe("escapeHtml / formatDateTimeJa", () => {
  it("escapes the 5 sensitive chars", () => {
    expect(escapeHtml(`<>&"'`)).toBe("&lt;&gt;&amp;&quot;&#39;");
  });

  it("formats a Date in JST and returns null for nullish", () => {
    const s = formatDateTimeJa(new Date("2026-06-01T00:30:00Z")); // 09:30 JST
    expect(s).toContain("09:30");
    expect(formatDateTimeJa(null)).toBeNull();
    expect(formatDateTimeJa(undefined)).toBeNull();
  });
});
