"use server";

import { revalidatePath } from "next/cache";
import { authenticatedUserId } from "../../lib/auth";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

async function ownedException(exceptionId: string, userId: string) {
  const supabase = createAdminSupabaseClient();

  const { data: exception, error: exceptionError } = await supabase
    .from("application_exceptions")
    .select("id,application_id,run_id,exception_type,status,field_key,field_label,title,detail,payload")
    .eq("id", exceptionId)
    .maybeSingle();

  if (exceptionError) throw new Error(exceptionError.message);
  if (!exception) throw new Error("Exception not found");

  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("id,profile_id,job_id,answers,last_attempt_id,submission_fenced_at,submitted_at,confirmation_verified_at")
    .eq("id", exception.application_id)
    .maybeSingle();

  if (appError) throw new Error(appError.message);
  if (!application?.profile_id) throw new Error("Application profile not found");

  const { data: profile, error: profileError } = await supabase
    .from("career_profiles")
    .select("id,owner_id")
    .eq("id", application.profile_id)
    .maybeSingle();

  if (profileError) throw new Error(profileError.message);
  if (!profile || profile.owner_id !== userId) throw new Error("Not authorized");

  return { supabase, exception, application, profile };
}

async function resolveRow(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  exceptionId: string,
  status: "resolved" | "dismissed",
  resolution: Record<string, unknown>
) {
  const { error } = await supabase
    .from("application_exceptions")
    .update({
      status,
      resolution,
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
    .eq("id", exceptionId);

  if (error) throw new Error(error.message);
}

async function remainingOpen(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  applicationId: string
): Promise<number> {
  const { count, error } = await supabase
    .from("application_exceptions")
    .select("id", { count: "exact", head: true })
    .eq("application_id", applicationId)
    .eq("status", "open");

  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function queueReviewResume(args: {
  supabase: ReturnType<typeof createAdminSupabaseClient>;
  applicationId: string;
  runId: string | null;
  exceptionId: string;
}) {
  if (args.runId) {
    const { error: runError } = await args.supabase
      .from("agent_runs")
      .update({
        status: "pending",
        mode: "dry-run",
        phase: "context",
        recovery_strategy: "safe-restart",
        last_error: null,
        completed_at: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", args.runId);

    if (runError) throw new Error(runError.message);
  }

  const key = `application-review-resume:${args.exceptionId}`;
  const { error: taskError } = await args.supabase
    .from("agent_tasks")
    .upsert(
      {
        task_type: "application-review",
        payload: {
          applicationId: args.applicationId,
          runId: args.runId,
          exceptionId: args.exceptionId
        },
        status: "pending",
        priority: 35,
        max_attempts: 3,
        idempotency_key: key,
        available_at: new Date().toISOString()
      },
      { onConflict: "idempotency_key", ignoreDuplicates: true }
    );

  if (taskError) throw new Error(taskError.message);

  const { error: appError } = await args.supabase
    .from("applications")
    .update({
      status: "cv-prepared",
      next_action: "Exception resolved. Application verification is queued to resume.",
      updated_at: new Date().toISOString()
    })
    .eq("id", args.applicationId);

  if (appError) throw new Error(appError.message);
}

export async function resolveApplicationException(formData: FormData) {
  const userId = await authenticatedUserId();
  if (!userId) throw new Error("Authentication required");

  const exceptionId = text(formData, "exceptionId");
  const action = text(formData, "action");
  if (!exceptionId || !action) throw new Error("Exception action is incomplete");

  const { supabase, exception, application, profile } =
    await ownedException(exceptionId, userId);

  if (exception.status !== "open") {
    revalidatePath("/exceptions");
    return;
  }

  if (action === "answer") {
    const answer = text(formData, "answer");
    const reusePolicy = text(formData, "reusePolicy") || "always";
    if (!answer) throw new Error("Answer is required");
    if (!["always", "ask", "never"].includes(reusePolicy)) {
      throw new Error("Invalid reuse policy");
    }

    const answerKey = exception.field_label || exception.field_key;
    if (!answerKey) throw new Error("This exception has no answer key");

    const answers = {
      ...((application.answers && typeof application.answers === "object")
        ? application.answers as Record<string, string>
        : {}),
      [answerKey]: answer
    };

    const { error: appAnswerError } = await supabase
      .from("applications")
      .update({ answers, updated_at: new Date().toISOString() })
      .eq("id", application.id);
    if (appAnswerError) throw new Error(appAnswerError.message);

    if (reusePolicy !== "never") {
      const { error: vaultError } = await supabase
        .from("answer_vault")
        .upsert(
          {
            profile_id: profile.id,
            answer_key: answerKey,
            label: exception.field_label || answerKey,
            answer_value: answer,
            reuse_policy: reusePolicy,
            sensitive: exception.exception_type === "sensitive-answer",
            aliases: exception.field_key && exception.field_key !== answerKey
              ? [exception.field_key]
              : [],
            updated_at: new Date().toISOString()
          },
          { onConflict: "profile_id,answer_key" }
        );
      if (vaultError) throw new Error(vaultError.message);
    }

    await resolveRow(supabase, exception.id, "resolved", {
      action,
      reusePolicy,
      answeredAt: new Date().toISOString()
    });

    if (await remainingOpen(supabase, application.id) === 0) {
      await queueReviewResume({
        supabase,
        applicationId: application.id,
        runId: exception.run_id,
        exceptionId: exception.id
      });
    }
  } else if (action === "retry") {
    if (application.submission_fenced_at && application.last_attempt_id) {
      const { data: released, error: releaseError } = await supabase.rpc(
        "release_submission_fence",
        {
          p_application_id: application.id,
          p_attempt_id: application.last_attempt_id
        }
      );
      if (releaseError) throw new Error(releaseError.message);
      if (!released) throw new Error("The submission fence could not be safely released");
    }

    if (!exception.run_id) throw new Error("No durable run exists to retry");

    const { data: approval, error: approvalError } = await supabase
      .from("agent_approvals")
      .select("id,status")
      .eq("run_id", exception.run_id)
      .eq("approval_type", "submit-application")
      .in("status", ["approved", "executed"])
      .order("requested_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (approvalError) throw new Error(approvalError.message);
    if (!approval) throw new Error("No approved submission authorization exists");

    const { error: runError } = await supabase
      .from("agent_runs")
      .update({
        status: "pending",
        mode: "submit",
        phase: "fence",
        recovery_strategy: "safe-restart",
        last_error: null,
        submit_attempts: 0,
        completed_at: null,
        updated_at: new Date().toISOString()
      })
      .eq("id", exception.run_id);
    if (runError) throw new Error(runError.message);

    const { error: taskError } = await supabase
      .from("agent_tasks")
      .upsert(
        {
          task_type: "application-auto-submit",
          payload: {
            applicationId: application.id,
            runId: exception.run_id,
            approvalId: approval.id,
            exceptionId: exception.id
          },
          status: "pending",
          priority: 25,
          max_attempts: 3,
          idempotency_key: `application-exception-retry:${exception.id}`,
          available_at: new Date().toISOString()
        },
        { onConflict: "idempotency_key", ignoreDuplicates: true }
      );
    if (taskError) throw new Error(taskError.message);

    await resolveRow(supabase, exception.id, "resolved", {
      action,
      confirmedNotSubmitted: true,
      retriedAt: new Date().toISOString()
    });

    const { error: appError } = await supabase
      .from("applications")
      .update({
        status: "auto-submit-queued",
        next_action: "You confirmed it was not submitted. A safe retry is queued.",
        updated_at: new Date().toISOString()
      })
      .eq("id", application.id);
    if (appError) throw new Error(appError.message);
  } else if (action === "mark-submitted") {
    const now = new Date().toISOString();
    const { error: appError } = await supabase
      .from("applications")
      .update({
        status: "applied",
        submitted_at: application.submitted_at ?? now,
        confirmation_verified_at: now,
        next_action: "Submission manually confirmed from the Exception Center.",
        updated_at: now
      })
      .eq("id", application.id);
    if (appError) throw new Error(appError.message);

    if (exception.run_id) {
      await supabase
        .from("agent_runs")
        .update({
          status: "completed",
          phase: "finalize",
          recovery_strategy: "already-complete",
          result: {
            terminal: "submitted",
            verified: true,
            reason: "User manually confirmed the application was submitted"
          },
          completed_at: now,
          updated_at: now
        })
        .eq("id", exception.run_id);

      await supabase
        .from("agent_approvals")
        .update({ status: "executed", executed_at: now })
        .eq("run_id", exception.run_id)
        .eq("status", "approved");
    }

    await resolveRow(supabase, exception.id, "resolved", {
      action,
      confirmedAt: now
    });

    await supabase
      .from("notification_outbox")
      .upsert(
        {
          owner_id: userId,
          application_id: application.id,
          exception_id: exception.id,
          kind: "submitted",
          subject: "RemoteJobOS: application manually confirmed",
          body_text: "You confirmed from the Exception Center that this application was submitted. RemoteJobOS marked it as applied and will continue lifecycle tracking.",
          status: "pending",
          dedupe_key: `manual-submitted:${application.id}`
        },
        { onConflict: "dedupe_key", ignoreDuplicates: true }
      );
  } else if (action === "dismiss") {
    await resolveRow(supabase, exception.id, "dismissed", {
      action,
      dismissedAt: new Date().toISOString()
    });

    await supabase
      .from("applications")
      .update({
        next_action: "Exception dismissed. No automatic action was taken.",
        updated_at: new Date().toISOString()
      })
      .eq("id", application.id);
  } else {
    throw new Error("Unsupported exception action");
  }

  revalidatePath("/exceptions");
  revalidatePath("/applications");
  revalidatePath("/");
}
