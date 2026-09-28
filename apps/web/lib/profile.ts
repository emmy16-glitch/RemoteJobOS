import "server-only";
import { createServerSupabaseClient } from "./supabase/server";

type CareerProfileRow = {
  id: string;
  display_name: string;
  profile: Record<string, unknown>;
  updated_at: string;
};

async function readLatestProfile(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string
): Promise<CareerProfileRow | null> {
  const { data, error } = await supabase
    .from("career_profiles")
    .select("id,display_name,profile,updated_at")
    .eq("owner_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  return data as CareerProfileRow | null;
}

export async function latestProfileForUser(userId: string) {
  const supabase = await createServerSupabaseClient();
  const existing = await readLatestProfile(supabase, userId);
  if (existing) return existing;

  const { data: claimedProfileId, error: claimError } = await supabase.rpc(
    "claim_own_profile_onboarding_seed"
  );

  if (claimError) throw new Error(claimError.message);
  if (!claimedProfileId) return null;

  return readLatestProfile(supabase, userId);
}
