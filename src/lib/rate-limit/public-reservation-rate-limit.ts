// Phase 64-A.33: 公開予約 surface (GET slots/menus + POST reservations/verification-code) の
// IP/global レート制限 policy + route helper。
// ---------------------------------------------------------------------------
//
// 2 段:
//   - per-IP: 単一 IP の濫用を上限化 (cross-company = その IP の総量を縛る)。安価なため最前段で評価。
//   - global: 分散 (多 IP) flood の backstop + コスト circuit breaker。**company 単位** にスコープし、
//     1 社へのトラフィックが他社を 429 にする cross-tenant blast radius を排除する (敵対的レビュー HIGH)。
//
// global を Turnstile の後ろで評価する (vcode):
//   global を Turnstile より前で increment すると、Turnstile を解かない garbage リクエストで company の
//   global を枯渇でき、その company の正規ユーザーを 10 分間ロックアウトできる (防御の自爆 = 敵対的レビュー
//   HIGH)。そこで vcode は per-IP を Turnstile 前に、global を Turnstile 成功後に評価する。route 側で
//   enforcePerIpRateLimit → (companyId 検証 → body → Turnstile) → enforceGlobalRateLimit の順に呼ぶ。
//   Turnstile を持たない route (create/slots/menus) は per-IP → companyId 検証 → global の順 (global は
//   IP 源の信頼性に依存する = 本番露出前に deployment の IP 信頼境界を要検証。seal prerequisite)。

import { checkRateLimit, type CheckRateLimitOptions } from "@/lib/rate-limit/rate-limiter";

export type PublicReservationRoute = "vcode" | "create" | "slots" | "menus";

interface RateLimitPolicy {
  // bucket_key の prefix (用途分離)。
  prefix: string;
  perIp: { limit: number; windowSeconds: number };
  global: { limit: number; windowSeconds: number };
}

// MVP の防御的初期値。tunable (本番トラフィック観測後に調整)。global は company 単位。
export const PUBLIC_RATE_LIMITS: Record<PublicReservationRoute, RateLimitPolicy> = {
  // email 送信 = Resend コストベクタ。最も厳しく。
  vcode: {
    prefix: "rsv:vcode",
    perIp: { limit: 5, windowSeconds: 600 },
    global: { limit: 100, windowSeconds: 600 },
  },
  // 予約確定。code ゲート済だが二重投稿/総当たり緩和。
  create: {
    prefix: "rsv:create",
    perIp: { limit: 10, windowSeconds: 600 },
    global: { limit: 200, windowSeconds: 600 },
  },
  // GET 空き枠検索。scraping 緩和の緩め throttle (1 分窓 = 自己回復が速い)。
  slots: {
    prefix: "rsv:slots",
    perIp: { limit: 60, windowSeconds: 60 },
    global: { limit: 600, windowSeconds: 60 },
  },
  menus: {
    prefix: "rsv:menus",
    perIp: { limit: 60, windowSeconds: 60 },
    global: { limit: 600, windowSeconds: 60 },
  },
};

// IPv6 最長 39 文字 + 余裕。長大な forged ヘッダ値が bucket_key (btree PK) を肥大化/超過させ、
// checkRateLimit の INSERT を 500 にするのを防ぐ。
const MAX_IP_KEY_LENGTH = 45;

// client IP を取得する。Vercel が edge で設定する x-real-ip を優先する (client から forward されず、
// プラットフォームが上書きするため leftmost x-forwarded-for より信頼できる)。x-real-ip が無い環境
// (local/test/別プロキシ) は x-forwarded-for 左端にフォールバックする。
//
// 注意 (seal prerequisite): leftmost x-forwarded-for は一般に client が偽装可能。non-Turnstile route
// (create/slots/menus) の per-company global の DoS 耐性は IP 源の信頼性に依存するため、本番 deployment の
// IP 信頼境界 (x-real-ip / @vercel/functions ipAddress の非偽装性) を本番露出前に検証すること。
// vcode は global を Turnstile 後で評価するため IP 偽装でも company A のロックアウトに Turnstile 100 回が要る。
export function getClientIp(request: Request): string {
  const realIp = request.headers.get("x-real-ip")?.trim();
  const xffFirst = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = realIp && realIp.length > 0 ? realIp : xffFirst;
  if (!ip || ip.length === 0) return "unknown";
  return ip.slice(0, MAX_IP_KEY_LENGTH);
}

export type EnforceRateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

// per-IP レート制限 (cross-company)。最前段で安価に flood を弾く。
export async function enforcePerIpRateLimit(
  request: Request,
  route: PublicReservationRoute,
  options: CheckRateLimitOptions = {},
): Promise<EnforceRateLimitResult> {
  const policy = PUBLIC_RATE_LIMITS[route];
  const ip = getClientIp(request);
  const r = await checkRateLimit(
    `${policy.prefix}:ip:${ip}`,
    policy.perIp.limit,
    policy.perIp.windowSeconds,
    options,
  );
  return r.allowed ? { ok: true } : { ok: false, retryAfterSeconds: r.retryAfterSeconds };
}

// global レート制限 (company 単位 = cross-tenant blast radius を排除)。vcode は Turnstile 成功後に呼ぶ。
export async function enforceGlobalRateLimit(
  route: PublicReservationRoute,
  companyId: string,
  options: CheckRateLimitOptions = {},
): Promise<EnforceRateLimitResult> {
  const policy = PUBLIC_RATE_LIMITS[route];
  const r = await checkRateLimit(
    `${policy.prefix}:global:${companyId}`,
    policy.global.limit,
    policy.global.windowSeconds,
    options,
  );
  return r.allowed ? { ok: true } : { ok: false, retryAfterSeconds: r.retryAfterSeconds };
}

// 429 レスポンス用の Retry-After ヘッダ秒数を文字列化するヘルパ (route で使う)。
export function retryAfterHeader(retryAfterSeconds: number): Record<string, string> {
  return { "retry-after": String(retryAfterSeconds) };
}
