import type { NormalizedJob } from "@remotejobos/core";

export interface JobSource {
  name: string;
  fetchJobs(): Promise<NormalizedJob[]>;
}
