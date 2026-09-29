import { Sidebar } from "../components/sidebar";
import { requireDashboardUser } from "../../lib/page-auth";
import { latestProfileForUser } from "../../lib/profile";
import { createServerSupabaseClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

type ApplicationRow = {
  id: string;
  job_id: string;
  status: string;
  next_action: string | null;
  submitted_at: string | null;
  confirmation_verified_at: string | null;
  updated_at: string;
};

type JobRow = {
  id: string;
  title: string;
  company: string;
  apply_url: string;
  remote_scope: string;
  role_family: string;
};

function label(value: string) {
  return value.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

function time(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos"
  }).format(date);
}

export default async function ApplicationsPage({
  searchParams
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const userId = await requireDashboardUser("/applications");
  const profile = await latestProfileForUser(userId);
  const params = await searchParams;

  if (!profile) {
    return (
      <main className="shell">
        <Sidebar active="Applications" />
        <section className="content">
          <header className="topbar">
            <div>
              <p className="eyebrow">APPLICATIONS</p>
              <h1>Application pipeline</h1>
            </div>
          </header>
          <div className="notice warning">
            <b>Career profile required</b>
            <span>
              Applications are created only from verified CV plans.
              <a href="/profile"> Open profile →</a>
            </span>
          </div>
        </section>
      </main>
    );
  }

  const supabase = await createServerSupabaseClient();
  let applicationQuery = supabase
    .from("applications")
    .select("id,job_id,status,next_action,submitted_at,confirmation_verified_at,updated_at")
    .eq("profile_id", profile.id)
    .order("updated_at", { ascending: false })
    .limit(200);

  if (params.status) {
    applicationQuery = applicationQuery.eq("status", params.status);
  }

  const { data: appData, error: appError } = await applicationQuery;
  if (appError) throw new Error(appError.message);

  const applications = (appData ?? []) as ApplicationRow[];
  const jobIds = applications.map((application) => application.job_id);
  let jobs: JobRow[] = [];

  if (jobIds.length) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id,title,company,apply_url,remote_scope,role_family")
      .in("id", jobIds);

    if (error) throw new Error(error.message);
    jobs = (data ?? []) as JobRow[];
  }

  const byId = new Map(jobs.map((job) => [job.id, job]));

  return (
    <main className="shell">
      <Sidebar active="Applications" />
      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">APPLICATIONS</p>
            <h1>Application pipeline</h1>
          </div>
          <div className="status">{applications.length} records</div>
        </header>

        <form className="filterBar compact">
          <select name="status" defaultValue={params.status ?? ""}>
            <option value="">All statuses</option>
            <option value="cv-prepared">CV prepared</option>
            <option value="auto-submit-queued">Auto-submit queued</option>
            <option value="needs-attention">Needs attention</option>
            <option value="ready-for-review">Manual review</option>
            <option value="applied">Applied</option>
            <option value="response">Response</option>
            <option value="assessment">Assessment</option>
            <option value="interview">Interview</option>
            <option value="offer">Offer</option>
            <option value="rejected">Rejected</option>
            <option value="withdrawn">Withdrawn</option>
          </select>
          <button type="submit">Filter</button>
        </form>

        <section className="listPanel">
          {applications.length ? applications.map((application) => {
            const job = byId.get(application.job_id);
            if (!job) return null;

            return (
              <article className="applicationCard" key={application.id}>
                <div className="applicationMain">
                  <div className="applicationHead">
                    <div>
                      <h2>{job.title}</h2>
                      <p>{job.company}</p>
                    </div>
                    <span className={"decision " + application.status}>
                      {label(application.status)}
                    </span>
                  </div>

                  <div className="jobMeta">
                    <span>{label(job.role_family)}</span>
                    <span>{job.remote_scope === "global" ? "Worldwide" : label(job.remote_scope)}</span>
                    <span>Updated {time(application.updated_at)}</span>
                  </div>

                  <div className="nextAction">
                    <small>NEXT ACTION</small>
                    <p>{application.next_action || "No action recorded"}</p>
                  </div>
                </div>

                <div className="applicationSide">
                  <dl>
                    <div>
                      <dt>Submitted</dt>
                      <dd>{time(application.submitted_at)}</dd>
                    </div>
                    <div>
                      <dt>Confirmed</dt>
                      <dd>
                        {application.confirmation_verified_at ? "Verified" : "—"}
                      </dd>
                    </div>
                  </dl>

                  {application.status === "needs-attention" ? (
                    <a className="primaryLink compactLink" href="/exceptions">
                      Resolve blocker
                    </a>
                  ) : null}
                  <a className="primaryLink compactLink" href={`/applications/${application.id}`}>
                    View application
                  </a>
                  <a
                    className="externalButton"
                    href={job.apply_url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open job ↗
                  </a>
                </div>
              </article>
            );
          }) : (
            <div className="emptyState">
              No applications match this status yet.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
