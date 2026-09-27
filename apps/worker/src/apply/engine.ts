import { buildDeterministicFillPlan } from "@remotejobos/core";
import type { ApplicationAdapter, ApplicationContext, ApplicationStore } from "./types.js";

export type PipelineOutcome =
  | { status: "needs-review"; attemptId: string; reason: string }
  | { status: "dry-run-verified"; attemptId: string }
  | { status: "submitted"; attemptId: string; confirmed: boolean }
  | { status: "blocked"; attemptId: string; reason: string }
  | { status: "failed"; attemptId: string; reason: string };

export async function runApplicationPipeline(
  context: ApplicationContext,
  adapter: ApplicationAdapter,
  store: ApplicationStore
): Promise<PipelineOutcome> {
  const attemptId = await store.startAttempt(context.applicationId, context.workerId);

  try {
    await store.recordStage(attemptId, "scan", "started");
    const fields = await adapter.scan(context);

    await store.recordStage(attemptId, "plan", "started", { fieldCount: fields.length });
    const verifiedAnswers = await store.getVerifiedAnswers(context.applicationId);
    const plan = buildDeterministicFillPlan(fields, verifiedAnswers);

    const reviews = plan.filter((entry) => entry.action.type === "human-review");
    if (reviews.length) {
      const reason = `${reviews.length} field(s) require explicit human review`;
      await store.recordStage(attemptId, "plan", "blocked", {
        reviewFields: reviews.map((entry) => ({
          key: entry.field.key,
          label: entry.field.label,
          reason: entry.action.type === "human-review" ? entry.action.reason : ""
        }))
      });
      return { status: "needs-review", attemptId, reason };
    }

    await store.recordStage(attemptId, "fill", "started");
    await adapter.fill(context, plan);

    const verification = await adapter.verify(context, plan);
    if (!verification.ok) {
      await store.recordStage(attemptId, "verify", "blocked", {
        verification: verification as unknown as Record<string, unknown>
      });
      return {
        status: "blocked",
        attemptId,
        reason: `Verification failed with ${verification.issues.length} issue(s)`
      };
    }

    await store.recordStage(attemptId, "verify", "verified", {
      verifiedFieldCount: verification.verifiedFieldCount,
      totalFieldCount: verification.totalFieldCount
    });

    if (context.dryRun) {
      const screenshot = await adapter.screenshot?.(context, "dry-run-verified");
      await store.recordStage(attemptId, "report", "verified", {
        dryRun: true,
        screenshot
      });
      return { status: "dry-run-verified", attemptId };
    }

    const fence = await store.canSubmit(context.applicationId);
    if (!fence.allowed) {
      await store.recordStage(attemptId, "fence", "blocked", { reason: fence.reason });
      return { status: "blocked", attemptId, reason: fence.reason };
    }

    const fenced = await store.fenceSubmission(context.applicationId, attemptId);
    if (!fenced) {
      await store.recordStage(attemptId, "fence", "blocked", { reason: "submission-fence-race" });
      return { status: "blocked", attemptId, reason: "submission-fence-race" };
    }

    // From here onward the application remains fenced even if the browser crashes.
    // That is deliberate: an unknown submit outcome is safer than a duplicate submission.
    await store.recordStage(attemptId, "submit", "started");
    const submission = await adapter.submit(context);
    if (!submission.submitted) {
      await store.recordStage(attemptId, "submit", "unknown", {
        url: submission.url,
        message: submission.message
      });
      return {
        status: "failed",
        attemptId,
        reason: submission.message ?? "Submit outcome could not be confirmed"
      };
    }

    const confirmation = await adapter.confirm(context);
    await store.markSubmitted(context.applicationId, confirmation);
    await store.recordStage(
      attemptId,
      "confirm",
      confirmation.confirmed ? "submitted" : "unknown",
      {
        confirmationUrl: confirmation.url,
        evidence: confirmation.evidence
      }
    );

    return { status: "submitted", attemptId, confirmed: confirmation.confirmed };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    await store.recordStage(attemptId, "report", "failed", undefined, reason).catch(() => undefined);
    return { status: "failed", attemptId, reason };
  }
}
