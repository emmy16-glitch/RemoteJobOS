import { discoverJobs } from "./discover.js";
import { matchJobs } from "./match.js";\nimport { prepareCvPlans } from "./prepare-cvs.js";
import { config, hasOptionalEnrichment, hasSupabase } from "./config.js";

const command = process.argv[2] ?? "health";

if (command === "discover") {
  await discoverJobs();
} else if (command === "match") {
  await matchJobs();
} else if (command === "prepare-cvs") {\n  await prepareCvPlans();\n} else if (command === "health") {
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
