// Phase 64-A.33: 公開予約 surface (GET slots/menus + POST reservations/verification-code) の
// IP/global レート制限 policy + route helper。
// ---------------------------------------------------------------------------
//
// route はこの `enforcePublicReservationRateLimit` を最前段で呼び、!ok なら 429 を返す (全リクエストを
// カウント = scanner も throttle、cheap-local DB write を outbound Cloudflare 検証より先に評価)。
//
// per-IP と global の 2 段:
//   - per-IP: 単一 IP の濫用を上限化。
//   - global: 分散 (多 IP) flood の backstop。Resend コスト等の総量に上限を設ける circuit breaker。
//
// global は **per-IP を通過したリクエストのみ** カウントする (重要):
//   per-IP で既に弾かれた濫用を global に積むと、単一 IP の flood が global を飽和させ全 IP を
//   ロックアウトする「防御の自爆」になる。per-IP 通過後のみ global を進めることで、単一 IP は per-IP で
//   止まり global を汚さず、分散 flood (各 IP は per-IP 以下) のみが global に蓄積して捕捉される。

import { checkRateLimit, type CheckRateLimitOptions } from "@/lib/rate-limit/rate-limiter";

export type PublicReservationRoute = "vcode" | "create" | "slots" | "menus";

interface RateLimitPolicy {
  // bucket_key の prefix (用途分離)。
  prefix: string;
  perIp: { limit: number; windowSeconds: number };
  global: { limit: number; windowSeconds: number };
}

// MVP の防御的初期値。tunable (本番トラフィック観測後に調整)。
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
  // GET 空き枠検索。scraping 緩和の緩め throttle。
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

// x-forwarded-for の左端を client IP として使う (既存 reservations route 踏襲)。
// Vercel は edge で XFF を上書きするため左端 = 実 client IP。spoof しても global rate が backstop。
// 取得不能時は "unknown" の共有 bucket に集約する (fail-safe: 制限する側へ倒す)。
export function getClientIp(request: Request): string {
  const xff = request.headers.get("x-forwarded-for");
  const first = xff?.split(",")[0]?.trim();
  return first && first.length > 0 ? first : "unknown";
}

export type EnforceRateLimitResult = { ok: true } | { ok: false; retryAfterSeconds: number };

/**
 * 公開予約 route のレート制限を適用する。per-IP → global の順にカウントし、
 * どちらかが上限超過なら ok:false を返す (global は per-IP 通過後のみカウント)。
 */
export async function enforcePublicReservationRateLimit(
  request: Request,
  route: PublicReservationRoute,
  options: CheckRateLimitOptions = {},
): Promise<EnforceRateLimitResult> {
  const policy = PUBLIC_RATE_LIMITS[route];
  const ip = getClientIp(request);

  const perIp = await checkRateLimit(
    `${policy.prefix}:ip:${ip}`,
    policy.perIp.limit,
    policy.perIp.windowSeconds,
    options,
  );
  if (!perIp.allowed) {
    return { ok: false, retryAfterSeconds: perIp.retryAfterSeconds };
  }

  const global = await checkRateLimit(
    `${policy.prefix}:global`,
    policy.global.limit,
    policy.global.windowSeconds,
    options,
  );
  if (!global.allowed) {
    return { ok: false, retryAfterSeconds: global.retryAfterSeconds };
  }

  return { ok: true };
}

// 429 レスポンス用の Retry-After ヘッダ秒数を文字列化するヘルパ (route で使う)。
export function retryAfterHeader(retryAfterSeconds: number): Record<string, string> {
  return { "retry-after": String(retryAfterSeconds) };
}
