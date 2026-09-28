import "server-only";
import { createAdminSupabaseClient } from "./supabase/admin";

type CareerProfileRow = {
  id: string;
  display_name: string;
  profile: Record<string, unknown>;
  updated_at: string;
};

async function readLatestProfile(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
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
  const supabase = createAdminSupabaseClient();
  const existing = await readLatestProfile(supabase, userId);
  if (existing) return existing;

  const { data: authData, error: authError } =
    await supabase.auth.admin.getUserById(userId);

  if (authError) throw new Error(authError.message);

  const email = authData.user?.email?.trim().toLowerCase();
  if (!email) return null;

  const { data: claimedProfileId, error: claimError } = await supabase.rpc(
    "claim_profile_onboarding_seed",
    {
      p_user_id: userId,
      p_email: email
    }
  );

  if (claimError) throw new Error(claimError.message);
  if (!claimedProfileId) return null;

  return readLatestProfile(supabase, userId);
}
