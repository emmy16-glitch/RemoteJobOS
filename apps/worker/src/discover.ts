import { remotiveSource } from "./sources/remotive.js";
import { remoteOkSource } from "./sources/remoteok.js";
import { arbeitnowSource } from "./sources/arbeitnow.js";
import { persistJobs } from "./persist.js";
import { loadRegisteredAtsSources } from "./source-registry.js";
import type { JobSource } from "./sources/types.js";

const builtInSources: JobSource[] = [remotiveSource, remoteOkSource, arbeitnowSource];

async function getSources(): Promise<JobSource[]> {
  const registered = await loadRegisteredAtsSources().catch((error) => {
    console.error("[discover] ATS registry unavailable; continuing with built-in sources", error);
    return [];
  });

  return [...builtInSources, ...registered];
}

export async function discoverJobs() {
  let total = 0;
  const sources = await getSources();

  for (const source of sources) {
    try {
      console.log(`[discover] ${source.name}: starting`);
      const jobs = await source.fetchJobs();
      const remoteJobs = jobs.filter((job) => job.remote);
      await persistJobs(remoteJobs);
      total += remoteJobs.length;
      console.log(`[discover] ${source.name}: ${remoteJobs.length} remote jobs normalized`);
    } catch (error) {
      console.error(`[discover] ${source.name}: failed`, error);
    }
  }

  console.log(`[discover] complete: ${total} jobs processed from ${sources.length} sources`);
  return total;
}
