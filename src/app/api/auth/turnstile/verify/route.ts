import { NextResponse } from "next/server";

const turnstileVerifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type TurnstileRequestBody = {
  token: string;
};

type TurnstileVerifyResponse = {
  success: boolean;
} & Record<string, unknown>;

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

function parseVerifyResponse(value: unknown): TurnstileVerifyResponse | null {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    return null;
  }

  return {
    ...value,
    success: value.success,
  };
}

export async function POST(request: Request): Promise<NextResponse> {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (secret === undefined || secret.length === 0) {
    return NextResponse.json({ success: false, error: "TURNSTILE_SECRET_KEY is not set" }, { status: 500 });
  }

  const requestBody: unknown = await request.json().catch(() => null);
  const parsedBody = parseRequestBody(requestBody);
  if (parsedBody === null) {
    return NextResponse.json({ success: false, error: "token is required" }, { status: 400 });
  }

  const formData = new URLSearchParams({
    secret,
    response: parsedBody.token,
  });

  const verifyResponse = await fetch(turnstileVerifyUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: formData,
  });

  const verifyBody: unknown = await verifyResponse.json().catch(() => null);
  const parsedVerifyBody = parseVerifyResponse(verifyBody);
  if (parsedVerifyBody === null) {
    return NextResponse.json({ success: false, error: "invalid Turnstile verify response" }, { status: 502 });
  }

  return NextResponse.json(parsedVerifyBody, { status: parsedVerifyBody.success ? 200 : 400 });
}
