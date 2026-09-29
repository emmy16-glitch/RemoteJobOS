import { classifyRemoteScope, classifyRoleFamily, type NormalizedJob } from "@remotejobos/core";
import type { JobSource } from "./types.js";

const REJECTED_APPLICATION_HOSTS = [
  /(^|\.)remoteok\.com$/i,
  /(^|\.)remoteok\.io$/i,
  /(^|\.)producthunt\.com$/i,
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)linkedin\.com$/i
];

function validatedExternalApplyUrl(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const parsed = new URL(value);
    if (!["http:", "https:"].includes(parsed.protocol)) return undefined;
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    if (REJECTED_APPLICATION_HOSTS.some((pattern) => pattern.test(host))) return undefined;
    if (/remote[-_ ]?ok.*(?:api|feed)|jobs[-_ ]?api/i.test(parsed.pathname)) return undefined;
    return parsed.toString();
  } catch {
    return undefined;
  }
}

type RemoteOkJob = {
  id?: string | number;
  date?: string;
  company?: string;
  position?: string;
  description?: string;
  location?: string;
  tags?: string[];
  salary_min?: number;
  salary_max?: number;
  url?: string;
  apply_url?: string;
};

export const remoteOkSource: JobSource = {
  name: "remoteok",
  async fetchJobs(): Promise<NormalizedJob[]> {
    const response = await fetch("https://remoteok.com/api", {
      headers: { "user-agent": "RemoteJobOS/0.1 (+https://github.com/emmy16-glitch/RemoteJobOS)" }
    });
    if (!response.ok) throw new Error(`Remote OK returned ${response.status}`);
    const payload = (await response.json()) as RemoteOkJob[];

    return payload
      .filter((job) => job.id && job.position && job.company)
      .map((job) => {
        const description = job.description ?? "";
        const location = job.location ?? "Remote";
        const salary = job.salary_min || job.salary_max
          ? `${job.salary_min ?? "?"} - ${job.salary_max ?? "?"}`
          : undefined;
        const sourceUrl = job.url?.startsWith("http") ? job.url : `https://remoteok.com${job.url ?? ""}`;

        return {
          source: "remoteok",
          externalId: String(job.id),
          title: job.position!,
          company: job.company!,
          description,
          // RemoteOK's public feed does not consistently expose a clean
          // employer ATS URL. Only trust apply_url when it is clearly external;
          // otherwise keep the RemoteOK listing as discovery-only.
          applyUrl: validatedExternalApplyUrl(job.apply_url) ?? sourceUrl,
          sourceUrl,
          postedAt: job.date,
          salaryText: salary,
          locationText: location,
          remote: true,
          remoteScope: classifyRemoteScope(`${location} ${description}`),
          roleFamily: classifyRoleFamily(job.position!, description),
          tags: job.tags ?? []
        };
      });
  }
};
