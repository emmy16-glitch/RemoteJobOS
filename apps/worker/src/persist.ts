import type { NormalizedJob } from "@remotejobos/core";
import { config, hasSupabase } from "./config.js";

export async function persistJobs(jobs: NormalizedJob[]) {
  if (!hasSupabase()) {
    console.log(`[dry-storage] Supabase not configured; ${jobs.length} jobs were normalized but not persisted.`);
    return;
  }

  const rows = jobs.map((job) => ({
    source: job.source,
    external_id: job.externalId,
    title: job.title,
    company: job.company,
    description: job.description,
    apply_url: job.applyUrl,
    source_url: job.sourceUrl ?? null,
    posted_at: job.postedAt ?? null,
    salary_text: job.salaryText ?? null,
    location_text: job.locationText ?? null,
    remote: job.remote,
    remote_scope: job.remoteScope,
    role_family: job.roleFamily,
    tags: job.tags
  }));

  const response = await fetch(`${config.supabaseUrl}/rest/v1/jobs?on_conflict=source,external_id`, {
    method: "POST",
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal"
    },
    body: JSON.stringify(rows)
  });

  if (!response.ok) throw new Error(`Supabase persistence failed: ${response.status} ${await response.text()}`);
}
