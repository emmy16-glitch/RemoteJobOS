export type HarnessRunStatus =
  | "pending"
  | "running"
  | "waiting-approval"
  | "completed"
  | "failed"
  | "blocked"
  | "cancelled";

export type HarnessRunPhase =
  | "assemble"
  | "context"
  | "cv"
  | "scan"
  | "plan"
  | "fill"
  | "verify"
  | "approval"
  | "fence"
  | "submit"
  | "confirm"
  | "report"
  | "finalize";

export type HarnessToolFamily =
  | "profile"
  | "cv"
  | "browser"
  | "policy"
  | "submission"
  | "confirmation"
  | "evidence"
  | "tracking";

const phaseTools: Record<HarnessRunPhase, HarnessToolFamily[]> = {
  assemble: [],
  context: ["profile"],
  cv: ["profile", "cv"],
  scan: ["browser"],
  plan: ["profile", "browser"],
  fill: ["profile", "cv", "browser"],
  verify: ["browser", "evidence"],
  approval: ["evidence"],
  fence: ["policy"],
  submit: ["browser", "policy", "submission"],
  confirm: ["browser", "submission", "confirmation", "evidence"],
  report: ["evidence"],
  finalize: ["evidence", "tracking"]
};

export interface HarnessBudget {
  used: number;
  limit: number;
}

export interface HarnessState {
  phase: HarnessRunPhase;
  status: HarnessRunStatus;
  budget: HarnessBudget;
  activeToolFamilies: HarnessToolFamily[];
  submissionFencedAt?: string | null;
  submittedAt?: string | null;
  confirmationVerifiedAt?: string | null;
}

export function toolFamiliesForPhase(
  phase: HarnessRunPhase
): HarnessToolFamily[] {
  return [...phaseTools[phase]];
}

export function remainingHarnessSteps(budget: HarnessBudget): number {
  return Math.max(0, budget.limit - budget.used);
}

export function canStartHarnessStep(budget: HarnessBudget): boolean {
  return budget.used < budget.limit;
}

export function recoveryDisposition(state: Pick<
  HarnessState,
  "submissionFencedAt" | "submittedAt" | "confirmationVerifiedAt"
>): "safe-restart" | "manual-reconcile" | "already-complete" {
  if (state.submittedAt && state.confirmationVerifiedAt) return "already-complete";
  if (state.submissionFencedAt) return "manual-reconcile";
  return "safe-restart";
}

export function isTerminalHarnessStatus(status: HarnessRunStatus): boolean {
  return ["completed", "failed", "blocked", "cancelled"].includes(status);
}
