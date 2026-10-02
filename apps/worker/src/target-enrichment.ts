import {
  atsBoardKeyCandidates,
  isStrongJobTitleMatch,
  jobTitleSimilarity,
  normalizedCompanyKey
} from "@remotejobos/core";
import { config, hasSupabase } from "./config.js";

type AtsProvider = "greenhouse" | "lever" | "ashby";

type MatchRow = {
  job_id: string;
  score: number;
};

type JobRow = {
  id: string;
  source: string;
  external_id: string;
  company: string;
  title: string;
  apply_url: string;
  source_url: string | null;
};

type RegistryRow = {
  provider: AtsProvider;
  board_key: string;
};

type CandidateJob = {
  title: string;
  url: string;
};

const AGGREGATOR_SOURCES = new Set(["himalayas", "remotive", "remoteok", "arbeitnow"]);

const AGGREGATOR_HOSTS = [
  /(^|\.)himalayas\.app$/i,
  /(^|\.)remotive\.com$/i,
  /(^|\.)remoteok\.(?:com|io)$/i,
  /(^|\.)arbeitnow\.(?:com|ch|co\.uk|fr)$/i
];

const SOCIAL_HOSTS = [
  /(^|\.)linkedin\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)youtube\.com$/i
];

function hostOf(value: string): string {
  try {
    return new URL(value).hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

function isAggregatorUrl(value: string): boolean {
  const host = hostOf(value);
  return AGGREGATOR_HOSTS.some((pattern) => pattern.test(host));
}

function isUsableExternalTarget(value: string): boolean {
  const host = hostOf(value);
  return Boolean(
    host &&
    !AGGREGATOR_HOSTS.some((pattern) => pattern.test(host)) &&
    !SOCIAL_HOSTS.some((pattern) => pattern.test(host))
  );
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!hasSupabase()) throw new Error("Supabase is required for target enrichment");

  const response = await fetch(config.supabaseUrl + "/rest/v1/" + path, {
    ...init,
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: "Bearer " + config.supabaseServiceRoleKey,
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error("Supabase request failed: " + response.status + " " + await response.text());
  }
  if (response.status === 204) return undefined as T;
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

async function requestAll<T>(path: string, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const page = await request<T[]>(path + separator + "limit=" + pageSize + "&offset=" + offset);
    rows.push(...page);
    if (page.length < pageSize) return rows;
    offset += page.length;
  }
}

function sourceBoard(source: string): { provider: AtsProvider; boardKey: string } | null {
  const match = source.match(/^(greenhouse|lever|ashby):(.+)$/i);
  const provider = match?.[1];
  const boardKey = match?.[2];
  if (!provider || !boardKey) return null;
  return {
    provider: provider.toLowerCase() as AtsProvider,
    boardKey
  };
}

function sameCompany(aggregate: JobRow, direct: JobRow): boolean {
  const left = normalizedCompanyKey(aggregate.company);
  const right = normalizedCompanyKey(direct.company);
  if (left && right && left === right) return true;

  const board = sourceBoard(direct.source);
  if (!board) return false;
  const candidates = atsBoardKeyCandidates(aggregate.company, aggregate.source_url);
  return candidates.some(
    (candidate) => normalizedCompanyKey(candidate) === normalizedCompanyKey(board.boardKey)
  );
}

function bestExistingDirectTarget(aggregate: JobRow, directJobs: JobRow[]): JobRow | null {
  const matches = directJobs
    .filter((direct) =>
      isUsableExternalTarget(direct.apply_url) &&
      sameCompany(aggregate, direct) &&
      isStrongJobTitleMatch(aggregate.title, direct.title)
    )
    .sort(
      (a, b) =>
        jobTitleSimilarity(aggregate.title, b.title) -
        jobTitleSimilarity(aggregate.title, a.title)
    );
  return matches[0] ?? null;
}

async function fetchJson(url: string): Promise<unknown | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "RemoteJobOS/0.1 (+https://github.com/emmy16-glitch/RemoteJobOS)"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) return null;
    return await response.json();
  } catch {
    return null;
  }
}

async function probeAtsBoard(
  provider: AtsProvider,
  boardKey: string
): Promise<CandidateJob[] | null> {
  if (provider === "greenhouse") {
    const payload = await fetchJson(
      "https://boards-api.greenhouse.io/v1/boards/" +
      encodeURIComponent(boardKey) +
      "/jobs?content=false"
    ) as { jobs?: Array<{ title?: string; name?: string; absolute_url?: string }> } | null;
    if (!payload?.jobs?.length) return null;
    return payload.jobs.flatMap((job) => {
      const title = (job.title ?? job.name ?? "").trim();
      return title && job.absolute_url ? [{ title, url: job.absolute_url }] : [];
    });
  }

  if (provider === "lever") {
    const payload = await fetchJson(
      "https://api.lever.co/v0/postings/" + encodeURIComponent(boardKey) + "?mode=json"
    ) as Array<{ text?: string; hostedUrl?: string; applyUrl?: string }> | null;
    if (!Array.isArray(payload) || !payload.length) return null;
    return payload.flatMap((job) => {
      const title = (job.text ?? "").trim();
      const url = job.applyUrl ?? job.hostedUrl;
      return title && url ? [{ title, url }] : [];
    });
  }

  const payload = await fetchJson(
    "https://api.ashbyhq.com/posting-api/job-board/" + encodeURIComponent(boardKey)
  ) as {
    jobs?: Array<{
      title?: string;
      jobUrl?: string;
      applyUrl?: string;
    }>;
  } | null;
  if (!payload?.jobs?.length) return null;
  return payload.jobs.flatMap((job) => {
    const title = (job.title ?? "").trim();
    const url = job.applyUrl ?? job.jobUrl;
    return title && url ? [{ title, url }] : [];
  });
}

