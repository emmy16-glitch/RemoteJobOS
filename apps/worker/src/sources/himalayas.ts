import {
  classifyRoleFamily,
  type NormalizedJob,
  type RemoteScope
} from "@remotejobos/core";
import type { JobSource } from "./types.js";

type CountryRestriction = {
  alpha2?: string;
  name?: string;
  slug?: string;
};

type HimalayasJob = {
  title: string;
  excerpt?: string;
  companyName: string;
  companySlug?: string;
  employmentType?: string;
  minSalary?: number | null;
  maxSalary?: number | null;
  salaryPeriod?: string;
  seniority?: string | string[];
  currency?: string;
  locationRestrictions?: CountryRestriction[];
  timezoneRestrictions?: string[];
  categories?: string[];
  parentCategories?: string[];
  description?: string;
  pubDate?: number | string;
  expiryDate?: number | string;
  applicationLink: string;
  guid: string;
};

type HimalayasResponse = {
  offset: number;
  limit: number;
  totalCount: number;
  jobs: HimalayasJob[];
};

function stripHtml(value: string): string {
  return value
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/gi, '"')
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function isoDate(value: number | string | undefined): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  const numeric =
    typeof value === "number"
      ? value
      : /^\d+$/.test(value)
        ? Number(value)
        : undefined;
  const date =
    numeric !== undefined
      ? new Date(numeric < 10_000_000_000 ? numeric * 1000 : numeric)
      : new Date(value);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function remoteScope(restrictions: CountryRestriction[] | undefined): RemoteScope {
  return restrictions?.length ? "country-restricted" : "global";
}

function locationText(restrictions: CountryRestriction[] | undefined): string {
  if (!restrictions?.length) return "Worldwide";
  return restrictions
    .map((restriction) => restriction.name ?? restriction.alpha2 ?? restriction.slug)
    .filter((value): value is string => Boolean(value))
    .join(", ");
}

function salaryText(job: HimalayasJob): string | undefined {
  if (job.minSalary == null && job.maxSalary == null) return undefined;

  const currency = job.currency ?? "";
  const period = job.salaryPeriod ? " / " + job.salaryPeriod : "";

  if (job.minSalary != null && job.maxSalary != null) {
    return `${currency} ${job.minSalary.toLocaleString()}–${job.maxSalary.toLocaleString()}${period}`.trim();
  }

  const value = job.minSalary ?? job.maxSalary;
  return `${currency} ${Number(value).toLocaleString()}${period}`.trim();
}

function expired(job: HimalayasJob): boolean {
  const expiry = isoDate(job.expiryDate);
  return expiry ? new Date(expiry).getTime() < Date.now() : false;
}

export const himalayasSource: JobSource = {
  name: "himalayas",
  // Their JSON feed is refreshed every 24 hours. Respect that upstream cadence.
  minimumIntervalMinutes: 22 * 60,

  async fetchJobs(): Promise<NormalizedJob[]> {
    const maxPages = Math.max(
      1,
      Math.min(5, Number(process.env.HIMALAYAS_MAX_PAGES ?? "3") || 3)
    );
    const jobsByGuid = new Map<string, NormalizedJob>();

    const searches = [
      { label: "worldwide", params: "worldwide=true&sort=recent" },
      { label: "nigeria", params: "country=NG&sort=recent" }
    ];

    for (const search of searches) {
      for (let page = 1; page <= maxPages; page += 1) {
        const response = await fetch(
          `https://himalayas.app/jobs/api/search?${search.params}&page=${page}`,
          {
            headers: {
              "user-agent":
                "RemoteJobOS/0.1 (+https://github.com/emmy16-glitch/RemoteJobOS)"
            }
          }
        );

        if (response.status === 429) {
          throw new Error(`Himalayas rate limit reached during ${search.label} search`);
        }
        if (!response.ok) {
          throw new Error(
            `Himalayas ${search.label} search returned ${response.status}`
          );
        }

        const payload = (await response.json()) as HimalayasResponse;
        const pageJobs = payload.jobs ?? [];
        if (!pageJobs.length) break;

        for (const item of pageJobs) {
          if (!item.guid || !item.applicationLink || expired(item)) continue;

          const description = stripHtml(item.description ?? item.excerpt ?? "");
          const seniority = Array.isArray(item.seniority)
            ? item.seniority
            : item.seniority
              ? [item.seniority]
              : [];
          const restrictions = item.locationRestrictions ?? [];

          jobsByGuid.set(item.guid, {
            source: "himalayas",
            externalId: item.guid,
            title: item.title,
            company: item.companyName,
            description,
            applyUrl: item.applicationLink,
            sourceUrl: item.applicationLink,
            postedAt: isoDate(item.pubDate),
            salaryText: salaryText(item),
            locationText: locationText(restrictions),
            remote: true,
            remoteScope: remoteScope(restrictions),
            roleFamily: classifyRoleFamily(item.title, description),
            tags: [
              item.employmentType,
              ...seniority,
              ...(item.categories ?? []),
              ...(item.parentCategories ?? []),
              ...(item.timezoneRestrictions ?? [])
            ].filter((value): value is string => Boolean(value))
          });
        }

        if (pageJobs.length < 20) break;
      }
    }

    return [...jobsByGuid.values()];
  }};
