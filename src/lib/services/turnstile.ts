// Phase 64-A.33: Cloudflare Turnstile トークン検証 service (多層防御 L1)。
// ---------------------------------------------------------------------------
//
// 既存 `src/app/api/auth/turnstile/verify/route.ts` の検証ロジックをここへ抽出し、vendor auth と
// 公開予約 surface (verification-code) で共用する。route から呼ぶ際は内部 HTTP ホップを避け本関数を直呼ぶ。
//
// remoteIp: siteverify に remoteip を渡すと Cloudflare 側でトークン↔IP の整合も検証できる。
// fail-closed: secret 未設定はサーバ設定不備として throw (route が 500 = fail-fast)。Cloudflare 到達
//   不能/不正応答は success:false を返す (検証できないリクエストは通さない = 防御を緩めない)。
//
// single-use: Turnstile トークンは一度検証すると再利用で `timeout-or-duplicate` になる。呼び出し側 (UI)
//   は再送時に widget を reset して新トークンを取得すること。

const TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

export interface TurnstileVerifyResult {
  success: boolean;
  // Cloudflare の error-codes (例: "timeout-or-duplicate", "invalid-input-response")。診断/ログ用。
  errorCodes: string[];
}

export interface VerifyTurnstileOptions {
  // テスト/呼び出し側からの secret 注入 (未指定は env)。
  secret?: string;
  // テスト用の fetch 差し替え。
  fetchImpl?: typeof fetch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseErrorCodes(value: unknown): string[] {
  if (!isRecord(value)) return [];
  const raw = value["error-codes"];
  if (!Array.isArray(raw)) return [];
  return raw.filter((c): c is string => typeof c === "string");
}

/**
 * Turnstile トークンを検証する。
 *
 * @param token    クライアントの cf-turnstile-response トークン
 * @param remoteIp 任意。client IP (siteverify に remoteip として渡す)
 * @throws secret 未設定時 (サーバ設定不備)
 */
export async function verifyTurnstileToken(
  token: string,
  remoteIp?: string | null,
  options: VerifyTurnstileOptions = {},
): Promise<TurnstileVerifyResult> {
  const secret = options.secret ?? process.env.TURNSTILE_SECRET_KEY;
  if (secret === undefined || secret.length === 0) {
    throw new Error("TURNSTILE_SECRET_KEY is not set");
  }
  if (typeof token !== "string" || token.length === 0) {
    return { success: false, errorCodes: ["missing-input-response"] };
  }

  const fetchImpl = options.fetchImpl ?? fetch;
  const form = new URLSearchParams({ secret, response: token });
  // "unknown" 等の擬似値は渡さない (有効な IP のみ Cloudflare に渡す)。
  if (remoteIp && remoteIp !== "unknown") {
    form.set("remoteip", remoteIp);
  }

  let parsed: unknown;
  try {
    const response = await fetchImpl(TURNSTILE_VERIFY_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: form,
    });
    parsed = await response.json();
  } catch {
    // 到達不能/JSON 不正 → fail-closed (検証できないため通さない)。
    return { success: false, errorCodes: ["internal-error"] };
  }

  if (!isRecord(parsed) || typeof parsed.success !== "boolean") {
    return { success: false, errorCodes: ["bad-verify-response"] };
  }

  return { success: parsed.success, errorCodes: parseErrorCodes(parsed) };
}
