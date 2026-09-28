import { classifyJobEmail } from "@remotejobos/core";
import { config, hasSupabase } from "./config.js";
import {
  getGmailMessage,
  gmailHeader,
  listGmailMessageIds,
  sendGmailMessage,
  type GmailConnection
} from "./gmail-client.js";
import { queueNotification } from "./notifications.js";

type NotificationRow = {
  id: string;
  owner_id: string;
  application_id: string | null;
  exception_id: string | null;
  kind: string;
  subject: string;
  body_text: string;
  status: string;
  attempts: number;
};

type NotificationPrefs = {
  owner_id: string;
  email_enabled: boolean;
  email_address: string | null;
  notify_exceptions: boolean;
  notify_submitted: boolean;
  notify_assessment: boolean;
  notify_interview: boolean;
  notify_offer: boolean;
  notify_rejection: boolean;
};

type ApplicationRow = {
  id: string;
  job_id: string;
  profile_id: string | null;
  status: string;
};

type JobRow = {
  id: string;
  title: string;
  company: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!hasSupabase()) throw new Error("Supabase is required for Gmail automation");
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
    throw new Error(`Gmail automation database request failed: ${response.status} ${await response.text()}`);
  }
  if (response.status === 204) return undefined as T;
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

function kindAllowed(kind: string, prefs?: NotificationPrefs): boolean {
  if (!prefs) return true;
  if (!prefs.email_enabled) return false;
  if (kind === "exception") return prefs.notify_exceptions;
  if (kind === "submitted" || kind === "application-received") return prefs.notify_submitted;
  if (kind === "assessment") return prefs.notify_assessment;
  if (kind === "interview") return prefs.notify_interview;
  if (kind === "offer") return prefs.notify_offer;
  if (kind === "rejection") return prefs.notify_rejection;
  return true;
}

async function destinationEmail(
  ownerId: string,
  connection: GmailConnection,
  prefs?: NotificationPrefs
): Promise<string> {
  if (prefs?.email_address) return prefs.email_address;
  if (connection.email_address) return connection.email_address;

  const profiles = await request<Array<{ profile: { verifiedAnswers?: Record<string, string> } }>>(
    `career_profiles?select=profile&owner_id=eq.${encodeURIComponent(ownerId)}&order=updated_at.desc&limit=1`
  );
  return profiles[0]?.profile?.verifiedAnswers?.email ?? "";
}

async function connectionForOwner(ownerId: string): Promise<GmailConnection | null> {
  const rows = await request<GmailConnection[]>(
    `gmail_connections?select=*&owner_id=eq.${encodeURIComponent(ownerId)}&active=eq.true&limit=1`
  );
  return rows[0] ?? null;
}

async function preferencesForOwner(ownerId: string): Promise<NotificationPrefs | undefined> {
  const rows = await request<NotificationPrefs[]>(
    `notification_preferences?select=*&owner_id=eq.${encodeURIComponent(ownerId)}&limit=1`
  );
  return rows[0];
}

export async function sendPendingNotifications(limit = 20): Promise<number> {
  const staleSendingBefore = new Date(Date.now() - 30 * 60 * 1000).toISOString();
  await request(
    `notification_outbox?status=eq.sending&updated_at=lt.${encodeURIComponent(staleSendingBefore)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        status: "failed",
        last_error: "Recovered stale sending state after worker interruption",
        available_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      })
    }
  );

  const rows = await request<NotificationRow[]>(
    `notification_outbox?select=*&status=in.(pending,failed)&available_at=lte.${encodeURIComponent(new Date().toISOString())}&order=created_at.asc&limit=${Math.max(1, Math.min(100, limit))}`
  );

  let sent = 0;
  for (const row of rows) {
    const connection = await connectionForOwner(row.owner_id);
    const prefs = await preferencesForOwner(row.owner_id);

    if (!kindAllowed(row.kind, prefs)) {
      await request(`notification_outbox?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status: "cancelled", updated_at: new Date().toISOString() })
      });
      continue;
    }

    if (!connection) {
      await request(`notification_outbox?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "failed",
          attempts: row.attempts + 1,
          last_error: "No active Gmail connection",
          available_at: new Date(Date.now() + 6 * 60 * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString()
        })
      });
      continue;
    }

    try {
      await request(`notification_outbox?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "sending",
          attempts: row.attempts + 1,
          updated_at: new Date().toISOString()
        })
      });

      const to = await destinationEmail(row.owner_id, connection, prefs);
      await sendGmailMessage({
        connection,
        to,
        subject: row.subject,
        bodyText: row.body_text
      });

      await request(`notification_outbox?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: "sent",
          sent_at: new Date().toISOString(),
          last_error: null,
          updated_at: new Date().toISOString()
        })
      });
      sent += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      const delayMinutes = Math.min(360, 5 * (2 ** Math.min(6, attempts - 1)));
      await request(`notification_outbox?id=eq.${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        body: JSON.stringify({
          status: attempts >= 8 ? "cancelled" : "failed",
          attempts,
          last_error: error instanceof Error ? error.message : String(error),
          available_at: new Date(Date.now() + delayMinutes * 60 * 1000).toISOString(),
          updated_at: new Date().toISOString()
        })
      });
    }
  }

  console.log(`[gmail] notifications sent=${sent} scanned=${rows.length}`);
  return sent;
}

function textForMatch(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}

