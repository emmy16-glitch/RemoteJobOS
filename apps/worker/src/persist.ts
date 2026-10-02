import {
  canonicalizeJobUrl,
  contentFingerprint,
  makeJobDedupeKey,
  type NormalizedJob
} from "@remotejobos/core";
import { config, hasSupabase } from "./config.js";

type ExistingJobTarget = {
  source: string;
  external_id: string;
  apply_url: string;
};

function hostOf(value: string | undefined): string {
  if (!value) return "";
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isLowQualityApplicationTarget(value: string | undefined): boolean {
  const host = hostOf(value);
  return (
    !host ||
    /(^|\.)remoteok\.(?:com|io)$/i.test(host) ||
    /(^|\.)himalayas\.app$/i.test(host) ||
    /(^|\.)remotive\.com$/i.test(host) ||
    /(^|\.)arbeitnow\.(?:com|ch|co\.uk|fr)$/i.test(host) ||
    /(^|\.)producthunt\.com$/i.test(host)
  );
}

async function existingEnrichedTargets(
  jobs: NormalizedJob[]
): Promise<Map<string, string>> {
  const wanted = new Set(
    jobs
      .filter((job) => isLowQualityApplicationTarget(job.applyUrl))
      .map((job) => `${job.source.toLowerCase()}:${job.externalId}`)
  );

  if (!wanted.size) return new Map();

  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/jobs?select=source,external_id,apply_url&limit=5000`,
    {
      headers: {
        apikey: config.supabaseServiceRoleKey,
        authorization: `Bearer ${config.supabaseServiceRoleKey}`
      }
    }
  );

  if (!response.ok) {
    console.warn(
      `[persist] could not load existing enriched targets: ${response.status} ${await response.text()}`
    );
    return new Map();
  }

  const rows = await response.json() as ExistingJobTarget[];
  return new Map(
    rows
      .filter((row) => {
        const key = `${row.source.toLowerCase()}:${row.external_id}`;
        return wanted.has(key) && !isLowQualityApplicationTarget(row.apply_url);
      })
      .map((row) => [
        `${row.source.toLowerCase()}:${row.external_id}`,
        row.apply_url
      ])
  );
}

export async function persistJobs(jobs: NormalizedJob[]) {
  if (!hasSupabase()) {
    console.log(`[dry-storage] Supabase not configured; ${jobs.length} jobs were normalized but not persisted.`);
    return;
  }

  const preservedEnrichedTargets = await existingEnrichedTargets(jobs);

  const rows = jobs.map((job) => {
    const preserved = isLowQualityApplicationTarget(job.applyUrl)
      ? preservedEnrichedTargets.get(
          `${job.source.toLowerCase()}:${job.externalId}`
        )
      : undefined;

    const effectiveApplyUrl = preserved ?? job.applyUrl;

    return {
      source: job.source,
      external_id: job.externalId,
      title: job.title,
      company: job.company,
      description: job.description,
      apply_url: effectiveApplyUrl,
      source_url: job.sourceUrl ?? null,
      posted_at: job.postedAt ?? null,
      salary_text: job.salaryText ?? null,
      location_text: job.locationText ?? null,
      remote: job.remote,
      remote_scope: job.remoteScope,
      role_family: job.roleFamily,
      tags: job.tags,
      canonical_url: canonicalizeJobUrl(effectiveApplyUrl),
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
    };
  });

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
