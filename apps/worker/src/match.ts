import {
  scoreJob,
  type CareerProfile,
  type NormalizedJob,
  type RoleFamily,
  type RemoteScope
} from "@remotejobos/core";
import { config, hasSupabase } from "./config.js";

type ProfileRow = { id: string; profile: CareerProfile; updated_at: string };
type ThinJobRow = {
  id: string;
  content_fingerprint: string | null;
};
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
  content_fingerprint: string | null;
};
type ExistingMatchRow = {
  job_id: string;
  decision: string;
  breakdown: Record<string, unknown> | null;
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

function matchInputFingerprint(
  job: ThinJobRow | JobRow,
  profileUpdatedAt: string
): string {
  return `${job.content_fingerprint ?? `job:${job.id}`}:${profileUpdatedAt}`;
}

function persistedInputFingerprint(match: ExistingMatchRow | undefined): string {
  const value = match?.breakdown?._inputFingerprint;
  return typeof value === "string" ? value : "";
}

async function fetchJobsByIds(jobIds: string[]): Promise<JobRow[]> {
  if (!jobIds.length) return [];

  const rows: JobRow[] = [];
  const chunkSize = 75;

  for (let index = 0; index < jobIds.length; index += chunkSize) {
    const chunk = jobIds.slice(index, index + chunkSize);
    rows.push(
      ...(await supabaseGetAll<JobRow>(
        "jobs?select=id,source,external_id,title,company,description,apply_url,source_url,posted_at,salary_text,location_text,remote,remote_scope,role_family,tags,content_fingerprint" +
          `&id=in.(${chunk.join(",")})`,
        chunkSize
      ))
    );
  }

  return rows;
}

export async function matchJobs() {
  if (!hasSupabase()) {
    console.log("[match] Supabase is not configured; nothing to match.");
    return 0;
  }

  const profiles = await supabaseGet<ProfileRow[]>(
    "career_profiles?select=id,profile,updated_at&order=updated_at.desc&limit=1000"
  );
  if (!profiles.length) {
    console.log("[match] No career profile exists yet.");
    return 0;
  }

  // Keep the normal polling query thin. Full descriptions are fetched only
  // for jobs whose content fingerprint (or profile revision) changed.
  const jobs = await supabaseGetAll<ThinJobRow>(
    "jobs?select=id,content_fingerprint&remote=eq.true",
    2000
  );

  let total = 0;
  let skipped = 0;
  let strong = 0;
  let review = 0;

  for (const profileRow of profiles) {
    const existingMatches = await supabaseGetAll<ExistingMatchRow>(
      `job_matches?select=job_id,decision,breakdown&profile_id=eq.${encodeURIComponent(profileRow.id)}`,
      2000
    );
    const existingByJob = new Map(
      existingMatches.map((match) => [match.job_id, match])
    );

    const changedIds = jobs
      .filter((job) => {
        const expected = matchInputFingerprint(job, profileRow.updated_at);
        return persistedInputFingerprint(existingByJob.get(job.id)) !== expected;
      })
      .map((job) => job.id);

    const fullJobs = await fetchJobsByIds(changedIds);

    const rows = fullJobs.map((row) => {
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
      const decision = result.decision;
      existingByJob.set(row.id, {
        job_id: row.id,
        decision,
        breakdown: {
          ...result.breakdown,
          _inputFingerprint: matchInputFingerprint(row, profileRow.updated_at)
        }
      });

      return {
        job_id: row.id,
        profile_id: profileRow.id,
        score: result.total,
        decision,
        breakdown: {
          ...result.breakdown,
          _inputFingerprint: matchInputFingerprint(row, profileRow.updated_at)
        },
        reasons: [...result.reasons, ...result.missingSignals]
      };
    });

    await persistMatches(rows);

    const remoteJobIds = new Set(jobs.map((job) => job.id));
    for (const match of existingByJob.values()) {
      if (!remoteJobIds.has(match.job_id)) continue;
      if (match.decision === "strong-match") strong += 1;
      if (match.decision === "review") review += 1;
    }

    total += rows.length;
    skipped += Math.max(0, jobs.length - rows.length);
  }

  console.log(
    `[match] profiles=${profiles.length}; scored=${total}; skipped=${skipped}; strong=${strong}; review=${review}`
  );
  return total;
}
