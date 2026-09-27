import { discoverJobs } from "./discover.js";
import { config, hasSupabase } from "./config.js";

const command = process.argv[2] ?? "health";

if (command === "discover") {
  await discoverJobs();
} else if (command === "health") {
  console.log(JSON.stringify({
    ok: true,
    service: "remotejobos-worker",
    supabaseConfigured: hasSupabase(),
    groqConfigured: Boolean(config.groqApiKey),
    dryRun: config.dryRun,
    timestamp: new Date().toISOString()
  }, null, 2));
} else {
  console.error(`Unknown command: ${command}`);
  process.exitCode = 1;
}
