// Phase 64-A.31b: 顧客公開予約フロー step2 作業メニュー一覧の GET エンドポイント (薄い shim)。
// ---------------------------------------------------------------------------
//
// GET /r/reserve/[companyId]/menus?storeId=
//   → { ok: true, menus: [{ id, name, durationMinutes, priceMinor }] }
//
// GET-safe (純 read / INSERT・UPDATE・audit ゼロ) — RFC 7231 GET safe 準拠 (A.23/A.31a 規律踏襲)。
//
// テナント境界: path の companyId が唯一の company scope。listPublicWorkMenus が companyId と
//   store/menu/lane の company_id 一致 + visible_to_customers + lane 提供可能性を検証する。
//   公開一覧は visible_to_customers=true かつ「その店舗の active lane が提供できる」メニューのみ。
//
// 露出制約 (A.33 で解消): GET 公開 surface も A.33 (Turnstile + rate 制限) まで production 露出禁止だった。
//   本 route には IP/global rate limit を最前段に配線する (GET のため Turnstile は付けない)。

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  enforceGlobalRateLimit,
  enforcePerIpRateLimit,
  retryAfterHeader,
} from "@/lib/rate-limit/public-reservation-rate-limit";
import { listPublicWorkMenus } from "@/lib/services/customer-reservation-public";

export const dynamic = "force-dynamic";

const querySchema = z.object({
  storeId: z.string().uuid(),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ companyId: string }> },
): Promise<NextResponse> {
  // 1) per-IP rate limit (GET の scraping 緩和、cross-company で IP の総量を縛る)。
  const perIp = await enforcePerIpRateLimit(request, "menus");
  if (!perIp.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited" },
      { status: 429, headers: retryAfterHeader(perIp.retryAfterSeconds) },
    );
  }

  const { companyId } = await context.params;

  // 2) companyId (path) も UUID を強制 (malformed は 404 = company 不在扱い)。
  if (!z.string().uuid().safeParse(companyId).success) {
    return NextResponse.json({ ok: false, reason: "company_not_found" }, { status: 404 });
  }

  // 3) global rate limit (company 単位)。GET のため Turnstile なし = IP 源の信頼性に依存 (seal prerequisite)。
  const global = await enforceGlobalRateLimit("menus", companyId);
  if (!global.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited" },
      { status: 429, headers: retryAfterHeader(global.retryAfterSeconds) },
    );
  }

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    storeId: url.searchParams.get("storeId") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid_query" }, { status: 400 });
  }

  const result = await listPublicWorkMenus(companyId, parsed.data.storeId);
  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 404 });
  }

  return NextResponse.json({ ok: true, menus: result.menus });
}
