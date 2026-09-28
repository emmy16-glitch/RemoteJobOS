import "server-only";
import { createAdminSupabaseClient } from "./supabase/admin";

export type DashboardJob = {
  score: number;
  role: string;
  company: string;
  scope: string;
  family: string;
};

export type DashboardActivity = {
  time: string;
  type: string;
  text: string;
};

export type DashboardData = {
  profileConfigured: boolean;
  profileName: string | null;
  jobsDiscovered: number;
  eligible: number;
  strongMatches: number;
  readyForReview: number;
  needsAttention: number;
  autoSubmitQueued: number;
  applications: number;
  applied: number;
  prepared: number;
  applicationQueue: number;
  latestJobs: DashboardJob[];
  activity: DashboardActivity[];
  lastSourceSuccess: string | null;
};

function formatActivityTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-NG", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Lagos"
  }).format(date);
}

function scopeLabel(value: string | null | undefined): string {
  if (!value || value === "unknown") return "Remote";
  if (value === "global") return "Worldwide";
  return value.replace(/-/g, " ").toUpperCase();
}

function familyLabel(value: string | null | undefined): string {
  if (!value) return "Technology";
  return value
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function getDashboardData(userId: string): Promise<DashboardData> {
  const supabase = createAdminSupabaseClient();

  const [
    jobsCountResult,
    profileResult,
    sourceRunResult
  ] = await Promise.all([
    supabase.from("jobs").select("id", { count: "exact", head: true }).eq("remote", true),
    supabase
      .from("career_profiles")
      .select("id,display_name")
      .eq("owner_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("job_source_runs")
      .select("created_at")
      .eq("success", true)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
  ]);

  const profile = profileResult.data;
  const jobsDiscovered = jobsCountResult.count ?? 0;
  const lastSourceSuccess =
    (sourceRunResult.data as { created_at?: string } | null)?.created_at ?? null;

  if (!profile) {
    return {
      profileConfigured: false,
      profileName: null,
      jobsDiscovered,
      eligible: 0,
      strongMatches: 0,
      readyForReview: 0,
      needsAttention: 0,
      autoSubmitQueued: 0,
      applications: 0,
      applied: 0,
      prepared: 0,
      applicationQueue: 0,
      latestJobs: [],
      activity: [],
      lastSourceSuccess
    };
  }

  const profileId = String(profile.id);

  const [
    eligibleResult,
    strongResult,
    readyResult,
    attentionResult,
    autoSubmitResult,
    applicationsResult,
    appliedResult,
    preparedResult,
    queueResult,
    eventsResult
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
      .from("applications")
      .select("id", { count: "exact", head: true })
      .eq("profile_id", profileId)
      .in("status", ["cv-prepared", "auto-submit-queued", "needs-attention", "ready-for-review"]),
    supabase
      .from("agent_events")
      .select("event_type,message,created_at")
      .order("created_at", { ascending: false })
      .limit(6)
  ]);

  const strongRows = (strongResult.data ?? []) as Array<{
    job_id: string;
    score: number;
  }>;

  const jobIds = strongRows.map((row) => row.job_id);
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
  const latestJobs = strongRows.flatMap((match) => {
    const job = jobsById.get(match.job_id);
    if (!job) return [];

    return [{
      score: match.score,
      role: job.title,
      company: job.company,
      scope: scopeLabel(job.remote_scope),
      family: familyLabel(job.role_family)
    }];
  });

  const activity = ((eventsResult.data ?? []) as Array<{
    event_type: string;
    message: string;
    created_at: string;
  }>).map((event) => ({
    time: formatActivityTime(event.created_at),
    type: event.event_type.split(".")[0]?.replace(/(^.|-.)/g, (part) => part.toUpperCase()) ?? "Agent",
    text: event.message
  }));

  return {
    profileConfigured: true,
    profileName: profile.display_name ?? null,
    jobsDiscovered,
    eligible: eligibleResult.count ?? 0,
    strongMatches: strongResult.count ?? 0,
    readyForReview: readyResult.count ?? 0,
    needsAttention: attentionResult.count ?? 0,
    autoSubmitQueued: autoSubmitResult.count ?? 0,
    applications: applicationsResult.count ?? 0,
    applied: appliedResult.count ?? 0,
    prepared: preparedResult.count ?? 0,
    applicationQueue: queueResult.count ?? 0,
    latestJobs,
    activity,
    lastSourceSuccess
  };
}
