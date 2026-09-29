import { Sidebar } from "../components/sidebar";
import { requireDashboardUser } from "../../lib/page-auth";
import { latestProfileForUser } from "../../lib/profile";
import { createServerSupabaseClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

type ApplicationRow = {
  id: string;
  status: string;
  submitted_at: string | null;
  created_at: string;
};

type MatchRow = {
  decision: string;
  score: number;
};

type ExceptionRow = {
  status: string;
  exception_type: string;
};

function pct(value: number, total: number) {
  return total ? Math.round((value / total) * 100) : 0;
}

export default async function AnalyticsPage() {
  const userId = await requireDashboardUser("/analytics");
  const profile = await latestProfileForUser(userId);

  if (!profile) {
    return (
      <main className="shell">
        <Sidebar active="Analytics" />
        <section className="content">
          <header className="topbar">
            <div><p className="eyebrow">ANALYTICS</p><h1>Automation outcomes</h1></div>
          </header>
          <div className="notice warning"><b>Career profile required</b></div>
        </section>
      </main>
    );
  }

  const supabase = await createServerSupabaseClient();

  const [appResult, matchResult] = await Promise.all([
    supabase
      .from("applications")
      .select("id,status,submitted_at,created_at")
      .eq("profile_id", profile.id),
    supabase
      .from("job_matches")
      .select("decision,score")
      .eq("profile_id", profile.id)
  ]);

  if (appResult.error) throw new Error(appResult.error.message);
  if (matchResult.error) throw new Error(matchResult.error.message);

  const applications = (appResult.data ?? []) as ApplicationRow[];
  const matches = (matchResult.data ?? []) as MatchRow[];
  const applicationIds = applications.map((row) => row.id);
  let exceptions: ExceptionRow[] = [];

  if (applicationIds.length) {
    const exceptionResult = await supabase
      .from("application_exceptions")
      .select("status,exception_type")
      .in("application_id", applicationIds);

    if (exceptionResult.error) throw new Error(exceptionResult.error.message);
    exceptions = (exceptionResult.data ?? []) as ExceptionRow[];
  }

  const applied = applications.filter((row) => row.status === "applied" || row.submitted_at).length;
  const interviews = applications.filter((row) => row.status === "interview").length;
  const offers = applications.filter((row) => row.status === "offer").length;
  const rejected = applications.filter((row) => row.status === "rejected").length;
  const strong = matches.filter((row) => row.decision === "strong-match").length;
  const openExceptions = exceptions.filter((row) => row.status === "open").length;
  const resolvedExceptions = exceptions.filter((row) => row.status === "resolved").length;
  const averageMatch = matches.length
    ? Math.round(matches.reduce((sum, row) => sum + row.score, 0) / matches.length)
    : 0;

  const stages = [
    ["Strong matches", strong],
    ["Applications", applications.length],
    ["Submitted", applied],
    ["Interviews", interviews],
    ["Offers", offers]
  ] as const;
  const maxStage = Math.max(1, ...stages.map(([, value]) => value));

  const exceptionGroups = new Map<string, number>();
  for (const exception of exceptions) {
    exceptionGroups.set(
      exception.exception_type,
      (exceptionGroups.get(exception.exception_type) ?? 0) + 1
    );
  }

  return (
    <main className="shell">
      <Sidebar active="Analytics" />
      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">ANALYTICS</p>
            <h1>Automation outcomes</h1>
          </div>
          <div className="status">{applications.length} application records</div>
        </header>

        <nav className="sectionTabs" aria-label="AI and CV sections">
          <a href="/cvs">CV history</a>
          <a href="/answers">Answer vault</a>
          <a className="active" href="/analytics">Analytics</a>
        </nav>

        <section className="metrics">
          <article className="metric"><span>Average match</span><strong>{averageMatch}%</strong><small>Across scored remote jobs</small></article>
          <article className="metric"><span>Confirmed submitted</span><strong>{applied}</strong><small>{pct(applied, applications.length)}% of application records</small></article>
          <article className="metric"><span>Interviews</span><strong>{interviews}</strong><small>{pct(interviews, Math.max(1, applied))}% of submitted</small></article>
          <article className="metric"><span>Open exceptions</span><strong>{openExceptions}</strong><small>{resolvedExceptions} resolved previously</small></article>
        </section>

        <section className="analyticsGrid">
          <article className="panel">
            <div className="panelHead">
              <div><p>FUNNEL</p><h2>Application progression</h2></div>
            </div>
            {stages.map(([label, value]) => (
              <div className="funnel" key={label}>
                <span>{label}</span>
                <div><i style={{ width: Math.max(value ? 5 : 0, (value / maxStage) * 100) + "%" }} /></div>
                <b>{value}</b>
              </div>
            ))}
          </article>

          <article className="panel">
            <div className="panelHead">
              <div><p>EXCEPTIONS</p><h2>What interrupts automation?</h2></div>
            </div>
            {exceptionGroups.size ? [...exceptionGroups.entries()]
              .sort((a, b) => b[1] - a[1])
              .map(([type, count]) => (
                <div className="analyticsRow" key={type}>
                  <span>{type.replace(/-/g, " ")}</span>
                  <b>{count}</b>
                </div>
              )) : <div className="emptyState">No exception history yet.</div>}
          </article>

          <article className="panel">
            <div className="panelHead">
              <div><p>OUTCOMES</p><h2>Current results</h2></div>
            </div>
            <div className="analyticsRow"><span>Submitted</span><b>{applied}</b></div>
            <div className="analyticsRow"><span>Interviews</span><b>{interviews}</b></div>
            <div className="analyticsRow"><span>Offers</span><b>{offers}</b></div>
            <div className="analyticsRow"><span>Rejections</span><b>{rejected}</b></div>
          </article>
        </section>
      </section>
    </main>
  );
}
