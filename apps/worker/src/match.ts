import { scoreJob, type CareerProfile, type NormalizedJob, type RoleFamily, type RemoteScope } from "@remotejobos/core";
import { config, hasSupabase } from "./config.js";

type ProfileRow = { id: string; profile: CareerProfile };
type JobRow = {
  id: string;
  source: string;
  external_id: string;
  title: string;
  company: string;
  description: string;
  apply_url: string;
  source_url?: string | null;
  posted_at?: string | null;
  salary_text?: string | null;
  location_text?: string | null;
  remote: boolean;
  remote_scope: RemoteScope;
  role_family: RoleFamily;
  tags?: string[] | null;
};

async function supabaseGet<T>(path: string): Promise<T> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: `Bearer ${config.supabaseServiceRoleKey}`
    }
  });
  if (!response.ok) throw new Error(`Supabase GET failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

export async function matchJobs() {
  if (!hasSupabase()) {
    console.log("[match] Supabase is not configured; nothing to match.");
    return 0;
  }

  const profiles = await supabaseGet<ProfileRow[]>(
    "career_profiles?select=id,profile&order=updated_at.desc&limit=1"
  );
  const profileRow = profiles[0];
  if (!profileRow) {
    console.log("[match] No career profile exists yet.");
    return 0;
  }

  const jobs = await supabaseGet<JobRow[]>(
    "jobs?select=id,source,external_id,title,company,description,apply_url,source_url,posted_at,salary_text,location_text,remote,remote_scope,role_family,tags&remote=eq.true&order=discovered_at.desc&limit=500"
  );
  const existing = await supabaseGet<Array<{ job_id: string }>>(
    `job_matches?select=job_id&profile_id=eq.${encodeURIComponent(profileRow.id)}`
  );
  const seen = new Set(existing.map((row) => row.job_id));

  const rows = jobs
    .filter((job) => !seen.has(job.id))
    .map((row) => {
      const job: NormalizedJob = {
        source: row.source,
        externalId: row.external_id,
        title: row.title,
        company: row.company,
        description: row.description,
        applyUrl: row.apply_url,
        sourceUrl: row.source_url ?? undefined,
        postedAt: row.posted_at ?? undefined,
        salaryText: row.salary_text ?? undefined,
        locationText: row.location_text ?? undefined,
        remote: row.remote,
        remoteScope: row.remote_scope,
        roleFamily: row.role_family,
        tags: row.tags ?? []
      };
      const result = scoreJob(job, profileRow.profile);
      return {
        job_id: row.id,
        profile_id: profileRow.id,
        score: result.total,
        decision: result.decision,
        breakdown: result.breakdown,
        reasons: [...result.reasons, ...result.missingSignals]
      };
    });

  if (!rows.length) {
    console.log("[match] No unscored jobs.");
    return 0;
  }

  const response = await fetch(`${config.supabaseUrl}/rest/v1/job_matches?on_conflict=job_id,profile_id`, {
    method: "POST",
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rows)
  });
  if (!response.ok) throw new Error(`Match persistence failed: ${response.status} ${await response.text()}`);

  const strong = rows.filter((row) => row.decision === "strong-match").length;
  const review = rows.filter((row) => row.decision === "review").length;
  console.log(`[match] scored ${rows.length}; strong=${strong}; review=${review}`);
  return rows.length;
}
