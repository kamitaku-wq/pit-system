import { describe, expect, it } from "vitest";
import {
  isEmailDomainAllowed,
  normalizeAllowedDomains,
  normalizeEmailDomain,
} from "@/lib/auth/email-domain";

// Phase 66: 社内 Google ログインの許可ドメイン判定。攻撃ケース (サブドメイン/前方一致詐称) と
// fail-closed (許可リスト空 = 全拒否) を重点的に固める。判定が緩いと無関係 Google で入口が開く。

describe("normalizeEmailDomain", () => {
  it("最後の @ 以降を小文字で返す", () => {
    expect(normalizeEmailDomain("Taro@Kaisha.Co.Jp")).toBe("kaisha.co.jp");
    expect(normalizeEmailDomain("  user@kaisha.co.jp  ")).toBe("kaisha.co.jp");
  });

  it("不正な形は null", () => {
    expect(normalizeEmailDomain(null)).toBeNull();
    expect(normalizeEmailDomain(undefined)).toBeNull();
    expect(normalizeEmailDomain("")).toBeNull();
    expect(normalizeEmailDomain("no-at-sign")).toBeNull();
    expect(normalizeEmailDomain("user@")).toBeNull();
    expect(normalizeEmailDomain("user@localhost")).toBeNull(); // ドットなし = 不正扱い
    expect(normalizeEmailDomain("user@dom ain.com")).toBeNull(); // 空白混入
  });

  it("複数 @ は最後の @ 以降を採用", () => {
    expect(normalizeEmailDomain("a@b@kaisha.co.jp")).toBe("kaisha.co.jp");
  });
});

describe("normalizeAllowedDomains", () => {
  it("小文字化・trim・@ 先頭除去・空要素除去", () => {
    expect(normalizeAllowedDomains([" @Kaisha.co.jp ", "", "B.CO.JP"])).toEqual([
      "kaisha.co.jp",
      "b.co.jp",
    ]);
  });
});

describe("isEmailDomainAllowed (セキュリティ核)", () => {
  const allowed = ["kaisha.co.jp"];

  it("厳密一致は許可", () => {
    expect(isEmailDomainAllowed("taro@kaisha.co.jp", allowed)).toBe(true);
    expect(isEmailDomainAllowed("TARO@KAISHA.CO.JP", allowed)).toBe(true);
  });

  it("サブドメイン詐称を拒否 (x@kaisha.co.jp.evil.com)", () => {
    expect(isEmailDomainAllowed("x@kaisha.co.jp.evil.com", allowed)).toBe(false);
  });

  it("前方一致詐称を拒否 (x@evil-kaisha.co.jp)", () => {
    expect(isEmailDomainAllowed("x@evil-kaisha.co.jp", allowed)).toBe(false);
  });

  it("サブドメイン (x@mail.kaisha.co.jp) は厳密一致でないので拒否", () => {
    expect(isEmailDomainAllowed("x@mail.kaisha.co.jp", allowed)).toBe(false);
  });

  it("別ドメインを拒否", () => {
    expect(isEmailDomainAllowed("x@gmail.com", allowed)).toBe(false);
  });

  it("許可リストが空なら全拒否 (fail-closed)", () => {
    expect(isEmailDomainAllowed("taro@kaisha.co.jp", [])).toBe(false);
  });

  it("不正な email は拒否", () => {
    expect(isEmailDomainAllowed(null, allowed)).toBe(false);
    expect(isEmailDomainAllowed("no-at", allowed)).toBe(false);
  });

  it("複数許可ドメインのいずれかに厳密一致すれば許可", () => {
    const multi = ["kaisha.co.jp", "kaisha-kansai.co.jp"];
    expect(isEmailDomainAllowed("a@kaisha-kansai.co.jp", multi)).toBe(true);
    expect(isEmailDomainAllowed("a@other.co.jp", multi)).toBe(false);
  });
});
