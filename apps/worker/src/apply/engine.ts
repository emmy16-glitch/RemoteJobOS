import {
  DEFAULT_CONFIRMATION_CHECKS,
  assertToolFamilyAllowed,
  buildDeterministicFillPlan,
  retryDelayMs
} from "@remotejobos/core";
import type { ApplicationAdapter, ApplicationContext, ApplicationStore } from "./types.js";

export type PipelineOutcome =
  | {
      status: "needs-review";
      attemptId: string;
      reason: string;
      fields: Array<{
        key: string;
        label: string;
        reason: string;
        sensitive: boolean;
        kind: string;
        options?: string[];
      }>;
    }
  | { status: "dry-run-verified"; attemptId: string }
  | { status: "submitted"; attemptId: string; confirmed: boolean }
  | {
      status: "blocked";
      attemptId: string;
      reason: string;
      issues?: Array<{
        fieldKey: string;
        code: string;
        message: string;
      }>;
    }
  | {
      status: "failed";
      attemptId: string;
      reason: string;
      retryable: boolean;
      sideEffectStarted: boolean;
      submitAttempt?: number;
    };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function runApplicationPipeline(
  context: ApplicationContext,
  adapter: ApplicationAdapter,
  store: ApplicationStore
): Promise<PipelineOutcome> {
  const attemptId = await store.startAttempt(context.applicationId, context.workerId);
  let fenced = false;
  let submitCallStarted = false;
  let sideEffectStarted = false;
  let reservedSubmitAttempt: number | null = null;

  try {
    const storedAssets = await store.getAssets(context.applicationId);
    const assets = { ...storedAssets, ...(context.assets ?? {}) };
    const executionContext: ApplicationContext = { ...context, assets };

    assertToolFamilyAllowed("scan", "browser");
    await store.recordStage(attemptId, "scan", "started");
    const fields = await adapter.scan(executionContext);

    assertToolFamilyAllowed("plan", "profile");
    await store.recordStage(attemptId, "plan", "started", { fieldCount: fields.length });
    const [verifiedAnswers, autoApprovedAnswerKeys] = await Promise.all([
      store.getVerifiedAnswers(context.applicationId),
      store.getAutoApprovedAnswerKeys(context.applicationId)
    ]);
    const plan = buildDeterministicFillPlan(
      fields,
      verifiedAnswers,
      Object.keys(assets),
      autoApprovedAnswerKeys
    );

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
      return {
        status: "needs-review",
        attemptId,
        reason,
        fields: reviews.map((entry) => ({
          key: entry.field.key,
          label: entry.field.label,
          reason:
            entry.action.type === "human-review"
              ? entry.action.reason
              : "Human review required",
          sensitive: Boolean(entry.field.sensitive),
          kind: entry.field.kind,
          options: entry.field.options
        }))
      };
    }

    assertToolFamilyAllowed("fill", "browser");
    await store.recordStage(attemptId, "fill", "started");
    await adapter.fill(executionContext, plan);

    assertToolFamilyAllowed("verify", "browser");
    assertToolFamilyAllowed("verify", "evidence");
    await store.recordStage(attemptId, "verify", "started");
    const verification = await adapter.verify(executionContext, plan);
    if (!verification.ok) {
      await store.recordStage(attemptId, "verify", "blocked", {
        verification: verification as unknown as Record<string, unknown>
      });
      return {
        status: "blocked",
        attemptId,
        reason: `Verification failed with ${verification.issues.length} issue(s)`,
        issues: verification.issues
      };
    }

    await store.recordStage(attemptId, "verify", "verified", {
      verifiedFieldCount: verification.verifiedFieldCount,
      totalFieldCount: verification.totalFieldCount
    });

    if (context.dryRun) {
      assertToolFamilyAllowed("report", "evidence");
      await store.recordStage(attemptId, "report", "started", { dryRun: true });
      const screenshot = await adapter.screenshot?.(executionContext, "dry-run-verified");
      await store.recordStage(attemptId, "report", "verified", {
        dryRun: true,
        screenshot
      });
      return { status: "dry-run-verified", attemptId };
    }

    assertToolFamilyAllowed("submit", "browser");
    assertToolFamilyAllowed("submit", "submission");
    await store.recordStage(attemptId, "submit-preflight", "started");
    const preparation = await adapter.prepareSubmit?.(executionContext) ?? {
      ready: true,
      retryable: false
    };

    if (!preparation.ready) {
      const reason = preparation.reason ?? "Submission preflight is not ready";
      const captchaBlocked = /captcha|anti-bot|verify you are human|security verification/i.test(reason);

      if (captchaBlocked) {
        await store.recordStage(attemptId, "submit-preflight", "blocked", {
          retryable: false,
          sideEffectStarted: false,
          reason
        });
        return {
          status: "blocked",
          attemptId,
          reason,
          issues: [{
            fieldKey: "captcha",
            code: "unverified",
            message: reason
          }]
        };
      }

      await store.recordStage(attemptId, "submit-preflight", "failed", {
        retryable: preparation.retryable,
        sideEffectStarted: false,
        reason
      });
      return {
        status: "failed",
        attemptId,
        reason,
        retryable: preparation.retryable,
        sideEffectStarted: false,
        submitAttempt: reservedSubmitAttempt ?? undefined
      };
    }
    reservedSubmitAttempt = context.beforeSubmitAttempt
      ? await context.beforeSubmitAttempt()
      : 1;

    if (reservedSubmitAttempt === null) {
      const reason = "Safe submit retry limit exhausted";
      await store.recordStage(attemptId, "submit-preflight", "blocked", {
        reason
      });
      return { status: "blocked", attemptId, reason };
    }

    await store.recordStage(attemptId, "submit-preflight", "verified", {
      submitAttempt: reservedSubmitAttempt
    });


    assertToolFamilyAllowed("fence", "policy");
    await store.recordStage(attemptId, "fence", "started");
    const fence = await store.canSubmit(context.applicationId);
    if (!fence.allowed) {
      await store.recordStage(attemptId, "fence", "blocked", { reason: fence.reason });
      return { status: "blocked", attemptId, reason: fence.reason };
    }

    const acquiredFence = await store.fenceSubmission(context.applicationId, attemptId);
    if (!acquiredFence) {
      await store.recordStage(attemptId, "fence", "blocked", { reason: "submission-fence-race" });
      return { status: "blocked", attemptId, reason: "submission-fence-race" };
    }
    fenced = true;

    await store.recordStage(attemptId, "submit", "started");
    submitCallStarted = true;
    const submission = await adapter.submit(executionContext);
    sideEffectStarted = submission.sideEffectStarted;

    if (!submission.submitted) {
      let fenceReleased = false;
      if (!submission.sideEffectStarted) {
        fenceReleased = await store.releaseSubmissionFence(context.applicationId, attemptId);
        if (fenceReleased) fenced = false;
      }

      await store.recordStage(attemptId, "submit", "failed", {
        url: submission.url,
        message: submission.message,
        retryable: submission.retryable && fenceReleased,
        sideEffectStarted: submission.sideEffectStarted,
        fenceReleased
      });

      return {
        status: "failed",
        attemptId,
        reason: submission.message ?? "Submit outcome could not be confirmed",
        retryable: submission.retryable && fenceReleased,
        sideEffectStarted: submission.sideEffectStarted,
        submitAttempt: reservedSubmitAttempt ?? undefined
      };
    }

    assertToolFamilyAllowed("confirm", "confirmation");
    assertToolFamilyAllowed("confirm", "evidence");
    await store.recordStage(attemptId, "confirm", "started", {
      maxChecks: DEFAULT_CONFIRMATION_CHECKS
    });

    let confirmation = await adapter.confirm(executionContext);
    let confirmationChecks = 1;

    while (!confirmation.confirmed && confirmationChecks < DEFAULT_CONFIRMATION_CHECKS) {
      await store.recordStage(attemptId, "confirm", "unknown", {
        confirmationCheck: confirmationChecks,
        confirmationUrl: confirmation.url,
        evidence: confirmation.evidence
      });
      await sleep(retryDelayMs(confirmationChecks));
      confirmationChecks += 1;
      confirmation = await adapter.confirm(executionContext);
    }

    if (!confirmation.confirmed) {
      const screenshot = await adapter.screenshot?.(executionContext, "submit-confirmation-unknown");
      await store.recordStage(attemptId, "confirm", "unknown", {
        confirmationChecks,
        confirmationUrl: confirmation.url,
        evidence: confirmation.evidence,
        screenshot
      });
      return {
        status: "failed",
        attemptId,
        reason:
          "Submit side effect started but confirmation could not be verified after repeated checks; automatic re-submit is blocked",
        retryable: false,
        sideEffectStarted: true,
        submitAttempt: reservedSubmitAttempt ?? undefined
      };
    }

    await store.markSubmitted(context.applicationId, confirmation);
    await store.recordStage(attemptId, "confirm", "submitted", {
      confirmationChecks,
      confirmationUrl: confirmation.url,
      evidence: confirmation.evidence
    });

    return { status: "submitted", attemptId, confirmed: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);

    let fenceReleased = false;
    if (fenced && !submitCallStarted && !sideEffectStarted) {
      fenceReleased = await store
        .releaseSubmissionFence(context.applicationId, attemptId)
        .catch(() => false);
      if (fenceReleased) fenced = false;
    }

    const retryable = !fenced && !sideEffectStarted;
    await store.recordStage(
      attemptId,
      "report",
      "failed",
      {
        retryable,
        sideEffectStarted,
        fenceReleased,
        submitCallStarted
      },
      reason
    ).catch(() => undefined);

    return {
      status: "failed",
      attemptId,
      reason,
      retryable,
      sideEffectStarted,
      submitAttempt: reservedSubmitAttempt ?? undefined
    };
  } finally {
    await adapter.close?.().catch(() => undefined);
  }
}
