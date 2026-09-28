import {
  canStartHarnessStep,
  recoveryDisposition,
  toolFamiliesForPhase,
  type HarnessRunPhase,
  type HarnessRunStatus
} from "@remotejobos/core";
import type { PipelineOutcome } from "./apply/engine.js";
import { config, hasSupabase } from "./config.js";

export type ApplicationHarnessMode = "dry-run" | "submit";

export type HarnessRunRow = {
  id: string;
  application_id: string;
  task_id: string | null;
  mode: ApplicationHarnessMode;
  status: HarnessRunStatus;
  phase: string;
  step_used: number;
  step_limit: number;
  active_tool_families: string[];
  checkpoint: Record<string, unknown>;
  result: Record<string, unknown>;
  recovery_strategy: "safe-restart" | "manual-reconcile" | "already-complete";
  last_error: string | null;
  idempotency_key: string;
  started_at: string | null;
  completed_at: string | null;
  submit_attempts: number;
};

type ApplicationStateRow = {
  id: string;
  job_id: string;
  cv_version_id: string | null;
  status: string;
  submission_fenced_at: string | null;
  submitted_at: string | null;
  confirmation_verified_at: string | null;
};

type AttemptRow = {
  id: string;
  application_id: string;
  stage: string;
  status: string;
  field_report: Record<string, unknown> | null;
  error: string | null;
};

type CvRow = {
  id: string;
  storage_path: string | null;
};

export type HarnessVerification = {
  verified: boolean;
  terminal:
    | "dry-run-verified"
    | "submitted"
    | "needs-review"
    | "blocked"
    | "failed"
    | "unknown";
  reason: string;
  evidence: Record<string, unknown>;
};

type ApprovalRow = {
  id: string;
  run_id: string;
  application_id: string;
  status: "pending" | "approved" | "denied" | "expired" | "executed" | "cancelled";
  summary: string;
  snapshot: Record<string, unknown>;
  expires_at: string;
};

function asArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map(String) : [];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!hasSupabase()) throw new Error("Supabase is required for harness operations");

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
    throw new Error(`Harness persistence failed: ${response.status} ${await response.text()}`);
  }

  if (response.status === 204) return undefined as T;
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

async function applicationState(applicationId: string): Promise<ApplicationStateRow> {
  const rows = await request<ApplicationStateRow[]>(
    `applications?select=id,job_id,cv_version_id,status,submission_fenced_at,submitted_at,confirmation_verified_at&id=eq.${encodeURIComponent(applicationId)}&limit=1`
  );
  const application = rows[0];
  if (!application) throw new Error(`Application not found: ${applicationId}`);
  return application;
}

async function loadRun(runId: string): Promise<HarnessRunRow> {
  const rows = await request<HarnessRunRow[]>(
    `agent_runs?select=*&id=eq.${encodeURIComponent(runId)}&limit=1`
  );
  const run = rows[0];
  if (!run) throw new Error(`Harness run not found: ${runId}`);
  return {
    ...run,
    active_tool_families: asArray(run.active_tool_families)
  };
}

async function writeCheckpoint(
  run: HarnessRunRow,
  phase: HarnessRunPhase,
  status: HarnessRunStatus,
  snapshot: Record<string, unknown>
): Promise<void> {
  await request("agent_run_checkpoints", {
    method: "POST",
    body: JSON.stringify({
      run_id: run.id,
      step_used: run.step_used,
      phase,
      status,
      active_tool_families: run.active_tool_families,
      snapshot
    })
  });
}

