import { AdapterRegistry } from "./registry.js";
import { PlaywrightAtsAdapter } from "./playwright-adapter.js";

export function createDefaultAdapterRegistry(): AdapterRegistry {
  const registry = new AdapterRegistry();

  registry.register(new PlaywrightAtsAdapter("greenhouse", [
    /(?:job-boards|boards)\.greenhouse\.io/i,
    /greenhouse\.com/i
  ]));

  registry.register(new PlaywrightAtsAdapter("lever", [
    /jobs\.lever\.co/i,
    /lever\.co/i
  ]));

  registry.register(new PlaywrightAtsAdapter("ashby", [
    /jobs\.ashbyhq\.com/i,
    /ashbyhq\.com/i
  ]));

  registry.register(new PlaywrightAtsAdapter("job-board-redirect", [
    /remoteok\.com/i,
    /arbeitnow\.(?:com|ch|co\.uk|fr)/i,
    /remotive\.com/i
  ], true));

  // Final guarded fallback for simple application forms on ATS domains that
  // do not yet have a dedicated adapter. The adapter still performs a dry-run
  // first, validates filled DOM values, blocks CAPTCHA/anti-bot challenges,
  // and only reaches live submit through the existing submission fence.
  registry.register(new PlaywrightAtsAdapter("generic-web-form", [
    /^https?:\/\//i
  ]));

  return registry;
}
