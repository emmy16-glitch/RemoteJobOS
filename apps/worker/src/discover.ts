import { remotiveSource } from "./sources/remotive.js";
import { persistJobs } from "./persist.js";

const sources = [remotiveSource];

export async function discoverJobs() {
  let total = 0;
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
  console.log(`[discover] complete: ${total} jobs processed`);
  return total;
}
