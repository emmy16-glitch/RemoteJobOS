import { claimTask, finishTask } from "./task-queue.js";
import { runOneApplication } from "./apply/run-one.js";

export async function processOneApplicationTask(): Promise<boolean> {
  const workerId = process.env.GITHUB_RUN_ID
    ? "github:" + process.env.GITHUB_RUN_ID
    : "local:" + process.pid;

  const task = await claimTask(workerId, ["application-dry-run"], 1800);
  if (!task) {
    console.log("[apply-task] no pending application dry-run task");
    return false;
  }

  const applicationId =
    typeof task.payload.applicationId === "string"
      ? task.payload.applicationId
      : "";

  if (!applicationId) {
    await finishTask(task, false, "Task payload has no applicationId", 3600);
    throw new Error("Application task has invalid payload");
  }

  try {
    const outcome = await runOneApplication(applicationId, "dry-run");
    const successfulTask = outcome.status !== "failed";

    await finishTask(
      task,
      successfulTask,
      successfulTask ? undefined : outcome.reason,
      successfulTask ? 300 : 1800
    );

    console.log("[apply-task] application=" + applicationId + " outcome=" + outcome.status);

    if (!successfulTask) throw new Error(outcome.reason);
    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);

    // Unsupported ATSs are already marked ready-for-review by runOneApplication.
    // Completing this queue item avoids three pointless browser retries.
    if (message.startsWith("No supported application adapter")) {
      await finishTask(task, true).catch(() => undefined);
      console.log("[apply-task] unsupported ATS moved to human review: " + applicationId);
      return true;
    }

    await finishTask(task, false, message, 1800).catch(() => undefined);
    throw error;
  }
}

export async function processApplicationTasks(maxTasks = 3): Promise<number> {
  let processed = 0;
  const limit = Math.max(1, Math.min(10, maxTasks));

  while (processed < limit) {
    try {
      const hadTask = await processOneApplicationTask();
      if (!hadTask) break;
    } catch (error) {
      console.error("[apply-task] task failed:", error);
    }
    processed += 1;
  }

  console.log("[apply-task] processed=" + processed);
  return processed;
}
