import { Sidebar } from "../components/sidebar";
import { requireDashboardUser } from "../../lib/page-auth";
import { latestProfileForUser } from "../../lib/profile";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";

export const dynamic = "force-dynamic";

type SourceState = {
  source: string;
  consecutive_failures: number;
  circuit_open_until: string | null;
  last_success_at: string | null;
  last_error: string | null;
  last_job_count: number;
};

type ApplicationRow = {
  id: string;
  job_id: string;
  status: string;
};

type JobRow = {
  id: string;
  title: string;
  company: string;
};

type RunRow = {
  id: string;
  application_id: string;
  status: string;
  phase: string;
  step_used: number;
  step_limit: number;
  submit_attempts: number;
  recovery_strategy: string;
  last_error: string | null;
  updated_at: string;
};

function formatTime(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos"
  }).format(date);
}

function pretty(value: string) {
  return value.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export default async function AgentPage() {
  const userId = await requireDashboardUser("/agent");
  const profile = await latestProfileForUser(userId);
  const supabase = createAdminSupabaseClient();

  const { data: sourceData, error: sourceError } = await supabase
    .from("job_source_state")
    .select("source,consecutive_failures,circuit_open_until,last_success_at,last_error,last_job_count")
    .order("source", { ascending: true });
  if (sourceError) throw new Error(sourceError.message);

  const sources = (sourceData ?? []) as SourceState[];
  const now = Date.now();
  const healthySources = sources.filter((source) => {
    if (!source.last_success_at) return false;
    const age = now - new Date(source.last_success_at).getTime();
    return age >= 0 && age < 26 * 60 * 60 * 1000;
  }).length;

  let applications: ApplicationRow[] = [];
  let runs: RunRow[] = [];
  let jobs: JobRow[] = [];
  let openExceptions = 0;

  if (profile) {
    const appResult = await supabase
      .from("applications")
      .select("id,job_id,status")
      .eq("profile_id", profile.id)
      .order("updated_at", { ascending: false })
      .limit(500);
    if (appResult.error) throw new Error(appResult.error.message);
    applications = (appResult.data ?? []) as ApplicationRow[];

    const applicationIds = applications.map((item) => item.id);
    const jobIds = [...new Set(applications.map((item) => item.job_id))];

    if (applicationIds.length) {
      const [runResult, exceptionResult] = await Promise.all([
        supabase
          .from("agent_runs")
          .select("id,application_id,status,phase,step_used,step_limit,submit_attempts,recovery_strategy,last_error,updated_at")
          .in("application_id", applicationIds)
          .order("updated_at", { ascending: false })
          .limit(50),
        supabase
          .from("application_exceptions")
          .select("id", { count: "exact", head: true })
          .in("application_id", applicationIds)
          .eq("status", "open")
      ]);
      if (runResult.error) throw new Error(runResult.error.message);
      if (exceptionResult.error) throw new Error(exceptionResult.error.message);
      runs = (runResult.data ?? []) as RunRow[];
      openExceptions = exceptionResult.count ?? 0;
    }

    if (jobIds.length) {
      const jobResult = await supabase
        .from("jobs")
        .select("id,title,company")
        .in("id", jobIds);
      if (jobResult.error) throw new Error(jobResult.error.message);
      jobs = (jobResult.data ?? []) as JobRow[];
    }
  }

  const appsById = new Map(applications.map((item) => [item.id, item]));
  const jobsById = new Map(jobs.map((item) => [item.id, item]));
  const activeRuns = runs.filter((run) =>
    ["pending", "running", "waiting-approval", "failed"].includes(run.status)
  ).length;

  return (
    <main className="shell">
      <Sidebar
        active="Agent"
        agentHealthy={sources.length > 0 && healthySources > 0}
      />

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">AUTOMATION RUNTIME</p>
            <h1>Agent health</h1>
          </div>
          <div className="status">
            {healthySources}/{sources.length || 0} sources healthy
          </div>
        </header>

        <div className="notice">
          <b>Auto-except runtime</b>
          <span>
            Discovery, matching, CV planning, form verification and clean
            submissions run automatically. Only unresolved exceptions should
            require your attention.
          </span>
        </div>

        <section className="metrics">
          <article className="metric"><span>Active runs</span><strong>{activeRuns}</strong><small>Durable application runs</small></article>
          <article className="metric"><span>Needs attention</span><strong>{openExceptions}</strong><small>Open exceptions</small></article>
          <article className="metric"><span>Run history</span><strong>{runs.length}</strong><small>Recent durable runs</small></article>
          <article className="metric"><span>Discovery sources</span><strong>{healthySources}</strong><small>Healthy in last 26 hours</small></article>
        </section>

        <section className="agentGrid">
          <article className="panel">
            <div className="panelHead">
              <div><p>SOURCES</p><h2>Discovery health</h2></div>
            </div>
            <div className="sourceTable">
              {sources.length ? sources.map((source) => {
                const circuitOpen =
                  source.circuit_open_until &&
                  new Date(source.circuit_open_until).getTime() > now;
                return (
                  <div className="sourceRow" key={source.source}>
                    <div>
                      <b>{source.source}</b>
                      <small>Last success {formatTime(source.last_success_at)}</small>
                    </div>
                    <span>{source.last_job_count} jobs</span>
                    <span>{source.consecutive_failures} failures</span>
                    <span className={circuitOpen ? "health bad" : "health good"}>
                      {circuitOpen ? "Circuit open" : "Available"}
                    </span>
                  </div>
                );
              }) : <div className="emptyState">No discovery source has reported health yet.</div>}
            </div>
          </article>

          <article className="panel">
            <div className="panelHead">
              <div><p>DURABLE RUNS</p><h2>Application automation</h2></div>
              <a className="panelLink" href="/exceptions">Exceptions →</a>
            </div>

            <div className="runList">
              {runs.length ? runs.map((run) => {
                const application = appsById.get(run.application_id);
                const job = application ? jobsById.get(application.job_id) : undefined;
                const progress = run.step_limit
                  ? Math.min(100, Math.round((run.step_used / run.step_limit) * 100))
                  : 0;

                return (
                  <article className="runRow" key={run.id}>
                    <div className="runHead">
                      <div>
                        <b>{job?.title ?? "Application run"}</b>
                        <small>{job?.company ?? run.application_id}</small>
                      </div>
                      <span className={"taskStatus " + run.status}>{pretty(run.status)}</span>
                    </div>
                    <div className="runMeta">
                      <span>Phase <b>{pretty(run.phase)}</b></span>
                      <span>Steps <b>{run.step_used}/{run.step_limit}</b></span>
                      <span>Submit tries <b>{run.submit_attempts}/3</b></span>
                      <span>Recovery <b>{pretty(run.recovery_strategy)}</b></span>
                    </div>
                    <div className="runProgress"><i style={{ width: progress + "%" }} /></div>
                    {run.last_error ? <p className="runError">{run.last_error}</p> : null}
                    <small className="runTime">Updated {formatTime(run.updated_at)}</small>
                  </article>
                );
              }) : <div className="emptyState">No application runs yet.</div>}
            </div>
          </article>
        </section>
      </section>
    </main>
  );
}
