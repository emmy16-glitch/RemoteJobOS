import { createHash } from "node:crypto";
import {
  auditResumePlan,
  materializeResumeFacts,
  planResume,
  type NormalizedJob,
  type RemoteScope,
  type RoleFamily,
  type VerifiedCareerFact
} from "@remotejobos/core";
import { config, hasSupabase } from "./config.js";

type ProfileRow = {
  id: string;
  updated_at: string;
  profile: { facts?: VerifiedCareerFact[] };
};

type MatchRow = { job_id: string };

type ExistingCvRow = {
  job_id: string | null;
  version: number;
  content: {
    inputFingerprint?: string;
  };
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
  last_seen_at: string;
};

async function getJson<T>(path: string): Promise<T> {
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

async function getAllJson<T>(path: string, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;

  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const page = await getJson<T[]>(
      `${path}${separator}limit=${pageSize}&offset=${offset}`
    );
    rows.push(...page);
    if (page.length < pageSize) return rows;
    offset += page.length;
  }
}

function stableFingerprint(profile: ProfileRow, job: JobRow): string {
  const input = JSON.stringify({
    profileUpdatedAt: profile.updated_at,
    facts: profile.profile.facts ?? [],
    job: {
      id: job.id,
      title: job.title,
      company: job.company,
      description: job.description,
      applyUrl: job.apply_url,
      salaryText: job.salary_text ?? null,
      locationText: job.location_text ?? null,
      remoteScope: job.remote_scope,
      roleFamily: job.role_family,
      tags: job.tags ?? [],
      lastSeenAt: job.last_seen_at
    }
  });
  return createHash("sha256").update(input).digest("hex");
}

async function prepareProfileCvPlans(profile: ProfileRow): Promise<number> {
  const facts = profile.profile.facts ?? [];
  if (!facts.length) {
    console.log(`[cv] profile ${profile.id} has no verified facts; skipping.`);
    return 0;
  }

  const matches = await getAllJson<MatchRow>(
    `job_matches?select=job_id&profile_id=eq.${encodeURIComponent(profile.id)}&decision=eq.strong-match&order=created_at.desc`
  );
  if (!matches.length) return 0;

  const existing = await getAllJson<ExistingCvRow>(
    `cv_versions?select=job_id,version,content&profile_id=eq.${encodeURIComponent(profile.id)}&family=not.is.null`
  );
  const existingByJob = new Map<string, ExistingCvRow[]>();
  for (const cv of existing) {
    if (!cv.job_id) continue;
    const bucket = existingByJob.get(cv.job_id) ?? [];
    bucket.push(cv);
    existingByJob.set(cv.job_id, bucket);
  }

  const jobIds = [...new Set(matches.map((row) => row.job_id))];
  const jobs: JobRow[] = [];
  const jobChunkSize = 100;
  for (let index = 0; index < jobIds.length; index += jobChunkSize) {
    const chunk = jobIds.slice(index, index + jobChunkSize);
    jobs.push(
      ...(await getJson<JobRow[]>(
        `jobs?select=id,source,external_id,title,company,description,apply_url,source_url,posted_at,salary_text,location_text,remote,remote_scope,role_family,tags,last_seen_at&id=in.(${chunk.join(",")})`
      ))
    );
  }

  const rows = jobs.flatMap((row) => {
    const inputFingerprint = stableFingerprint(profile, row);
    const previous = existingByJob.get(row.id) ?? [];

    if (previous.some((cv) => cv.content?.inputFingerprint === inputFingerprint)) {
      return [];
    }

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

    const plan = planResume(job, facts);
    const selectedFacts = materializeResumeFacts(plan, facts);
    if (!selectedFacts.length) return [];
    const quality = auditResumePlan(job, plan, facts);
    const version = previous.reduce((max, cv) => Math.max(max, cv.version), 0) + 1;

    return [{
      profile_id: profile.id,
      job_id: row.id,
      family: row.role_family,
      version,
      content: {
        strategy: "verified-facts-v2",
        template: "professional-single-column-v2",
        inputFingerprint,
        profileUpdatedAt: profile.updated_at,
        jobLastSeenAt: row.last_seen_at,
        quality,
        job: {
          title: row.title,
          company: row.company,
          roleFamily: row.role_family
        },
        plan,
        facts: selectedFacts
      }
    }];
  });

  if (!rows.length) return 0;

  const response = await fetch(`${config.supabaseUrl}/rest/v1/cv_versions`, {
    method: "POST",
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "content-type": "application/json",
      prefer: "return=minimal"
    },
    body: JSON.stringify(rows)
  });

  if (!response.ok) {
    throw new Error(`CV plan persistence failed: ${response.status} ${await response.text()}`);
  }

  return rows.length;
}

export async function prepareCvPlans() {
  if (!hasSupabase()) {
    console.log("[cv] Supabase is not configured; skipping CV planning.");
    return 0;
  }

  const profiles = await getJson<ProfileRow[]>(
    "career_profiles?select=id,updated_at,profile&order=updated_at.desc&limit=1000"
  );
  if (!profiles.length) {
    console.log("[cv] No career profile exists yet.");
    return 0;
  }

  let total = 0;
  for (const profile of profiles) {
    total += await prepareProfileCvPlans(profile);
  }

  console.log(`[cv] profiles=${profiles.length}; prepared=${total} verified-fact CV plans`);
  return total;
}
