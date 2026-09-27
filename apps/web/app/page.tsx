import { redirect } from "next/navigation";
import { signOut } from "./auth-actions";
import { authenticatedUserId } from "../lib/auth";
import { getDashboardData } from "../lib/dashboard-data";
import { publicSupabaseEnv, serverSupabaseEnv } from "../lib/supabase/env";

export const dynamic = "force-dynamic";

const nav = [
  "Overview",
  "Jobs",
  "Applications",
  "CVs",
  "Inbox",
  "Analytics",
  "Agent",
  "Rules",
  "Settings"
];

function Metric({
  label,
  value,
  detail
}: {
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

function setupMissing() {
  return !publicSupabaseEnv().configured || !serverSupabaseEnv().configured;
}

function onlineFrom(lastSuccess: string | null) {
  if (!lastSuccess) return false;
  const age = Date.now() - new Date(lastSuccess).getTime();
  return Number.isFinite(age) && age >= 0 && age < 3 * 60 * 60 * 1000;
}

export default async function Home() {
  if (setupMissing()) {
    return (
      <main className="setupShell">
        <section className="setupCard">
          <div className="brand setupBrand">
            <div className="mark">R</div>
            <div>
              <b>RemoteJobOS</b>
              <span>Cloud-first job operations</span>
            </div>
          </div>
          <p className="eyebrow">SETUP REQUIRED</p>
          <h1>Connect the database</h1>
          <p>
            The dashboard is built, but Supabase environment variables have not
            been configured in this deployment yet.
          </p>
          <div className="setupCode">
            <code>NEXT_PUBLIC_SUPABASE_URL</code>
            <code>NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY</code>
            <code>SUPABASE_URL</code>
            <code>SUPABASE_SERVICE_ROLE_KEY</code>
          </div>
          <p className="muted">
            The service-role key is server-only and must never use a
            NEXT_PUBLIC_ prefix.
          </p>
        </section>
      </main>
    );
  }

  const userId = await authenticatedUserId();
  if (!userId) redirect("/login");

  const data = await getDashboardData(userId);
  const agentOnline = onlineFrom(data.lastSourceSuccess);
  const maxFunnel = Math.max(1, data.jobsDiscovered);

  const funnel: Array<[string, number]> = [
    ["Discovered", data.jobsDiscovered],
    ["Eligible", data.eligible],
    ["Strong match", data.strongMatches],
    ["Prepared", data.prepared],
    ["Applied", data.applied]
  ];

  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="mark">R</div>
          <div>
            <b>RemoteJobOS</b>
            <span>Control center</span>
          </div>
        </div>

        <nav>
          {nav.map((item, index) => (
            <a className={index === 0 ? "active" : ""} href="#" key={item}>
              {item}
            </a>
          ))}
        </nav>

        <div className="sidebarFoot">
          <span className={agentOnline ? "dot" : "dot off"} />
          {agentOnline ? "Cloud agent healthy" : "Agent awaiting heartbeat"}
          <small>Remote-only · AI optional</small>
        </div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">REMOTE JOB OPERATIONS</p>
            <h1>Overview</h1>
          </div>

          <div className="topActions">
            <div className="status">
              <span className={agentOnline ? "pulse" : "pulse off"} />
              {agentOnline ? "Agent online" : "No recent discovery run"}
            </div>
            <form action={signOut}>
              <button className="signOut" type="submit">
                Sign out
              </button>
            </form>
          </div>
        </header>

        {!data.profileConfigured ? (
          <div className="notice warning">
            <b>Career profile required</b>
            <span>
              Jobs can already be discovered, but matching, CV preparation and
              applications stay disabled until an authenticated career profile
              is attached to this account.
            </span>
          </div>
        ) : (
          <div className="notice">
            <b>Remote-only mode</b>
            <span>
              Discover globally. Geographic and work-authorization restrictions
              are classified after discovery, not before.
            </span>
          </div>
        )}

        <section className="metrics">
          <Metric
            label="Jobs discovered"
            value={data.jobsDiscovered.toLocaleString()}
            detail="Remote jobs in the database"
          />
          <Metric
            label="Strong matches"
            value={data.strongMatches.toLocaleString()}
            detail="Deterministic match engine"
          />
          <Metric
            label="Ready for review"
            value={data.readyForReview.toLocaleString()}
            detail="Human gate before submission"
          />
          <Metric
            label="Applications"
            value={data.applications.toLocaleString()}
            detail={data.applied + " confirmed submitted"}
          />
        </section>

        <section className="grid">
          <article className="panel jobsPanel">
            <div className="panelHead">
              <div>
                <p>QUEUE</p>
                <h2>Strong matches</h2>
              </div>
              <span className="panelMeta">
                {data.profileName ?? "Verified profile"}
              </span>
            </div>

            {data.latestJobs.length ? (
              <>
                <div className="jobHeader">
                  <span>Match</span>
                  <span>Role</span>
                  <span>Scope</span>
                  <span>Category</span>
                </div>
                {data.latestJobs.map((job) => (
                  <div
                    className="jobRow"
                    key={job.company + ":" + job.role}
                  >
                    <span className="score">{job.score}</span>
                    <span>
                      <b>{job.role}</b>
                      <small>{job.company}</small>
                    </span>
                    <span>{job.scope}</span>
                    <span className="chip">{job.family}</span>
                  </div>
                ))}
              </>
            ) : (
              <div className="emptyState">
                No strong matches yet. Discovery and matching can run without
                an AI provider.
              </div>
            )}
          </article>

          <article className="panel agentPanel">
            <div className="panelHead">
              <div>
                <p>WORKER</p>
                <h2>Cloud agent</h2>
              </div>
              <span className={agentOnline ? "live" : "live idle"}>
                {agentOnline ? "HEALTHY" : "IDLE"}
              </span>
            </div>

            <div className="agentStat">
              <span>Discovery</span>
              <b>{agentOnline ? "Healthy" : "Waiting"}</b>
            </div>
            <div className="agentStat">
              <span>Eligible matches</span>
              <b>{data.eligible}</b>
            </div>
            <div className="agentStat">
              <span>Application queue</span>
              <b>{data.applicationQueue}</b>
            </div>
            <div className="agentStat">
              <span>Confirmed applied</span>
              <b>{data.applied}</b>
            </div>

            <div className="agentRule">
              <small>AUTONOMY</small>
              <strong>Review before submit</strong>
              <p>
                Deterministic planning and DOM verification run in the cloud.
                Sensitive or unknown fields stop for review. AI is not required.
              </p>
            </div>
          </article>

          <article className="panel activityPanel">
            <div className="panelHead">
              <div>
                <p>EVENT STREAM</p>
                <h2>Agent activity</h2>
              </div>
            </div>

            {data.activity.length ? (
              data.activity.map((event, index) => (
                <div className="activity" key={event.time + event.type + index}>
                  <time>{event.time}</time>
                  <span>{event.type}</span>
                  <p>{event.text}</p>
                </div>
              ))
            ) : (
              <div className="emptyState">
                Agent events will appear here after the cloud workers run.
              </div>
            )}
          </article>

          <article className="panel funnelPanel">
            <div className="panelHead">
              <div>
                <p>PIPELINE</p>
                <h2>Application funnel</h2>
              </div>
            </div>

            {funnel.map(([label, value]) => (
              <div className="funnel" key={label}>
                <span>{label}</span>
                <div>
                  <i
                    style={{
                      width:
                        Math.max(
                          value > 0 ? 5 : 0,
                          Math.min(100, (value / maxFunnel) * 100)
                        ) + "%"
                    }}
                  />
                </div>
                <b>{value}</b>
              </div>
            ))}
          </article>
        </section>
      </section>
    </main>
  );
}
