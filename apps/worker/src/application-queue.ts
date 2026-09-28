import { config, hasSupabase } from "./config.js";
import { claimTask, finishTask, type ClaimedTask } from "./task-queue.js";
import { runOneApplication } from "./apply/run-one.js";
import {
  blockHarnessRun,
  checkpointApplicationRun,
  completeHarnessRun,
  createHarnessStageObserver,
  failHarnessRun,
  requestSubmissionApproval,
  requireApprovedSubmission,
  salvagePersistedApplicationResult,
  startOrResumeApplicationRun,
  verifyApplicationOutcome
} from "./agent-harness.js";

const REVIEW_TASK_TYPE = "application-review";
const SUBMIT_TASK_TYPE = "application-submit";

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

function payloadString(task: ClaimedTask, key: string): string {
  const value = task.payload[key];
  if (typeof value !== "string" || !value) {
    throw new Error(`Task ${task.id} has no ${key}`);
  }
  return value;
}

function applicationIdFromTask(task: ClaimedTask): string {
  return payloadString(task, "applicationId");
}

async function verifyWithSalvage(
  applicationId: string,
  mode: "dry-run" | "submit",
  outcome: Awaited<ReturnType<typeof runOneApplication>>
) {
  const verification = await verifyApplicationOutcome(applicationId, outcome);
  if (verification.verified) return verification;

  // One deterministic salvage pass: only persisted database evidence may
  // rescue a run. This never clicks submit a second time.
  return salvagePersistedApplicationResult(applicationId, mode);
}

