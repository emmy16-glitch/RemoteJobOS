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

  return registry;
}
