// Phase 64-A.33 (敵対的レビュー HIGH fix の回帰テスト): verification-code route が
// **global rate limit を Turnstile 成功後にのみ評価する** ことを、実 rate-limiter + 実 DB で実証する。
// ---------------------------------------------------------------------------
// 塞いだ攻撃経路: Turnstile を解かない garbage リクエストで company の global バケットを枯渇させ
//   全正規ユーザーをロックアウトする「防御の自爆」。route 層テスト (customer-reservation-public-routes)
//   は enforce* を mock するため per-IP→Turnstile→global の **並び替えを検出できない**。本テストは
//   rate-limit モジュールを mock せず実カウンタを DB で検査して順序不変条件を固定する。
//
// 検証:
//   - Turnstile 失敗 (403): per-IP は increment される (最前段) が global は increment されない (Turnstile 後)。
//   - Turnstile 成功 (200): per-IP / global ともに increment される。
//   - global キーは company 単位 (rsv:vcode:global:<companyId>) = cross-tenant blast radius なし。

import { config } from "dotenv";
import { eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { rateLimitCounters } from "@/lib/db/schema/rate_limit_counters";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false, max: 2 }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || db === undefined);

const verifyTurnstileTokenMock = vi.fn();
const requestReservationVerificationCodeMock = vi.fn();

// integration-setup は @/lib/db/client の db を「throw する Proxy」に mock する (全 integration tests に
// 明示的 db 注入を強制する仕組み)。本テストは route 内部の serviceRoleDb 経由で **実 rate-limiter** を
// 走らせたいので、実 drizzle クライアントで上書きする (db が無い環境では describeIntegration が skip)。
vi.doMock("@/lib/db/client", () => ({ db }));
// turnstile と issue service のみ mock。rate-limit モジュールは **mock せず実カウンタを使う**。
vi.doMock("@/lib/services/turnstile", () => ({ verifyTurnstileToken: verifyTurnstileTokenMock }));
vi.doMock("@/lib/services/customer-reservation-verification", () => ({
  requestReservationVerificationCode: requestReservationVerificationCodeMock,
}));

const { POST: VERIFICATION_POST } =
  await import("@/app/r/reserve/[companyId]/verification-code/route");

describeIntegration("verification-code: global is gated behind Turnstile (A.33 HIGH fix)", () => {
  const touchedKeys = new Set<string>();

  beforeEach(() => {
    verifyTurnstileTokenMock.mockReset();
    requestReservationVerificationCodeMock.mockReset();
    requestReservationVerificationCodeMock.mockResolvedValue({ ok: true, outboxId: "ob" });
  });

  afterAll(async () => {
    if (!db) return;
    for (const k of touchedKeys) {
      await db.delete(rateLimitCounters).where(eq(rateLimitCounters.bucketKey, k));
    }
  });

  async function counterFor(bucketKey: string): Promise<number> {
    if (!db) return 0;
    const rows = await db
      .select({ count: rateLimitCounters.count })
      .from(rateLimitCounters)
      .where(eq(rateLimitCounters.bucketKey, bucketKey));
    // 一意キー = 現窓に高々 1 行。
    return rows.reduce((acc, r) => acc + r.count, 0);
  }

  function request(companyId: string, ip: string) {
    return new Request(`http://localhost/r/reserve/${companyId}/verification-code`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": ip },
      body: JSON.stringify({ email: "taro@example.test", turnstileToken: "tok" }),
    });
  }

  it("does NOT increment the per-company global counter when Turnstile fails (403)", async () => {
    verifyTurnstileTokenMock.mockResolvedValue({
      success: false,
      errorCodes: ["invalid-input-response"],
    });
    const companyId = crypto.randomUUID();
    const ip = `10.99.${1 + (Number.parseInt(crypto.randomUUID().slice(0, 2), 16) % 250)}.${1 + (Number.parseInt(crypto.randomUUID().slice(2, 4), 16) % 250)}`;
    const ipKey = `rsv:vcode:ip:${ip}`;
    const globalKey = `rsv:vcode:global:${companyId}`;
    touchedKeys.add(ipKey);
    touchedKeys.add(globalKey);

    const res = await VERIFICATION_POST(request(companyId, ip), {
      params: Promise.resolve({ companyId }),
    });
    expect(res.status).toBe(403);

    // per-IP は最前段で increment 済、global は Turnstile 失敗で **未** increment (= 攻撃経路が閉じている)。
    expect(await counterFor(ipKey)).toBe(1);
    expect(await counterFor(globalKey)).toBe(0);
    expect(requestReservationVerificationCodeMock).not.toHaveBeenCalled();
  });

  it("increments the per-company global counter only after Turnstile succeeds (200)", async () => {
    verifyTurnstileTokenMock.mockResolvedValue({ success: true, errorCodes: [] });
    const companyId = crypto.randomUUID();
    const ip = `10.98.${1 + (Number.parseInt(crypto.randomUUID().slice(0, 2), 16) % 250)}.${1 + (Number.parseInt(crypto.randomUUID().slice(2, 4), 16) % 250)}`;
    const ipKey = `rsv:vcode:ip:${ip}`;
    const globalKey = `rsv:vcode:global:${companyId}`;
    touchedKeys.add(ipKey);
    touchedKeys.add(globalKey);

    const res = await VERIFICATION_POST(request(companyId, ip), {
      params: Promise.resolve({ companyId }),
    });
    expect(res.status).toBe(200);

    expect(await counterFor(ipKey)).toBe(1);
    expect(await counterFor(globalKey)).toBe(1);
  });
});
