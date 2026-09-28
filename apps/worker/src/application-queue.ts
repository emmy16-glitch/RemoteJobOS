import {
  DEFAULT_SAFE_SUBMIT_RETRIES,
  retryDelayMs
} from "@remotejobos/core";
import { config, hasSupabase } from "./config.js";
import {
  claimTask,
  claimTaskByIdempotencyKey,
  finishTask,
  type ClaimedTask
} from "./task-queue.js";
import { runOneApplication } from "./apply/run-one.js";
import {
  blockHarnessRun,
  checkpointApplicationRun,
  completeHarnessRun,
  createHarnessStageObserver,
  failHarnessRun,
  getHarnessApproval,
  authorizeAutoSubmission,
  requestSubmissionApproval,
  requireApprovedSubmission,
  reserveSubmitAttempt,
  salvagePersistedApplicationResult,
  startOrResumeApplicationRun,
  verifyApplicationOutcome
} from "./agent-harness.js";
import {
  createApplicationException,
  createFieldExceptions
} from "./application-exceptions.js";
import {
  jobLabelForApplication,
  queueNotification
} from "./notifications.js";

const REVIEW_TASK_TYPE = "application-review";
const SUBMIT_TASK_TYPE = "application-submit";
const AUTO_SUBMIT_TASK_TYPE = "application-auto-submit";

