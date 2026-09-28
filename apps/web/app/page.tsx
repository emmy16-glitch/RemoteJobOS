import { redirect } from "next/navigation";
import { signOut } from "./auth-actions";
import { authenticatedUserId } from "../lib/auth";
import { getDashboardData } from "../lib/dashboard-data";
import { publicSupabaseEnv } from "../lib/supabase/env";
import { Sidebar } from "./components/sidebar";

export const dynamic = "force-dynamic";

function onlineFrom(lastSuccess: string | null) {
  if (!lastSuccess) return false;
  const age = Date.now() - new Date(lastSuccess).getTime();
  return Number.isFinite(age) && age >= 0 && age < 3 * 60 * 60 * 1000;
}

function greeting() {
  const hour = Number(
    new Intl.DateTimeFormat("en", {
      hour: "2-digit",
      hourCycle: "h23",
      timeZone: "Africa/Lagos"
    }).format(new Date())
  );
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function initials(name: string | null) {
  const parts = (name ?? "Remote Job").trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "RJ";
}

function companyInitials(company: string) {
  const parts = company.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "R";
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    applied: "Submitted",
    "auto-submit-queued": "Queued",
    "needs-attention": "Needs Info",
    "cv-prepared": "Preparing",
    "ready-for-review": "Review",
    response: "Response",
    assessment: "Assessment",
    interview: "Interview",
    offer: "Offer",
    rejected: "Rejected",
    withdrawn: "Withdrawn"
  };
  return map[status] ?? status.replace(/-/g, " ");
}

function notificationLabel(classification: string) {
  const map: Record<string, string> = {
    interview: "Interview invitation",
    assessment: "Assessment received",
    offer: "Offer received",
    rejection: "Rejection",
    recruiter: "Recruiter response",
    "application-received": "Application confirmed"
  };
  return map[classification] ?? classification.replace(/-/g, " ");
}

function MetricCard({
  tone,
  icon,
  value,
  label,
  detail
}: {
  tone: "blue" | "green" | "purple" | "amber" | "rose";
  icon: string;
  value: number;
  label: string;
  detail: string;
}) {
  return (
    <article className={"heroMetric " + tone}>
      <div className="heroMetricIcon" aria-hidden="true">{icon}</div>
      <div className="heroMetricCopy">
        <strong>{value.toLocaleString()}</strong>
        <span>{label}</span>
        <small>{detail}</small>
      </div>
      <div className="miniBars" aria-hidden="true">
        {[34, 46, 58, 72, 88].map((height, index) => (
          <i key={index} style={{ height: height + "%" }} />
        ))}
      </div>
    </article>
  );
}

