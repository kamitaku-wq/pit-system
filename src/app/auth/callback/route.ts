import { NextResponse, type NextRequest } from "next/server";

import { db } from "@/lib/db/client";
import { provisionInternalUserByEmail } from "@/lib/auth/internal-user-provisioning";
import { safeNextPath } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";
// postgres direct 接続を使うため Node.js runtime を明示 (Edge では動かない)。
export const runtime = "nodejs";

// Phase 66: 社内ユーザー Google OAuth の callback。
// セキュリティ核 (fail-closed):
//   1. code を session に交換し、Google が返す **検証済み email** を取得。
//   2. provisionInternalUserByEmail が許可ドメイン照合 + 会社解決 + users get-or-create を実施。
//   3. ドメイン不一致 / 退職者 / 設定不全はいずれも signOut してログイン画面へ拒否理由付きで戻す
//      (= 未許可アカウントのセッションを残さない)。
//
// 公開オリジンは NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_APP_URL を正とする (x-forwarded-host 偽装による
// オープンリダイレクトを防ぐ)。env 未設定 (preview 等) は request.origin にフォールバック。
function resolveBase(request: NextRequest): string {
  if (process.env.NODE_ENV === "development") {
    return new URL(request.url).origin;
  }
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL)?.replace(
    /\/$/,
    "",
  );
  return configured && configured.length > 0 ? configured : new URL(request.url).origin;
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNextPath(url.searchParams.get("next"));
  const base = resolveBase(request);

  const denyTo = (errorCode: string): NextResponse =>
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(errorCode)}`, base));

  if (!code) {
    return denyTo("missing_code");
  }

  const supabase = await createClient();

  const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
  if (exchangeError) {
    return denyTo("oauth_failed");
  }

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !user.email) {
    await supabase.auth.signOut();
    return denyTo("oauth_failed");
  }

  const displayName =
    (typeof user.user_metadata?.full_name === "string" && user.user_metadata.full_name) ||
    (typeof user.user_metadata?.name === "string" && user.user_metadata.name) ||
    null;

  const provisioned = await provisionInternalUserByEmail(db, {
    authUserId: user.id,
    email: user.email,
    displayName,
  });

  if (!provisioned.ok) {
    // 未許可ドメイン / 退職者 / 設定不全はセッションを破棄して拒否 (fail-closed)。
    await supabase.auth.signOut();
    const reasonCode =
      provisioned.reason === "domain_not_allowed"
        ? "domain_not_allowed"
        : provisioned.reason === "user_disabled"
          ? "user_disabled"
          : "server_error";
    return denyTo(reasonCode);
  }

  return NextResponse.redirect(new URL(next, base));
}