type ProfileRow = {
  id: string;
  profile?: {
    settings?: {
      autonomyMode?: string;
    };
  };
};
type CvRow = { id: string; job_id: string | null; created_at: string };
type ApplicationRow = {
  id: string;
  job_id: string;
  profile_id: string | null;
  cv_version_id: string | null;
  status: string;
  autonomy_mode?: string;
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

async function applicationAutonomyMode(applicationId: string): Promise<string> {
  const rows = await request<Array<{ autonomy_mode: string }>>(
    `applications?select=autonomy_mode&id=eq.${encodeURIComponent(applicationId)}&limit=1`
  );
  return rows[0]?.autonomy_mode ?? "auto-except";
}

async function notifySubmitted(applicationId: string): Promise<void> {
  const job = await jobLabelForApplication(applicationId);
  await queueNotification({
    applicationId,
    kind: "submitted",
    subject: `Application submitted: ${job.company} — ${job.title}`,
    bodyText: [
      "RemoteJobOS submitted and verified your application.",
      "",
      `Company: ${job.company}`,
      `Role: ${job.title}`,
      "",
      "The application was marked submitted only after confirmation evidence was detected."
    ].join("\n"),
    dedupeKey: `submitted:${applicationId}`
  });
}

async function verifyWithSalvage(
  applicationId: string,
  mode: "dry-run" | "submit",
  outcome: Awaited<ReturnType<typeof runOneApplication>>
) {
  const verification = await verifyApplicationOutcome(applicationId, outcome);
  if (verification.verified) return verification;

  // A failure explicitly classified as safe/retryable has not started the
  // consequential side effect, so preserve that classification instead of
  // replacing it with a generic salvage result.
  if (
    outcome.status === "failed" &&
    outcome.retryable &&
    !outcome.sideEffectStarted
  ) {
    return verification;
  }

  // One deterministic salvage pass checks only persisted evidence. It never
  // clicks Submit again.
  return salvagePersistedApplicationResult(applicationId, mode);
}

async function processReviewTask(task: ClaimedTask, applicationId: string): Promise<void> {
  const resumeRunId =
    typeof task.payload.runId === "string" && task.payload.runId
      ? task.payload.runId
      : undefined;

  const run = await startOrResumeApplicationRun({
    taskId: task.id,
    applicationId,
    mode: "dry-run",
    resumeRunId
  });

  if (
    run.status === "waiting-approval" ||
    run.status === "completed" ||
    run.status === "cancelled"
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
      const autonomyMode = await applicationAutonomyMode(applicationId);

      if (autonomyMode === "auto-except") {
        await authorizeAutoSubmission({
          runId: run.id,
          applicationId,
          verification
        });
      } else {
        const approval = await requestSubmissionApproval({
          runId: run.id,
          applicationId,
          verification
        });
        await updateApplication(applicationId, {
          status: "ready-for-review",
          next_action: `Dry-run verified. Approval ${approval.id} is required before live submission.`
        });
      }

      await finishTask(task, true);
      return;
    }

    if (outcome.status === "needs-review") {
      await createFieldExceptions({
        applicationId,
        runId: run.id,
        attemptId: outcome.attemptId,
        fields: outcome.fields
      });
      await blockHarnessRun(run.id, applicationId, verification.reason, {
        verification,
        outcome
      });
      await finishTask(task, true);
      return;
    }

    if (verification.terminal === "blocked") {
      const issueType =
        outcome.status === "blocked" &&
        "issues" in outcome &&
        Array.isArray(outcome.issues) &&
        outcome.issues.some((issue) => issue.fieldKey === "captcha")
          ? "captcha"
          : "verification-failed";

      await createApplicationException({
        applicationId,
        runId: run.id,
        type: issueType,
        title:
          issueType === "captcha"
            ? "CAPTCHA requires your attention"
            : "Application verification needs review",
        detail: verification.reason,
        payload: { verification, outcome },
        dedupeKey: `${issueType}:${applicationId}:${outcome.attemptId}`
      });

      await blockHarnessRun(run.id, applicationId, verification.reason, {
        verification,
        outcome
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
      await createApplicationException({
        applicationId,
        runId: run.id,
        type: "other",
        title: "Application run needs review",
        detail: verification.reason,
        payload: { verification, outcome },
        dedupeKey: `blocked:${applicationId}:${outcome.attemptId}`
      });
      await finishTask(task, true);
    } else {
      await finishTask(task, false, verification.reason, 1800);
    }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    if (reason.startsWith("No supported application adapter")) {
      await createApplicationException({
        applicationId,
        runId: run.id,
        type: "unsupported-ats",
        title: "This job site needs a new application adapter",
        detail: "RemoteJobOS could not safely automate this ATS yet. Open the job from the dashboard or wait until support is added.",
        payload: { reason },
        dedupeKey: `unsupported-ats:${applicationId}`
      }).catch(() => undefined);

      await blockHarnessRun(run.id, applicationId, reason, {
        taskType: task.task_type
      }).catch(() => undefined);
      await finishTask(task, true).catch(() => undefined);
      console.log(`[application-queue] unsupported ATS moved to exceptions: ${applicationId}`);
      return;
    }

    const runStatus = await failHarnessRun(
      run.id,
      applicationId,
      reason,
      { taskType: task.task_type }
    ).catch(() => "failed" as const);

    if (runStatus === "blocked") {
      await createApplicationException({
        applicationId,
        runId: run.id,
        type: "other",
        title: "Application automation stopped",
        detail: reason,
        payload: { taskType: task.task_type },
        dedupeKey: `review-failure:${applicationId}:${run.id}`
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
  if (run.status === "blocked" && run.recovery_strategy === "manual-reconcile") {
    await createApplicationException({
      applicationId,
      runId: run.id,
      type: "submit-uncertain",
      title: "Submission outcome is uncertain",
      detail: "RemoteJobOS detected that a submit side effect may have started, but it could not verify the final confirmation. It will not click Submit again until you review it.",
      payload: { approvalId, recoveryStrategy: run.recovery_strategy },
      dedupeKey: `submit-uncertain:${applicationId}:${run.id}`
    }).catch(() => undefined);
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
      note: "Re-render/reload verified CV before each safe browser submission attempt."
    });

    for (let localTry = 1; localTry <= DEFAULT_SAFE_SUBMIT_RETRIES; localTry += 1) {
      const outcome = await runOneApplication(applicationId, "submit", {
        stageObserver: createHarnessStageObserver(run.id),
        beforeSubmitAttempt: () =>
          reserveSubmitAttempt(run.id, DEFAULT_SAFE_SUBMIT_RETRIES)
      });
      const verification = await verifyWithSalvage(applicationId, "submit", outcome);

      if (verification.verified && verification.terminal === "submitted") {
        await completeHarnessRun(run.id, verification, approvalId);
        await notifySubmitted(applicationId).catch(() => undefined);
        await finishTask(task, true);
        return;
      }

      if (outcome.status === "needs-review") {
        await createFieldExceptions({
          applicationId,
          runId: run.id,
          attemptId: outcome.attemptId,
          fields: outcome.fields
        });
        await blockHarnessRun(run.id, applicationId, verification.reason, {
          verification,
          outcome,
          approvalId
        });
        await finishTask(task, true);
        return;
      }

      if (verification.terminal === "blocked") {
        const uncertain =
          verification.evidence?.recovery === "manual-reconcile" ||
          (
            outcome.status === "failed" &&
            outcome.sideEffectStarted
          );

        await createApplicationException({
          applicationId,
          runId: run.id,
          type: uncertain ? "submit-uncertain" : "verification-failed",
          title: uncertain
            ? "Submission outcome is uncertain"
            : "Submission needs review",
          detail: verification.reason,
          payload: { verification, outcome, approvalId },
          dedupeKey: `${uncertain ? "submit-uncertain" : "submit-blocked"}:${applicationId}:${outcome.attemptId}`
        });

        await blockHarnessRun(run.id, applicationId, verification.reason, {
          verification,
          outcome,
          approvalId
        });
        await finishTask(task, true);
        return;
      }

      const safeRetry =
        outcome.status === "failed" &&
        outcome.retryable &&
        !outcome.sideEffectStarted &&
        typeof outcome.submitAttempt === "number" &&
        outcome.submitAttempt < DEFAULT_SAFE_SUBMIT_RETRIES;

      if (safeRetry) {
        await checkpointApplicationRun(
          run.id,
          "report",
          {
            safeSubmitRetry: true,
            submitAttempt: outcome.submitAttempt,
            maxSubmitAttempts: DEFAULT_SAFE_SUBMIT_RETRIES,
            reason: outcome.reason
          },
          false
        );
        await sleep(retryDelayMs(outcome.submitAttempt ?? localTry));
        continue;
      }

      const retryLimitReached =
        outcome.status === "blocked" &&
        /retry limit exhausted/i.test(outcome.reason);

      if (
        retryLimitReached ||
        (
          outcome.status === "failed" &&
          outcome.retryable &&
          !outcome.sideEffectStarted &&
          outcome.submitAttempt === DEFAULT_SAFE_SUBMIT_RETRIES
        )
      ) {
        const reason =
          `Safe submit retry limit reached after ${DEFAULT_SAFE_SUBMIT_RETRIES} attempts. RemoteJobOS needs you to inspect the job before another attempt.`;

        await createApplicationException({
          applicationId,
          runId: run.id,
          type: "retry-exhausted",
          title: "Automatic submit retries were exhausted",
          detail: reason,
          payload: { verification, outcome, approvalId },
          dedupeKey: `retry-exhausted:${applicationId}:${run.id}`
        });

        await blockHarnessRun(run.id, applicationId, reason, {
          verification,
          outcome,
          approvalId
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
        await createApplicationException({
          applicationId,
          runId: run.id,
          type: "submit-uncertain",
          title: "Submission needs reconciliation",
          detail: verification.reason,
          payload: { verification, outcome, approvalId },
          dedupeKey: `submit-reconcile:${applicationId}:${run.id}`
        }).catch(() => undefined);
        await finishTask(task, true);
      } else {
        await finishTask(task, false, verification.reason, 1800);
      }
      return;
    }

    const reason = "Submit retry loop ended without a terminal result";
    await createApplicationException({
      applicationId,
      runId: run.id,
      type: "other",
      title: "Submission worker stopped unexpectedly",
      detail: reason,
      payload: { approvalId },
      dedupeKey: `submit-loop-ended:${applicationId}:${run.id}`
    });
    await blockHarnessRun(run.id, applicationId, reason, { approvalId });
    await finishTask(task, true);
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const runStatus = await failHarnessRun(
      run.id,
      applicationId,
      reason,
      { approvalId, taskType: task.task_type }
    ).catch(() => "failed" as const);

    if (runStatus === "blocked") {
      await createApplicationException({
        applicationId,
        runId: run.id,
        type: "submit-uncertain",
        title: "Submission worker needs review",
        detail: reason,
        payload: { approvalId, taskType: task.task_type },
        dedupeKey: `submit-error:${applicationId}:${run.id}`
      }).catch(() => undefined);
      await finishTask(task, true).catch(() => undefined);
    } else {
      await finishTask(task, false, reason, 1800).catch(() => undefined);
    }
    console.error(`[application-queue] submit task ${task.id} failed:`, reason);
  }
}

async function syncProfileApplications(profile: ProfileRow): Promise<{
  created: number;
  queued: number;
}> {
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
    `applications?select=id,job_id,profile_id,cv_version_id,status,autonomy_mode&profile_id=eq.${encodeURIComponent(profile.id)}&limit=1000`
  );

  // Before a dry-run starts, keep the application pointed at the newest CV
  // generated from the current profile/job inputs. Once it reaches review we
  // freeze the reviewed CV version so approval cannot silently switch content.
  for (const application of applications) {
    const newestCv = newestCvByJob.get(application.job_id);
    if (
      newestCv &&
      application.status === "cv-prepared" &&
      application.cv_version_id !== newestCv.id
    ) {
      await updateApplication(application.id, {
        cv_version_id: newestCv.id,
        next_action: "cloud-dry-run"
      });
      application.cv_version_id = newestCv.id;
    }
  }

  const byJob = new Map(applications.map((application) => [application.job_id, application]));

  const autonomyMode =
    profile.profile?.settings?.autonomyMode === "review"
      ? "review"
      : "auto-except";

  const rows = [...newestCvByJob.entries()]
    .filter(([jobId]) => !byJob.has(jobId))
    .map(([jobId, cv]) => ({
      job_id: jobId,
      profile_id: profile.id,
      cv_version_id: cv.id,
      status: "cv-prepared",
      autonomy_mode: autonomyMode,
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

  return { created: created.length, queued: tasks.length };
}

export async function syncApplications(): Promise<number> {
  if (!hasSupabase()) {
    console.log("[application-queue] Supabase is not configured; skipping sync.");
    return 0;
  }

  const profiles = await request<ProfileRow[]>(
    "career_profiles?select=id,profile&order=updated_at.desc&limit=1000"
  );
  if (!profiles.length) {
    console.log("[application-queue] No career profile exists yet.");
    return 0;
  }

  let created = 0;
  let queued = 0;

  for (const profile of profiles) {
    const result = await syncProfileApplications(profile);
    created += result.created;
    queued += result.queued;
  }

  console.log(
    `[application-queue] profiles=${profiles.length} created=${created} queued=${queued}`
  );

  return created + queued;
}

function workerId(): string {
  return process.env.GITHUB_RUN_ID
    ? `github-actions:${process.env.GITHUB_RUN_ID}`
    : `worker:${process.pid}`;
}

export async function processAutoSubmissionTasks(maxTasks = 3): Promise<number> {
  if (!hasSupabase()) {
    console.log("[application-queue] Supabase is not configured; skipping auto-submit processor.");
    return 0;
  }
  if ((process.env.REMOTEJOBOS_ALLOW_SUBMIT ?? "").toLowerCase() !== "true") {
    throw new Error("Live submission is disabled");
  }

  const limit = Math.max(1, Math.min(10, maxTasks));
  const id = workerId();
  let processed = 0;

  while (processed < limit) {
    const task = await claimTask(id, [AUTO_SUBMIT_TASK_TYPE], 1800);
    if (!task) break;

    try {
      const applicationId = applicationIdFromTask(task);
      await processSubmitTask(task, applicationId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await finishTask(task, false, reason, 1800).catch(() => undefined);
      console.error(`[application-queue] auto-submit task ${task.id} failed:`, reason);
    }

    processed += 1;
  }

  console.log(`[application-queue] auto-submit processed=${processed}`);
  return processed;
}

export async function processApprovedSubmission(approvalId: string): Promise<number> {
  if (!hasSupabase()) throw new Error("Supabase is required for approved submission");
  if ((process.env.REMOTEJOBOS_ALLOW_SUBMIT ?? "").toLowerCase() !== "true") {
    throw new Error("Live submission is disabled");
  }

  const approval = await getHarnessApproval(approvalId);
  if (approval.status === "executed") return 0;
  if (approval.status !== "approved") {
    throw new Error(`Approval ${approvalId} is ${approval.status}, not approved`);
  }

  const key = `application-submit:${approval.run_id}:${approval.id}`;
  const task = await claimTaskByIdempotencyKey(workerId(), key, 1800);
  if (!task) {
    throw new Error(
      "The exact approved submission task is not currently claimable; it may already be running, completed, or waiting for its retry lease."
    );
  }

  const applicationId = applicationIdFromTask(task);
  await processSubmitTask(task, applicationId);
  return 1;
}

export async function processApplicationTasks(maxTasks = 3): Promise<number> {
  if (!hasSupabase()) {
    console.log("[application-queue] Supabase is not configured; skipping processor.");
    return 0;
  }

  const limit = Math.max(1, Math.min(10, maxTasks));
  const id = workerId();

  // The normal queue remains dry-run/review only. Consequential submit tasks
  // must be claimed by approval ID through processApprovedSubmission().
  const allowedTaskTypes = [REVIEW_TASK_TYPE];

  let processed = 0;

  while (processed < limit) {
    const task = await claimTask(id, allowedTaskTypes, 1800);
    if (!task) break;

    let applicationId = "";

    try {
      applicationId = applicationIdFromTask(task);
      await processReviewTask(task, applicationId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await finishTask(task, false, reason, 1800).catch(() => undefined);
      console.error(`[application-queue] task ${task.id} failed before harness execution:`, reason);
    }

    processed += 1;
  }

  console.log(`[application-queue] processed=${processed} mode=review-only`);
  return processed;
}
