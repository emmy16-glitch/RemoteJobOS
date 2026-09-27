import { createServerSupabaseClient } from "./supabase/server";
import { publicSupabaseEnv } from "./supabase/env";

export async function authenticatedUserId(): Promise<string | null> {
  if (!publicSupabaseEnv().configured) return null;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.getClaims();

  if (error) return null;
  const subject = data?.claims?.sub;
  return typeof subject === "string" && subject ? subject : null;
}
