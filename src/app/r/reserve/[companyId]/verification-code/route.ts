// Phase 64-A.32b: 顧客公開予約フロー step6 の「確認コード送信」エンドポイント (薄い shim)。
// ---------------------------------------------------------------------------
//
// POST /r/reserve/[companyId]/verification-code
//   body: { email }
//   → 200 { ok: true } (issue 成否 = ok / rate_limited を区別しない)
//   / 400 { ok: false, reason: "invalid_body" } (malformed email)
//   / 404 { ok: false, reason: "company_not_found" } (malformed / 不在 / inactive company)
//
// requestReservationVerificationCode (company gate → issue + outbox を 1 tx) へ委譲する。
//
// issue-state 非漏洩 (advisor 指摘): 顧客は自分の email にコードを要求するため列挙脅威は薄いが、
//   rate_limited を含む issue 結果 (= email の有無/発行回数) を区別せず汎用 200 を返す (「送信した
//   可能性がある」以上を観測させない)。一方 company 存在/形式は sibling route (slots/reservations)
//   でも 404 で観測可能なため、本 route も company_not_found を 404 に正規化する (500 にすると
//   逆に「200=実在 / 500=不在」という強い oracle を作るため避ける)。malformed email は 400。
//
// 露出制約 (A.31a/A.32a 不変条件の継承): 本 surface の本番露出は A.33 (Turnstile + IP/global 送信
//   レート制限) 完了が hard 依存。本 route の rate guard は (company,email) 単位の暫定ガードのみ。

import { NextResponse } from "next/server";
import { z } from "zod";
import { requestReservationVerificationCode } from "@/lib/services/customer-reservation-verification";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    email: z.string().trim().email().max(320),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ companyId: string }> },
): Promise<NextResponse> {
  const { companyId } = await context.params;

  // companyId (path) は UUID 必須 (malformed は 404 = company 不在扱い、reservations route と同型)。
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

  // issue + outbox。company_not_found (不在/inactive/soft-deleted company) のみ 404 に正規化する
  // (sibling route の slots/reservations と整合。これを 500 にすると company 存在 oracle になる)。
  // rate_limited は ok と区別せず汎用 200 に畳む (issue-state 非漏洩)。
  // 想定外の throw (pepper 未設定 / DB エラー) はそのまま 500 にする (= サーバ設定不備で fail-fast)。
  const result = await requestReservationVerificationCode({ companyId, email: parsed.data.email });
  if (!result.ok && result.reason === "company_not_found") {
    return NextResponse.json({ ok: false, reason: "company_not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
