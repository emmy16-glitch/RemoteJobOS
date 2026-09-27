import { classifyRemoteScope, classifyRoleFamily, type NormalizedJob } from "@remotejobos/core";
import type { JobSource } from "./types.js";

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
          applyUrl: job.apply_url || sourceUrl,
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
