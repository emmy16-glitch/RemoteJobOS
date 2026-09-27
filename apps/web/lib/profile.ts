import "server-only";
import { createAdminSupabaseClient } from "./supabase/admin";

export async function latestProfileForUser(userId: string) {
  const supabase = createAdminSupabaseClient();
  const { data, error } = await supabase
    .from("career_profiles")
    .select("id,display_name,profile,updated_at")
    .eq("owner_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data;
}