export async function startOrResumeApplicationRun(args: {
  taskId?: string;
  applicationId: string;
  mode: ApplicationHarnessMode;
  resumeRunId?: string;
  stepLimit?: number;
}): Promise<HarnessRunRow> {
  const application = await applicationState(args.applicationId);

  if (args.resumeRunId) {
    const existing = await loadRun(args.resumeRunId);
    if (existing.application_id !== args.applicationId) {
      throw new Error("Resume run belongs to a different application");
    }

    if (existing.status === "waiting-approval" && args.mode === "dry-run") {
      return existing;
    }
    if (existing.status === "completed" || existing.status === "cancelled") {
      return existing;
    }
    if (existing.status === "blocked" && existing.recovery_strategy === "manual-reconcile") {
      return existing;
    }

    const recovery = recoveryDisposition({
      submissionFencedAt: application.submission_fenced_at,
      submittedAt: application.submitted_at,
      confirmationVerifiedAt: application.confirmation_verified_at
    });

    if (recovery === "manual-reconcile" && args.mode === "submit") {
      await request(`agent_runs?id=eq.${encodeURIComponent(existing.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "blocked",
          recovery_strategy: recovery,
          last_error: "Submission is fenced but not confirmed; manual reconciliation required.",
          updated_at: new Date().toISOString()
        })
      });
      throw new Error("Submission is fenced but not confirmed; refusing automatic retry");
    }

    const rows = await request<HarnessRunRow[]>(
      `agent_runs?id=eq.${encodeURIComponent(existing.id)}&select=*`,
      {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({
          task_id: args.taskId ?? existing.task_id,
          mode: args.mode,
          status: recovery === "already-complete" ? "completed" : "running",
          recovery_strategy: recovery,
          last_error: null,
          started_at: existing.started_at ?? new Date().toISOString(),
          updated_at: new Date().toISOString(),
          completed_at: recovery === "already-complete" ? new Date().toISOString() : null
        })
      }
    );
    return rows[0] ?? loadRun(existing.id);
  }

  const key = `application:${args.applicationId}:${application.cv_version_id ?? "no-cv"}`;
  const existingRows = await request<HarnessRunRow[]>(
    `agent_runs?select=*&idempotency_key=eq.${encodeURIComponent(key)}&limit=1`
  );
  const existing = existingRows[0];

  if (existing) {
    return startOrResumeApplicationRun({
      ...args,
      resumeRunId: existing.id
    });
  }

  const rows = await request<HarnessRunRow[]>("agent_runs?select=*", {
    method: "POST",
    headers: { prefer: "return=representation" },
    body: JSON.stringify({
      application_id: args.applicationId,
      task_id: args.taskId ?? null,
      mode: args.mode,
      status: "running",
      phase: "assemble",
      step_limit: args.stepLimit ?? 40,
      active_tool_families: [],
      checkpoint: {
        applicationId: args.applicationId,
        cvVersionId: application.cv_version_id,
        recovery: "safe-restart"
      },
      recovery_strategy: "safe-restart",
      idempotency_key: key,
      started_at: new Date().toISOString()
    })
  });

  const run = rows[0];
  if (!run) throw new Error("Could not create durable harness run");
  await writeCheckpoint(run, "assemble", "running", run.checkpoint ?? {});
  return run;
}

export async function checkpointApplicationRun(
  runId: string,
  phase: HarnessRunPhase,
  snapshot: Record<string, unknown> = {},
  incrementStep = true
): Promise<HarnessRunRow> {
  const run = await loadRun(runId);

  if (incrementStep && !canStartHarnessStep({ used: run.step_used, limit: run.step_limit })) {
    const reason = `Harness step budget exhausted at ${run.step_used}/${run.step_limit}`;
    await request(`agent_runs?id=eq.${encodeURIComponent(runId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "blocked",
        phase,
        last_error: reason,
        updated_at: new Date().toISOString()
      })
    });
    throw new Error(reason);
  }

  const nextStep = incrementStep ? run.step_used + 1 : run.step_used;
  const tools = toolFamiliesForPhase(phase);
  const checkpoint = {
    ...(run.checkpoint ?? {}),
    ...snapshot,
    phase,
    stepUsed: nextStep,
    stepLimit: run.step_limit,
    activeToolFamilies: tools,
    checkpointedAt: new Date().toISOString()
  };

  const rows = await request<HarnessRunRow[]>(
    `agent_runs?id=eq.${encodeURIComponent(runId)}&select=*`,
    {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        status: "running",
        phase,
        step_used: nextStep,
        active_tool_families: tools,
        checkpoint,
        updated_at: new Date().toISOString()
      })
    }
  );

  const updated = rows[0];
  if (!updated) throw new Error(`Could not checkpoint harness run ${runId}`);
  await writeCheckpoint(
    { ...updated, active_tool_families: asArray(updated.active_tool_families) },
    phase,
    "running",
    checkpoint
  );
  return { ...updated, active_tool_families: asArray(updated.active_tool_families) };
}

