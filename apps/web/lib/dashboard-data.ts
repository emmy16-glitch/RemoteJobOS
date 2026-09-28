import "server-only";
import { createServerSupabaseClient } from "./supabase/server";
import { latestProfileForUser } from "./profile";

export type DashboardJob = {
  id: string;
  score: number;
  role: string;
  company: string;
  scope: string;
  family: string;
};

export type DashboardApplication = {
  id: string;
  role: string;
  company: string;
  scope: string;
  score: number | null;
  status: string;
  nextAction: string;
  updated: string;
};

export type DashboardException = {
  id: string;
  type: string;
  role: string;
  company: string;
  detail: string;
  action: string;
  age: string;
};

export type DashboardCv = {
  id: string;
  role: string;
  company: string;
  version: number;
  age: string;
};

export type DashboardMessage = {
  id: string;
  subject: string;
  sender: string;
  classification: string;
  age: string;
};

export type DashboardData = {
  profileConfigured: boolean;
  profileName: string | null;
  firstName: string;
  jobsDiscovered: number;
  newJobsToday: number;
  eligible: number;
  strongMatches: number;
  readyForReview: number;
  needsAttention: number;
  autoSubmitQueued: number;
  applications: number;
  applied: number;
  prepared: number;
  cvCount: number;
  newResponses: number;
  gmailConnected: boolean;
  gmailEmail: string | null;
  latestJobs: DashboardJob[];
  recentApplications: DashboardApplication[];
  exceptions: DashboardException[];
  latestCvs: DashboardCv[];
  messages: DashboardMessage[];
  lastSourceSuccess: string | null;
};

function scopeLabel(value: string | null | undefined): string {
  if (!value || value === "unknown") return "Remote";
  if (value === "global") return "Worldwide Remote";
  if (value === "us-only") return "Remote (US)";
  if (value === "uk-only") return "Remote (UK)";
  if (value === "eu-only") return "Remote (EU)";
  if (value === "emea") return "Remote (EMEA)";
  if (value === "africa") return "Remote (Africa)";
  return value.replace(/-/g, " ");
}

