import "server-only";
import { createClient } from "@supabase/supabase-js";
import { serverSupabaseEnv } from "./env";

export function createAdminSupabaseClient() {
  const env = serverSupabaseEnv();
  if (!env.configured) {
    throw new Error("Supabase server environment is not configured");
  }

  return createClient(env.url, env.serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });
}