export async function observeApplicationRun(
  runId: string,
  phase: HarnessRunPhase,
  snapshot: Record<string, unknown> = {}
): Promise<void> {
  const run = await loadRun(runId);
  const checkpoint = {
    ...(run.checkpoint ?? {}),
    ...snapshot,
    observedPhase: phase,
    observedAt: new Date().toISOString()
  };

  await request(`agent_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      checkpoint,
      updated_at: new Date().toISOString()
    })
  });

  await writeCheckpoint(run, phase, run.status, checkpoint);
}

function pipelinePhase(stage: string): HarnessRunPhase {
  if (stage === "detect") return "assemble";
  if (stage === "scan") return "scan";
  if (stage === "plan") return "plan";
  if (stage === "fill") return "fill";
  if (stage === "verify") return "verify";
  if (stage === "fence") return "fence";
  if (stage === "submit-preflight" || stage === "submit") return "submit";
  if (stage === "confirm") return "confirm";
  return "report";
}

export function createHarnessStageObserver(runId: string) {
  return async (event: {
    stage: string;
    status: "started" | "blocked" | "failed" | "verified" | "submitted" | "unknown";
    report?: Record<string, unknown>;
    error?: string;
  }): Promise<void> => {
    const phase = pipelinePhase(event.stage);
    const snapshot = {
      pipelineStage: event.stage,
      pipelineStatus: event.status,
      report: event.report ?? {},
      error: event.error ?? null
    };

    if (event.status === "started") {
      await checkpointApplicationRun(runId, phase, snapshot, true);
    } else {
      await observeApplicationRun(runId, phase, snapshot);
    }
  };
}

export async function verifyApplicationOutcome(
  applicationId: string,
  outcome: PipelineOutcome
): Promise<HarnessVerification> {
  const application = await applicationState(applicationId);
  const attempts = await request<AttemptRow[]>(
    `application_attempts?select=id,application_id,stage,status,field_report,error&id=eq.${encodeURIComponent(outcome.attemptId)}&limit=1`
  );
  const attempt = attempts[0];

  let cv: CvRow | undefined;
  if (application.cv_version_id) {
    const cvs = await request<CvRow[]>(
      `cv_versions?select=id,storage_path&id=eq.${encodeURIComponent(application.cv_version_id)}&limit=1`
    );
    cv = cvs[0];
  }

  if (outcome.status === "dry-run-verified") {
    const verified =
      attempt?.stage === "report" &&
      attempt.status === "verified" &&
      Boolean(cv?.storage_path);

    return {
      verified,
      terminal: "dry-run-verified",
      reason: verified
        ? "Dry-run persisted verified form evidence and a rendered CV asset"
        : "Dry-run reported success but persisted proof is incomplete",
      evidence: {
        attemptId: outcome.attemptId,
        attemptStage: attempt?.stage,
        attemptStatus: attempt?.status,
        cvStoragePath: cv?.storage_path ?? null
      }
    };
  }

  if (outcome.status === "submitted") {
    const verified =
      application.status === "applied" &&
      Boolean(application.submitted_at) &&
      Boolean(application.confirmation_verified_at) &&
      attempt?.stage === "confirm" &&
      attempt.status === "submitted";

    return {
      verified,
      terminal: "submitted",
      reason: verified
        ? "Submission and confirmation are both durably verified"
        : "Submission outcome is not durably confirmed",
      evidence: {
        attemptId: outcome.attemptId,
        applicationStatus: application.status,
        submittedAt: application.submitted_at,
        confirmationVerifiedAt: application.confirmation_verified_at,
        attemptStage: attempt?.stage,
        attemptStatus: attempt?.status
      }
    };
  }

  if (outcome.status === "needs-review") {
    return {
      verified: true,
      terminal: "needs-review",
      reason: outcome.reason,
      evidence: { attemptId: outcome.attemptId, attemptStage: attempt?.stage }
    };
  }

  if (outcome.status === "blocked") {
    return {
      verified: true,
      terminal: "blocked",
      reason: outcome.reason,
      evidence: { attemptId: outcome.attemptId, attemptStage: attempt?.stage }
    };
  }

  const recovery = recoveryDisposition({
    submissionFencedAt: application.submission_fenced_at,
    submittedAt: application.submitted_at,
    confirmationVerifiedAt: application.confirmation_verified_at
  });

  return {
    verified: false,
    terminal: "failed",
    reason: outcome.reason,
    evidence: {
      attemptId: outcome.attemptId,
      attemptStage: attempt?.stage,
      error: attempt?.error,
      retryable: outcome.status === "failed" ? outcome.retryable : false,
      sideEffectStarted: outcome.status === "failed" ? outcome.sideEffectStarted : false,
      recovery
    }
  };
}

export async function salvagePersistedApplicationResult(
  applicationId: string,
  mode: ApplicationHarnessMode
): Promise<HarnessVerification> {
  const application = await applicationState(applicationId);

  if (
    application.status === "applied" &&
    application.submitted_at &&
    application.confirmation_verified_at
  ) {
    return {
      verified: true,
      terminal: "submitted",
      reason: "Salvage recovered a durably confirmed submission",
      evidence: {
        applicationStatus: application.status,
        submittedAt: application.submitted_at,
        confirmationVerifiedAt: application.confirmation_verified_at
      }
    };
  }

  if (mode === "dry-run") {
    const attempts = await request<AttemptRow[]>(
      `application_attempts?select=id,application_id,stage,status,field_report,error&application_id=eq.${encodeURIComponent(applicationId)}&stage=eq.report&status=eq.verified&order=started_at.desc&limit=1`
    );
    let cv: CvRow | undefined;
    if (application.cv_version_id) {
      const cvs = await request<CvRow[]>(
        `cv_versions?select=id,storage_path&id=eq.${encodeURIComponent(application.cv_version_id)}&limit=1`
      );
      cv = cvs[0];
    }

    if (attempts[0] && cv?.storage_path) {
      return {
        verified: true,
        terminal: "dry-run-verified",
        reason: "Salvage recovered verified dry-run state from persisted evidence",
        evidence: {
          attemptId: attempts[0].id,
          cvStoragePath: cv.storage_path
        }
      };
    }
  }

  const recovery = recoveryDisposition({
    submissionFencedAt: application.submission_fenced_at,
    submittedAt: application.submitted_at,
    confirmationVerifiedAt: application.confirmation_verified_at
  });

  return {
    verified: false,
    terminal: recovery === "manual-reconcile" ? "blocked" : "unknown",
    reason:
      recovery === "manual-reconcile"
        ? "Submission is fenced but confirmation is missing; manual reconciliation is required"
        : "No durable terminal result could be salvaged",
    evidence: { recovery }
  };
}

export async function reserveSubmitAttempt(
  runId: string,
  maxAttempts = 3
): Promise<number | null> {
  const attempt = await request<number | null>("rpc/reserve_agent_submit_attempt", {
    method: "POST",
    body: JSON.stringify({
      p_run_id: runId,
      p_max_attempts: maxAttempts
    })
  });
  return typeof attempt === "number" ? attempt : null;
}

export async function requestSubmissionApproval(args: {
  runId: string;
  applicationId: string;
  verification: HarnessVerification;
}): Promise<ApprovalRow> {
  const existing = await request<ApprovalRow[]>(
    `agent_approvals?select=*&run_id=eq.${encodeURIComponent(args.runId)}&approval_type=eq.submit-application&limit=1`
  );

  let approval = existing[0];
  if (!approval) {
    const rows = await request<ApprovalRow[]>("agent_approvals?select=*", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        run_id: args.runId,
        application_id: args.applicationId,
        approval_type: "submit-application",
        status: "pending",
        summary: "Dry-run verified. Approve live submission of this application.",
        snapshot: {
          verification: args.verification,
          resumePhase: "fence"
        }
      })
    });
    approval = rows[0];
  }

  if (!approval) throw new Error("Could not create submission approval");

  await request(`agent_runs?id=eq.${encodeURIComponent(args.runId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "waiting-approval",
      phase: "approval",
      active_tool_families: toolFamiliesForPhase("approval"),
      checkpoint: {
        approvalId: approval.id,
        verification: args.verification,
        resumePhase: "fence",
        checkpointedAt: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    })
  });

  await request(`applications?id=eq.${encodeURIComponent(args.applicationId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "ready-for-review",
      next_action: "Dry-run verified. Submission is suspended until approval.",
      updated_at: new Date().toISOString()
    })
  });

  return approval;
}

async function ensureApprovedSubmissionTask(
  approval: ApprovalRow
): Promise<void> {
  await request(`agent_runs?id=eq.${encodeURIComponent(approval.run_id)}&status=neq.completed`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "pending",
      mode: "submit",
      phase: "fence",
      active_tool_families: toolFamiliesForPhase("fence"),
      checkpoint: {
        approvalId: approval.id,
        decision: "approved",
        resumePhase: "fence",
        checkpointedAt: new Date().toISOString()
      },
      updated_at: new Date().toISOString()
    })
  });

  await request("agent_tasks?on_conflict=idempotency_key", {
    method: "POST",
    headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      task_type: "application-submit",
      payload: {
        applicationId: approval.application_id,
        runId: approval.run_id,
        approvalId: approval.id
      },
      status: "pending",
      priority: 40,
      max_attempts: 3,
      idempotency_key: `application-submit:${approval.run_id}:${approval.id}`
    })
  });

  await request(`applications?id=eq.${encodeURIComponent(approval.application_id)}`, {
    method: "PATCH",
    body: JSON.stringify({
      next_action: "Submission approved and queued on the same durable run.",
      updated_at: new Date().toISOString()
    })
  });
}

export async function decideHarnessApproval(
  approvalId: string,
  decision: "approved" | "denied",
  decidedBy?: string
): Promise<ApprovalRow> {
  const rows = await request<ApprovalRow[]>(
    `agent_approvals?select=*&id=eq.${encodeURIComponent(approvalId)}&limit=1`
  );
  const approval = rows[0];
  if (!approval) throw new Error(`Approval not found: ${approvalId}`);

  if (approval.status === "approved" && decision === "approved") {
    // Idempotent replay: recreate the task if a previous worker died after the
    // approval row changed but before the submit task was persisted.
    await ensureApprovedSubmissionTask(approval);
    return approval;
  }
  if (approval.status === "denied" && decision === "denied") {
    return approval;
  }
  if (approval.status === "executed" && decision === "approved") {
    return approval;
  }
  if (approval.status !== "pending") {
    throw new Error(`Approval is already ${approval.status}`);
  }
  if (new Date(approval.expires_at).getTime() <= Date.now()) {
    await request(`agent_approvals?id=eq.${encodeURIComponent(approvalId)}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "expired", decided_at: new Date().toISOString() })
    });
    throw new Error("Approval has expired");
  }

  const updatedRows = await request<ApprovalRow[]>(
    `agent_approvals?id=eq.${encodeURIComponent(approvalId)}&status=eq.pending&select=*`,
    {
      method: "PATCH",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        status: decision,
        decided_at: new Date().toISOString(),
        decided_by: decidedBy ?? null
      })
    }
  );
  const updated = updatedRows[0];
  if (!updated) throw new Error("Approval decision race; approval was not updated");

  if (decision === "denied") {
    await request(`agent_runs?id=eq.${encodeURIComponent(updated.run_id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "cancelled",
        phase: "approval",
        result: { approvalId, decision },
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    });
    await request(`applications?id=eq.${encodeURIComponent(updated.application_id)}`, {
      method: "PATCH",
      body: JSON.stringify({
        next_action: "Submission denied. Application remains unsubmitted.",
        updated_at: new Date().toISOString()
      })
    });
    return updated;
  }

  await ensureApprovedSubmissionTask(updated);
  return updated;
}

export async function getHarnessApproval(
  approvalId: string
): Promise<ApprovalRow> {
  const rows = await request<ApprovalRow[]>(
    `agent_approvals?select=*&id=eq.${encodeURIComponent(approvalId)}&limit=1`
  );
  const approval = rows[0];
  if (!approval) throw new Error(`Approval not found: ${approvalId}`);
  return approval;
}

export async function requireApprovedSubmission(
  runId: string,
  approvalId: string
): Promise<ApprovalRow> {
  const rows = await request<ApprovalRow[]>(
    `agent_approvals?select=*&id=eq.${encodeURIComponent(approvalId)}&run_id=eq.${encodeURIComponent(runId)}&limit=1`
  );
  const approval = rows[0];
  if (!approval || approval.status !== "approved") {
    throw new Error("Live submission requires an approved harness approval");
  }
  return approval;
}

export async function completeHarnessRun(
  runId: string,
  verification: HarnessVerification,
  approvalId?: string
): Promise<void> {
  await checkpointApplicationRun(
    runId,
    "finalize",
    { verification, approvalId: approvalId ?? null },
    true
  );

  await request(`agent_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "completed",
      phase: "finalize",
      result: verification,
      recovery_strategy: verification.terminal === "submitted" ? "already-complete" : "safe-restart",
      last_error: null,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  });

  if (approvalId && verification.terminal === "submitted") {
    await request(`agent_approvals?id=eq.${encodeURIComponent(approvalId)}&status=eq.approved`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "executed",
        executed_at: new Date().toISOString()
      })
    });
  }
}

