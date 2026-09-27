import {
  canonicalizeJobUrl,
  contentFingerprint,
  makeJobDedupeKey,
  type NormalizedJob
} from "@remotejobos/core";
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
    tags: job.tags,
    canonical_url: canonicalizeJobUrl(job.applyUrl),
    dedupe_key: makeJobDedupeKey({
      company: job.company,
      title: job.title,
      locationText: job.locationText
    }),
    content_fingerprint: contentFingerprint({
      company: job.company,
      title: job.title,
      description: job.description
    })
  }));

  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/ingest_discovered_jobs`, {
    method: "POST",
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({ p_jobs: rows })
  });

  if (!response.ok) {
    throw new Error(`Supabase ingestion failed: ${response.status} ${await response.text()}`);
  }

  const result = await response.json() as Array<{ inserted: number; updated: number; skipped: number }>;
  const summary = result[0] ?? { inserted: 0, updated: 0, skipped: 0 };
  console.log(`[persist] inserted=${summary.inserted} updated=${summary.updated} skipped=${summary.skipped}`);
}
