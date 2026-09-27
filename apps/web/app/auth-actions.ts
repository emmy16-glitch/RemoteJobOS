"use server";

import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "../lib/supabase/server";
import { publicSupabaseEnv } from "../lib/supabase/env";

function safeNext(value: FormDataEntryValue | null): string {
  if (typeof value !== "string") return "/";
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}

export async function signIn(formData: FormData) {
  if (!publicSupabaseEnv().configured) {
    redirect("/login?error=" + encodeURIComponent("Supabase Auth is not configured yet."));
  }

  const email = String(formData.get("email") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    redirect("/login?error=" + encodeURIComponent("Email and password are required."));
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    redirect("/login?error=" + encodeURIComponent(error.message));
  }

  redirect(next);
}

export async function signOut() {
  if (publicSupabaseEnv().configured) {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
  }

  redirect("/login");
}