function matchApplication(
  subject: string,
  snippet: string,
  sender: string,
  applications: ApplicationRow[],
  jobs: Map<string, JobRow>
): ApplicationRow | undefined {
  const text = textForMatch([subject, snippet, sender].join(" "));
  let best: { application: ApplicationRow; score: number } | undefined;

  for (const application of applications) {
    const job = jobs.get(application.job_id);
    if (!job) continue;

    const company = textForMatch(job.company);
    const titleTokens = textForMatch(job.title)
      .split(" ")
      .filter((token) => token.length >= 4);

    let score = 0;
    if (company && text.includes(company)) score += 8;
    for (const token of titleTokens) {
      if (text.includes(token)) score += 1;
    }

    if (!best || score > best.score) best = { application, score };
  }

  return best && best.score >= 5 ? best.application : undefined;
}

function lifecycleStatus(classification: string): string | undefined {
  if (classification === "assessment") return "assessment";
  if (classification === "interview") return "interview";
  if (classification === "offer") return "offer";
  if (classification === "rejection") return "rejected";
  if (classification === "recruiter") return "response";
  return undefined;
}

function headerDate(value: string, internalDate?: string): string | null {
  const parsed = value ? new Date(value) : internalDate ? new Date(Number(internalDate)) : null;
  return parsed && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null;
}

export async function syncGmailLifecycle(): Promise<number> {
  const connections = await request<GmailConnection[]>(
    "gmail_connections?select=*&active=eq.true&order=updated_at.desc&limit=100"
  );

  let stored = 0;

  for (const connection of connections) {
    if (!connection.granted_scope?.includes("gmail.readonly")) continue;

    try {
      const ids = await listGmailMessageIds({
        connection,
        query: "newer_than:30d",
        maxResults: 100
      });

      const existing = ids.length
        ? await request<Array<{ gmail_message_id: string }>>(
            `gmail_messages?select=gmail_message_id&owner_id=eq.${encodeURIComponent(connection.owner_id)}&gmail_message_id=in.(${ids.map(encodeURIComponent).join(",")})`
          )
        : [];
      const seen = new Set(existing.map((row) => row.gmail_message_id));

      const profiles = await request<Array<{ id: string }>>(
        `career_profiles?select=id&owner_id=eq.${encodeURIComponent(connection.owner_id)}`
      );
      const profileIds = profiles.map((row) => row.id);
      const applications = profileIds.length
        ? await request<ApplicationRow[]>(
            `applications?select=id,job_id,profile_id,status&profile_id=in.(${profileIds.join(",")})&limit=1000`
          )
        : [];
      const jobIds = [...new Set(applications.map((application) => application.job_id))];
      const jobRows = jobIds.length
        ? await request<JobRow[]>(
            `jobs?select=id,title,company&id=in.(${jobIds.join(",")})`
          )
        : [];
      const jobs = new Map(jobRows.map((job) => [job.id, job]));

      for (const id of ids.filter((value) => !seen.has(value))) {
        const message = await getGmailMessage(connection, id);
        const subject = gmailHeader(message, "Subject");
        const sender = gmailHeader(message, "From");
        const date = gmailHeader(message, "Date");
        const snippet = message.snippet ?? "";

        if (
          connection.email_address &&
          sender.toLowerCase().includes(connection.email_address.toLowerCase()) &&
          /^remotejobos\b/i.test(subject)
        ) {
          continue;
        }

        const classification = classifyJobEmail({ subject, snippet, sender });
        const application = matchApplication(subject, snippet, sender, applications, jobs);

        await request("gmail_messages?on_conflict=owner_id,gmail_message_id", {
          method: "POST",
          headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
          body: JSON.stringify({
            owner_id: connection.owner_id,
            gmail_message_id: message.id,
            thread_id: message.threadId ?? null,
            sender,
            subject,
            snippet,
            received_at: headerDate(date, message.internalDate),
            classification: classification.classification,
            classification_reason: classification.reason,
            matched_application_id: application?.id ?? null
          })
        });
        stored += 1;

        const nextStatus = lifecycleStatus(classification.classification);
        if (application && nextStatus) {
          await request(`applications?id=eq.${encodeURIComponent(application.id)}`, {
            method: "PATCH",
            body: JSON.stringify({
              status: nextStatus,
              next_action:
                classification.classification === "interview"
                  ? "Interview message received — review Gmail."
                  : classification.classification === "assessment"
                    ? "Assessment received — review Gmail and complete it."
                    : classification.classification === "offer"
                      ? "Offer message received — review Gmail."
                      : classification.classification === "rejection"
                        ? "Employer rejection received."
                        : "Recruiter response received — review Gmail.",
              updated_at: new Date().toISOString()
            })
          });

          const job = jobs.get(application.job_id);
          if (job) {
            await queueNotification({
              ownerId: connection.owner_id,
              applicationId: application.id,
              kind: classification.classification,
              subject: `RemoteJobOS: ${classification.classification.replace(/-/g, " ")} — ${job.company}`,
              bodyText: [
                `RemoteJobOS detected a ${classification.classification.replace(/-/g, " ")} message.`,
                "",
                `Company: ${job.company}`,
                `Role: ${job.title}`,
                `Email subject: ${subject}`,
                "",
                "Open Gmail or the RemoteJobOS Inbox for the full message."
              ].join("\n"),
              dedupeKey: `gmail-lifecycle:${message.id}`
            });
          }
        }
      }

      await request(
        `gmail_connections?owner_id=eq.${encodeURIComponent(connection.owner_id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            last_synced_at: new Date().toISOString(),
            last_error: null,
            updated_at: new Date().toISOString()
          })
        }
      );
    } catch (error) {
      await request(
        `gmail_connections?owner_id=eq.${encodeURIComponent(connection.owner_id)}`,
        {
          method: "PATCH",
          body: JSON.stringify({
            last_error: error instanceof Error ? error.message : String(error),
            updated_at: new Date().toISOString()
          })
        }
      ).catch(() => undefined);
    }
  }

  console.log(`[gmail] lifecycle stored=${stored} connections=${connections.length}`);
  return stored;
}