async function processReviewTask(task: ClaimedTask, applicationId: string): Promise<void> {
  const run = await startOrResumeApplicationRun({
    taskId: task.id,
    applicationId,
    mode: "dry-run"
  });

  if (
    run.status === "waiting-approval" ||
    run.status === "completed" ||
    run.status === "cancelled" ||
    run.status === "blocked"
  ) {
    await finishTask(task, true);
    return;
  }

  try {
    await checkpointApplicationRun(run.id, "context", {
      taskType: task.task_type,
      applicationId
    });
    await checkpointApplicationRun(run.id, "cv", {
      applicationId,
      note: "Resume asset will be rendered before browser execution."
    });

    const outcome = await runOneApplication(applicationId, "dry-run", {
      stageObserver: createHarnessStageObserver(run.id)
    });
    const verification = await verifyWithSalvage(applicationId, "dry-run", outcome);

    if (verification.verified && verification.terminal === "dry-run-verified") {
      const approval = await requestSubmissionApproval({
        runId: run.id,
        applicationId,
        verification
      });

      await updateApplication(applicationId, {
        status: "ready-for-review",
        next_action: `Dry-run verified. Approval ${approval.id} is required before live submission.`
      });
      await finishTask(task, true);
      return;
    }

    if (
      verification.terminal === "needs-review" ||
      verification.terminal === "blocked"
    ) {
      await blockHarnessRun(run.id, applicationId, verification.reason, {
        verification,
        outcome
      });
      await updateApplication(applicationId, {
        status: "ready-for-review",
        next_action: verification.reason
      });
      await finishTask(task, true);
      return;
    }

    const runStatus = await failHarnessRun(
      run.id,
      applicationId,
      verification.reason,
      { verification, outcome }
    );

    if (runStatus === "blocked") {
      await updateApplication(applicationId, {
        status: "ready-for-review",
        next_action: verification.reason
      });
      await finishTask(task, true);
    } else {
      await finishTask(task, false, verification.reason, 1800);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    if (reason.startsWith("No supported application adapter")) {
      await blockHarnessRun(run.id, applicationId, reason, {
        taskType: task.task_type
      }).catch(() => undefined);
      await updateApplication(applicationId, {
        status: "ready-for-review",
        next_action: "No verified browser adapter exists for this ATS yet"
      }).catch(() => undefined);
      await finishTask(task, true).catch(() => undefined);
      console.log(`[application-queue] unsupported ATS moved to review: ${applicationId}`);
      return;
    }

    const runStatus = await failHarnessRun(
      run.id,
      applicationId,
      reason,
      { taskType: task.task_type }
    ).catch(() => "failed" as const);

    if (runStatus === "blocked") {
      await updateApplication(applicationId, {
        status: "ready-for-review",
        next_action: reason
      }).catch(() => undefined);
      await finishTask(task, true).catch(() => undefined);
    } else {
      await finishTask(task, false, reason, 1800).catch(() => undefined);
    }
    console.error(`[application-queue] task ${task.id} failed:`, reason);
  }
}

async function processSubmitTask(task: ClaimedTask, applicationId: string): Promise<void> {
  const runId = payloadString(task, "runId");
  const approvalId = payloadString(task, "approvalId");

  await requireApprovedSubmission(runId, approvalId);

  const run = await startOrResumeApplicationRun({
    taskId: task.id,
    applicationId,
    mode: "submit",
    resumeRunId: runId
  });

  if (run.status === "completed") {
    await finishTask(task, true);
    return;
  }

  try {
    await checkpointApplicationRun(run.id, "context", {
      taskType: task.task_type,
      applicationId,
      approvalId,
      resumedAfterApproval: true
    });
    await checkpointApplicationRun(run.id, "cv", {
      applicationId,
      approvalId,
      note: "Re-render/reload verified CV before a fresh browser session."
    });

    const outcome = await runOneApplication(applicationId, "submit", {
      stageObserver: createHarnessStageObserver(run.id)
    });
    const verification = await verifyWithSalvage(applicationId, "submit", outcome);

    if (verification.verified && verification.terminal === "submitted") {
      await completeHarnessRun(run.id, verification, approvalId);
      await finishTask(task, true);
      return;
    }

    if (
      verification.terminal === "needs-review" ||
      verification.terminal === "blocked"
    ) {
      await blockHarnessRun(run.id, applicationId, verification.reason, {
        verification,
        outcome,
        approvalId
      });
      await updateApplication(applicationId, {
        status: "ready-for-review",
        next_action: verification.reason
      });
      await finishTask(task, true);
      return;
    }

    const runStatus = await failHarnessRun(
      run.id,
      applicationId,
      verification.reason,
      { verification, outcome, approvalId }
    );

    if (runStatus === "blocked") {
      await updateApplication(applicationId, {
        status: "ready-for-review",
        next_action: verification.reason
      });
      await finishTask(task, true);
    } else {
      await finishTask(task, false, verification.reason, 1800);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const runStatus = await failHarnessRun(
      run.id,
      applicationId,
      reason,
      { approvalId, taskType: task.task_type }
    ).catch(() => "failed" as const);

    if (runStatus === "blocked") {
      await updateApplication(applicationId, {
        status: "ready-for-review",
        next_action: reason
      }).catch(() => undefined);
      await finishTask(task, true).catch(() => undefined);
    } else {
      await finishTask(task, false, reason, 1800).catch(() => undefined);
    }
    console.error(`[application-queue] submit task ${task.id} failed:`, reason);
  }
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
    task_type: REVIEW_TASK_TYPE,
    payload: { applicationId: application.id },
    status: "pending",
    priority: 50,
    max_attempts: 3,
    idempotency_key: `${REVIEW_TASK_TYPE}:${application.id}:${application.cv_version_id}`
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

  const submitEnabled =
    (process.env.REMOTEJOBOS_ALLOW_SUBMIT ?? "").toLowerCase() === "true";
  const allowedTaskTypes = submitEnabled
    ? [REVIEW_TASK_TYPE, SUBMIT_TASK_TYPE]
    : [REVIEW_TASK_TYPE];

  let processed = 0;

  while (processed < limit) {
    const task = await claimTask(workerId, allowedTaskTypes, 1800);
    if (!task) break;

    let applicationId = "";

    try {
      applicationId = applicationIdFromTask(task);
      if (task.task_type === SUBMIT_TASK_TYPE) {
        await processSubmitTask(task, applicationId);
      } else {
        await processReviewTask(task, applicationId);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await finishTask(task, false, reason, 1800).catch(() => undefined);
      console.error(`[application-queue] task ${task.id} failed before harness execution:`, reason);
    }

    processed += 1;
  }

  console.log(
    `[application-queue] processed=${processed} submitEnabled=${submitEnabled}`
  );
  return processed;
}
