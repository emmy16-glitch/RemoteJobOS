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


export async function signUp(formData: FormData) {
  if (!publicSupabaseEnv().configured) {
    redirect("/login?mode=signup&error=" + encodeURIComponent("Supabase Auth is not configured yet."));
  }

  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const next = safeNext(formData.get("next"));

  if (!email || !password) {
    redirect("/login?mode=signup&error=" + encodeURIComponent("Email and password are required."));
  }
  if (password.length < 8) {
    redirect("/login?mode=signup&error=" + encodeURIComponent("Use a password with at least 8 characters."));
  }
  if (password !== confirmPassword) {
    redirect("/login?mode=signup&error=" + encodeURIComponent("Passwords do not match."));
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signUp({ email, password });

  if (error) {
    redirect("/login?mode=signup&error=" + encodeURIComponent(error.message));
  }

  if (data.session) {
    redirect(next);
  }

  redirect(
    "/login?created=1&email=" +
      encodeURIComponent(email) +
      "&next=" +
      encodeURIComponent(next)
  );
}

export async function signOut() {
  if (publicSupabaseEnv().configured) {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
  }

  redirect("/login");
}
