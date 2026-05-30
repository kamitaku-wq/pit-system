"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { safeNextPath } from "@/lib/auth/safe-redirect";
import { createClient } from "@/lib/supabase/server";

// Phase 66: 社内ユーザーの Google OAuth サインイン開始。
// signInWithOAuth が Google の同意画面 URL を返す → そこへ redirect。Google は認証後に
// redirectTo (= /auth/callback) へ戻し、callback が許可ドメイン照合 + provisioning を行う。
//
// redirectTo の基底オリジンは公開 env を正とする (x-forwarded-host 偽装でのオープンリダイレクトを防ぐ)。
async function resolveOrigin(): Promise<string> {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? process.env.NEXT_PUBLIC_APP_URL)?.replace(
    /\/$/,
    "",
  );
  if (configured && configured.length > 0) return configured;
  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  return `${proto}://${host}`;
}

export async function signInWithGoogleAction(formData: FormData): Promise<never> {
  const next = safeNextPath(formData.get("next")?.toString() ?? null);
  const origin = await resolveOrigin();
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
      queryParams: { access_type: "offline", prompt: "consent" },
    },
  });

  if (error || !data?.url) {
    redirect(`/login?error=oauth_failed`);
  }

  redirect(data.url);
}
