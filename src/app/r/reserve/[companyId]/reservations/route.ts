// Phase 64-A.31b: 顧客公開予約フロー step1-5 を確定する POST エンドポイント (薄い shim)。
// ---------------------------------------------------------------------------
//
// POST /r/reserve/[companyId]/reservations
//   body: { storeId, workMenuId, laneId, startAt(ISO), endAt(ISO), customer{...}, vehicle{...}, notes? }
//   → 201 { ok: true, reservationId } / 4xx { ok: false, reason }
//
// 本 route は createPublicReservation (境界チェック → gate → create) へ委譲する薄い shim。
//   cross-tenant / visible_to_customers / lane↔store / gate→create 同一 laneId の保証は
//   すべて service 層 (customer-reservation-public.createPublicReservation) とその integration
//   tests に集約され、route は入力 (UUID / ISO datetime / customer・vehicle 形状) の検証と
//   reason → HTTP status の写像のみを担う (A.31a GET slots route と同型の責務分担)。
//
// テナント境界: path の companyId が唯一の company scope。createPublicReservation が companyId と
//   store/menu/lane の company_id 一致 + 可視性 + lane↔store を検証する (URL 改竄防御)。
//
// 露出制約 (A.31a invariant 踏襲): GET/POST 公開 surface は A.33 (Turnstile + rate 制限、spec
//   §12.3) まで production 露出禁止。本 POST は create-on-confirm の email 認証 gate (step6-7, A.32)
//   を未だ挟んでいない — A.32 で createPublicReservation 呼び出し前に 6 桁コード検証を差し込む。

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  customerInputSchema,
  vehicleInputSchema,
} from "@/lib/services/customer-reservation-create";
import { createPublicReservation } from "@/lib/services/customer-reservation-public";

export const dynamic = "force-dynamic";

// 公開入力の検証。startAt/endAt は picker (GET slots) が返した ISO 文字列をそのまま受ける。
// customer/vehicle は service と同一 schema を再利用 (契約の単一源)。
const bodySchema = z
  .object({
    storeId: z.string().uuid(),
    workMenuId: z.string().uuid(),
    laneId: z.string().uuid(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    customer: customerInputSchema,
    vehicle: vehicleInputSchema,
    notes: z.string().trim().max(2000).optional(),
  })
  .refine((v) => new Date(v.startAt).getTime() < new Date(v.endAt).getTime(), {
    message: "startAt must be before endAt",
    path: ["endAt"],
  });

// reason → HTTP status。境界/不在 = 404、availability/二重予約 = 409、seed 欠落 = 500。
function statusForReason(reason: string): number {
  switch (reason) {
    case "company_not_found":
    case "store_not_found":
    case "work_menu_not_found":
    case "lane_not_found":
      return 404;
    case "duration_mismatch":
    case "too_soon":
    case "too_far":
    case "closed":
    case "outside_business_hours":
    case "slot_unavailable":
      return 409;
    case "status_not_seeded":
      return 500;
    default:
      return 400;
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ companyId: string }> },
): Promise<NextResponse> {
  const { companyId } = await context.params;

  // companyId (path) は UUID 必須 (malformed は 404 = company 不在扱い)。
  if (!z.string().uuid().safeParse(companyId).success) {
    return NextResponse.json({ ok: false, reason: "company_not_found" }, { status: 404 });
  }

  let rawBody: unknown;
  try {
    rawBody = await request.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  const userAgent = request.headers.get("user-agent") ?? null;

  const result = await createPublicReservation(
    {
      companyId,
      storeId: parsed.data.storeId,
      workMenuId: parsed.data.workMenuId,
      laneId: parsed.data.laneId,
      startAt: new Date(parsed.data.startAt),
      endAt: new Date(parsed.data.endAt),
      customer: parsed.data.customer,
      vehicle: parsed.data.vehicle,
      notes: parsed.data.notes,
    },
    { ipAddress, userAgent },
  );

  if (!result.ok) {
    return NextResponse.json(
      { ok: false, reason: result.reason },
      { status: statusForReason(result.reason) },
    );
  }

  return NextResponse.json({ ok: true, reservationId: result.reservationId }, { status: 201 });
}
