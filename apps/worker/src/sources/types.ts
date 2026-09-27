import type { NormalizedJob } from "@remotejobos/core";

export interface JobSource {
  name: string;
  minimumIntervalMinutes?: number;
  fetchJobs(): Promise<NormalizedJob[]>;
}
