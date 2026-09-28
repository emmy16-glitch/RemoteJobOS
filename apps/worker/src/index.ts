import { discoverJobs } from "./discover.js";
import { matchJobs } from "./match.js";
import { prepareCvPlans } from "./prepare-cvs.js";
import {
  syncApplications,
  processApplicationTasks,
  processApprovedSubmission
} from "./application-queue.js";
import { runOneApplication, type ApplicationRunMode } from "./apply/run-one.js";
import { config, hasOptionalEnrichment, hasSupabase } from "./config.js";
import { decideHarnessApproval } from "./agent-harness.js";

const command = process.argv[2] ?? "health";

if (command === "discover") {
  await discoverJobs();
} else if (command === "match") {
  await matchJobs();
} else if (command === "prepare-cvs") {
  await prepareCvPlans();
} else if (command === "sync-applications") {
  await syncApplications();
} else if (command === "process-application-tasks") {
  const maxTasks = Number(process.argv[3] ?? process.env.REMOTEJOBOS_MAX_REVIEW_TASKS ?? "3");
  await processApplicationTasks(Number.isFinite(maxTasks) ? maxTasks : 3);
} else if (command === "apply-one") {
  const applicationId = process.argv[3] ?? process.env.REMOTEJOBOS_APPLICATION_ID ?? "";
  const mode = (process.argv[4] ?? process.env.REMOTEJOBOS_APPLICATION_MODE ?? "dry-run") as ApplicationRunMode;
  const outcome = await runOneApplication(applicationId, mode);
  console.log(JSON.stringify(outcome, null, 2));
  if (outcome.status === "failed") process.exitCode = 1;
} else if (command === "decide-approval") {
  const approvalId = process.argv[3] ?? "";
  const decision = process.argv[4];
  if (!approvalId) throw new Error("approvalId is required");
  if (decision !== "approved" && decision !== "denied") {
    throw new Error("decision must be approved or denied");
  }
  const result = await decideHarnessApproval(approvalId, decision);
  console.log(JSON.stringify(result, null, 2));
} else if (command === "process-approved-submission") {
  const approvalId = process.argv[3] ?? "";
  if (!approvalId) throw new Error("approvalId is required");
  const processed = await processApprovedSubmission(approvalId);
  console.log(JSON.stringify({ processed, approvalId }, null, 2));
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
