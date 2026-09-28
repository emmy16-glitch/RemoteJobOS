"use server";

import { revalidatePath } from "next/cache";
import { authenticatedUserId } from "../../lib/auth";
import { createServerSupabaseClient } from "../../lib/supabase/server";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

export async function resolveApplicationException(formData: FormData) {
  const userId = await authenticatedUserId();
  if (!userId) throw new Error("Authentication required");

  const exceptionId = text(formData, "exceptionId");
  const action = text(formData, "action");
  const answer = text(formData, "answer") || null;
  const reusePolicy = text(formData, "reusePolicy") || "always";

  if (!exceptionId || !action) {
    throw new Error("Exception action is incomplete");
  }

  if (!["answer", "retry", "mark-submitted", "dismiss"].includes(action)) {
    throw new Error("Unsupported exception action");
  }

  if (!["always", "ask", "never"].includes(reusePolicy)) {
    throw new Error("Invalid reuse policy");
  }

  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("resolve_own_application_exception", {
    p_exception_id: exceptionId,
    p_action: action,
    p_answer: answer,
    p_reuse_policy: reusePolicy
  });

  if (error) throw new Error(error.message);

  revalidatePath("/exceptions");
  revalidatePath("/applications");
  revalidatePath("/answers");
  revalidatePath("/");
}
