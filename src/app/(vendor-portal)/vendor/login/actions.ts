"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

// Phase 31-A 追補: `?next=` を消費して redirect 先を決定。
// open-redirect 防止: 内部 path (`/`始まり、`//` で始まらない) のみ許可。
function safeNextPath(next: FormDataEntryValue | null): string {
  if (typeof next !== "string" || !next) return "/vendor/requests";
  if (!next.startsWith("/") || next.startsWith("//")) return "/vendor/requests";
  return next;
}

function loginRedirectWithNext(errorCode: string, nextPath: string): never {
  const params = new URLSearchParams({ error: errorCode });
  if (nextPath !== "/vendor/requests") {
    params.set("next", nextPath);
  }
  redirect(`/vendor/login?${params.toString()}`);
}

export async function signInAction(formData: FormData): Promise<never> {
  const nextPath = safeNextPath(formData.get("next"));
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    loginRedirectWithNext("invalid_credentials", nextPath);
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    loginRedirectWithNext("invalid_credentials", nextPath);
  }

  redirect(nextPath);
}

export async function logoutAction(): Promise<never> {
  const supabase = await createClient();

  await supabase.auth.signOut();
  redirect("/vendor/login");
}
