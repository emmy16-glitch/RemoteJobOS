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

    console.log(
      "[apply-task] application=" +
        applicationId +
        " outcome=" +
        outcome.status
    );

    if (!successfulTask) {
      throw new Error(outcome.reason);
    }

    return true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await finishTask(task, false, message, 1800).catch(() => undefined);
    throw error;
  }
}