function familyLabel(value: string | null | undefined): string {
  if (!value) return "Technology";
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function relativeTime(value: string | null | undefined): string {
  if (!value) return "—";
  const time = new Date(value).getTime();
  if (!Number.isFinite(time)) return "—";
  const minutes = Math.max(0, Math.round((Date.now() - time) / 60_000));
  if (minutes < 2) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function exceptionAction(type: string): string {
  if (type === "missing-answer" || type === "sensitive-answer") return "Answer";
  if (type === "captcha") return "Continue";
  if (type === "submit-uncertain" || type === "retry-exhausted") return "Review";
  return "Resolve";
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const supabase = await createServerSupabaseClient();
  const since24h = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const [jobsCountResult, newJobsResult, sourceRunResult] = await Promise.all([
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("remote", true),
    supabase
      .from("jobs")
      .select("id", { count: "exact", head: true })
      .eq("remote", true)
      .gte("discovered_at", since24h),
    supabase
      .from("job_source_runs")
      .select("created_at")
      .eq("success", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const profile = await latestProfileForUser(userId);
  const jobsDiscovered = jobsCountResult.count ?? 0;
  const newJobsToday = newJobsResult.count ?? 0;
  const lastSourceSuccess =
    (sourceRunResult.data as { created_at?: string } | null)?.created_at ?? null;

  if (!profile) {
    return {
      profileConfigured: false,
      profileName: null,
      firstName: "there",
      jobsDiscovered,
      newJobsToday,
      eligible: 0,
      strongMatches: 0,
      readyForReview: 0,
      needsAttention: 0,
      autoSubmitQueued: 0,
      applications: 0,
      applied: 0,
      prepared: 0,
      cvCount: 0,
      newResponses: 0,
      gmailConnected: false,
      gmailEmail: null,
      latestJobs: [],
      recentApplications: [],
      exceptions: [],
      latestCvs: [],
      messages: [],
      lastSourceSuccess
    };
  }

  const profileId = String(profile.id);
  const firstName = String(profile.display_name ?? "there").trim().split(/\s+/)[0] || "there";

  const [
    eligibleResult,
    strongResult,
    readyResult,
    attentionResult,
    autoSubmitResult,
    applicationsResult,
    appliedResult,
    preparedResult,
    cvCountResult,
    recentApplicationsResult,
    latestCvsResult,
    gmailConnectionResult,
    messagesResult,
    newResponsesResult
  ] = await Promise.all([
    supabase
      .from("job_matches")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .in("decision", ["review", "strong-match"]),
    supabase
      .from("job_matches")
      .select("job_id,score", { count: "exact" })
      .eq("profile_id", profileId)
      .eq("decision", "strong-match")
      .order("score", { ascending: false })
      .limit(5),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .eq("status", "ready-for-review"),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .eq("status", "needs-attention"),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .eq("status", "auto-submit-queued"),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .eq("status", "applied"),
    supabase
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .in("status", ["cv-prepared", "ready-for-review", "auto-submit-queued", "needs-attention"]),
    supabase
      .from("cv_versions")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId),
    supabase
      .from("applications")
      .select("id,job_id,status,next_action,updated_at")
      .eq("profile_id", profileId)
      .order("updated_at", { ascending: false })
      .limit(5),
    supabase
      .from("cv_versions")
      .select("id,job_id,version,created_at")
      .eq("profile_id", profileId)
      .order("created_at", { ascending: false })
      .limit(3),
    supabase
      .from("gmail_connections")
      .select("email_address,granted_scope,active,last_synced_at,last_error")
      .eq("owner_id", userId)
      .maybeSingle(),
    supabase
      .from("gmail_messages")
      .select("id,sender,subject,classification,received_at")
      .eq("owner_id", userId)
      .order("received_at", { ascending: false })
      .limit(4),
    supabase
      .from("gmail_messages")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", userId)
      .gte("received_at", since24h)
      .in("classification", ["recruiter", "assessment", "interview", "offer", "rejection"])
  ]);

  const recentAppRows = (recentApplicationsResult.data ?? []) as Array<{
    id: string;
    job_id: string;
    status: string;
    next_action: string | null;
    updated_at: string;
  }>;

  const latestCvRows = (latestCvsResult.data ?? []) as Array<{
    id: string;
    job_id: string | null;
    version: number;
    created_at: string;
  }>;

  const strongRows = (strongResult.data ?? []) as Array<{
    job_id: string;
    score: number;
  }>;

  const allApplicationIdsResult = await supabase
    .from("applications")
    .select("id,job_id")
    .eq("profile_id", profileId)
    .limit(1000);

  const applicationRows = (allApplicationIdsResult.data ?? []) as Array<{
    id: string;
    job_id: string;
  }>;
  const applicationIds = applicationRows.map((item) => item.id);

  let openExceptionRows: Array<{
    id: string;
    application_id: string;
    exception_type: string;
    detail: string;
    created_at: string;
  }> = [];

  if (applicationIds.length) {
    const result = await supabase
      .from("application_exceptions")
      .select("id,application_id,exception_type,detail,created_at")
      .in("application_id", applicationIds)
      .eq("status", "open")
      .order("created_at", { ascending: false })
      .limit(3);

    openExceptionRows = (result.data ?? []) as typeof openExceptionRows;
  }

  const jobIds = [...new Set([
    ...strongRows.map((row) => row.job_id),
    ...recentAppRows.map((row) => row.job_id),
    ...latestCvRows.flatMap((row) => row.job_id ? [row.job_id] : []),
    ...applicationRows.map((row) => row.job_id)
  ])];

  let jobRows: Array<{
    id: string;
    title: string;
    company: string;
    remote_scope: string;
    role_family: string;
  }> = [];

  if (jobIds.length) {
    const result = await supabase
      .from("jobs")
      .select("id,title,company,remote_scope,role_family")
      .in("id", jobIds);
    jobRows = (result.data ?? []) as typeof jobRows;
  }

  const jobsById = new Map(jobRows.map((job) => [job.id, job]));
  const applicationsById = new Map(applicationRows.map((application) => [application.id, application]));

  let recentMatchRows: Array<{ job_id: string; score: number }> = [];
  const recentJobIds = recentAppRows.map((row) => row.job_id);
  if (recentJobIds.length) {
    const result = await supabase
      .from("job_matches")
      .select("job_id,score")
      .eq("profile_id", profileId)
      .in("job_id", recentJobIds);
    recentMatchRows = (result.data ?? []) as typeof recentMatchRows;
  }
  const matchScoreByJob = new Map(recentMatchRows.map((row) => [row.job_id, row.score]));

  const latestJobs: DashboardJob[] = strongRows.flatMap((match) => {
    const job = jobsById.get(match.job_id);
    if (!job) return [];
    return [{
      id: job.id,
      score: match.score,
      role: job.title,
      company: job.company,
      scope: scopeLabel(job.remote_scope),
      family: familyLabel(job.role_family)
    }];
  });

  const recentApplications: DashboardApplication[] = recentAppRows.flatMap((application) => {
    const job = jobsById.get(application.job_id);
    if (!job) return [];
    return [{
      id: application.id,
      role: job.title,
      company: job.company,
      scope: scopeLabel(job.remote_scope),
      score: matchScoreByJob.get(job.id) ?? null,
      status: application.status,
      nextAction: application.next_action ?? "Automation is monitoring this application.",
      updated: relativeTime(application.updated_at)
    }];
  });

  const exceptions: DashboardException[] = openExceptionRows.flatMap((item) => {
    const application = applicationsById.get(item.application_id);
    const job = application ? jobsById.get(application.job_id) : undefined;
    if (!job) return [];
    return [{
      id: item.id,
      type: item.exception_type,
      role: job.title,
      company: job.company,
      detail: item.detail,
      action: exceptionAction(item.exception_type),
      age: relativeTime(item.created_at)
    }];
  });

  const latestCvs: DashboardCv[] = latestCvRows.flatMap((cv) => {
    if (!cv.job_id) return [];
    const job = jobsById.get(cv.job_id);
    if (!job) return [];
    return [{
      id: cv.id,
      role: job.title,
      company: job.company,
      version: cv.version,
      age: relativeTime(cv.created_at)
    }];
  });

  const messages: DashboardMessage[] = ((messagesResult.data ?? []) as Array<{
    id: string;
    sender: string | null;
    subject: string | null;
    classification: string;
    received_at: string | null;
  }>).map((message) => ({
    id: message.id,
    subject: message.subject || "(No subject)",
    sender: message.sender || "Unknown sender",
    classification: message.classification,
    age: relativeTime(message.received_at)
  }));

  const connection = gmailConnectionResult.data as {
    email_address?: string | null;
    granted_scope?: string | null;
    active?: boolean;
  } | null;

  const gmailConnected = Boolean(
    connection?.active &&
    connection.granted_scope?.includes("gmail.readonly")
  );

  return {
    profileConfigured: true,
    profileName: profile.display_name ?? null,
    firstName,
    jobsDiscovered,
    newJobsToday,
    eligible: eligibleResult.count ?? 0,
    strongMatches: strongResult.count ?? 0,
    readyForReview: readyResult.count ?? 0,
    needsAttention: attentionResult.count ?? 0,
    autoSubmitQueued: autoSubmitResult.count ?? 0,
    applications: applicationsResult.count ?? 0,
    applied: appliedResult.count ?? 0,
    prepared: preparedResult.count ?? 0,
    cvCount: cvCountResult.count ?? 0,
    newResponses: newResponsesResult.count ?? 0,
    gmailConnected,
    gmailEmail: connection?.email_address ?? null,
    latestJobs,
    recentApplications,
    exceptions,
    latestCvs,
    messages,
    lastSourceSuccess
  };
}
