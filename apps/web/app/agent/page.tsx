import { Sidebar } from "../components/sidebar";
import { requireDashboardUser } from "../../lib/page-auth";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";

export const dynamic = "force-dynamic";

type SourceState = {
  source: string;
  consecutive_failures: number;
  circuit_open_until: string | null;
  last_success_at: string | null;
  last_failure_at: string | null;
  last_error: string | null;
  last_job_count: number;
};

type TaskRow = {
  id: string;
  task_type: string;
  status: string;
  attempts: number;
  max_attempts: number;
  worker_id: string | null;
  lease_expires_at: string | null;
  last_error: string | null;
  created_at: string;
};

type EventRow = {
  event_type: string;
  severity: string;
  message: string;
  created_at: string;
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

export default async function AgentPage() {
  await requireDashboardUser("/agent");
  const supabase = createAdminSupabaseClient();

  const [sourceResult, taskResult, eventResult] = await Promise.all([
    supabase
      .from("job_source_state")
      .select("source,consecutive_failures,circuit_open_until,last_success_at,last_failure_at,last_error,last_job_count")
      .order("source", { ascending: true }),
    supabase
      .from("agent_tasks")
      .select("id,task_type,status,attempts,max_attempts,worker_id,lease_expires_at,last_error,created_at")
      .order("created_at", { ascending: false })
      .limit(30),
    supabase
      .from("agent_events")
      .select("event_type,severity,message,created_at")
      .order("created_at", { ascending: false })
      .limit(30)
  ]);

  const sources = (sourceResult.data ?? []) as SourceState[];
  const tasks = (taskResult.data ?? []) as TaskRow[];
  const events = (eventResult.data ?? []) as EventRow[];

  const now = Date.now();
  const healthySources = sources.filter((source) => {
    if (!source.last_success_at) return false;
    const age = now - new Date(source.last_success_at).getTime();
    return age >= 0 && age < 26 * 60 * 60 * 1000;
  }).length;

  return (
    <main className="shell">
      <Sidebar
        active="Agent"
        agentHealthy={sources.length > 0 && healthySources > 0}
      />

      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">CLOUD WORKERS</p>
            <h1>Agent health</h1>
          </div>
          <div className="status">
            {healthySources}/{sources.length || 0} sources healthy
          </div>
        </header>

        <div className="notice">
          <b>AI-independent runtime</b>
          <span>
            Discovery, matching, CV planning, queue leasing and browser
            verification run without Groq or another model provider.
          </span>
        </div>

        <section className="agentGrid">
          <article className="panel">
            <div className="panelHead">
              <div>
                <p>SOURCES</p>
                <h2>Discovery health</h2>
              </div>
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
                      <small>
                        Last success {formatTime(source.last_success_at)}
                      </small>
                    </div>
                    <span>{source.last_job_count} jobs</span>
                    <span>{source.consecutive_failures} failures</span>
                    <span className={circuitOpen ? "health bad" : "health good"}>
                      {circuitOpen ? "Circuit open" : "Available"}
                    </span>
                  </div>
                );
              }) : (
                <div className="emptyState">
                  No discovery source has reported health yet.
                </div>
              )}
            </div>
          </article>

          <article className="panel">
            <div className="panelHead">
              <div>
                <p>LEASED QUEUE</p>
                <h2>Recent tasks</h2>
              </div>
            </div>

            <div className="taskList">
              {tasks.length ? tasks.map((task) => (
                <div className="taskRow" key={task.id}>
                  <span className={"taskStatus " + task.status}>
                    {task.status}
                  </span>
                  <div>
                    <b>{task.task_type}</b>
                    <small>
                      Attempt {task.attempts}/{task.max_attempts}
                      {task.worker_id ? " · " + task.worker_id : ""}
                    </small>
                    {task.last_error ? <p>{task.last_error}</p> : null}
                  </div>
                </div>
              )) : (
                <div className="emptyState">No task history yet.</div>
              )}
            </div>
          </article>
        </section>

        <article className="panel agentEvents">
          <div className="panelHead">
            <div>
              <p>AUDIT LOG</p>
              <h2>Recent events</h2>
            </div>
          </div>

          {events.length ? events.map((event, index) => (
            <div
              className="agentEvent"
              key={event.created_at + event.event_type + index}
            >
              <time>{formatTime(event.created_at)}</time>
              <span className={"eventSeverity " + event.severity}>
                {event.event_type}
              </span>
              <p>{event.message}</p>
            </div>
          )) : (
            <div className="emptyState">
              Agent events will appear after workers begin running.
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
