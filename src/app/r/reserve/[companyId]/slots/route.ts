// Phase 64-A.31a: 顧客公開予約フロー step3 空き枠 picker の GET エンドポイント。
// ---------------------------------------------------------------------------
//
// GET /r/reserve/[companyId]/slots?storeId=&workMenuId=&date=YYYY-MM-DD
//   → { ok: true, slots: [{ startAt, endAt, laneId }] }
//
// GET-safe (純 read / INSERT・UPDATE・audit ゼロ) — RFC 7231 GET safe 準拠 (A.23 規律踏襲)。
//   unfurl / prefetch / scanner が叩いても副作用なし。
//
// テナント境界: path の companyId が唯一の company scope。listAvailableSlotsForStoreMenu が
//   companyId と store/menu/lane の company_id 一致を検証する (URL 改竄防御)。
//
// A.31b でこの slots を消費する multi-step UI と、返ってきた {startAt,endAt,laneId} を
//   そのまま gate (checkReservationSlotAvailable) → createCustomerReservation に渡す
//   POST route を実装する (gate→create 同一パラメータ invariant)。

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  enforcePublicReservationRateLimit,
  retryAfterHeader,
} from "@/lib/rate-limit/public-reservation-rate-limit";
import { listAvailableSlotsForStoreMenu } from "@/lib/services/customer-reservation-public";

export const dynamic = "force-dynamic";

// query param 検証 (公開入力のため malformed は 400 で弾く)。
const querySchema = z.object({
  storeId: z.string().uuid(),
  workMenuId: z.string().uuid(),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "date must be YYYY-MM-DD"),
});

export async function GET(
  request: Request,
  context: { params: Promise<{ companyId: string }> },
): Promise<NextResponse> {
  // rate limit を最前段で適用 (GET の scraping 緩和、IP + global の緩め throttle)。
  const limited = await enforcePublicReservationRateLimit(request, "slots");
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited" },
      { status: 429, headers: retryAfterHeader(limited.retryAfterSeconds) },
    );
  }

  const { companyId } = await context.params;
  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    storeId: url.searchParams.get("storeId") ?? undefined,
    workMenuId: url.searchParams.get("workMenuId") ?? undefined,
    date: url.searchParams.get("date") ?? undefined,
  });
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid_query" }, { status: 400 });
  }

  // companyId (path) も UUID を強制 (malformed は 404 = company 不在扱い)。
  if (!z.string().uuid().safeParse(companyId).success) {
    return NextResponse.json({ ok: false, reason: "company_not_found" }, { status: 404 });
  }

  const result = await listAvailableSlotsForStoreMenu({
    companyId,
    storeId: parsed.data.storeId,
    workMenuId: parsed.data.workMenuId,
    date: parsed.data.date,
  });

  if (!result.ok) {
    return NextResponse.json({ ok: false, reason: result.reason }, { status: 404 });
  }

  return NextResponse.json({
    ok: true,
    slots: result.slots.map((s) => ({
      startAt: s.startAt.toISOString(),
      endAt: s.endAt.toISOString(),
      laneId: s.laneId,
    })),
  });
}
