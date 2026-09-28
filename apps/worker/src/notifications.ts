import { config, hasSupabase } from "./config.js";

type ApplicationOwnerRow = {
  id: string;
  profile_id: string | null;
  career_profiles:
    | { owner_id: string | null }
    | Array<{ owner_id: string | null }>
    | null;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!hasSupabase()) throw new Error("Supabase is required for notifications");
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
    throw new Error(`Notification persistence failed: ${response.status} ${await response.text()}`);
  }
  if (response.status === 204) return undefined as T;
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

function ownerFromRelation(row: ApplicationOwnerRow): string | null {
  if (Array.isArray(row.career_profiles)) {
    return row.career_profiles[0]?.owner_id ?? null;
  }
  return row.career_profiles?.owner_id ?? null;
}

export async function ownerIdForApplication(applicationId: string): Promise<string | null> {
  const rows = await request<ApplicationOwnerRow[]>(
    `applications?select=id,profile_id,career_profiles(owner_id)&id=eq.${encodeURIComponent(applicationId)}&limit=1`
  );
  return rows[0] ? ownerFromRelation(rows[0]) : null;
}

export async function queueNotification(args: {
  ownerId?: string | null;
  applicationId?: string;
  exceptionId?: string;
  kind: string;
  subject: string;
  bodyText: string;
  dedupeKey: string;
}): Promise<void> {
  const ownerId =
    args.ownerId ??
    (args.applicationId ? await ownerIdForApplication(args.applicationId) : null);

  if (!ownerId) return;

  await request("notification_outbox?on_conflict=dedupe_key", {
    method: "POST",
    headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      owner_id: ownerId,
      application_id: args.applicationId ?? null,
      exception_id: args.exceptionId ?? null,
      kind: args.kind,
      subject: args.subject,
      body_text: args.bodyText,
      status: "pending",
      dedupe_key: args.dedupeKey
    })
  });
}

export async function jobLabelForApplication(
  applicationId: string
): Promise<{ title: string; company: string }> {
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
