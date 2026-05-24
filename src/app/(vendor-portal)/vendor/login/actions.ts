"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function signInAction(formData: FormData): Promise<never> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    redirect("/vendor/login?error=invalid_credentials");
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });

  if (error) {
    redirect("/vendor/login?error=invalid_credentials");
  }

  redirect("/vendor/requests");
}

export async function logoutAction(): Promise<never> {
  const supabase = await createClient();

  await supabase.auth.signOut();
  redirect("/vendor/login");
}
