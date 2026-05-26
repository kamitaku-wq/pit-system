"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

import { createClient } from "@/lib/supabase/browser";

export default function AdminInviteCallbackPage() {
  const router = useRouter();
  const [message, setMessage] = useState("招待を確認しています...");

  useEffect(() => {
    async function handleCallback() {
      const hash = window.location.hash;
      if (!hash || !hash.includes("access_token=")) {
        router.replace("/vendor/login?error=invalid_callback");
        return;
      }

      const params = new URLSearchParams(hash.substring(1));
      const accessToken = params.get("access_token");
      const refreshToken = params.get("refresh_token");
      if (!accessToken || !refreshToken) {
        router.replace("/vendor/login?error=callback_failed");
        return;
      }

      const supabase = createClient();
      const { error: sessionError } = await supabase.auth.setSession({
        access_token: accessToken,
        refresh_token: refreshToken,
      });
      if (sessionError) {
        router.replace("/vendor/login?error=callback_failed");
        return;
      }

      const response = await fetch("/vendor/invitations/callback/finalize", {
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        router.replace(`/vendor/login?error=${body.error ?? "finalize_failed"}`);
        return;
      }

      router.replace("/vendor/requests");
    }

    handleCallback().catch(() => {
      setMessage("エラーが発生しました");
      router.replace("/vendor/login?error=callback_failed");
    });
  }, [router]);

  return <div className="p-8 text-sm text-neutral-600">{message}</div>;
}
