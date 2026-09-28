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
  profile: { facts?: VerifiedCareerFact[] };
};

type MatchRow = { job_id: string };

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

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: `Bearer ${config.supabaseServiceRoleKey}`
    }
  });
  if (!response.ok) throw new Error(`Supabase GET failed: ${response.status} ${await response.text()}`);
  return response.json() as Promise<T>;
}

export async function prepareCvPlans() {
  if (!hasSupabase()) {
    console.log("[cv] Supabase is not configured; skipping CV planning.");
    return 0;
  }

  const profiles = await getJson<ProfileRow[]>(
    "career_profiles?select=id,profile&order=updated_at.desc&limit=1"
  );
  const profile = profiles[0];
  if (!profile) {
    console.log("[cv] No career profile exists yet.");
    return 0;
  }

  const facts = profile.profile.facts ?? [];
  if (!facts.length) {
    console.log("[cv] Career profile has no verified facts yet; refusing to invent CV content.");
    return 0;
  }

  const matches = await getJson<MatchRow[]>(
    `job_matches?select=job_id&profile_id=eq.${encodeURIComponent(profile.id)}&decision=eq.strong-match&order=created_at.desc&limit=100`
  );
  if (!matches.length) {
    console.log("[cv] No strong matches need CV planning.");
    return 0;
  }

  const existing = await getJson<Array<{ job_id: string }>>(
    `cv_versions?select=job_id&profile_id=eq.${encodeURIComponent(profile.id)}&family=not.is.null`
  );
  const existingJobIds = new Set(existing.map((row) => row.job_id));
  const jobIds = matches.map((row) => row.job_id).filter((id) => !existingJobIds.has(id));
  if (!jobIds.length) {
    console.log("[cv] All strong matches already have a CV plan.");
    return 0;
  }

  const jobs = await getJson<JobRow[]>(
    `jobs?select=id,source,external_id,title,company,description,apply_url,source_url,posted_at,salary_text,location_text,remote,remote_scope,role_family,tags&id=in.(${jobIds.join(",")})`
  );

  const rows = jobs.flatMap((row) => {
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

    return [{
      profile_id: profile.id,
      job_id: row.id,
      family: row.role_family,
      version: 1,
      content: {
        strategy: "verified-facts-v2",
        template: "professional-single-column-v2",
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

  if (!rows.length) {
    console.log("[cv] No CV plans had verified relevant facts.");
    return 0;
  }

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

  if (!response.ok) throw new Error(`CV plan persistence failed: ${response.status} ${await response.text()}`);

  console.log(`[cv] prepared ${rows.length} verified-fact CV plans`);
  return rows.length;
}
