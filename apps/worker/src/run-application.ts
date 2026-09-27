import { config, hasSupabase } from "./config.js";
import { renderApplicationResume } from "./resume-renderer.js";
import { createDefaultAdapterRegistry } from "./apply/default-adapters.js";
import { runApplicationPipeline, type PipelineOutcome } from "./apply/engine.js";
import { SupabaseApplicationStore } from "./apply/store.js";

export type ApplicationMode = "dry-run" | "review" | "submit";

type ApplicationRow = {
  id: string;
  job_id: string;
};

type JobRow = {
  apply_url: string;
};

async function request<T>(pathPart: string, init?: RequestInit): Promise<T> {
  if (!hasSupabase()) throw new Error("Supabase is required for application execution");

  const response = await fetch(config.supabaseUrl + "/rest/v1/" + pathPart, {
    ...init,
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: "Bearer " + config.supabaseServiceRoleKey,
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error("Supabase request failed: " + response.status + " " + await response.text());
  }

  if (response.status === 204) return undefined as T;
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

async function setApplicationState(applicationId: string, status: string, nextAction: string): Promise<void> {
  await request("applications?id=eq." + encodeURIComponent(applicationId), {
    method: "PATCH",
    body: JSON.stringify({
      status,
      next_action: nextAction,
      updated_at: new Date().toISOString()
    })
  });
}

export async function runApplication(
  applicationId: string,
  mode: ApplicationMode = "dry-run"
): Promise<PipelineOutcome> {
  if (!hasSupabase()) throw new Error("Supabase is not configured");

  if (mode === "submit" && process.env.REMOTEJOBOS_ALLOW_SUBMIT !== "true") {
    throw new Error("Live submission is disabled. Set REMOTEJOBOS_ALLOW_SUBMIT=true explicitly.");
  }

  const applications = await request<ApplicationRow[]>(
    "applications?select=id,job_id&id=eq." + encodeURIComponent(applicationId) + "&limit=1"
  );
  const application = applications[0];
  if (!application) throw new Error("Application not found: " + applicationId);

  const jobs = await request<JobRow[]>(
    "jobs?select=apply_url&id=eq." + encodeURIComponent(application.job_id) + "&limit=1"
  );
  const jobUrl = jobs[0]?.apply_url;
  if (!jobUrl) throw new Error("Application job has no apply URL");

  const resumePath = await renderApplicationResume(applicationId);
  const registry = createDefaultAdapterRegistry();
  const adapter = registry.resolve(jobUrl);

  if (!adapter) {
    await setApplicationState(
      applicationId,
      "ready-for-review",
      "No verified browser adapter exists for this ATS yet"
    );
    throw new Error("Unsupported ATS for application URL: " + jobUrl);
  }

  const store = new SupabaseApplicationStore();
  const workerId = process.env.GITHUB_RUN_ID
    ? "github:" + process.env.GITHUB_RUN_ID
    : "local:" + process.pid;

  const outcome = await runApplicationPipeline(
    {
      applicationId,
      jobUrl,
      workerId,
      dryRun: mode !== "submit",
      assets: resumePath ? { resume: resumePath } : {}
    },
    adapter,
    store
  );

  if (outcome.status === "submitted") {
    return outcome;
  }

  if (outcome.status === "dry-run-verified") {
    await setApplicationState(
      applicationId,
      "ready-for-review",
      "Dry-run passed: form filled and DOM values verified"
    );
  } else if (outcome.status === "needs-review" || outcome.status === "blocked") {
    await setApplicationState(applicationId, "ready-for-review", outcome.reason);
  } else {
    await setApplicationState(applicationId, "ready-for-review", outcome.reason);
  }

  return outcome;
}
