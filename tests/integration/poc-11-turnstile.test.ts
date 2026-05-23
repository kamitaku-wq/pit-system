import { config } from "dotenv";
import path from "node:path";
import { expect, it } from "vitest";

config({ path: path.resolve(process.cwd(), ".env.local"), override: false });

const turnstileVerifyUrl = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

type TurnstileVerifyResponse = {
  success: boolean;
} & Record<string, unknown>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseTurnstileVerifyResponse(value: unknown): TurnstileVerifyResponse {
  if (!isRecord(value) || typeof value.success !== "boolean") {
    throw new Error("Unexpected Turnstile verify response");
  }

  return {
    ...value,
    success: value.success,
  };
}

it(
  "returns success true with the official public Cloudflare Turnstile test key",
  async () => {
    // Cloudflare Turnstile test keys are official public information for integration testing.
    const secret = process.env.TURNSTILE_SECRET_KEY;
    if (secret === undefined || secret.length === 0) {
      throw new Error("TURNSTILE_SECRET_KEY must be set for this integration test");
    }

    const response = await fetch(turnstileVerifyUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        secret,
        response: "poc-11-arbitrary-token",
      }),
    });

    const body: unknown = await response.json();
    const parsedBody = parseTurnstileVerifyResponse(body);

    expect(parsedBody.success).toBe(true);
  },
  10_000,
);
