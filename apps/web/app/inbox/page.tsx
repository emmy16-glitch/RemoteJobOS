import { Sidebar } from "../components/sidebar";
import { requireDashboardUser } from "../../lib/page-auth";
import { createServerSupabaseClient } from "../../lib/supabase/server";
import {
  hasGmailReadAccess,
  hasGmailSendAccess,
  isGmailFullyConfigured
} from "../../lib/gmail/scopes";
import { saveNotificationPreferences } from "./actions";

export const dynamic = "force-dynamic";

type GmailConnection = {
  email_address: string | null;
  granted_scope: string | null;
  active: boolean;
  last_synced_at: string | null;
  last_error: string | null;
};

type GmailMessage = {
  id: string;
  sender: string | null;
  subject: string | null;
  snippet: string | null;
  received_at: string | null;
  classification: string;
  matched_application_id: string | null;
};

type NotificationPrefs = {
  email_enabled: boolean;
  email_address: string | null;
  notify_exceptions: boolean;
  notify_submitted: boolean;
  notify_assessment: boolean;
  notify_interview: boolean;
  notify_offer: boolean;
  notify_rejection: boolean;
};

function time(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos"
  }).format(new Date(value));
}

function pretty(value: string) {
  return value.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function InboxPage({
  searchParams
}: {
  searchParams: Promise<{ connected?: string; error?: string }>;
}) {
  const userId = await requireDashboardUser("/inbox");
  const params = await searchParams;
  const supabase = await createServerSupabaseClient();

  const [connectionResult, messageResult, preferenceResult] = await Promise.all([
    supabase
      .from("gmail_connections")
      .select("email_address,granted_scope,active,last_synced_at,last_error")
      .eq("owner_id", userId)
      .maybeSingle(),
    supabase
      .from("gmail_messages")
      .select("id,sender,subject,snippet,received_at,classification,matched_application_id")
      .eq("owner_id", userId)
      .order("received_at", { ascending: false })
      .limit(50),
    supabase
      .from("notification_preferences")
      .select("email_enabled,email_address,notify_exceptions,notify_submitted,notify_assessment,notify_interview,notify_offer,notify_rejection")
      .eq("owner_id", userId)
      .maybeSingle()
  ]);

  if (connectionResult.error) throw new Error(connectionResult.error.message);
  if (messageResult.error) throw new Error(messageResult.error.message);
  if (preferenceResult.error) throw new Error(preferenceResult.error.message);

  const connection = connectionResult.data as GmailConnection | null;
  const messages = (messageResult.data ?? []) as GmailMessage[];
  const prefs = preferenceResult.data as NotificationPrefs | null;
  const hasRead = hasGmailReadAccess(connection?.granted_scope);
  const hasSend = hasGmailSendAccess(connection?.granted_scope);
  const fullyConnected = isGmailFullyConfigured({
    active: connection?.active,
    grantedScope: connection?.granted_scope
  });

  return (
    <main className="shell">
      <Sidebar active="Inbox" />
      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">GMAIL AUTOMATION</p>
            <h1>Inbox & notifications</h1>
          </div>
          <div className="status">{fullyConnected ? "Gmail connected" : "Gmail setup needed"}</div>
        </header>

        {params.error && !fullyConnected ? (
          <div className="notice warning"><b>Gmail connection failed</b><span>{params.error}</span></div>
        ) : null}

        {params.connected ? (
          <div className="notice"><b>Gmail connected</b><span>RemoteJobOS can now sync job lifecycle email and send your configured alerts.</span></div>
        ) : null}

        <section className="gmailGrid">
          <article className="panel">
            <div className="panelHead">
              <div><p>CONNECTION</p><h2>Gmail account</h2></div>
              <span className={fullyConnected ? "health good" : "health bad"}>
                {fullyConnected ? "Ready" : "Reconnect"}
              </span>
            </div>

            <div className="connectionRows">
              <div><span>Account</span><b>{connection?.email_address ?? "Not connected"}</b></div>
              <div><span>Read lifecycle mail</span><b>{hasRead ? "Enabled" : "Missing"}</b></div>
              <div><span>Send notifications</span><b>{hasSend ? "Enabled" : "Missing"}</b></div>
              <div><span>Last sync</span><b>{time(connection?.last_synced_at ?? null)}</b></div>
            </div>

            {connection?.last_error ? (
              <p className="connectionError">{connection.last_error}</p>
            ) : null}

            <a className="primaryLink" href="/api/gmail/connect">
              {connection ? "Reconnect Gmail" : "Connect Gmail"}
            </a>
          </article>

          <article className="panel">
            <div className="panelHead">
              <div><p>ALERTS</p><h2>What should email you?</h2></div>
            </div>

            <form action={saveNotificationPreferences} className="notificationForm">
              <label>
                <span>Notification email</span>
                <input
                  type="email"
                  name="emailAddress"
                  defaultValue={prefs?.email_address ?? connection?.email_address ?? ""}
                  placeholder="you@gmail.com"
                />
              </label>

              {[
                ["emailEnabled", "Enable Gmail notifications", prefs?.email_enabled ?? true],
                ["notifyExceptions", "Anything that needs my attention", prefs?.notify_exceptions ?? true],
                ["notifySubmitted", "Confirmed applications", prefs?.notify_submitted ?? true],
                ["notifyAssessment", "Assessments", prefs?.notify_assessment ?? true],
                ["notifyInterview", "Interview messages", prefs?.notify_interview ?? true],
                ["notifyOffer", "Offers", prefs?.notify_offer ?? true],
                ["notifyRejection", "Rejections", prefs?.notify_rejection ?? true]
              ].map(([name, label, selected]) => (
                <label className="checkItem" key={String(name)}>
                  <input
                    type="checkbox"
                    name={String(name)}
                    defaultChecked={Boolean(selected)}
                  />
                  <span>{String(label)}</span>
                </label>
              ))}

              <button type="submit" className="primaryButton">Save notification settings</button>
            </form>
          </article>
        </section>

        <article className="panel inboxPanel">
          <div className="panelHead">
            <div><p>LIFECYCLE</p><h2>Recent job-related mail</h2></div>
            <span className="panelMeta">{messages.length} recent</span>
          </div>

          {messages.length ? messages.map((message) => (
            <div className="mailRow" key={message.id}>
              <span className={"decision " + message.classification}>
                {pretty(message.classification)}
              </span>
              <div>
                <b>{message.subject || "(No subject)"}</b>
                <small>{message.sender || "Unknown sender"} · {time(message.received_at)}</small>
                <p>{message.snippet || "No preview available."}</p>
              </div>
            </div>
          )) : (
            <div className="emptyState">
              No job lifecycle email has been synchronized yet.
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
