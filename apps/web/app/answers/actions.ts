"use server";

import { revalidatePath } from "next/cache";
import { authenticatedUserId } from "../../lib/auth";
import { createServerSupabaseClient } from "../../lib/supabase/server";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function saveAnswerVaultEntry(formData: FormData) {
  const userId = await authenticatedUserId();
  if (!userId) throw new Error("Authentication required");

  const supabase = await createServerSupabaseClient();
  const { data: profile, error: profileError } = await supabase
    .from("career_profiles")
    .select("id")
    .eq("owner_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);
  if (!profile) throw new Error("Career profile required");

  const label = text(formData, "label");
  const answerValue = text(formData, "answerValue");
  const reusePolicy = text(formData, "reusePolicy") || "always";
  const answerKey = text(formData, "answerKey") || label;

  if (!label || !answerValue) throw new Error("Question and answer are required");
  if (!["always", "ask", "never"].includes(reusePolicy)) {
    throw new Error("Invalid reuse policy");
  }

  const { error } = await supabase
    .from("answer_vault")
    .upsert(
      {
        profile_id: profile.id,
        answer_key: answerKey,
        label,
        answer_value: answerValue,
        reuse_policy: reusePolicy,
        sensitive: formData.get("sensitive") === "on",
        updated_at: new Date().toISOString()
      },
      { onConflict: "profile_id,answer_key" }
    );

  if (error) throw new Error(error.message);
  revalidatePath("/answers");
}

export async function deleteAnswerVaultEntry(formData: FormData) {
  const userId = await authenticatedUserId();
  if (!userId) throw new Error("Authentication required");

  const id = text(formData, "id");
  if (!id) return;

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("answer_vault")
    .delete()
    .eq("id", id);

  if (error) throw new Error(error.message);
  revalidatePath("/answers");
}
