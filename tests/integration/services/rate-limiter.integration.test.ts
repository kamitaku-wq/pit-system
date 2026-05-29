// Phase 64-A.33: pg 固定窓レート制限 (rate_limit_counters) の integration tests。
// ---------------------------------------------------------------------------
// checkRateLimit の原子性 (並行 increment が 1..N に確定する) / 窓ロールオーバ / limit 判定と、
// enforcePerIpRateLimit (per-IP キー) / enforceGlobalRateLimit (company 単位キー) のキー設計・limit を
// テーブル検査で実証する。「global は Turnstile 後にのみ呼ばれる」route 順序不変条件は
// tests/integration/app/verification-code-turnstile-global-ordering.integration.test.ts で固定する。

import { config } from "dotenv";
import { and, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import crypto from "node:crypto";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { rateLimitCounters } from "@/lib/db/schema/rate_limit_counters";
import { checkRateLimit } from "@/lib/rate-limit/rate-limiter";
import {
  enforceGlobalRateLimit,
  enforcePerIpRateLimit,
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

describeIntegration("enforcePerIpRateLimit / enforceGlobalRateLimit (A.33)", () => {
  const touchedRows: Array<{ key: string; windowStart: Date }> = [];

  afterAll(async () => {
    if (!db) return;
    for (const { key, windowStart } of touchedRows) {
      await db
        .delete(rateLimitCounters)
        .where(
          and(eq(rateLimitCounters.bucketKey, key), eq(rateLimitCounters.windowStart, windowStart)),
        );
    }
  });

  it("enforcePerIpRateLimit keys by rsv:<route>:ip:<ip> and blocks past the per-IP limit", async () => {
    if (!db) return;
    const policy = PUBLIC_RATE_LIMITS.vcode;
    const ip = `198.51.100.${1 + (Number.parseInt(crypto.randomUUID().slice(0, 2), 16) % 200)}`;
    const ipKey = `${policy.prefix}:ip:${ip}`;
    const now = uniqueNow();
    const ipWindow = windowStartFor(now, policy.perIp.windowSeconds);
    touchedRows.push({ key: ipKey, windowStart: ipWindow });

    const req = new Request("http://localhost/r/reserve/x/verification-code", {
      headers: { "x-real-ip": ip },
    });

    const calls = policy.perIp.limit + 1; // 上限 +1
    const outcomes: boolean[] = [];
    for (let i = 0; i < calls; i++) {
      outcomes.push((await enforcePerIpRateLimit(req, "vcode", { db, now })).ok);
    }
    expect(outcomes.slice(0, policy.perIp.limit).every((ok) => ok)).toBe(true);
    expect(outcomes[outcomes.length - 1]).toBe(false); // limit+1 件目は弾かれる

    const ipRow = await db
      .select({ count: rateLimitCounters.count })
      .from(rateLimitCounters)
      .where(
        and(eq(rateLimitCounters.bucketKey, ipKey), eq(rateLimitCounters.windowStart, ipWindow)),
      );
    expect(ipRow[0]?.count).toBe(calls); // 弾かれた分も increment される
  });

  it("enforceGlobalRateLimit keys per-company (rsv:<route>:global:<companyId>) — independent counters, no cross-tenant blast radius", async () => {
    if (!db) return;
    const policy = PUBLIC_RATE_LIMITS.vcode;
    const companyA = crypto.randomUUID();
    const companyB = crypto.randomUUID();
    const now = uniqueNow();
    const globalWindow = windowStartFor(now, policy.global.windowSeconds);
    const keyA = `${policy.prefix}:global:${companyA}`;
    const keyB = `${policy.prefix}:global:${companyB}`;
    touchedRows.push({ key: keyA, windowStart: globalWindow });
    touchedRows.push({ key: keyB, windowStart: globalWindow });

    // company A へ 3 回、company B へ 1 回。別キー = 独立にカウントされ、A のトラフィックは B を汚さない
    // (cross-tenant blast radius の排除。limit 超過の block 挙動は checkRateLimit / per-IP テストで既出)。
    for (let i = 0; i < 3; i++) {
      expect((await enforceGlobalRateLimit("vcode", companyA, { db, now })).ok).toBe(true);
    }
    expect((await enforceGlobalRateLimit("vcode", companyB, { db, now })).ok).toBe(true);

    const countFor = async (key: string): Promise<number | undefined> => {
      const rows = await db
        .select({ count: rateLimitCounters.count })
        .from(rateLimitCounters)
        .where(
          and(
            eq(rateLimitCounters.bucketKey, key),
            eq(rateLimitCounters.windowStart, globalWindow),
          ),
        );
      return rows[0]?.count;
    };
    expect(await countFor(keyA)).toBe(3);
    expect(await countFor(keyB)).toBe(1);
  });
});