export async function failHarnessRun(
  runId: string,
  applicationId: string,
  reason: string,
  result: Record<string, unknown> = {}
): Promise<"failed" | "blocked"> {
  const application = await applicationState(applicationId);
  const recovery = recoveryDisposition({
    submissionFencedAt: application.submission_fenced_at,
    submittedAt: application.submitted_at,
    confirmationVerifiedAt: application.confirmation_verified_at
  });
  const status = recovery === "manual-reconcile" ? "blocked" : "failed";

  await request(`agent_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status,
      recovery_strategy: recovery,
      last_error: reason,
      result,
      completed_at: status === "blocked" ? new Date().toISOString() : null,
      updated_at: new Date().toISOString()
    })
  });

  return status;
}

export async function blockHarnessRun(
  runId: string,
  applicationId: string,
  reason: string,
  result: Record<string, unknown> = {}
): Promise<void> {
  const application = await applicationState(applicationId);
  const recovery = recoveryDisposition({
    submissionFencedAt: application.submission_fenced_at,
    submittedAt: application.submitted_at,
    confirmationVerifiedAt: application.confirmation_verified_at
  });

  await request(`agent_runs?id=eq.${encodeURIComponent(runId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "blocked",
      recovery_strategy: recovery,
      last_error: reason,
      result,
      completed_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    })
  });
}
