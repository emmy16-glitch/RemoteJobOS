import { remotiveSource } from "./sources/remotive.js";
import { remoteOkSource } from "./sources/remoteok.js";
import { arbeitnowSource } from "./sources/arbeitnow.js";
import { himalayasSource } from "./sources/himalayas.js";
import { persistJobs } from "./persist.js";
import { loadRegisteredAtsSources } from "./source-registry.js";
import { recordSourceRun, sourceAvailable } from "./source-health.js";
import type { JobSource } from "./sources/types.js";

const builtInSources: JobSource[] = [remotiveSource, remoteOkSource, arbeitnowSource, himalayasSource];

async function getSources(): Promise<JobSource[]> {
  const registered = await loadRegisteredAtsSources().catch((error) => {
    console.error("[discover] ATS registry unavailable; continuing with built-in sources", error);
    return [];
  });

  const all = [...builtInSources, ...registered];
  const unique = new Map(all.map((source) => [source.name, source]));
  return [...unique.values()];
}

export async function discoverJobs() {
  let total = 0;
  let skipped = 0;
  const sources = await getSources();

  for (const source of sources) {
    if (!(await sourceAvailable(source.name, source.minimumIntervalMinutes ?? 0))) {
      skipped += 1;
      console.warn(`[discover] ${source.name}: unavailable by circuit/cadence policy, skipping this run`);
      continue;
    }

    const startedAt = Date.now();

    try {
      console.log(`[discover] ${source.name}: starting`);
      const jobs = await source.fetchJobs();
      const remoteJobs = jobs.filter((job) => job.remote);
      await persistJobs(remoteJobs);
      total += remoteJobs.length;

      await recordSourceRun({
        source: source.name,
        success: true,
        jobCount: remoteJobs.length,
        durationMs: Date.now() - startedAt
      });

      console.log(`[discover] ${source.name}: ${remoteJobs.length} remote jobs normalized`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await recordSourceRun({
        source: source.name,
        success: false,
        jobCount: 0,
        durationMs: Date.now() - startedAt,
        error: message
      });

      console.error(`[discover] ${source.name}: failed`, error);
    }
  }

  console.log(
    `[discover] complete: ${total} jobs processed from ${sources.length} sources; ${skipped} circuit-skipped`
  );
  return total;
}
