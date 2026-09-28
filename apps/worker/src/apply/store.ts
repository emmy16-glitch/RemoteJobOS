import type { ConfirmationResult, ApplicationStore } from "./types.js";
import { config, hasSupabase } from "../config.js";

type CareerProfilePayload = {
  verifiedAnswers?: Record<string, string>;
  assets?: Record<string, string>;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!hasSupabase()) throw new Error("Supabase is required for application persistence");

  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  }

  if (response.status === 204) return undefined as T;
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function applicationContext(applicationId: string): Promise<{
  profileId: string | null;
  answers: Record<string, string>;
  profile: CareerProfilePayload;
}> {
  const apps = await request<Array<{
    profile_id: string | null;
    answers: Record<string, string> | null;
  }>>(
    `applications?select=profile_id,answers&id=eq.${encodeURIComponent(applicationId)}&limit=1`
  );
  const profileId = apps[0]?.profile_id ?? null;
  if (!profileId) return { profileId: null, answers: apps[0]?.answers ?? {}, profile: {} };

  const profiles = await request<Array<{ profile: CareerProfilePayload }>>(
    `career_profiles?select=profile&id=eq.${encodeURIComponent(profileId)}&limit=1`
  );
  return {
    profileId,
    answers: apps[0]?.answers ?? {},
    profile: profiles[0]?.profile ?? {}
  };
}

export type ApplicationStageObserver = (event: {
  stage: string;
  status: "started" | "blocked" | "failed" | "verified" | "submitted" | "unknown";
  report?: Record<string, unknown>;
  error?: string;
}) => Promise<void>;

export class SupabaseApplicationStore implements ApplicationStore {
  constructor(private readonly stageObserver?: ApplicationStageObserver) {}
  async getVerifiedAnswers(applicationId: string): Promise<Record<string, string>> {
    const context = await applicationContext(applicationId);
    const reusable = context.profileId
      ? await request<Array<{ answer_key: string; answer_value: string }>>(
          `answer_vault?select=answer_key,answer_value&profile_id=eq.${encodeURIComponent(context.profileId)}&reuse_policy=eq.always`
        )
      : [];

    return {
      ...(context.profile.verifiedAnswers ?? {}),
      ...Object.fromEntries(reusable.map((row) => [row.answer_key, row.answer_value])),
      ...(context.answers ?? {})
    };
  }

  async getAutoApprovedAnswerKeys(applicationId: string): Promise<string[]> {
    const context = await applicationContext(applicationId);
    const reusable = context.profileId
      ? await request<Array<{ answer_key: string }>>(
          `answer_vault?select=answer_key&profile_id=eq.${encodeURIComponent(context.profileId)}&reuse_policy=eq.always`
        )
      : [];

    return [
      ...reusable.map((row) => row.answer_key),
      ...Object.keys(context.answers ?? {})
    ];
  }

  async getAssets(applicationId: string): Promise<Record<string, string>> {
    return (await applicationContext(applicationId)).profile.assets ?? {};
  }

  async canSubmit(applicationId: string): Promise<{ allowed: boolean; reason: string }> {
    const rows = await request<Array<{ allowed: boolean; reason: string }>>(
      "rpc/can_submit_application",
      {
        method: "POST",
        body: JSON.stringify({ p_application_id: applicationId })
      }
    );
    return rows[0] ?? { allowed: false, reason: "submission-policy-unavailable" };
  }

  async startAttempt(applicationId: string, workerId: string): Promise<string> {
    const rows = await request<Array<{ id: string }>>("application_attempts?select=id", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        application_id: applicationId,
        worker_id: workerId,
        stage: "detect",
        status: "started"
      })
    });

    const id = rows[0]?.id;
    if (!id) throw new Error("Could not create application attempt");

    await request(`applications?id=eq.${encodeURIComponent(applicationId)}`, {
      method: "PATCH",
      body: JSON.stringify({ last_attempt_id: id })
    });

    return id;
  }

  async recordStage(
    attemptId: string,
    stage: string,
    status: "started" | "blocked" | "failed" | "verified" | "submitted" | "unknown",
    report: Record<string, unknown> = {},
    error?: string
  ): Promise<void> {
    await request(`application_attempts?id=eq.${encodeURIComponent(attemptId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        stage,
        status,
        field_report: report,
        error: error ?? null,
        finished_at: status === "started" ? null : new Date().toISOString()
      })
    });

    await request("agent_events", {
      method: "POST",
      body: JSON.stringify({
        event_type: `application.${stage}`,
        severity: status === "failed" || status === "blocked" ? "warning" : "info",
        message: `Application stage ${stage}: ${status}`,
        metadata: { attemptId, stage, status, ...report, error: error ?? null }
      })
    });

    await this.stageObserver?.({
      stage,
      status,
      report,
      error
    });
  }

  async fenceSubmission(applicationId: string, attemptId: string): Promise<boolean> {
    const rows = await request<Array<{ id: string }>>(
      `applications?id=eq.${encodeURIComponent(applicationId)}&submission_fenced_at=is.null&submitted_at=is.null&select=id`,
      {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({
          submission_fenced_at: new Date().toISOString(),
          last_attempt_id: attemptId
        })
      }
    );

    return rows.length === 1;
  }

  async releaseSubmissionFence(applicationId: string, attemptId: string): Promise<boolean> {
    const released = await request<boolean>("rpc/release_submission_fence", {
      method: "POST",
      body: JSON.stringify({
        p_application_id: applicationId,
        p_attempt_id: attemptId
      })
    });
    return released === true;
  }

  async markSubmitted(applicationId: string, confirmation: ConfirmationResult): Promise<void> {
    await request(`applications?id=eq.${encodeURIComponent(applicationId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "applied",
        submitted_at: new Date().toISOString(),
        confirmation_verified_at: confirmation.confirmed ? new Date().toISOString() : null,
        confirmation_url: confirmation.url ?? null
      })
    });
  }
}
