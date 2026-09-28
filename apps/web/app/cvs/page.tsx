import { Sidebar } from "../components/sidebar";
import { requireDashboardUser } from "../../lib/page-auth";
import { latestProfileForUser } from "../../lib/profile";
import { createServerSupabaseClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

type CvRow = {
  id: string;
  job_id: string | null;
  family: string;
  version: number;
  content: {
    strategy?: string;
    facts?: Array<{ id: string }>;
    job?: { title?: string; company?: string };
  };
  storage_path: string | null;
  created_at: string;
};

type JobRow = {
  id: string;
  title: string;
  company: string;
};

function time(value: string) {
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos"
  }).format(new Date(value));
}

export default async function CvsPage() {
  const userId = await requireDashboardUser("/cvs");
  const profile = await latestProfileForUser(userId);

  if (!profile) {
    return (
      <main className="shell">
        <Sidebar active="CVs" />
        <section className="content">
          <header className="topbar">
            <div><p className="eyebrow">VERIFIED CVS</p><h1>CV history</h1></div>
          </header>
          <div className="notice warning">
            <b>Career profile required</b>
            <span><a href="/profile">Create your verified profile →</a></span>
          </div>
        </section>
      </main>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("cv_versions")
    .select("id,job_id,family,version,content,storage_path,created_at")
    .eq("profile_id", profile.id)
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) throw new Error(error.message);
  const cvs = (data ?? []) as CvRow[];

  const jobIds = cvs.flatMap((cv) => cv.job_id ? [cv.job_id] : []);
  let jobs: JobRow[] = [];
  if (jobIds.length) {
    const result = await supabase
      .from("jobs")
      .select("id,title,company")
      .in("id", jobIds);
    if (result.error) throw new Error(result.error.message);
    jobs = (result.data ?? []) as JobRow[];
  }
  const byId = new Map(jobs.map((job) => [job.id, job]));

  const signedUrls = new Map<string, string>();
  await Promise.all(
    cvs.map(async (cv) => {
      if (!cv.storage_path) return;
      const result = await supabase.storage
        .from("application-assets")
        .createSignedUrl(cv.storage_path, 300);
      if (result.data?.signedUrl) signedUrls.set(cv.id, result.data.signedUrl);
    })
  );

  return (
    <main className="shell">
      <Sidebar active="CVs" />
      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">VERIFIED CVS</p>
            <h1>CV history</h1>
          </div>
          <div className="status">{cvs.length} versions</div>
        </header>

        <div className="notice">
          <b>No generated career claims</b>
          <span>
            Every CV below is assembled only from facts saved in your verified
            career profile.
          </span>
        </div>

        <section className="listPanel">
          {cvs.length ? cvs.map((cv) => {
            const job = cv.job_id ? byId.get(cv.job_id) : undefined;
            const url = signedUrls.get(cv.id);
            const factCount = cv.content?.facts?.length ?? 0;

            return (
              <article className="cvCard" key={cv.id}>
                <div>
                  <span className="factNumber">VERSION {cv.version}</span>
                  <h2>{job?.title ?? cv.content?.job?.title ?? "Tailored CV"}</h2>
                  <p>{job?.company ?? cv.content?.job?.company ?? "General"}</p>
                </div>

                <div className="cvMeta">
                  <span>{cv.family.replace(/-/g, " ")}</span>
                  <span>{factCount} verified facts</span>
                  <span>{time(cv.created_at)}</span>
                  <span>{cv.storage_path ? "PDF rendered" : "Plan ready"}</span>
                </div>

                {url ? (
                  <a className="externalButton" href={url}>
                    Open PDF
                  </a>
                ) : (
                  <span className="decision cv-prepared">Renders at review</span>
                )}
              </article>
            );
          }) : (
            <div className="emptyState">
              No tailored CVs yet. Strong matches will create deterministic CV
              plans automatically.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
