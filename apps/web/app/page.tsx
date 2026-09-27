const nav = ["Overview", "Jobs", "Applications", "CVs", "Inbox", "Analytics", "Agent", "Rules", "Settings"];

const jobs = [
  { score: 92, role: "Security Analyst", company: "Northstar Labs", scope: "Worldwide", family: "Cybersecurity" },
  { score: 89, role: "DevOps Engineer", company: "Cloud Arc", scope: "EMEA", family: "DevOps" },
  { score: 87, role: "Backend Developer", company: "Relay Systems", scope: "Worldwide", family: "Software" },
  { score: 84, role: "Data Analyst", company: "Metric Forge", scope: "Remote", family: "Data" }
];

const activity = [
  ["21:31", "Discovery", "137 remote jobs checked across active sources"],
  ["21:29", "Filter", "23 duplicate or non-remote roles removed"],
  ["21:26", "Match", "Security Analyst marked strong match"],
  ["21:24", "Queue", "3 applications waiting for review"]
];

function Metric({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <article className="metric">
      <span>{label}</span>
      <strong>{value}</strong>
      <small>{detail}</small>
    </article>
  );
}

export default function Home() {
  return (
    <main className="shell">
      <aside className="sidebar">
        <div className="brand"><div className="mark">R</div><div><b>RemoteJobOS</b><span>Control center</span></div></div>
        <nav>{nav.map((item, index) => <a className={index === 0 ? "active" : ""} href="#" key={item}>{item}</a>)}</nav>
        <div className="sidebarFoot"><span className="dot" /> Cloud agent ready<small>Preview mode</small></div>
      </aside>

      <section className="content">
        <header className="topbar">
          <div><p className="eyebrow">REMOTE JOB OPERATIONS</p><h1>Overview</h1></div>
          <div className="status"><span className="pulse" /> Agent online</div>
        </header>

        <div className="notice"><b>Remote-only mode</b><span>Discover globally. Eligibility restrictions are classified after discovery, not before.</span></div>

        <section className="metrics">
          <Metric label="Jobs discovered" value="1,281" detail="+137 latest run" />
          <Metric label="Strong matches" value="49" detail="3.8% of discovered" />
          <Metric label="Ready for review" value="14" detail="Human gate enabled" />
          <Metric label="Applications" value="9" detail="This week" />
        </section>

        <section className="grid">
          <article className="panel jobsPanel">
            <div className="panelHead"><div><p>QUEUE</p><h2>Strong matches</h2></div><button>View all jobs</button></div>
            <div className="jobHeader"><span>Match</span><span>Role</span><span>Scope</span><span>Category</span></div>
            {jobs.map((job) => (
              <div className="jobRow" key={job.role}>
                <span className="score">{job.score}</span>
                <span><b>{job.role}</b><small>{job.company}</small></span>
                <span>{job.scope}</span>
                <span className="chip">{job.family}</span>
              </div>
            ))}
          </article>

          <article className="panel agentPanel">
            <div className="panelHead"><div><p>WORKER</p><h2>Cloud agent</h2></div><span className="live">LIVE</span></div>
            <div className="agentStat"><span>Discovery</span><b>Running</b></div>
            <div className="agentStat"><span>Analysis queue</span><b>19</b></div>
            <div className="agentStat"><span>Application queue</span><b>6</b></div>
            <div className="agentStat"><span>Last heartbeat</span><b>Just now</b></div>
            <div className="agentRule"><small>AUTONOMY</small><strong>Review before submit</strong><p>Unusual or sensitive questions always stop for human review.</p></div>
          </article>

          <article className="panel activityPanel">
            <div className="panelHead"><div><p>EVENT STREAM</p><h2>Agent activity</h2></div><button>Open logs</button></div>
            {activity.map(([time, type, text]) => (
              <div className="activity" key={time + type}><time>{time}</time><span>{type}</span><p>{text}</p></div>
            ))}
          </article>

          <article className="panel funnelPanel">
            <div className="panelHead"><div><p>PIPELINE</p><h2>Application funnel</h2></div></div>
            {[
              ["Discovered", 1281],
              ["Eligible", 214],
              ["Strong match", 49],
              ["Prepared", 14],
              ["Applied", 9]
            ].map(([label, value]) => (
              <div className="funnel" key={String(label)}><span>{label}</span><div><i style={{ width: `${Math.max(8, Number(value) / 12.81)}%` }} /></div><b>{value}</b></div>
            ))}
          </article>
        </section>
      </section>
    </main>
  );
}
