import { Sidebar } from "../components/sidebar";
import { requireDashboardUser } from "../../lib/page-auth";
import { latestProfileForUser } from "../../lib/profile";
import { createAdminSupabaseClient } from "../../lib/supabase/admin";
import { resolveApplicationException } from "./actions";

export const dynamic = "force-dynamic";

type ExceptionRow = {
  id: string;
  application_id: string;
  run_id: string | null;
  exception_type: string;
  status: string;
  field_key: string | null;
  field_label: string | null;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
  created_at: string;
  resolved_at: string | null;
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
  apply_url: string;
};

function pretty(value: string) {
  return value.replace(/-/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function time(value: string | null) {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos"
  }).format(new Date(value));
}

export default async function ExceptionsPage() {
  const userId = await requireDashboardUser("/exceptions");
  const profile = await latestProfileForUser(userId);

  if (!profile) {
    return (
      <main className="shell">
        <Sidebar active="Exceptions" />
        <section className="content">
          <header className="topbar">
            <div><p className="eyebrow">EXCEPTION CENTER</p><h1>Needs your attention</h1></div>
          </header>
          <div className="notice warning">
            <b>Career profile required</b>
            <span>RemoteJobOS needs a verified profile before it can automate applications.</span>
          </div>
        </section>
      </main>
    );
  }

  const supabase = createAdminSupabaseClient();
  const { data: appData, error: appError } = await supabase
    .from("applications")
    .select("id,job_id,status")
    .eq("profile_id", profile.id)
    .limit(1000);
  if (appError) throw new Error(appError.message);

  const applications = (appData ?? []) as ApplicationRow[];
  const applicationIds = applications.map((application) => application.id);

  let exceptions: ExceptionRow[] = [];
  if (applicationIds.length) {
    const { data, error } = await supabase
      .from("application_exceptions")
      .select("id,application_id,run_id,exception_type,status,field_key,field_label,title,detail,payload,created_at,resolved_at")
      .in("application_id", applicationIds)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);
    exceptions = (data ?? []) as ExceptionRow[];
  }

  const jobIds = [...new Set(applications.map((application) => application.job_id))];
  let jobs: JobRow[] = [];
  if (jobIds.length) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id,title,company,apply_url")
      .in("id", jobIds);
    if (error) throw new Error(error.message);
    jobs = (data ?? []) as JobRow[];
  }

  const appsById = new Map(applications.map((application) => [application.id, application]));
  const jobsById = new Map(jobs.map((job) => [job.id, job]));
  const open = exceptions.filter((item) => item.status === "open");
  const history = exceptions.filter((item) => item.status !== "open").slice(0, 30);

  return (
    <main className="shell">
      <Sidebar active="Exceptions" />
      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">EXCEPTION CENTER</p>
            <h1>Only the things that need you</h1>
          </div>
          <div className="status">{open.length} open</div>
        </header>

        <div className={open.length ? "notice warning" : "notice"}>
          <b>{open.length ? "Automation paused only where necessary" : "No blockers"}</b>
          <span>
            {open.length
              ? "Resolve a missing answer or safety blocker here. RemoteJobOS will resume the same application run when it is safe."
              : "RemoteJobOS can continue discovering, tailoring and applying without your intervention."}
          </span>
        </div>

        <section className="exceptionList">
          {open.length ? open.map((item) => {
            const application = appsById.get(item.application_id);
            const job = application ? jobsById.get(application.job_id) : undefined;
            const needsAnswer =
              item.exception_type === "missing-answer" ||
              item.exception_type === "sensitive-answer";
            const canRetry =
              item.exception_type === "submit-uncertain" ||
              item.exception_type === "retry-exhausted";
            const options = Array.isArray(item.payload?.options)
              ? item.payload.options.map(String)
              : [];

            return (
              <article className="exceptionCard" key={item.id}>
                <div className="exceptionHead">
                  <div>
                    <span className={"exceptionType " + item.exception_type}>
                      {pretty(item.exception_type)}
                    </span>
                    <h2>{item.title}</h2>
                    <p>{job ? `${job.company} · ${job.title}` : "Application"}</p>
                  </div>
                  <time>{time(item.created_at)}</time>
                </div>

                <p className="exceptionDetail">{item.detail}</p>

                {needsAnswer ? (
                  <form action={resolveApplicationException} className="exceptionForm">
                    <input type="hidden" name="exceptionId" value={item.id} />
                    <input type="hidden" name="action" value="answer" />

                    <label>
                      <span>{item.field_label || "Answer"}</span>
                      {options.length ? (
                        <select name="answer" required defaultValue="">
                          <option value="" disabled>Select an answer</option>
                          {options.map((option) => (
                            <option value={option} key={option}>{option}</option>
                          ))}
                        </select>
                      ) : (
                        <textarea
                          name="answer"
                          rows={3}
                          required
                          placeholder="Enter the truthful answer RemoteJobOS should use for this application."
                        />
                      )}
                    </label>

                    <label>
                      <span>Future reuse</span>
                      <select name="reusePolicy" defaultValue="always">
                        <option value="always">Use this answer automatically next time</option>
                        <option value="ask">Remember it, but ask me each time</option>
                        <option value="never">Use only for this application</option>
                      </select>
                    </label>

                    <button type="submit" className="primaryButton">
                      Save answer & resume
                    </button>
                  </form>
                ) : null}

                {canRetry ? (
                  <div className="exceptionActions">
                    <form action={resolveApplicationException}>
                      <input type="hidden" name="exceptionId" value={item.id} />
                      <input type="hidden" name="action" value="retry" />
                      <button type="submit" className="primaryButton">
                        I checked — it was not submitted. Retry safely
                      </button>
                    </form>
                    <form action={resolveApplicationException}>
                      <input type="hidden" name="exceptionId" value={item.id} />
                      <input type="hidden" name="action" value="mark-submitted" />
                      <button type="submit" className="secondaryButton">
                        I confirm it was submitted
                      </button>
                    </form>
                  </div>
                ) : null}

                <div className="exceptionFooter">
                  {job ? (
                    <a className="externalButton" href={job.apply_url} target="_blank" rel="noreferrer">
                      Open job ↗
                    </a>
                  ) : null}
                  {!needsAnswer && !canRetry ? (
                    <form action={resolveApplicationException}>
                      <input type="hidden" name="exceptionId" value={item.id} />
                      <input type="hidden" name="action" value="dismiss" />
                      <button className="secondaryButton" type="submit">Dismiss</button>
                    </form>
                  ) : null}
                </div>
              </article>
            );
          }) : (
            <div className="emptyState">
              Nothing needs your attention. Clean verified applications can continue automatically.
            </div>
          )}
        </section>

        {history.length ? (
          <section className="panel exceptionHistory">
            <div className="panelHead">
              <div><p>HISTORY</p><h2>Recently resolved</h2></div>
            </div>
            {history.map((item) => (
              <div className="historyRow" key={item.id}>
                <span className="decision">{pretty(item.status)}</span>
                <div>
                  <b>{item.title}</b>
                  <small>{pretty(item.exception_type)} · {time(item.resolved_at || item.created_at)}</small>
                </div>
              </div>
            ))}
          </section>
        ) : null}
      </section>
    </main>
  );
}
