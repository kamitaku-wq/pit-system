// Phase 64-A.33: pg 固定窓レート制限 (rate_limit_counters) の integration tests。
// ---------------------------------------------------------------------------
// checkRateLimit の原子性 (並行 increment が 1..N に確定する) / 窓ロールオーバ / limit 判定と、
// enforcePublicReservationRateLimit の「per-IP と global が独立」「global は per-IP 通過後のみカウント」
// 不変条件 (防御の自爆回避) をテーブル検査で実証する。

import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { rateLimitCounters } from "@/lib/db/schema/rate_limit_counters";
import { checkRateLimit } from "@/lib/rate-limit/rate-limiter";
import {
  enforcePublicReservationRateLimit,
  PUBLIC_RATE_LIMITS,
} from "@/lib/rate-limit/public-reservation-rate-limit";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const { default: postgres } = await import("postgres");
const databaseUrl = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
// max を低く保つ: 並行 increment テストが共有 pooler (session mode, pool_size 15) を枯渇させ、
// 並列実行中の他 integration テストを EMAXCONNSESSION で巻き添えにしないため (atomicity は 3-way race で実証可能)。
const queryClient = databaseUrl ? postgres(databaseUrl, { prepare: false, max: 3 }) : undefined;
const db = queryClient ? drizzle(queryClient) : undefined;
const describeIntegration = describe.skipIf(databaseUrl === undefined || db === undefined);

// 各 run で衝突しないよう、未来のランダムな日 (= 一意の窓) を基準時刻にする。
function uniqueNow(): Date {
  const base = Date.UTC(2030, 0, 1);
  const offsetDays = Math.floor(Number.parseInt(crypto.randomUUID().slice(0, 8), 16) % 100000);
  return new Date(base + offsetDays * 86_400_000);
}

function windowStartFor(now: Date, windowSeconds: number): Date {
  const ms = windowSeconds * 1000;
  return new Date(Math.floor(now.getTime() / ms) * ms);
}

describeIntegration("checkRateLimit (A.33 pg fixed-window)", () => {
  const createdKeys = new Set<string>();
  function key(label: string): string {
    const k = `test:rl:${label}:${crypto.randomUUID()}`;
    createdKeys.add(k);
    return k;
  }

  afterAll(async () => {
    if (!db) return;
    for (const k of createdKeys) {
      await db.delete(rateLimitCounters).where(eq(rateLimitCounters.bucketKey, k));
    }
  });

  it("increments atomically and flips allowed=false past the limit", async () => {
    const k = key("basic");
    const now = uniqueNow();
    const r1 = await checkRateLimit(k, 3, 60, { db, now });
    expect(r1).toMatchObject({ allowed: true, count: 1, remaining: 2 });
    const r2 = await checkRateLimit(k, 3, 60, { db, now });
    expect(r2).toMatchObject({ allowed: true, count: 2, remaining: 1 });
    const r3 = await checkRateLimit(k, 3, 60, { db, now });
    expect(r3).toMatchObject({ allowed: true, count: 3, remaining: 0 });
    const r4 = await checkRateLimit(k, 3, 60, { db, now });
    expect(r4.allowed).toBe(false);
    expect(r4.count).toBe(4);
    expect(r4.retryAfterSeconds).toBeGreaterThan(0);
    expect(r4.retryAfterSeconds).toBeLessThanOrEqual(60);
  });

  it("resets the count when the window rolls over", async () => {
    const k = key("window");
    const now1 = uniqueNow();
    const now2 = new Date(now1.getTime() + 60_000); // 次の 60s 窓
    expect((await checkRateLimit(k, 1, 60, { db, now: now1 })).allowed).toBe(true);
    expect((await checkRateLimit(k, 1, 60, { db, now: now1 })).allowed).toBe(false);
    const next = await checkRateLimit(k, 1, 60, { db, now: now2 });
    expect(next.allowed).toBe(true);
    expect(next.count).toBe(1); // 別窓 = 別 PK でリセット
  });

  it("is race-free under concurrency (counts are exactly 1..N)", async () => {
    const k = key("concurrent");
    const now = uniqueNow();
    const N = 25;
    const results = await Promise.all(
      Array.from({ length: N }, () => checkRateLimit(k, 1000, 60, { db, now })),
    );
    const counts = results.map((r) => r.count).sort((a, b) => a - b);
    expect(counts).toEqual(Array.from({ length: N }, (_, i) => i + 1));
  });
});

describeIntegration("enforcePublicReservationRateLimit (A.33 per-IP + global)", () => {
  const touchedIpKeys = new Set<string>();
  const touchedGlobalRows: Array<{ key: string; windowStart: Date }> = [];

  afterAll(async () => {
    if (!db) return;
    for (const k of touchedIpKeys) {
      await db.delete(rateLimitCounters).where(eq(rateLimitCounters.bucketKey, k));
    }
    for (const { key, windowStart } of touchedGlobalRows) {
      await db
        .delete(rateLimitCounters)
        .where(
          and(eq(rateLimitCounters.bucketKey, key), eq(rateLimitCounters.windowStart, windowStart)),
        );
    }
  });

  it("blocks past per-IP limit and only counts global for per-IP-passing requests", async () => {
    if (!db) return;
    const policy = PUBLIC_RATE_LIMITS.vcode;
    const ip = `198.51.100.${1 + (Number.parseInt(crypto.randomUUID().slice(0, 2), 16) % 200)}`;
    const ipKey = `${policy.prefix}:ip:${ip}`;
    const globalKey = `${policy.prefix}:global`;
    const now = uniqueNow();
    const ipWindow = windowStartFor(now, policy.perIp.windowSeconds);
    const globalWindow = windowStartFor(now, policy.global.windowSeconds);
    touchedIpKeys.add(ipKey);
    touchedGlobalRows.push({ key: globalKey, windowStart: globalWindow });

    const req = new Request("http://localhost/r/reserve/x/verification-code", {
      headers: { "x-forwarded-for": `${ip}, 10.0.0.1` },
    });

    const calls = policy.perIp.limit + 1; // 上限 +1
    const outcomes: boolean[] = [];
    for (let i = 0; i < calls; i++) {
      const r = await enforcePublicReservationRateLimit(req, "vcode", { db, now });
      outcomes.push(r.ok);
    }
    // 最初の limit 件は通過、最後の 1 件は per-IP で弾かれる。
    expect(outcomes.slice(0, policy.perIp.limit).every((ok) => ok)).toBe(true);
    expect(outcomes[outcomes.length - 1]).toBe(false);

    // per-IP は弾かれた分も含めて increment される。
    const ipRow = await db
      .select({ count: rateLimitCounters.count })
      .from(rateLimitCounters)
      .where(
        and(eq(rateLimitCounters.bucketKey, ipKey), eq(rateLimitCounters.windowStart, ipWindow)),
      );
    expect(ipRow[0]?.count).toBe(calls);

    // global は per-IP 通過後のみ = limit 件だけカウントされる (防御の自爆回避の不変条件)。
    const globalRow = await db
      .select({ count: rateLimitCounters.count })
      .from(rateLimitCounters)
      .where(
        and(
          eq(rateLimitCounters.bucketKey, globalKey),
          eq(rateLimitCounters.windowStart, globalWindow),
        ),
      );
    expect(globalRow[0]?.count).toBe(policy.perIp.limit);
  });
});
