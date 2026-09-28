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

    const [verifiedAnswers, autoApprovedAnswerKeys] = await Promise.all([
      store.getVerifiedAnswers(context.applicationId),
      store.getAutoApprovedAnswerKeys(context.applicationId)
    ]);

    const maxFormPages = 8;
    let formPage = 0;

    while (true) {
      formPage += 1;

      assertToolFamilyAllowed("scan", "browser");
      await store.recordStage(attemptId, "scan", "started", { formPage });
      const fields = await adapter.scan(executionContext);

      assertToolFamilyAllowed("plan", "profile");
      await store.recordStage(attemptId, "plan", "started", {
        formPage,
        fieldCount: fields.length
      });

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
          formPage,
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
      await store.recordStage(attemptId, "fill", "started", { formPage });
      await adapter.fill(executionContext, plan);

      assertToolFamilyAllowed("verify", "browser");
      assertToolFamilyAllowed("verify", "evidence");
      await store.recordStage(attemptId, "verify", "started", { formPage });
      const verification = await adapter.verify(executionContext, plan);
      if (!verification.ok) {
        await store.recordStage(attemptId, "verify", "blocked", {
          formPage,
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
        formPage,
        verifiedFieldCount: verification.verifiedFieldCount,
        totalFieldCount: verification.totalFieldCount
      });

      if (formPage >= maxFormPages) {
        const finalCheck = await adapter.prepareSubmit?.(executionContext);
        if (!finalCheck?.ready) {
          const reason =
            `Application form exceeded the safe ${maxFormPages}-page automation limit before a final Submit control was verified`;
          await store.recordStage(attemptId, "advance", "blocked", {
            formPage,
            reason,
            preflightReason: finalCheck?.reason
          });
          return {
            status: "blocked",
            attemptId,
            reason,
            issues: [{
              fieldKey: "form-page-limit",
              code: "unverified",
              message: reason
            }]
          };
        }
        break;
      }

      const progress = await adapter.advanceIfNeeded?.(executionContext);
      if (!progress?.advanced) break;

      await store.recordStage(attemptId, "advance", "verified", {
        formPage,
        reason: progress.reason ?? "safe-next-step"
      });
    }

    // A dry-run is only considered clean when the final page exposes a clear,
    // enabled Submit control. This prevents an unsupported wizard page from
    // being policy-authorized simply because its visible fields were filled.
    if (context.dryRun && adapter.prepareSubmit) {
      const finalPreparation = await adapter.prepareSubmit(executionContext);
      if (!finalPreparation.ready) {
        const reason =
          finalPreparation.reason ?? "Final submit control could not be verified";
        await store.recordStage(attemptId, "submit-preflight", "blocked", {
          dryRun: true,
          reason
        });
        return {
          status: "blocked",
          attemptId,
          reason,
          issues: [{
            fieldKey: /captcha/i.test(reason) ? "captcha" : "submit-control",
            code: "unverified",
            message: reason
          }]
        };
      }
    }

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

    assertToolFamilyAllowed("submit", "browser");
    assertToolFamilyAllowed("submit", "submission");
    await store.recordStage(attemptId, "submit-preflight", "started", {
      submitAttempt: reservedSubmitAttempt
    });
    const preparation = await adapter.prepareSubmit?.(executionContext) ?? {
      ready: true,
      retryable: false
    };

    if (!preparation.ready) {
      const reason = preparation.reason ?? "Submission preflight is not ready";
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
