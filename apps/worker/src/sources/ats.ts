import { classifyRemoteScope, classifyRoleFamily, looksRemote, type NormalizedJob } from "@remotejobos/core";
import type { JobSource } from "./types.js";

export type AtsProvider = "greenhouse" | "lever" | "ashby";

export interface AtsBoard {
  provider: AtsProvider;
  boardKey: string;
}

function textOnly(input: string) {
  return input.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function classifyAtsRemoteScope(title: string, location: string, description: string) {
  const normalized = location.replace(/\s+/g, " ").trim();
  const bareRemote = /^(?:remote|anywhere)$/i.test(normalized);
  const genericGlobal = /\b(global|worldwide)\b/i.test(normalized);

  // Specific structured ATS locations are stronger evidence than a broad
  // title qualifier such as "EMEA". Example: a title may say EMEA while the
  // actual hiring locations are only UK, Poland, France and Germany.
  if (normalized && !bareRemote && !genericGlobal) {
    if (/\bemea\b/i.test(normalized)) return "emea" as const;
    if (/\bafrica\b/i.test(normalized)) return "africa" as const;
    if (/\b(?:amer|north america|united states|usa)\b|remote\s*[-,]?\s*us\b|,\s*us\b/i.test(normalized)) {
      return "us-only" as const;
    }
    if (/\b(?:united kingdom|uk)\b|\blondon\b/i.test(normalized)) return "uk-only" as const;
    if (/\b(?:eu|european union)\b/i.test(normalized)) return "eu-only" as const;

    const explicit = classifyRemoteScope(normalized);
    return explicit === "unknown" ? "country-restricted" as const : explicit;
  }

  // Broad title qualifiers can narrow only generic/bare location metadata.
  if (/\bemea\b/i.test(title)) return "emea" as const;
  if (/\b(?:amer|americas|apac|asia pacific|latam|europe)\b/i.test(title)) {
    return "country-restricted" as const;
  }
  if (/\b(?:united states|usa|us-only|us only)\b/i.test(title)) return "us-only" as const;
  if (/\b(?:united kingdom|uk-only|uk only)\b/i.test(title)) return "uk-only" as const;

  if (genericGlobal) return "global" as const;

  // A bare "Remote" location is not proof of worldwide eligibility.
  const fromDescription = classifyRemoteScope(description);
  return fromDescription === "global" ? "global" as const : "unknown" as const;
}

export function greenhouseSource(boardKey: string): JobSource {
  return {
    name: `greenhouse:${boardKey}`,
    async fetchJobs(): Promise<NormalizedJob[]> {
      const response = await fetch(
        `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardKey)}/jobs?content=true`,
        { headers: { "user-agent": "RemoteJobOS/0.1 (+https://github.com/emmy16-glitch/RemoteJobOS)" } }
      );
      if (!response.ok) throw new Error(`Greenhouse ${boardKey} returned ${response.status}`);
      const payload = (await response.json()) as {
        jobs?: Array<{
          id: number;
          title?: string;
          name?: string;
          absolute_url: string;
          content?: string;
          updated_at?: string;
          location?: { name?: string };
        }>;
      };

      return (payload.jobs ?? []).flatMap((job) => {
        const title = (job.title ?? job.name ?? "").trim();
        if (!title || !job.absolute_url) return [];

        const description = textOnly(job.content ?? "");
        const location = job.location?.name ?? "";
        const remote = looksRemote(`${title} ${location} ${description}`);
        if (!remote) return [];
        return [{
          source: `greenhouse:${boardKey}`,
          externalId: String(job.id),
          title,
          company: boardKey,
          description,
          applyUrl: job.absolute_url,
          sourceUrl: job.absolute_url,
          postedAt: job.updated_at,
          locationText: location || "Remote",
          remote: true,
          remoteScope: classifyAtsRemoteScope(title, location, description),
          roleFamily: classifyRoleFamily(title, description),
          tags: []
        }];
      });
    }
  };
}

export function leverSource(boardKey: string): JobSource {
  return {
    name: `lever:${boardKey}`,
    async fetchJobs(): Promise<NormalizedJob[]> {
      const response = await fetch(
        `https://api.lever.co/v0/postings/${encodeURIComponent(boardKey)}?mode=json`,
        { headers: { "user-agent": "RemoteJobOS/0.1 (+https://github.com/emmy16-glitch/RemoteJobOS)" } }
      );
      if (!response.ok) throw new Error(`Lever ${boardKey} returned ${response.status}`);
      const jobs = (await response.json()) as Array<{
        id: string;
        text: string;
        hostedUrl: string;
        applyUrl?: string;
        descriptionPlain?: string;
        description?: string;
        workplaceType?: string;
        categories?: { location?: string; team?: string; commitment?: string };
      }>;

      return jobs.flatMap((job) => {
        const description = job.descriptionPlain ?? textOnly(job.description ?? "");
        const location = job.categories?.location ?? "";
        const remote = job.workplaceType?.toLowerCase() === "remote" ||
          looksRemote(`${job.text} ${location} ${description}`);
        if (!remote) return [];
        return [{
          source: `lever:${boardKey}`,
          externalId: job.id,
          title: job.text,
          company: boardKey,
          description,
          applyUrl: job.applyUrl ?? job.hostedUrl,
          sourceUrl: job.hostedUrl,
          locationText: location || "Remote",
          remote: true,
          remoteScope: classifyAtsRemoteScope(job.text, location, description),
          roleFamily: classifyRoleFamily(job.text, description),
          tags: [job.categories?.team, job.categories?.commitment].filter((x): x is string => Boolean(x))
        }];
      });
    }
  };
}

export function ashbySource(boardKey: string): JobSource {
  return {
    name: `ashby:${boardKey}`,
    async fetchJobs(): Promise<NormalizedJob[]> {
      const response = await fetch(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(boardKey)}`,
        { headers: { "user-agent": "RemoteJobOS/0.1 (+https://github.com/emmy16-glitch/RemoteJobOS)" } }
      );
      if (!response.ok) throw new Error(`Ashby ${boardKey} returned ${response.status}`);
      const payload = (await response.json()) as {
        jobs?: Array<{
          id: string;
          title: string;
          location?: string;
          descriptionPlain?: string;
          descriptionHtml?: string;
          jobUrl?: string;
          applyUrl?: string;
          isRemote?: boolean;
          publishedAt?: string;
          department?: string;
          employmentType?: string;
        }>;
      };

      return (payload.jobs ?? []).flatMap((job) => {
        const description = job.descriptionPlain ?? textOnly(job.descriptionHtml ?? "");
        const location = job.location ?? "";
        const remote = Boolean(job.isRemote) || looksRemote(`${job.title} ${location} ${description}`);
        if (!remote || !(job.applyUrl || job.jobUrl)) return [];
        return [{
          source: `ashby:${boardKey}`,
          externalId: job.id,
          title: job.title,
          company: boardKey,
          description,
          applyUrl: job.applyUrl ?? job.jobUrl!,
          sourceUrl: job.jobUrl ?? job.applyUrl,
          postedAt: job.publishedAt,
          locationText: location || "Remote",
          remote: true,
          remoteScope: classifyAtsRemoteScope(job.title, location, description),
          roleFamily: classifyRoleFamily(job.title, description),
          tags: [job.department, job.employmentType].filter((x): x is string => Boolean(x))
        }];
      });
    }
  };
}

export function sourceFromBoard(board: AtsBoard): JobSource {
  if (board.provider === "greenhouse") return greenhouseSource(board.boardKey);
  if (board.provider === "lever") return leverSource(board.boardKey);
  return ashbySource(board.boardKey);
}
