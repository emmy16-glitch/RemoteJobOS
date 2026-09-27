import { config, hasSupabase } from "./config.js";
import { claimTask, finishTask, type ClaimedTask } from "./task-queue.js";
import { runOneApplication } from "./apply/run-one.js";

async function updateApplication(
  applicationId: string,
  values: Record<string, unknown>
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
      body: JSON.stringify(values)
    }
  );
  if (!response.ok) {
    throw new Error(`Application update failed: ${response.status} ${await response.text()}`);
  }
}

function applicationIdFromTask(task: ClaimedTask): string {
  const value = task.payload.applicationId;
  if (typeof value !== "string" || !value) {
    throw new Error(`Task ${task.id} has no applicationId`);
  }
  return value;
}

export async function processApplicationReviewQueue(maxTasks = 3): Promise<number> {
  if (!hasSupabase()) {
    console.log("[review-queue] Supabase is not configured; skipping.");
    return 0;
  }

  const workerId = process.env.GITHUB_RUN_ID
    ? `github-actions:${process.env.GITHUB_RUN_ID}`
    : `worker:${process.pid}`;

  let processed = 0;

  while (processed < maxTasks) {
    const task = await claimTask(workerId, ["application-review"], 1200);
    if (!task) break;

    try {
      const applicationId = applicationIdFromTask(task);
      const outcome = await runOneApplication(applicationId, "dry-run");

      if (outcome.status === "failed") {
        await finishTask(task, false, outcome.reason, 900);
      } else {
        const nextAction =
          outcome.status === "dry-run-verified"
            ? "verified-dry-run"
            : outcome.status === "needs-review"
              ? outcome.reason
              : outcome.status === "blocked"
                ? outcome.reason
                : outcome.status;

        await updateApplication(applicationId, {
          status: "ready-for-review",
          next_action: nextAction,
          updated_at: new Date().toISOString()
        });
        await finishTask(task, true);
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);

      if (reason.startsWith("No supported application adapter")) {
        await finishTask(task, true).catch(() => undefined);
        console.log(`[review-queue] unsupported ATS moved to human review: ${task.id}`);
      } else {
        await finishTask(task, false, reason, 900).catch(() => undefined);
        console.error(`[review-queue] task ${task.id} failed:`, reason);
      }
    }

    processed += 1;
  }

  console.log(`[review-queue] processed=${processed}`);
  return processed;
}
