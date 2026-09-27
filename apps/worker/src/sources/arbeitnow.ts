import { classifyRemoteScope, classifyRoleFamily, type NormalizedJob } from "@remotejobos/core";
import type { JobSource } from "./types.js";

type ArbeitnowJob = {
  slug: string;
  company_name: string;
  title: string;
  description: string;
  remote: boolean;
  url: string;
  tags?: string[];
  job_types?: string[];
  location?: string;
  created_at?: number;
};

export const arbeitnowSource: JobSource = {
  name: "arbeitnow",
  async fetchJobs(): Promise<NormalizedJob[]> {
    const response = await fetch("https://www.arbeitnow.com/api/job-board-api", {
      headers: { "user-agent": "RemoteJobOS/0.1 (+https://github.com/emmy16-glitch/RemoteJobOS)" }
    });
    if (!response.ok) throw new Error(`Arbeitnow returned ${response.status}`);
    const payload = (await response.json()) as { data?: ArbeitnowJob[] };

    return (payload.data ?? [])
      .filter((job) => job.remote)
      .map((job) => {
        const location = job.location ?? "Remote";
        return {
          source: "arbeitnow",
          externalId: job.slug,
          title: job.title,
          company: job.company_name,
          description: job.description ?? "",
          applyUrl: job.url,
          sourceUrl: job.url,
          postedAt: job.created_at ? new Date(job.created_at * 1000).toISOString() : undefined,
          locationText: location,
          remote: true,
          remoteScope: classifyRemoteScope(`${location} ${job.description ?? ""}`),
          roleFamily: classifyRoleFamily(job.title, job.description ?? ""),
          tags: [...(job.tags ?? []), ...(job.job_types ?? [])]
        };
      });
  }
};
