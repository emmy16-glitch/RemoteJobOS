"use server";

import { revalidatePath } from "next/cache";
import { authenticatedUserId } from "../../lib/auth";
import { createServerSupabaseClient } from "../../lib/supabase/server";

function checked(formData: FormData, key: string): boolean {
  return formData.get(key) === "on";
}

export async function saveNotificationPreferences(formData: FormData) {
  const userId = await authenticatedUserId();
  if (!userId) throw new Error("Authentication required");

  const supabase = await createServerSupabaseClient();
  const emailAddress = String(formData.get("emailAddress") ?? "").trim();

  const { error } = await supabase
    .from("notification_preferences")
    .upsert(
      {
        owner_id: userId,
        email_enabled: checked(formData, "emailEnabled"),
        email_address: emailAddress || null,
        notify_exceptions: checked(formData, "notifyExceptions"),
        notify_submitted: checked(formData, "notifySubmitted"),
        notify_assessment: checked(formData, "notifyAssessment"),
        notify_interview: checked(formData, "notifyInterview"),
        notify_offer: checked(formData, "notifyOffer"),
        notify_rejection: checked(formData, "notifyRejection"),
        updated_at: new Date().toISOString()
      },
      { onConflict: "owner_id" }
    );

  if (error) throw new Error(error.message);
  revalidatePath("/inbox");
}
