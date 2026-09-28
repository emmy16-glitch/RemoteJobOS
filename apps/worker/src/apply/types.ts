import type {
  ApplicationField,
  FillPlanEntry,
  VerificationReport
} from "@remotejobos/core";

export interface ApplicationContext {
  applicationId: string;
  jobUrl: string;
  workerId: string;
  dryRun: boolean;
  assets?: Record<string, string>;
}

export interface SubmitPreparationResult {
  ready: boolean;
  retryable: boolean;
  reason?: string;
}

export interface SubmitResult {
  submitted: boolean;
  sideEffectStarted: boolean;
  retryable: boolean;
  url?: string;
  message?: string;
}

export interface ConfirmationResult {
  confirmed: boolean;
  url?: string;
  evidence?: string;
}

export interface ApplicationAdapter {
  readonly name: string;
  canHandle(url: string): boolean;
  scan(context: ApplicationContext): Promise<ApplicationField[]>;
  fill(context: ApplicationContext, plan: FillPlanEntry[]): Promise<void>;
  verify(context: ApplicationContext, plan: FillPlanEntry[]): Promise<VerificationReport>;
  prepareSubmit?(context: ApplicationContext): Promise<SubmitPreparationResult>;
  submit(context: ApplicationContext): Promise<SubmitResult>;
  confirm(context: ApplicationContext): Promise<ConfirmationResult>;
  screenshot?(context: ApplicationContext, label: string): Promise<string | undefined>;
  close?(): Promise<void>;
}

export interface ApplicationStore {
  getVerifiedAnswers(applicationId: string): Promise<Record<string, string>>;
  getAssets(applicationId: string): Promise<Record<string, string>>;
  canSubmit(applicationId: string): Promise<{ allowed: boolean; reason: string }>;
  startAttempt(applicationId: string, workerId: string): Promise<string>;
  recordStage(
    attemptId: string,
    stage: string,
    status: "started" | "blocked" | "failed" | "verified" | "submitted" | "unknown",
    report?: Record<string, unknown>,
    error?: string
  ): Promise<void>;
  fenceSubmission(applicationId: string, attemptId: string): Promise<boolean>;
  releaseSubmissionFence(applicationId: string, attemptId: string): Promise<boolean>;
  markSubmitted(
    applicationId: string,
    confirmation: ConfirmationResult
  ): Promise<void>;
}
