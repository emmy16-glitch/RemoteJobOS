import { classifyRemoteScope, classifyRoleFamily, type NormalizedJob } from "@remotejobos/core";
import type { JobSource } from "./types.js";

function remotiveRemoteScope(location: string, description: string) {
  const explicit = classifyRemoteScope(`${location} ${description}`);
  if (explicit !== "unknown") return explicit;

  const normalized = location.trim().toLowerCase();
  if (!normalized || /^(remote|anywhere|worldwide|global|any location)$/i.test(normalized)) {
    return normalized && /anywhere|worldwide|global/i.test(normalized) ? "global" : "unknown";
  }

  // Remotive's candidate_required_location is itself an eligibility field.
  // If it names countries/regions but none of our broad-scope patterns match,
  // treat it as restricted rather than assuming worldwide eligibility.
  return "country-restricted";
}

type RemotiveJob = {
  id: number;
  url: string;
  title: string;
  company_name: string;
  category: string;
  candidate_required_location: string;
  publication_date: string;
  salary: string;
  description: string;
  tags: string[];
};

export const remotiveSource: JobSource = {
  name: "remotive",
  async fetchJobs(): Promise<NormalizedJob[]> {
    const response = await fetch("https://remotive.com/api/remote-jobs", {
      headers: { "user-agent": "RemoteJobOS/0.1 (+https://github.com/emmy16-glitch/RemoteJobOS)" }
    });
    if (!response.ok) throw new Error(`Remotive returned ${response.status}`);
    const payload = (await response.json()) as { jobs: RemotiveJob[] };

    return payload.jobs.map((job) => {
      const scopeText = `${job.candidate_required_location} ${job.description}`;
      const inferredScope = classifyRemoteScope(scopeText);
      const location = job.candidate_required_location.trim();
      const remoteScope =
        inferredScope !== "unknown"
          ? inferredScope
          : /^(worldwide|global|anywhere|any location)$/i.test(location)
            ? "global"
            : location && !/^remote$/i.test(location)
              ? "country-restricted"
              : "unknown";
      return {
        source: "remotive",
        externalId: String(job.id),
        title: job.title,
        company: job.company_name,
        description: job.description,
        applyUrl: job.url,
        sourceUrl: job.url,
        postedAt: job.publication_date,
        salaryText: job.salary || undefined,
        locationText: job.candidate_required_location || "Remote",
        remote: true,
        remoteScope: remotiveRemoteScope(job.candidate_required_location, job.description),
        roleFamily: classifyRoleFamily(job.title, job.description),
        tags: [job.category, ...(job.tags ?? [])].filter(Boolean)
      };
    });
  }
};
