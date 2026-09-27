import { createDefaultAdapterRegistry } from "./default-adapters.js";
import { runApplicationPipeline, type PipelineOutcome } from "./engine.js";
import { SupabaseApplicationStore } from "./store.js";
import { config, hasSupabase } from "../config.js";
import { renderApplicationResume } from "../resume-renderer.js";

type ApplicationRow = {
  id: string;
  job_id: string;
  status: string;
  autonomy_mode: string;
};

type JobRow = {
  id: string;
  title: string;
  company: string;
  apply_url: string;
};

async function getJson<T>(path: string): Promise<T> {
  if (!hasSupabase()) throw new Error("Supabase is required for application execution");

  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: `Bearer ${config.supabaseServiceRoleKey}`
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase GET failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

async function patchApplication(
  applicationId: string,
  status: string,
  nextAction: string
): Promise<void> {
  if (!hasSupabase()) return;

  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/applications?id=eq.${encodeURIComponent(applicationId)}`,
    {
      method: "PATCH",
      headers: {
        apikey: config.supabaseServiceRoleKey,
        authorization: `Bearer ${config.supabaseServiceRoleKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        status,
        next_action: nextAction,
        updated_at: new Date().toISOString()
      })
    }
  );

  if (!response.ok) {
    throw new Error(`Application status update failed: ${response.status} ${await response.text()}`);
  }
}

async function recordEvent(
  eventType: string,
  message: string,
  metadata: Record<string, unknown>
): Promise<void> {
  if (!hasSupabase()) return;

  await fetch(`${config.supabaseUrl}/rest/v1/agent_events`, {
    method: "POST",
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      event_type: eventType,
      severity: eventType.endsWith(".failed") ? "warning" : "info",
      message,
      metadata
    })
  }).catch(() => undefined);
}

export type ApplicationRunMode = "dry-run" | "review" | "submit";

export async function runOneApplication(
  applicationId: string,
  mode: ApplicationRunMode = "dry-run"
): Promise<PipelineOutcome> {
  if (!applicationId) throw new Error("applicationId is required");

  const applications = await getJson<ApplicationRow[]>(
    `applications?select=id,job_id,status,autonomy_mode&id=eq.${encodeURIComponent(applicationId)}&limit=1`
  );
  const application = applications[0];
  if (!application) throw new Error(`Application not found: ${applicationId}`);

  const jobs = await getJson<JobRow[]>(
    `jobs?select=id,title,company,apply_url&id=eq.${encodeURIComponent(application.job_id)}&limit=1`
  );
  const job = jobs[0];
  if (!job) throw new Error(`Job not found for application: ${applicationId}`);

  const registry = createDefaultAdapterRegistry();
  const adapter = registry.resolve(job.apply_url);
  if (!adapter) {
    await patchApplication(
      applicationId,
      "ready-for-review",
      "No verified browser adapter exists for this ATS yet"
    );
    await recordEvent(
      "application.needs_adapter",
      "No supported ATS adapter matched this application URL",
      { applicationId, jobId: job.id, company: job.company, applyUrl: job.apply_url }
    );
    throw new Error(`No supported application adapter for ${job.apply_url}`);
  }

  const submitEnabled =
    mode === "submit" &&
    (process.env.REMOTEJOBOS_ALLOW_SUBMIT ?? "").toLowerCase() === "true";

  if (mode === "submit" && !submitEnabled) {
    throw new Error(
      "Submit mode is disabled. Set REMOTEJOBOS_ALLOW_SUBMIT=true only after dry-run verification."
    );
  }

  const resumePath = await renderApplicationResume(applicationId);

  const workerId =
    process.env.GITHUB_RUN_ID
      ? `github-actions:${process.env.GITHUB_RUN_ID}`
      : `worker:${process.pid}`;

  await recordEvent(
    "application.started",
    `Application execution started in ${mode} mode`,
    {
      applicationId,
      jobId: job.id,
      title: job.title,
      company: job.company,
      adapter: adapter.name,
      mode
    }
  );

  const outcome = await runApplicationPipeline(
    {
      applicationId,
      jobUrl: job.apply_url,
      workerId,
      dryRun: !submitEnabled,
      assets: resumePath ? { resume: resumePath } : undefined
    },
    adapter,
    new SupabaseApplicationStore()
  );

  if (outcome.status !== "submitted") {
    const nextAction =
      outcome.status === "dry-run-verified"
        ? "Dry-run passed: form filled and DOM values verified; ready for approval"
        : outcome.reason;

    await patchApplication(applicationId, "ready-for-review", nextAction);
  }

  await recordEvent(
    outcome.status === "failed" ? "application.failed" : "application.finished",
    `Application execution finished: ${outcome.status}`,
    {
      applicationId,
      jobId: job.id,
      adapter: adapter.name,
      mode,
      outcome
    }
  );

  return outcome;
}
