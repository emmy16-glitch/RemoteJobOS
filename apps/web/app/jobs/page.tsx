import { Sidebar } from "../components/sidebar";
import { requireDashboardUser } from "../../lib/page-auth";
import { latestProfileForUser } from "../../lib/profile";
import { createServerSupabaseClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

type MatchRow = {
  job_id: string;
  score: number;
  decision: string;
  reasons: string[] | null;
  created_at: string;
};

type JobRow = {
  id: string;
  title: string;
  company: string;
  source: string;
  apply_url: string;
  salary_text: string | null;
  location_text: string | null;
  remote_scope: string;
  role_family: string;
  posted_at: string | null;
};

function label(value: string) {
  return value
    .replace(/-/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default async function JobsPage({
  searchParams
}: {
  searchParams: Promise<{ decision?: string; family?: string; q?: string }>;
}) {
  const userId = await requireDashboardUser("/jobs");
  const profile = await latestProfileForUser(userId);
  const params = await searchParams;

  if (!profile) {
    return (
      <main className="shell">
        <Sidebar active="Jobs" />
        <section className="content">
          <header className="topbar">
            <div>
              <p className="eyebrow">REMOTE JOBS</p>
              <h1>Jobs</h1>
            </div>
          </header>
          <div className="notice warning">
            <b>Career profile required</b>
            <span>
              Create your verified profile before RemoteJobOS scores jobs.
              <a href="/profile"> Open profile →</a>
            </span>
          </div>
        </section>
      </main>
    );
  }

  const supabase = await createServerSupabaseClient();
  let matchQuery = supabase
    .from("job_matches")
    .select("job_id,score,decision,reasons,created_at")
    .eq("profile_id", profile.id)
    .order("score", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(200);

  if (params.decision && ["strong-match", "review", "reject"].includes(params.decision)) {
    matchQuery = matchQuery.eq("decision", params.decision);
  }

  const { data: matchData, error: matchError } = await matchQuery;
  if (matchError) throw new Error(matchError.message);

  const matches = (matchData ?? []) as MatchRow[];
  const jobIds = matches.map((match) => match.job_id);
  let jobs: JobRow[] = [];

  if (jobIds.length) {
    const { data, error } = await supabase
      .from("jobs")
      .select("id,title,company,source,apply_url,salary_text,location_text,remote_scope,role_family,posted_at")
      .in("id", jobIds);

    if (error) throw new Error(error.message);
    jobs = (data ?? []) as JobRow[];
  }

  const byId = new Map(jobs.map((job) => [job.id, job]));
  const query = (params.q ?? "").trim().toLowerCase();

  const rows = matches.flatMap((match) => {
    const job = byId.get(match.job_id);
    if (!job) return [];
    if (params.family && params.family !== job.role_family) return [];
    if (
      query &&
      ![job.title, job.company, job.role_family, job.source]
        .join(" ")
        .toLowerCase()
        .includes(query)
    ) {
      return [];
    }
    return [{ match, job }];
  });

  return (
    <main className="shell">
      <Sidebar active="Jobs" />
      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">REMOTE JOBS</p>
            <h1>Matched jobs</h1>
          </div>
          <div className="status">{rows.length} shown</div>
        </header>

        <form className="filterBar">
          <input
            name="q"
            defaultValue={params.q ?? ""}
            placeholder="Search role or company"
          />
          <select name="decision" defaultValue={params.decision ?? ""}>
            <option value="">All decisions</option>
            <option value="strong-match">Strong match</option>
            <option value="review">Review</option>
            <option value="reject">Rejected</option>
          </select>
          <select name="family" defaultValue={params.family ?? ""}>
            <option value="">All categories</option>
            <option value="cybersecurity">Cybersecurity</option>
            <option value="software">Software</option>
            <option value="devops">DevOps</option>
            <option value="cloud">Cloud</option>
            <option value="data">Data</option>
            <option value="qa">QA</option>
            <option value="it-support">IT Support</option>
            <option value="networking">Networking</option>
            <option value="ai-ml">AI / ML</option>
            <option value="product-technical">Technical Product</option>
            <option value="other-tech">Other Tech</option>
          </select>
          <button type="submit">Filter</button>
        </form>

        <section className="listPanel">
          {rows.length ? rows.map(({ match, job }) => (
            <article className="jobCard" key={job.id}>
              <div className="score large">{match.score}</div>
              <div className="jobCardBody">
                <div className="jobCardTitle">
                  <div>
                    <h2>{job.title}</h2>
                    <p>{job.company}</p>
                  </div>
                  <span className={"decision " + match.decision}>
                    {label(match.decision)}
                  </span>
                </div>

                <div className="jobMeta">
                  <span>{job.remote_scope === "global" ? "Worldwide" : job.location_text || label(job.remote_scope)}</span>
                  <span>{label(job.role_family)}</span>
                  <span>{job.source}</span>
                  {job.salary_text ? <span>{job.salary_text}</span> : null}
                </div>

                {match.reasons?.length ? (
                  <p className="jobReasons">
                    {match.reasons.slice(0, 3).join(" · ")}
                  </p>
                ) : null}
              </div>
              <a
                className="externalButton"
                href={job.apply_url}
                target="_blank"
                rel="noreferrer"
              >
                View job ↗
              </a>
            </article>
          )) : (
            <div className="emptyState">
              No jobs match the current filters.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
