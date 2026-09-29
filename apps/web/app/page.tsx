import { redirect } from "next/navigation";
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

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return parts.slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "RJ";
}

function statusLabel(status: string) {
  const map: Record<string, string> = {
    applied: "Applied",
    "auto-submit-queued": "Queued",
    "needs-attention": "Needs attention",
    "cv-prepared": "CV prepared",
    "ready-for-review": "Ready",
    response: "Response",
    assessment: "Assessment",
    interview: "Interview",
    offer: "Offer",
    rejected: "Rejected",
    withdrawn: "Withdrawn"
  };
  return map[status] ?? status.replace(/-/g, " ");
}

function MetricCard({
  icon,
  label,
  value,
  tone,
  detail
}: {
  icon: string;
  label: string;
  value: number;
  tone: string;
  detail: string;
}) {
  return (
    <article className={"overviewMetric " + tone}>
      <div className="overviewMetricTop">
        <span className="overviewMetricIcon" aria-hidden="true">{icon}</span>
        <span>{label}</span>
      </div>
      <div className="overviewMetricValue">
        <strong>{value.toLocaleString()}</strong>
        <div className="metricSpark" aria-hidden="true">
          {[28, 42, 38, 60, 74, 88].map((height, index) => (
            <i key={index} style={{ height: height + "%" }} />
          ))}
        </div>
      </div>
      <small>{detail}</small>
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
              <span>Find. Match. Apply. Get hired.</span>
            </div>
          </div>
          <p className="eyebrow">ONE-TIME SETUP</p>
          <h1>Connect Supabase</h1>
          <p>Add the public Supabase project URL and publishable key to this deployment.</p>
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
  const completionRate = data.applications
    ? Math.min(100, Math.round((data.applied / data.applications) * 100))
    : 0;

  const pipeline = [
    ["Discovered", data.jobsDiscovered, "blue"],
    ["Strong matches", data.strongMatches, "indigo"],
    ["Prepared", data.prepared, "violet"],
    ["Submitted", data.applied, "green"],
    ["Responses", data.newResponses, "amber"]
  ] as const;
  const pipelineMax = Math.max(1, ...pipeline.map(([, value]) => value));

  return (
    <main className="appShell">
      <Sidebar
        active="Overview"
        agentHealthy={agentOnline}
        counts={{
          Jobs: data.strongMatches,
          Applications: data.applications,
          Exceptions: data.needsAttention,
          CVs: data.cvCount,
          Responses: data.newResponses
        }}
      />

      <section className="appMain">
        <div className="overviewLayout">
          <section className="overviewPrimary">
            <header className="overviewHero">
              <div>
                <h1>Overview</h1>
                <p>High-throughput job application automation. Running every 5 minutes.</p>
              </div>
              <div className="overviewHeroActions">
                <span className={agentOnline ? "automationChip live" : "automationChip"}>
                  <i />
                  {agentOnline ? "Automation active" : "Automation waiting"}
                </span>
                <div className="cycleStat">
                  <small>Application capacity</small>
                  <strong>50 / cycle</strong>
                </div>
                <a className="controlButton" href="/agent">Automation</a>
              </div>
            </header>

            <nav className="rangeTabs" aria-label="Dashboard range">
              <span className="active">Today</span>
              <span>Last 7 days</span>
              <span>Last 30 days</span>
              <span>All time</span>
            </nav>

            {!data.profileConfigured ? (
              <div className="notice warning">
                <b>Finish your career profile</b>
                <span>Matching and applications stay paused until a verified profile is attached.</span>
                <a href="/profile">Open settings →</a>
              </div>
            ) : null}

            <section className="overviewMetrics">
              <MetricCard icon="⌕" label="Jobs discovered" value={data.jobsDiscovered} tone="blue" detail={data.newJobsToday + " added today"} />
              <MetricCard icon="↗" label="Applications submitted" value={data.applied} tone="green" detail={data.autoSubmitQueued + " queued now"} />
              <MetricCard icon="✉" label="Responses received" value={data.newResponses} tone="violet" detail={data.gmailConnected ? "Gmail tracking active" : "Connect Gmail"} />
              <MetricCard icon="☆" label="Strong matches" value={data.strongMatches} tone="amber" detail={data.eligible + " eligible jobs"} />
              <MetricCard icon="!" label="Requires attention" value={data.needsAttention} tone="rose" detail={data.needsAttention ? "Only genuine blockers" : "Nothing blocking"} />
            </section>

            <section className="activityGrid">
              <article className="surfacePanel activityPanel">
                <div className="surfaceHead">
                  <div>
                    <h2>Application activity</h2>
                    <p>Current pipeline volume</p>
                  </div>
                  <div className="legend">
                    <span><i className="blueDot" /> Pipeline</span>
                  </div>
                </div>
                <div className="pipelineChart">
                  {pipeline.map(([label, value, tone]) => (
                    <div className="pipelineBarGroup" key={label}>
                      <div className="pipelineBarTrack">
                        <i
                          className={tone}
                          style={{ height: Math.max(value ? 8 : 2, (value / pipelineMax) * 100) + "%" }}
                        />
                      </div>
                      <b>{value.toLocaleString()}</b>
                      <span>{label}</span>
                    </div>
                  ))}
                </div>
              </article>

              <article className="surfacePanel successPanel">
                <div className="surfaceHead">
                  <div>
                    <h2>Submission completion</h2>
                    <p>Confirmed submissions</p>
                  </div>
                </div>
                <div
                  className="donut"
                  style={{ background: `conic-gradient(#22c55e ${completionRate}%, #e8f5ec 0)` }}
                  aria-label={completionRate + "% of application records submitted"}
                >
                  <div><strong>{completionRate}%</strong></div>
                </div>
                <p className="donutLabel">
                  <b>{data.applied.toLocaleString()}</b> / {data.applications.toLocaleString()} application records
                </p>
              </article>
            </section>

            <article className="surfacePanel recentPanel">
              <div className="surfaceHead">
                <div>
                  <h2>Recent applications</h2>
                  <p>Latest application activity from the automation pipeline.</p>
                </div>
                <a className="smallButton" href="/applications">View all →</a>
              </div>

              <div className="cleanTableWrap">
                <table className="cleanTable">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Job</th>
                      <th>Company</th>
                      <th>Location</th>
                      <th>Match</th>
                      <th>Status</th>
                      <th>Updated</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.recentApplications.length ? data.recentApplications.map((application, index) => (
                      <tr key={application.id}>
                        <td>{index + 1}</td>
                        <td><b>{application.role}</b></td>
                        <td>
                          <span className="companyCell">
                            <i>{initials(application.company)}</i>
                            {application.company}
                          </span>
                        </td>
                        <td>{application.scope}</td>
                        <td>{application.score === null ? "—" : application.score + "%"}</td>
                        <td><span className={"tableStatus " + application.status}>{statusLabel(application.status)}</span></td>
                        <td>{application.updated}</td>
                      </tr>
                    )) : (
                      <tr>
                        <td colSpan={7}>
                          <div className="tableEmpty">Eligible applications will appear here automatically.</div>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </article>
          </section>

          <aside className="overviewRail">
            <article className="surfacePanel railPanel">
              <div className="surfaceHead">
                <h2>Live activity</h2>
                <span className={agentOnline ? "liveBadge" : "liveBadge idle"}><i /> {agentOnline ? "Live" : "Idle"}</span>
              </div>
              <div className="activityFeed">
                {data.recentApplications.slice(0, 6).map((application) => (
                  <a href="/applications" className="activityFeedRow" key={application.id}>
                    <span className={"activityDot " + application.status}>✓</span>
                    <div>
                      <b>{statusLabel(application.status)} · {application.role}</b>
                      <small>{application.company}</small>
                    </div>
                    <time>{application.updated}</time>
                  </a>
                ))}
                {data.messages.slice(0, 3).map((message) => (
                  <a href="/inbox" className="activityFeedRow" key={message.id}>
                    <span className="activityDot response">✉</span>
                    <div>
                      <b>{message.subject}</b>
                      <small>{message.sender}</small>
                    </div>
                    <time>{message.age}</time>
                  </a>
                ))}
                {!data.recentApplications.length && !data.messages.length ? (
                  <div className="miniEmpty">Activity will appear as the workers run.</div>
                ) : null}
              </div>
            </article>

            <article className="surfacePanel railPanel">
              <div className="surfaceHead">
                <h2>System status</h2>
              </div>
              <p className="systemSummary"><i className={agentOnline ? "ok" : ""} /> {agentOnline ? "Core automation operational" : "Waiting for worker heartbeat"}</p>
              <div className="statusList">
                <div><span>Discovery</span><b className={agentOnline ? "okText" : ""}>{agentOnline ? "Online" : "Waiting"}</b></div>
                <div><span>Matching & CV generation</span><b className="okText">Ready</b></div>
                <div><span>Application workers (5)</span><b className="okText">Ready</b></div>
                <div><span>Gmail monitoring</span><b className={data.gmailConnected ? "okText" : ""}>{data.gmailConnected ? "Online" : "Setup"}</b></div>
                <div><span>Exceptions</span><b>{data.needsAttention}</b></div>
              </div>
            </article>

            <article className="surfacePanel railPanel">
              <div className="surfaceHead">
                <h2>Throughput</h2>
              </div>
              <div className="throughputStats">
                <div><strong>5</strong><span>parallel workers</span></div>
                <div><strong>10</strong><span>jobs / worker</span></div>
                <div><strong>5m</strong><span>application cycle</span></div>
                <div><strong>50</strong><span>max / cycle</span></div>
              </div>
              <p className="railNote">Capacity is used only when enough eligible, verified jobs are available.</p>
            </article>
          </aside>
        </div>
      </section>
    </main>
  );
}