export default async function Home() {
  if (!publicSupabaseEnv().configured) {
    return (
      <main className="setupShell">
        <section className="setupCard">
          <div className="loginBrand">
            <div className="brandMark" aria-hidden="true">
              <span className="brandHandle" />
              <span className="brandCase" />
            </div>
            <div>
              <b>RemoteJobOS</b>
              <span>Find. Apply. Get Hired. Automatically.</span>
            </div>
          </div>
          <p className="eyebrow">ONE-TIME SETUP</p>
          <h1>Connect Supabase</h1>
          <p>
            Add the project URL and publishable key to this deployment. The
            dashboard now uses your authenticated session and does not need a
            service-role key for normal browsing.
          </p>
          <div className="setupCode">
            <code>NEXT_PUBLIC_SUPABASE_URL</code>
            <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>
          </div>
        </section>
      </main>
    );
  }

  const userId = await authenticatedUserId();
  if (!userId) redirect("/login");

  const data = await getDashboardData(userId);
  const agentOnline = onlineFrom(data.lastSourceSuccess);
  const alertCount = data.needsAttention + data.newResponses;

  return (
    <main className="appShell">
      <Sidebar
        active="Dashboard"
        agentHealthy={agentOnline}
        counts={{
          Jobs: data.strongMatches,
          Applications: data.applications,
          Exceptions: data.needsAttention,
          CVs: data.cvCount,
          Inbox: data.newResponses
        }}
      />

      <section className="appMain">
        <header className="appHeader">
          <form className="globalSearch" action="/jobs">
            <span aria-hidden="true">⌕</span>
            <input
              name="q"
              aria-label="Search jobs, companies, or applications"
              placeholder="Search jobs, companies, or view applications..."
            />
          </form>

          <div className="headerActions">
            <a className="notificationButton" href="/exceptions" aria-label="Notifications">
              <span aria-hidden="true">♧</span>
              {alertCount > 0 ? <b>{Math.min(alertCount, 99)}</b> : null}
            </a>
            <span className="headerDivider" />
            <a className="userMenu" href="/profile">
              <span className="avatar">{initials(data.profileName)}</span>
              <strong>{data.profileName ?? "Your profile"}</strong>
              <span aria-hidden="true">⌄</span>
            </a>
            <form action={signOut}>
              <button className="logoutButton" type="submit">Sign out</button>
            </form>
          </div>
        </header>

        <div className="dashboardCanvas">
          <section className="welcomeRow">
            <div>
              <h1>{greeting()}, {data.firstName} <span aria-hidden="true">👋</span></h1>
              <p>Your job search is running automatically. Here&apos;s what&apos;s happening.</p>
            </div>

            <div className="automationSummary">
              <div className="automationStatusCard">
                <span className={agentOnline ? "statusOrb live" : "statusOrb"} />
                <div>
                  <small>Automation Status</small>
                  <strong>{agentOnline ? "Running" : "Waiting"}</strong>
                  <span>
                    {data.lastSourceSuccess
                      ? "Cloud workers reporting normally"
                      : "Waiting for the first discovery run"}
                  </span>
                </div>
              </div>
              <a className="outlineButton" href="/agent">
                <span aria-hidden="true">☷</span>
                View Logs
              </a>
            </div>
          </section>

          {!data.profileConfigured ? (
            <div className="notice warning dashboardNotice">
              <b>Finish your career profile</b>
              <span>
                Your account is ready, but matching and applications stay paused
                until a verified profile is attached.
              </span>
              <a href="/profile">Open settings →</a>
            </div>
          ) : null}

          <section className="heroMetrics">
            <MetricCard
              tone="blue"
              icon="⌕"
              value={data.newJobsToday}
              label="New jobs today"
              detail={data.jobsDiscovered + " remote jobs tracked"}
            />
            <MetricCard
              tone="green"
              icon="☆"
              value={data.strongMatches}
              label="Strong matches"
              detail={data.eligible + " eligible opportunities"}
            />
            <MetricCard
              tone="purple"
              icon="▧"
              value={data.applied}
              label="Applications submitted"
              detail={data.autoSubmitQueued + " queued automatically"}
            />
            <MetricCard
              tone="amber"
              icon="◷"
              value={data.needsAttention}
              label="Need your attention"
              detail={data.needsAttention ? "Requires your input" : "Nothing blocking automation"}
            />
            <MetricCard
              tone="rose"
              icon="✉"
              value={data.newResponses}
              label="New responses"
              detail={data.gmailConnected ? "Tracked from Gmail" : "Connect Gmail to track replies"}
            />
          </section>

          <section className="dashboardGrid">
            <article className="dashPanel recentApplicationsPanel">
              <div className="dashPanelHead">
                <h2>Recent Applications</h2>
                <a href="/applications">View all applications →</a>
              </div>

              <div className="applicationTable">
                <div className="applicationTableHead">
                  <span>Role / Company</span>
                  <span>Match</span>
                  <span>Status</span>
                  <span>Next action</span>
                  <span>Updated</span>
                  <span />
                </div>

                {data.recentApplications.length ? data.recentApplications.map((application) => (
                  <div className="applicationTableRow" key={application.id}>
                    <div className="applicationIdentity">
                      <span className="companyBadge">{companyInitials(application.company)}</span>
                      <div>
                        <b>{application.role}</b>
                        <strong>{application.company}</strong>
                        <small>⌖ {application.scope}</small>
                      </div>
                    </div>
                    <span className="matchPill">
                      {application.score === null ? "—" : application.score + "%"}
                    </span>
                    <span className={"statusPill " + application.status}>
                      {statusLabel(application.status)}
                    </span>
                    <span className="nextActionText">{application.nextAction}</span>
                    <span className="updatedText">{application.updated}</span>
                    <a className="rowMenu" href={"/applications?status=" + encodeURIComponent(application.status)}>⋮</a>
                  </div>
                )) : (
                  <div className="tableEmpty">
                    Applications will appear here as soon as strong matches enter the automation pipeline.
                  </div>
                )}
              </div>
            </article>

            <article className="dashPanel pipelinePanel">
              <div className="dashPanelHead">
                <h2>Automation Pipeline</h2>
                <span className={agentOnline ? "liveBadge" : "liveBadge idle"}>
                  <i /> {agentOnline ? "Live" : "Waiting"}
                </span>
              </div>

              <div className="pipelineList">
                <div className="pipelineRow">
                  <span className="pipelineIcon green">⌕</span>
                  <b>Discovering jobs</b>
                  <small>{data.newJobsToday} new today</small>
                </div>
                <div className="pipelineRow">
                  <span className="pipelineIcon green">☆</span>
                  <b>Matching</b>
                  <small>{data.strongMatches} strong matches</small>
                </div>
                <div className="pipelineRow">
                  <span className="pipelineIcon blue">▧</span>
                  <b>Generating CVs</b>
                  <small>{data.cvCount} completed</small>
                </div>
                <div className="pipelineRow">
                  <span className="pipelineIcon purple">▤</span>
                  <b>Preparing applications</b>
                  <small>{data.prepared} in progress</small>
                </div>
                <div className="pipelineRow">
                  <span className="pipelineIcon amber">▣</span>
                  <b>Submitting</b>
                  <small>{data.autoSubmitQueued} queued</small>
                </div>
                <div className="pipelineRow">
                  <span className="pipelineIcon amber">✉</span>
                  <b>Tracking responses</b>
                  <small>{data.gmailConnected ? "Active (Gmail)" : "Connect Gmail"}</small>
                </div>
              </div>
            </article>

            <article className="dashPanel attentionPanel">
              <div className="dashPanelHead">
                <h2>Needs Your Attention ({data.needsAttention})</h2>
                <a href="/exceptions">View all →</a>
              </div>
              <div className="compactList">
                {data.exceptions.length ? data.exceptions.map((item) => (
                  <div className="attentionRow" key={item.id}>
                    <span className="companyBadge small">{companyInitials(item.company)}</span>
                    <div>
                      <b>{item.role}</b>
                      <small>{item.company}</small>
                    </div>
                    <div className="attentionReason">
                      <strong>{item.type.replace(/-/g, " ")}</strong>
                      <small>{item.age}</small>
                    </div>
                    <a
                      className={
                        "compactAction " +
                        (item.action === "Review" ? "warn" : "")
                      }
                      href="/exceptions"
                    >
                      {item.action}
                    </a>
                  </div>
                )) : (
                  <div className="miniEmpty">Nothing needs you right now.</div>
                )}
              </div>
            </article>

            <article className="dashPanel matchesPanel">
              <div className="dashPanelHead">
                <h2>Latest Job Matches</h2>
                <a href="/jobs">View all →</a>
              </div>
              <div className="compactList">
                {data.latestJobs.slice(0, 4).map((job) => (
                  <a className="matchRow" href={"/jobs?q=" + encodeURIComponent(job.company)} key={job.id}>
                    <span className="companyBadge small">{companyInitials(job.company)}</span>
                    <div>
                      <b>{job.role}</b>
                      <small>{job.company}</small>
                    </div>
                    <strong>{job.score}%</strong>
                  </a>
                ))}
                {!data.latestJobs.length ? <div className="miniEmpty">No scored matches yet.</div> : null}
              </div>
            </article>

            <article className="dashPanel cvsPanel">
              <div className="dashPanelHead">
                <h2>Your CVs</h2>
                <a href="/cvs">View all →</a>
              </div>
              <div className="compactList">
                {data.latestCvs.map((cv) => (
                  <a className="cvMiniRow" href="/cvs" key={cv.id}>
                    <span className="cvMiniIcon">▧</span>
                    <div>
                      <b>{cv.role}</b>
                      <small>Tailored for {cv.company}</small>
                    </div>
                    <span>v{cv.version}</span>
                    <strong>View</strong>
                  </a>
                ))}
                {!data.latestCvs.length ? <div className="miniEmpty">Tailored CVs will appear automatically.</div> : null}
              </div>
            </article>

            <article className="dashPanel gmailPanel">
              <div className="dashPanelHead">
                <h2>Gmail &amp; Notifications</h2>
                <span className={data.gmailConnected ? "connectedBadge" : "connectedBadge off"}>
                  <i /> {data.gmailConnected ? "Connected" : "Setup needed"}
                </span>
              </div>

              <div className="gmailAccount">
                <span className="gmailMark">M</span>
                <div>
                  <b>{data.gmailEmail ?? "Connect your Gmail"}</b>
                  <small>{data.gmailConnected ? "Lifecycle tracking is active" : "Track employer replies and alerts"}</small>
                </div>
                <a href={data.gmailConnected ? "/inbox" : "/api/gmail/connect"}>{data.gmailConnected ? "Settings" : "Connect"}</a>
              </div>

              <div className="mailPreviewList">
                {data.messages.map((message) => (
                  <a href="/inbox" className="mailPreviewRow" key={message.id}>
                    <span className={"mailEventIcon " + message.classification}>
                      {message.classification === "rejection" ? "×" :
                       message.classification === "application-received" ? "✓" :
                       message.classification === "interview" ? "▣" : "↗"}
                    </span>
                    <div>
                      <b>{notificationLabel(message.classification)}</b>
                      <small>{message.subject}</small>
                    </div>
                    <time>{message.age}</time>
                  </a>
                ))}
                {!data.messages.length ? (
                  <div className="miniEmpty">No job-response email has been synchronized yet.</div>
                ) : null}
              </div>

              <a className="gmailFooterLink" href="/inbox">View all messages →</a>
            </article>
          </section>
        </div>
      </section>
    </main>
  );
}
