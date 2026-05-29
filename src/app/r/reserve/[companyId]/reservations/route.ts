// Phase 64-A.31b / A.32b: 顧客公開予約フロー step1-7 を確定する POST エンドポイント (薄い shim)。
// ---------------------------------------------------------------------------
//
// POST /r/reserve/[companyId]/reservations
//   body: { storeId, workMenuId, laneId, startAt(ISO), endAt(ISO), customer{email 必須,...}, vehicle{...},
//           code(6 桁本人確認コード), notes? }
//   → 201 { ok: true, reservationId } / 4xx { ok: false, reason }
//
// 本 route は createVerifiedPublicReservation (verify+消費 → 境界 → gate → create を 1 tx) へ委譲する
//   薄い shim。cross-tenant / visible_to_customers / lane↔store / gate→create 同一 laneId / email 本人確認
//   の保証はすべて service 層 (customer-reservation-verification / -public) とその integration tests に
//   集約され、route は入力 (UUID / ISO datetime / customer・vehicle 形状 / code) の検証と reason → HTTP
//   status の写像のみを担う (A.31a GET slots route と同型の責務分担)。
//
// テナント境界: path の companyId が唯一の company scope。createVerifiedPublicReservation が companyId と
//   store/menu/lane の company_id 一致 + 可視性 + lane↔store を検証する (URL 改竄防御)。email は verify が
//   返す verifiedEmail で予約に転記され、クライアント送信 email は verify の lookup key にのみ使う。
//
// 本人確認 (A.32b): createVerifiedPublicReservation が createPublicReservation 前に 6 桁コードを
//   verify+消費する。not_found/invalid_code/expired/locked は verification_failed 1 種へ畳まれ (oracle 緩和)、
//   verify と create は単一 tx で原子 (create 失敗時はコードを温存)。
//
// 露出制約 (A.33 で解消): GET/POST 公開 surface は A.33 (Turnstile + rate 制限、spec §12.3) まで
//   production 露出禁止だった。本 route には IP/global rate limit を最前段に配線する。Turnstile は付けない
//   (既に issue 時 Turnstile を通過した code でゲート済 = 二重 challenge は UX 劣化、code brute-force は
//   A.32a の attempt 制限で有界)。

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  enforcePublicReservationRateLimit,
  retryAfterHeader,
} from "@/lib/rate-limit/public-reservation-rate-limit";
import {
  customerInputSchema,
  vehicleInputSchema,
} from "@/lib/services/customer-reservation-create";
import { createVerifiedPublicReservation } from "@/lib/services/customer-reservation-verification";

export const dynamic = "force-dynamic";

// 公開フローでは email を必須化する (verify の lookup key かつ本人確認の宛先)。共有 customerInputSchema
// は不変のまま、ここで email のみ required に絞る (createVerifiedPublicReservation の入力型と対称)。
const publicCustomerSchema = customerInputSchema.extend({
  email: z.string().trim().email().max(320),
});

// 公開入力の検証。startAt/endAt は picker (GET slots) が返した ISO 文字列をそのまま受ける。
// vehicle は service と同一 schema を再利用 (契約の単一源)。code は 6 桁だが、桁数の厳密検証は
// service 層 (verify) に委ね、route は空でない短い文字列であることだけを保証する。
const bodySchema = z
  .object({
    storeId: z.string().uuid(),
    workMenuId: z.string().uuid(),
    laneId: z.string().uuid(),
    startAt: z.string().datetime(),
    endAt: z.string().datetime(),
    customer: publicCustomerSchema,
    vehicle: vehicleInputSchema,
    code: z.string().trim().min(1).max(12),
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
    case "verification_failed":
      // 本人確認コード不一致/期限切れ/ロック/不在の統一 reason (oracle 緩和)。
      return 422;
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
  // rate limit を最前段で適用 (全リクエストをカウント、IP + global)。
  const limited = await enforcePublicReservationRateLimit(request, "create");
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited" },
      { status: 429, headers: retryAfterHeader(limited.retryAfterSeconds) },
    );
  }

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

  const result = await createVerifiedPublicReservation(
    {
      companyId,
      storeId: parsed.data.storeId,
      workMenuId: parsed.data.workMenuId,
      laneId: parsed.data.laneId,
      startAt: new Date(parsed.data.startAt),
      endAt: new Date(parsed.data.endAt),
      customer: parsed.data.customer,
      vehicle: parsed.data.vehicle,
      code: parsed.data.code,
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
