import { config, hasSupabase } from "./config.js";
import { claimTask, finishTask, type ClaimedTask } from "./task-queue.js";
import { runOneApplication } from "./apply/run-one.js";

const TASK_TYPE = "application-review";

type ProfileRow = { id: string };
type CvRow = { id: string; job_id: string | null; created_at: string };
type ApplicationRow = {
  id: string;
  job_id: string;
  profile_id: string | null;
  cv_version_id: string | null;
  status: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!hasSupabase()) throw new Error("Supabase is required for application queue operations");

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
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

async function updateApplication(
  applicationId: string,
  values: Record<string, unknown>
): Promise<void> {
  await request(
    `applications?id=eq.${encodeURIComponent(applicationId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        ...values,
        updated_at: new Date().toISOString()
      })
    }
  );
}

function applicationIdFromTask(task: ClaimedTask): string {
  const applicationId = task.payload.applicationId;
  if (typeof applicationId !== "string" || !applicationId) {
    throw new Error(`Task ${task.id} has no applicationId`);
  }
  return applicationId;
}

export async function syncApplications(): Promise<number> {
  if (!hasSupabase()) {
    console.log("[application-queue] Supabase is not configured; skipping sync.");
    return 0;
  }

  const profiles = await request<ProfileRow[]>(
    "career_profiles?select=id&order=updated_at.desc&limit=1"
  );
  const profile = profiles[0];
  if (!profile) {
    console.log("[application-queue] No career profile exists yet.");
    return 0;
  }

  // prepare-cvs only creates CV plans for strong matches. This makes a CV plan
  // the durable promotion boundary from matching into application automation.
  const cvs = await request<CvRow[]>(
    `cv_versions?select=id,job_id,created_at&profile_id=eq.${encodeURIComponent(profile.id)}&job_id=not.is.null&order=created_at.desc&limit=500`
  );

  const newestCvByJob = new Map<string, CvRow>();
  for (const cv of cvs) {
    if (cv.job_id && !newestCvByJob.has(cv.job_id)) {
      newestCvByJob.set(cv.job_id, cv);
    }
  }

  const applications = await request<ApplicationRow[]>(
    `applications?select=id,job_id,profile_id,cv_version_id,status&profile_id=eq.${encodeURIComponent(profile.id)}&limit=1000`
  );
  const byJob = new Map(applications.map((application) => [application.job_id, application]));

  const rows = [...newestCvByJob.entries()]
    .filter(([jobId]) => !byJob.has(jobId))
    .map(([jobId, cv]) => ({
      job_id: jobId,
      profile_id: profile.id,
      cv_version_id: cv.id,
      status: "cv-prepared",
      autonomy_mode: "review",
      next_action: "cloud-dry-run"
    }));

  let created: ApplicationRow[] = [];
  if (rows.length) {
    created = await request<ApplicationRow[]>(
      "applications?select=id,job_id,profile_id,cv_version_id,status",
      {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify(rows)
      }
    );
  }

  const allApplications = [...applications, ...created];
  const reviewable = allApplications.filter(
    (application) =>
      application.status === "cv-prepared" &&
      Boolean(application.cv_version_id)
  );

  const tasks = reviewable.map((application) => ({
    task_type: TASK_TYPE,
    payload: { applicationId: application.id },
    status: "pending",
    priority: 50,
    max_attempts: 3,
    idempotency_key: `${TASK_TYPE}:${application.id}:${application.cv_version_id}`
  }));

  if (tasks.length) {
    await request(
      "agent_tasks?on_conflict=idempotency_key",
      {
        method: "POST",
        headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(tasks)
      }
    );
  }

  console.log(
    `[application-queue] created=${created.length} queued=${tasks.length} ready=${reviewable.length}`
  );

  return created.length + tasks.length;
}

export async function processApplicationTasks(maxTasks = 3): Promise<number> {
  if (!hasSupabase()) {
    console.log("[application-queue] Supabase is not configured; skipping processor.");
    return 0;
  }

  const limit = Math.max(1, Math.min(10, maxTasks));
  const workerId = process.env.GITHUB_RUN_ID
    ? `github-actions:${process.env.GITHUB_RUN_ID}`
    : `worker:${process.pid}`;

  let processed = 0;

  while (processed < limit) {
    const task = await claimTask(workerId, [TASK_TYPE], 1800);
    if (!task) break;

    let applicationId = "";

    try {
      applicationId = applicationIdFromTask(task);
      const outcome = await runOneApplication(applicationId, "dry-run");

      if (outcome.status === "failed") {
        await finishTask(task, false, outcome.reason, 1800);
      } else {
        const nextAction =
          outcome.status === "dry-run-verified"
            ? "Dry-run passed: form values verified; ready for review"
            : outcome.status === "needs-review" || outcome.status === "blocked"
              ? outcome.reason
              : outcome.status;

        await updateApplication(applicationId, {
          status: "ready-for-review",
          next_action: nextAction
        });
        await finishTask(task, true);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      if (applicationId && reason.startsWith("No supported application adapter")) {
        await updateApplication(applicationId, {
          status: "ready-for-review",
          next_action: "No verified browser adapter exists for this ATS yet"
        }).catch(() => undefined);
        await finishTask(task, true).catch(() => undefined);
        console.log(`[application-queue] unsupported ATS moved to review: ${applicationId}`);
      } else {
        await finishTask(task, false, reason, 1800).catch(() => undefined);
        console.error(`[application-queue] task ${task.id} failed:`, reason);
      }
    }

    processed += 1;
  }

  console.log(`[application-queue] processed=${processed}`);
  return processed;
}
