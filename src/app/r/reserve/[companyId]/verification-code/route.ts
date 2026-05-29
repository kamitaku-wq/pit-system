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
// 露出制約 (A.33 で解消): 本 surface の本番露出は A.33 (Turnstile + IP/global 送信レート制限) 完了が
//   hard 依存だった。A.33 で以下の多層防御を最前段に配線する。
//
// A.33 レイヤ順序 (A.32b oracle 不変条件を壊さない):
//   1. rate limit (IP + global)        → 429 rate_limited (全リクエストをカウント、最前段で load shed)
//   2. companyId UUID 形式             → 404 company_not_found (純形式、oracle なし)
//   3. body parse (email + token)      → 400 invalid_body
//   4. Turnstile verify(token, ip)     → 403 turnstile_failed
//   5. requestReservationVerificationCode → 404 company_not_found / 200 (issue guard rate_limited は 200 据え置き)
//   - IP/global rate limit (429) と (company,email) issue guard (200) は別レイヤ・統合しない。429 は
//     service 呼出前に short-circuit するため issue guard の汎用 200 と衝突しない。
//   - Turnstile/rate limit は company 存在 lookup (service 内) より前 = 存在 oracle を漏らさない。
//     companyId の形式 404 は純ローカル判定で oracle なし。

import { NextResponse } from "next/server";
import { z } from "zod";
import {
  enforcePublicReservationRateLimit,
  getClientIp,
  retryAfterHeader,
} from "@/lib/rate-limit/public-reservation-rate-limit";
import { requestReservationVerificationCode } from "@/lib/services/customer-reservation-verification";
import { verifyTurnstileToken } from "@/lib/services/turnstile";

export const dynamic = "force-dynamic";

const bodySchema = z
  .object({
    email: z.string().trim().email().max(320),
    // Cloudflare Turnstile トークン (cf-turnstile-response)。空/欠落は invalid_body (400)。
    turnstileToken: z.string().min(1).max(4096),
  })
  .strict();

export async function POST(
  request: Request,
  context: { params: Promise<{ companyId: string }> },
): Promise<NextResponse> {
  // 1) rate limit を最前段で適用 (全リクエストをカウント = scanner も throttle、outbound Turnstile 検証
  //    より前に cheap-local DB write で load を shed)。
  const limited = await enforcePublicReservationRateLimit(request, "vcode");
  if (!limited.ok) {
    return NextResponse.json(
      { ok: false, reason: "rate_limited" },
      { status: 429, headers: retryAfterHeader(limited.retryAfterSeconds) },
    );
  }

  const { companyId } = await context.params;

  // 2) companyId (path) は UUID 必須 (malformed は 404 = company 不在扱い、reservations route と同型)。
  if (!z.string().uuid().safeParse(companyId).success) {
    return NextResponse.json({ ok: false, reason: "company_not_found" }, { status: 404 });
  }

  // 3) body parse (email + turnstileToken)。
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

  // 4) Turnstile 検証 (company 存在 lookup より前 = oracle を漏らさない)。失敗は 403。
  //    secret 未設定は service が throw → 500 (サーバ設定不備で fail-fast)。
  const turnstile = await verifyTurnstileToken(parsed.data.turnstileToken, getClientIp(request));
  if (!turnstile.success) {
    return NextResponse.json({ ok: false, reason: "turnstile_failed" }, { status: 403 });
  }

  // 5) issue + outbox。company_not_found (不在/inactive/soft-deleted company) のみ 404 に正規化する
  //    (sibling route の slots/reservations と整合。これを 500 にすると company 存在 oracle になる)。
  //    rate_limited は ok と区別せず汎用 200 に畳む (issue-state 非漏洩、IP/global 429 とは別レイヤ)。
  //    想定外の throw (pepper 未設定 / DB エラー) はそのまま 500 にする (= サーバ設定不備で fail-fast)。
  const result = await requestReservationVerificationCode({ companyId, email: parsed.data.email });
  if (!result.ok && result.reason === "company_not_found") {
    return NextResponse.json({ ok: false, reason: "company_not_found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true }, { status: 200 });
}
