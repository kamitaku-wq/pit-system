// Cloudflare Turnstile トークン検証エンドポイント。
// Phase 64-A.33: 検証ロジックを `@/lib/services/turnstile` の verifyTurnstileToken へ集約し、本 route は
//   その薄い HTTP ラッパとした (公開予約 surface の verification-code route は service を直呼ぶ)。

import { NextResponse } from "next/server";
import { verifyTurnstileToken } from "@/lib/services/turnstile";

type TurnstileRequestBody = {
  token: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseRequestBody(value: unknown): TurnstileRequestBody | null {
  if (!isRecord(value)) {
    return null;
  }
  const token = value.token;
  if (typeof token !== "string" || token.length === 0) {
    return null;
  }
  return { token };
}

export async function POST(request: Request): Promise<NextResponse> {
  const requestBody: unknown = await request.json().catch(() => null);
  const parsedBody = parseRequestBody(requestBody);
  if (parsedBody === null) {
    return NextResponse.json({ success: false, error: "token is required" }, { status: 400 });
  }

  const ipAddress = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;

  let result: Awaited<ReturnType<typeof verifyTurnstileToken>>;
  try {
    result = await verifyTurnstileToken(parsedBody.token, ipAddress);
  } catch {
    // secret 未設定等のサーバ設定不備。
    return NextResponse.json(
      { success: false, error: "TURNSTILE_SECRET_KEY is not set" },
      { status: 500 },
    );
  }

  return NextResponse.json(
    { success: result.success, errorCodes: result.errorCodes },
    { status: result.success ? 200 : 400 },
  );
}
