import { queueNotification } from "./notifications.js";
import { config, hasSupabase } from "./config.js";

export type ExceptionType =
  | "missing-answer"
  | "sensitive-answer"
  | "captcha"
  | "unsupported-ats"
  | "policy-block"
  | "submit-uncertain"
  | "retry-exhausted"
  | "verification-failed"
  | "other";

type ExceptionRow = {
  id: string;
  application_id: string;
  run_id: string | null;
  exception_type: ExceptionType;
  status: "open" | "resolved" | "dismissed";
  title: string;
  detail: string;
  field_key: string | null;
  field_label: string | null;
  payload: Record<string, unknown>;
  dedupe_key: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!hasSupabase()) throw new Error("Supabase is required for application exceptions");
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
    throw new Error(`Exception persistence failed: ${response.status} ${await response.text()}`);
  }
  if (response.status === 204) return undefined as T;
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

async function jobLabel(applicationId: string): Promise<{ title: string; company: string }> {
  const rows = await request<Array<{
    jobs: { title: string; company: string } | Array<{ title: string; company: string }> | null;
  }>>(
    `applications?select=jobs(title,company)&id=eq.${encodeURIComponent(applicationId)}&limit=1`
  );
  const relation = rows[0]?.jobs;
  const job = Array.isArray(relation) ? relation[0] : relation;
  return {
    title: job?.title ?? "job application",
    company: job?.company ?? "Unknown company"
  };
}

export async function createApplicationException(args: {
  applicationId: string;
  runId?: string | null;
  type: ExceptionType;
  title: string;
  detail: string;
  fieldKey?: string | null;
  fieldLabel?: string | null;
  payload?: Record<string, unknown>;
  dedupeKey: string;
}): Promise<ExceptionRow> {
  const rows = await request<ExceptionRow[]>(
    "application_exceptions?on_conflict=dedupe_key&select=*",
    {
      method: "POST",
      headers: { prefer: "resolution=merge-duplicates,return=representation" },
      body: JSON.stringify({
        application_id: args.applicationId,
        run_id: args.runId ?? null,
        exception_type: args.type,
        status: "open",
        field_key: args.fieldKey ?? null,
        field_label: args.fieldLabel ?? null,
        title: args.title,
        detail: args.detail,
        payload: args.payload ?? {},
        dedupe_key: args.dedupeKey,
        updated_at: new Date().toISOString()
      })
    }
  );

  const exception = rows[0];
  if (!exception) throw new Error("Could not create application exception");

  const job = await jobLabel(args.applicationId);
  await queueNotification({
    applicationId: args.applicationId,
    exceptionId: exception.id,
    kind: "exception",
    subject: `RemoteJobOS needs you: ${job.company} — ${job.title}`,
    bodyText: [
      args.title,
      "",
      args.detail,
      "",
      `Company: ${job.company}`,
      `Role: ${job.title}`,
      "",
      "Open RemoteJobOS → Exceptions to resolve it. The application will remain paused until the blocker is resolved."
    ].join("\n"),
    dedupeKey: `exception-email:${exception.dedupe_key}`
  });

  await request(`applications?id=eq.${encodeURIComponent(args.applicationId)}`, {
    method: "PATCH",
    body: JSON.stringify({
      status: "needs-attention",
      next_action: args.detail,
      updated_at: new Date().toISOString()
    })
  });

  return exception;
}

export async function createFieldExceptions(args: {
  applicationId: string;
  runId: string;
  attemptId: string;
  fields: Array<{
    key: string;
    label: string;
    reason: string;
    sensitive: boolean;
    kind: string;
    options?: string[];
  }>;
}): Promise<ExceptionRow[]> {
  const rows: ExceptionRow[] = [];
  for (const field of args.fields) {
    const type: ExceptionType = field.sensitive ? "sensitive-answer" : "missing-answer";
    rows.push(await createApplicationException({
      applicationId: args.applicationId,
      runId: args.runId,
      type,
      title: field.sensitive ? "A sensitive application answer needs your decision" : "Application detail required",
      detail: `${field.label}: ${field.reason}`,
      fieldKey: field.key,
      fieldLabel: field.label,
      payload: { kind: field.kind, options: field.options ?? [], attemptId: args.attemptId },
      dedupeKey: `field:${args.applicationId}:${field.key}:${args.attemptId}`
    }));
  }
  return rows;
}
