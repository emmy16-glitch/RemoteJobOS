import { notFound } from "next/navigation";
import { Sidebar } from "../../components/sidebar";
import { requireDashboardUser } from "../../../lib/page-auth";
import { latestProfileForUser } from "../../../lib/profile";
import { createServerSupabaseClient } from "../../../lib/supabase/server";
import { createAdminSupabaseClient } from "../../../lib/supabase/admin";

export const dynamic = "force-dynamic";

type CvRow = {
  id: string;
  version: number;
  family: string;
  content: Record<string, unknown> | null;
  storage_path: string | null;
  created_at: string;
};

type SnapshotField = {
  key?: string;
  label?: string;
  kind?: string;
  required?: boolean;
  sensitive?: boolean;
  action?: string;
  value?: string | null;
  assetKey?: string | null;
  reason?: string | null;
  source?: string;
  confidence?: number;
};

function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return new Intl.DateTimeFormat("en-NG", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Africa/Lagos"
  }).format(d);
}

function titleCase(value: string | null | undefined) {
  return (value ?? "unknown")
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function actionValue(field: SnapshotField) {
  if (field.action === "fill") return field.value || "—";
  if (field.action === "upload") return field.assetKey ? `Uploaded asset: ${field.assetKey}` : "Uploaded CV / file";
  if (field.action === "decline") return "Declined / No";
  if (field.action === "skip") return field.reason || "Skipped";
  if (field.action === "human-review") return field.reason || "Human review required";
  return "—";
}

export default async function ApplicationDetailsPage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const userId = await requireDashboardUser(`/applications/${id}`);
  const profile = await latestProfileForUser(userId);
  if (!profile) notFound();

  const supabase = await createServerSupabaseClient();
  const { data: application, error: appError } = await supabase
    .from("applications")
    .select("id,job_id,profile_id,cv_version_id,status,next_action,answers,submitted_at,confirmation_verified_at,confirmation_url,submission_fenced_at,last_attempt_id,created_at,updated_at")
    .eq("id", id)
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (appError) throw new Error(appError.message);
  if (!application) notFound();

  const { data: job, error: jobError } = await supabase
    .from("jobs")
    .select("id,title,company,apply_url,source_url,remote_scope,role_family")
    .eq("id", application.job_id)
    .maybeSingle();
  if (jobError) throw new Error(jobError.message);
  if (!job) notFound();

  let cv: CvRow | null = null;
  let cvUrl: string | null = null;

  if (application.cv_version_id) {
    const cvResult = await supabase
      .from("cv_versions")
      .select("id,version,family,content,storage_path,created_at")
      .eq("id", application.cv_version_id)
      .maybeSingle();
    if (cvResult.error) throw new Error(cvResult.error.message);
    cv = (cvResult.data as CvRow | null) ?? null;

    if (cv?.storage_path) {
      const signed = await supabase.storage
        .from("application-assets")
        .createSignedUrl(cv.storage_path, 900);
      cvUrl = signed.data?.signedUrl ?? null;
    }
  }

  const admin = createAdminSupabaseClient();
  const [snapshotsResult, attemptsResult] = await Promise.all([
    admin
      .from("application_form_snapshots")
      .select("id,attempt_id,cv_version_id,form_url,adapter,phase,fields,metadata,verified,captured_at,updated_at")
      .eq("application_id", id)
      .order("captured_at", { ascending: false })
      .limit(10),
    admin
      .from("application_attempts")
      .select("id,stage,status,field_report,error,worker_id,started_at,finished_at")
      .eq("application_id", id)
      .order("started_at", { ascending: false })
      .limit(20)
  ]);
  if (snapshotsResult.error) throw new Error(snapshotsResult.error.message);
  if (attemptsResult.error) throw new Error(attemptsResult.error.message);

  const snapshots = snapshotsResult.data ?? [];
  const latestSnapshot = snapshots[0] ?? null;
  const fields = Array.isArray(latestSnapshot?.fields)
    ? (latestSnapshot.fields as SnapshotField[])
    : [];
  const attempts = attemptsResult.data ?? [];
  const savedAnswers =
    application.answers && typeof application.answers === "object"
      ? Object.entries(application.answers as Record<string, unknown>)
      : [];

  const cvContent = (cv?.content ?? {}) as {
    strategy?: string;
    facts?: Array<{ id?: string; title?: string }>;
    job?: { title?: string; company?: string };
  };
  const confirmationEvidence =
    latestSnapshot?.metadata && typeof latestSnapshot.metadata === "object"
      ? String((latestSnapshot.metadata as Record<string, unknown>).confirmationEvidence ?? "")
      : "";

  return (
    <main className="shell">
      <Sidebar active="Applications" />
      <section className="content applicationDetailPage">
        <a className="backLink" href="/applications">← Applications</a>

        <header className="applicationDetailHero">
          <div>
            <p className="eyebrow">APPLICATION AUDIT</p>
            <h1>{job.title}</h1>
            <p>{job.company}</p>
          </div>
          <span className={"decision detailStatus " + application.status}>
            {titleCase(application.status)}
          </span>
        </header>

        <section className="auditSummary">
          <div><small>Submitted</small><strong>{formatTime(application.submitted_at)}</strong></div>
          <div><small>Confirmation</small><strong>{application.confirmation_verified_at ? "Verified" : "Not verified"}</strong></div>
          <div><small>CV</small><strong>{cv ? `Version ${cv.version}` : "Not attached"}</strong></div>
          <div><small>Form snapshot</small><strong>{latestSnapshot ? titleCase(latestSnapshot.phase) : "Not captured"}</strong></div>
        </section>

        <nav className="detailJumpNav" aria-label="Application detail sections">
          <a href="#filled-form">Filled form</a>
          <a href="#cv-used">CV used</a>
          <a href="#activity">Activity</a>
          <a href="#evidence">Evidence</a>
        </nav>

        <section className="auditSection" id="filled-form">
          <div className="auditSectionHead">
            <div>
              <p className="eyebrow">WHAT REMOTEJOBOS FILLED</p>
              <h2>Application form</h2>
            </div>
            {latestSnapshot ? (
              <span className="auditChip">
                {latestSnapshot.verified ? "DOM verified" : "Planned"} · {latestSnapshot.adapter || "browser"}
              </span>
            ) : null}
          </div>

          {fields.length ? (
            <div className="answerAuditList">
              {fields.map((field, index) => (
                <article className="answerAuditRow" key={(field.key || field.label || "field") + index}>
                  <div className="answerAuditQuestion">
                    <strong>{field.label || field.key || `Field ${index + 1}`}</strong>
                    <span>
                      {titleCase(field.kind)}
                      {field.required ? " · Required" : " · Optional"}
                    </span>
                  </div>
                  <div className="answerAuditValue">
                    <small>{titleCase(field.action)}</small>
                    <p>{actionValue(field)}</p>
                  </div>
                  <div className="answerAuditSource">
                    <small>Source</small>
                    <span>{field.source === "verified-profile" ? "Verified profile / approved answer" : titleCase(field.source)}</span>
                    {typeof field.confidence === "number" ? (
                      <em>{Math.round(field.confidence * 100)}% confidence</em>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="notice warning auditNotice">
              <b>No exact form snapshot for this attempt</b>
              <span>
                This application predates the new audit capture, or it has not reached form planning yet.
                Future runs now save every field and value before submission.
              </span>
            </div>
          )}

          {!fields.length && savedAnswers.length ? (
            <div className="fallbackAnswers">
              <h3>Saved application-specific answers</h3>
              <p>These are stored answers, not a claim that every one was submitted on the employer form.</p>
              {savedAnswers.map(([key, value]) => (
                <div key={key}><b>{titleCase(key)}</b><span>{String(value ?? "—")}</span></div>
              ))}
            </div>
          ) : null}
        </section>

        <section className="auditSection" id="cv-used">
          <div className="auditSectionHead">
            <div>
              <p className="eyebrow">DOCUMENT SENT</p>
              <h2>CV used for this application</h2>
            </div>
            {cvUrl ? <a className="primaryLink" href={cvUrl} target="_blank" rel="noreferrer">Open PDF ↗</a> : null}
          </div>

          {cv ? (
            <>
              <div className="cvAuditMeta">
                <span>Version {cv.version}</span>
                <span>{titleCase(cv.family)}</span>
                <span>{Array.isArray(cvContent.facts) ? cvContent.facts.length : 0} verified facts</span>
                <span>Created {formatTime(cv.created_at)}</span>
              </div>
              {cvContent.strategy ? <p className="cvStrategy">{cvContent.strategy}</p> : null}
              {cvUrl ? (
                <iframe className="cvPreviewFrame" src={cvUrl} title={`CV for ${job.title} at ${job.company}`} />
              ) : (
                <div className="emptyState">The CV plan exists, but no rendered PDF is currently available.</div>
              )}
            </>
          ) : (
            <div className="emptyState">No CV version is attached to this application yet.</div>
          )}
        </section>

        <section className="auditSection" id="activity">
          <div className="auditSectionHead">
            <div>
              <p className="eyebrow">AUTOMATION HISTORY</p>
              <h2>Application attempts</h2>
            </div>
          </div>
          <div className="attemptTimeline">
            {attempts.length ? attempts.map((attempt) => (
              <article className="attemptRow" key={attempt.id}>
                <span className={"attemptDot " + attempt.status} />
                <div>
                  <strong>{titleCase(attempt.stage)} · {titleCase(attempt.status)}</strong>
                  <p>{attempt.error || "No error recorded"}</p>
                  <small>{formatTime(attempt.finished_at || attempt.started_at)}</small>
                </div>
              </article>
            )) : <div className="emptyState">No browser attempts recorded yet.</div>}
          </div>
        </section>

        <section className="auditSection" id="evidence">
          <div className="auditSectionHead">
            <div>
              <p className="eyebrow">SUBMISSION EVIDENCE</p>
              <h2>Proof and destination</h2>
            </div>
          </div>
          <div className="evidenceGrid">
            <div>
              <small>Employer form</small>
              <a href={latestSnapshot?.form_url || job.apply_url} target="_blank" rel="noreferrer">
                Open application page ↗
              </a>
            </div>
            <div>
              <small>Confirmation URL</small>
              {application.confirmation_url ? (
                <a href={application.confirmation_url} target="_blank" rel="noreferrer">Open confirmation ↗</a>
              ) : <span>Not recorded</span>}
            </div>
            <div>
              <small>Confirmation status</small>
              <strong>{application.confirmation_verified_at ? "Durably verified" : "Not verified"}</strong>
            </div>
            <div>
              <small>Evidence</small>
              <span>{confirmationEvidence || (application.confirmation_verified_at ? "Submission confirmation was verified by the browser workflow." : "No confirmed submission evidence yet.")}</span>
            </div>
          </div>
        </section>
      </section>
    </main>
  );
}
