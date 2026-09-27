import { discoverJobs } from "./discover.js";
import { matchJobs } from "./match.js";
import { prepareCvPlans } from "./prepare-cvs.js";
import { promoteStrongMatchesToApplications } from "./promote-applications.js";
import { processApplicationReviewQueue } from "./process-application-queue.js";
import { runOneApplication, type ApplicationRunMode } from "./apply/run-one.js";
import { config, hasOptionalEnrichment, hasSupabase } from "./config.js";

const command = process.argv[2] ?? "health";

if (command === "discover") {
  await discoverJobs();
} else if (command === "match") {
  await matchJobs();
} else if (command === "prepare-cvs") {
  await prepareCvPlans();
} else if (command === "promote-applications") {
  await promoteStrongMatchesToApplications();
} else if (command === "process-application-reviews") {
  const maxTasks = Number(process.argv[3] ?? process.env.REMOTEJOBOS_MAX_REVIEW_TASKS ?? "3");
  await processApplicationReviewQueue(Number.isFinite(maxTasks) ? Math.max(1, Math.min(10, maxTasks)) : 3);
} else if (command === "apply-one") {
  const applicationId = process.argv[3] ?? process.env.REMOTEJOBOS_APPLICATION_ID ?? "";
  const mode = (process.argv[4] ?? process.env.REMOTEJOBOS_APPLICATION_MODE ?? "dry-run") as ApplicationRunMode;
  const outcome = await runOneApplication(applicationId, mode);
  console.log(JSON.stringify(outcome, null, 2));
  if (outcome.status === "failed") process.exitCode = 1;
} else if (command === "health") {
  console.log(JSON.stringify({
    ok: true,
    service: "remotejobos-worker",
    supabaseConfigured: hasSupabase(),
    dryRun: config.dryRun,
    enrichment: {
      enabled: hasOptionalEnrichment(),
      provider: config.enrichmentProvider
    },
    timestamp: new Date().toISOString()
  }, null, 2));
} else {
  console.error(`Unknown command: ${command}`);
  process.exitCode = 1;
}