function stripHtml(value: string): string {
  return value
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function anchorsFromHtml(html: string, baseUrl: string): Array<{ label: string; url: string }> {
  const anchors: Array<{ label: string; url: string }> = [];
  const pattern = /<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
  for (const match of html.matchAll(pattern)) {
    const href = match[1];
    const rawLabel = match[2] ?? "";
    if (!href) continue;
    try {
      const url = new URL(href, baseUrl).toString();
      anchors.push({ label: stripHtml(rawLabel), url });
    } catch {
      // Ignore malformed anchors.
    }
  }
  return anchors;
}

async function fetchHtml(url: string): Promise<{ html: string; finalUrl: string } | null> {
  try {
    const response = await fetch(url, {
      headers: {
        "user-agent": "RemoteJobOS/0.1 (+https://github.com/emmy16-glitch/RemoteJobOS)"
      },
      redirect: "follow",
      signal: AbortSignal.timeout(8_000)
    });
    if (!response.ok) return null;
    const type = response.headers.get("content-type") ?? "";
    if (!type.includes("text/html")) return null;
    return { html: await response.text(), finalUrl: response.url };
  } catch {
    return null;
  }
}

function himalayasCompanySlug(job: JobRow): string | null {
  for (const value of [job.source_url, job.apply_url]) {
    if (!value) continue;
    try {
      const url = new URL(value);
      const match = url.pathname.match(/\/companies\/([^/]+)(?:\/|$)/i);
      if (match?.[1]) return decodeURIComponent(match[1]);
    } catch {
      // Ignore.
    }
  }
  return null;
}

async function resolveViaEmployerCareerPage(job: JobRow): Promise<string | null> {
  const slug = himalayasCompanySlug(job);
  if (!slug) return null;

  const profileUrl = "https://himalayas.app/companies/" + encodeURIComponent(slug);
  const profile = await fetchHtml(profileUrl);
  if (!profile) return null;

  const profileAnchors = anchorsFromHtml(profile.html, profile.finalUrl);
  const external = profileAnchors.filter((anchor) => isUsableExternalTarget(anchor.url));
  const companyKey = normalizedCompanyKey(job.company);

  const official = external
    .sort((a, b) => {
      const score = (item: { label: string; url: string }) => {
        let value = 0;
        if (/\bvisit\b|website|homepage/i.test(item.label)) value += 20;
        if (companyKey && normalizedCompanyKey(hostOf(item.url)).includes(companyKey)) value += 10;
        if (/career|jobs?|join|work-with-us/i.test(item.url + " " + item.label)) value += 5;
        return value;
      };
      return score(b) - score(a);
    })
    .slice(0, 3);

  const pageCandidates = new Set<string>();
  for (const anchor of official) {
    if (/career|jobs?|join|work with us/i.test(anchor.label + " " + anchor.url)) {
      pageCandidates.add(anchor.url);
    }
    try {
      const base = new URL(anchor.url);
      pageCandidates.add(new URL("/careers", base).toString());
      pageCandidates.add(new URL("/career", base).toString());
      pageCandidates.add(new URL("/jobs", base).toString());
    } catch {
      // Ignore.
    }
  }

  for (const pageUrl of [...pageCandidates].slice(0, 8)) {
    const page = await fetchHtml(pageUrl);
    if (!page) continue;
    const anchors = anchorsFromHtml(page.html, page.finalUrl)
      .filter((anchor) => isUsableExternalTarget(anchor.url))
      .filter((anchor) => isStrongJobTitleMatch(job.title, anchor.label))
      .sort(
        (a, b) =>
          jobTitleSimilarity(job.title, b.label) -
          jobTitleSimilarity(job.title, a.label)
      );
    if (anchors[0]?.url) return anchors[0].url;
  }

  return null;
}

async function patchJobTarget(jobId: string, targetUrl: string): Promise<void> {
  await request("jobs?id=eq." + encodeURIComponent(jobId), {
    method: "PATCH",
    body: JSON.stringify({ apply_url: targetUrl })
  });
}

async function registerBoard(
  provider: AtsProvider,
  boardKey: string,
  company: string
): Promise<void> {
  await request("job_source_registry?on_conflict=provider,board_key", {
    method: "POST",
    headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
    body: JSON.stringify({
      provider,
      board_key: boardKey,
      display_name: company,
      enabled: true,
      metadata: {
        discoveredBy: "aggregator-target-enrichment",
        discoveredAt: new Date().toISOString()
      }
    })
  });
}

export async function enrichApplicationTargets(): Promise<{
  candidates: number;
  converted: number;
  registeredBoards: number;
}> {
  if (!hasSupabase()) {
    console.log("[target-enrichment] Supabase is not configured; skipping.");
    return { candidates: 0, converted: 0, registeredBoards: 0 };
  }

  const [matches, jobs, registry] = await Promise.all([
    requestAll<MatchRow>("job_matches?select=job_id,score&decision=eq.strong-match"),
    requestAll<JobRow>("jobs?select=id,source,external_id,company,title,apply_url,source_url"),
    requestAll<RegistryRow>("job_source_registry?select=provider,board_key&enabled=eq.true")
  ]);

  const strongIds = new Set(matches.map((row) => row.job_id));
  const aggregates = jobs.filter(
    (job) =>
      strongIds.has(job.id) &&
      AGGREGATOR_SOURCES.has(job.source.toLowerCase()) &&
      isAggregatorUrl(job.apply_url)
  );
  const directJobs = jobs.filter(
    (job) =>
      !AGGREGATOR_SOURCES.has(job.source.toLowerCase()) &&
      isUsableExternalTarget(job.apply_url)
  );

  let converted = 0;
  let registeredBoards = 0;
  const unresolved: JobRow[] = [];

  for (const job of aggregates) {
    const existing = bestExistingDirectTarget(job, directJobs);
    if (existing) {
      await patchJobTarget(job.id, existing.apply_url);
      converted += 1;
    } else {
      unresolved.push(job);
    }
  }

  const byCompany = new Map<string, JobRow[]>();
  for (const job of unresolved) {
    const key = normalizedCompanyKey(job.company) || job.company.toLowerCase();
    byCompany.set(key, [...(byCompany.get(key) ?? []), job]);
  }

  const companyLimit = Math.max(
    1,
    Math.min(50, Number(process.env.REMOTEJOBOS_ENRICH_COMPANIES_PER_RUN ?? "50") || 50)
  );
  const probeCache = new Map<string, CandidateJob[] | null>();

  for (const companyJobs of [...byCompany.values()].slice(0, companyLimit)) {
    const first = companyJobs[0];
    if (!first) continue;
    const keys = [
      ...new Set(
        companyJobs.flatMap((job) =>
          atsBoardKeyCandidates(job.company, job.source_url)
        )
      )
    ].slice(0, 10);

    const registryFirst = registry
      .filter((row) =>
        keys.some(
          (key) => normalizedCompanyKey(key) === normalizedCompanyKey(row.board_key)
        )
      )
      .map((row) => ({ provider: row.provider, boardKey: row.board_key }));

    const probes: Array<{ provider: AtsProvider; boardKey: string }> = [...registryFirst];

    for (const key of keys) {
      for (const provider of ["greenhouse", "lever", "ashby"] as const) {
        if (!probes.some((probe) => probe.provider === provider && probe.boardKey === key)) {
          probes.push({ provider, boardKey: key });
        }
      }
    }

    let boardResolved = false;

    for (const probe of probes.slice(0, 30)) {
      const cacheKey = probe.provider + ":" + probe.boardKey.toLowerCase();
      let boardJobs = probeCache.get(cacheKey);
      if (boardJobs === undefined) {
        boardJobs = await probeAtsBoard(probe.provider, probe.boardKey);
        probeCache.set(cacheKey, boardJobs);
      }
      if (!boardJobs?.length) continue;

      const resolvedPairs = companyJobs.flatMap((job) => {
        const candidate = boardJobs!
          .filter((entry) => isStrongJobTitleMatch(job.title, entry.title))
          .sort(
            (a, b) =>
              jobTitleSimilarity(job.title, b.title) -
              jobTitleSimilarity(job.title, a.title)
          )[0];
        return candidate ? [{ job, candidate }] : [];
      });

      if (!resolvedPairs.length) continue;

      await registerBoard(probe.provider, probe.boardKey, first.company);
      registeredBoards += registry.some(
        (row) =>
          row.provider === probe.provider &&
          row.board_key.toLowerCase() === probe.boardKey.toLowerCase()
      )
        ? 0
        : 1;

      for (const { job, candidate } of resolvedPairs) {
        await patchJobTarget(job.id, candidate.url);
        converted += 1;
      }
      boardResolved = true;
      break;
    }

    if (boardResolved) continue;

    for (const job of companyJobs) {
      const employerTarget = await resolveViaEmployerCareerPage(job);
      if (employerTarget) {
        await patchJobTarget(job.id, employerTarget);
        converted += 1;
      }
    }
  }

  console.log(
    "[target-enrichment] strong aggregator candidates=" +
      aggregates.length +
      " converted=" +
      converted +
      " registeredBoards=" +
      registeredBoards
  );

  return { candidates: aggregates.length, converted, registeredBoards };
}
