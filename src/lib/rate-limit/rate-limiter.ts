// Phase 64-A.33: 汎用 固定窓 (fixed-window) レート制限カウンタ (多層防御 L2)。
// ---------------------------------------------------------------------------
//
// 薄い interface = この `checkRateLimit` 1 関数。pg 実装 (rate_limit_counters テーブル) を裏に置く。
// 将来 Upstash/Vercel KV へ差し替える場合、この関数のみ再実装すれば呼び出し側 (route helper) は無改修
// (storage 選定の de-risk = advisor 指摘)。
//
// 原子性 (不変条件): INSERT ... ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count を単一文で
//   実行し、read-then-write の race を排除する (A.32b Design A と同じ規律)。判定 (count <= limit) は
//   increment 後の値で行うため、並行リクエストでも上限を超えてカウントが進む = 確実に弾ける。
//
// 固定窓: window_start を now から window 境界へ truncate する。窓をまたぐと別 PK になり自動的に
//   カウントがリセットされる。境界付近のバースト (2 窓に跨る 2*limit) は固定窓の既知の緩さだが、
//   MVP の bot/DoS 緩和には十分。厳密さが要れば sliding window へ (この関数のみ差し替え)。

import { sql } from "drizzle-orm";
import { db as serviceRoleDb } from "@/lib/db/client";
import { rateLimitCounters } from "@/lib/db/schema/rate_limit_counters";

// drizzle は本プロジェクトに合う共通の DB/transaction interface を公開しないため any で受ける
// (customer-reservation-verification.ts と同型)。
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = any;

export interface RateLimitResult {
  // increment 後のカウントが limit 以下なら許可。
  allowed: boolean;
  // 現窓の increment 後カウント。
  count: number;
  // 残り許可数 (max(0, limit - count))。
  remaining: number;
  // 現窓がリセットされるまでの秒数 (Retry-After 用、最小 1)。
  retryAfterSeconds: number;
}

export interface CheckRateLimitOptions {
  db?: Db;
  now?: Date;
}

// window 境界へ truncate した Date を返す。
function windowStartFor(now: Date, windowMs: number): Date {
  return new Date(Math.floor(now.getTime() / windowMs) * windowMs);
}

/**
 * 固定窓レート制限。`key` の現窓カウントを atomic に +1 し、limit 以下なら allowed=true を返す。
 *
 * @param key          bucket キー (用途を prefix で分離: "rsv:vcode:ip:1.2.3.4" 等)
 * @param limit        窓あたりの許可回数 (>=1)
 * @param windowSeconds 窓の長さ (秒, >=1)
 */
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number,
  options: CheckRateLimitOptions = {},
): Promise<RateLimitResult> {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error(`checkRateLimit: limit must be a positive integer (got ${limit})`);
  }
  if (!Number.isInteger(windowSeconds) || windowSeconds < 1) {
    throw new Error(
      `checkRateLimit: windowSeconds must be a positive integer (got ${windowSeconds})`,
    );
  }

  const db: Db = options.db ?? serviceRoleDb;
  const now = options.now ?? new Date();
  const windowMs = windowSeconds * 1000;
  const windowStart = windowStartFor(now, windowMs);
  // 窓終了 + 1 窓分の余裕を持たせて purge を遅延させる (境界付近の判定に影響しない)。
  const expiresAt = new Date(windowStart.getTime() + windowMs * 2);

  // atomic upsert-increment。複合 PK (bucket_key, window_start) で衝突 → count+1。
  const rows = await db
    .insert(rateLimitCounters)
    .values({ bucketKey: key, windowStart, count: 1, expiresAt })
    .onConflictDoUpdate({
      target: [rateLimitCounters.bucketKey, rateLimitCounters.windowStart],
      set: { count: sql`${rateLimitCounters.count} + 1` },
    })
    .returning({ count: rateLimitCounters.count });

  const count = rows[0]?.count ?? 1;
  const allowed = count <= limit;
  const remaining = Math.max(0, limit - count);
  const msUntilReset = windowStart.getTime() + windowMs - now.getTime();
  const retryAfterSeconds = Math.max(1, Math.ceil(msUntilReset / 1000));

  return { allowed, count, remaining, retryAfterSeconds };
}
