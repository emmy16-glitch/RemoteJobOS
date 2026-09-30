import {
  scoreJob,
  type CareerProfile,
  type NormalizedJob,
  type RoleFamily,
  type RemoteScope
} from "@remotejobos/core";
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
  if (!response.ok) {
    throw new Error(`Supabase GET failed: ${response.status} ${await response.text()}`);
  }
  return response.json() as Promise<T>;
}

async function supabaseGetAll<T>(path: string, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;

  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const page = await supabaseGet<T[]>(
      `${path}${separator}limit=${pageSize}&offset=${offset}`
    );
    rows.push(...page);
    if (page.length < pageSize) return rows;
    offset += page.length;
  }
}

async function persistMatches(rows: Array<Record<string, unknown>>): Promise<void> {
  if (!rows.length) return;

  const chunkSize = 500;
  for (let index = 0; index < rows.length; index += chunkSize) {
    const chunk = rows.slice(index, index + chunkSize);
    const response = await fetch(
      `${config.supabaseUrl}/rest/v1/job_matches?on_conflict=job_id,profile_id`,
      {
        method: "POST",
        headers: {
          apikey: config.supabaseServiceRoleKey,
          authorization: `Bearer ${config.supabaseServiceRoleKey}`,
          "content-type": "application/json",
          prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(chunk)
      }
    );

    if (!response.ok) {
      throw new Error(`Match persistence failed: ${response.status} ${await response.text()}`);
    }
  }
}

export async function matchJobs() {
  if (!hasSupabase()) {
    console.log("[match] Supabase is not configured; nothing to match.");
    return 0;
  }

  const profiles = await supabaseGet<ProfileRow[]>(
    "career_profiles?select=id,profile&order=updated_at.desc&limit=1000"
  );
  if (!profiles.length) {
    console.log("[match] No career profile exists yet.");
    return 0;
  }

  const jobs = await supabaseGetAll<JobRow>(
    "jobs?select=id,source,external_id,title,company,description,apply_url,source_url,posted_at,salary_text,location_text,remote,remote_scope,role_family,tags&remote=eq.true&order=discovered_at.desc"
  );

  let total = 0;
  let strong = 0;
  let review = 0;

  for (const profileRow of profiles) {
    // Matches are live/recomputable state, not durable memory. Re-score the
    // current job snapshot against the current verified profile every run so
    // profile edits and job-description changes cannot leave stale scores.
    const rows = jobs.map((row) => {
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

    await persistMatches(rows);

    total += rows.length;
    strong += rows.filter((row) => row.decision === "strong-match").length;
    review += rows.filter((row) => row.decision === "review").length;
  }

  console.log(
    `[match] profiles=${profiles.length}; scored=${total}; strong=${strong}; review=${review}`
  );
  return total;
}
