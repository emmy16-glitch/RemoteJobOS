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

  registry.register(new PlaywrightAtsAdapter("workday", [
    /myworkdayjobs\.com/i,
    /myworkdaysite\.com/i
  ]));

  registry.register(new PlaywrightAtsAdapter("smartrecruiters", [
    /jobs\.smartrecruiters\.com/i
  ]));

  registry.register(new PlaywrightAtsAdapter("workable", [
    /apply\.workable\.com/i
  ]));

  registry.register(new PlaywrightAtsAdapter("icims", [
    /icims\.com/i
  ]));

  registry.register(new PlaywrightAtsAdapter("recruitee", [
    /recruitee\.com/i
  ]));

  registry.register(new PlaywrightAtsAdapter("teamtailor", [
    /teamtailor\.com/i
  ]));

  registry.register(new PlaywrightAtsAdapter("personio", [
    /jobs\.personio\.(?:com|de)/i
  ]));

  registry.register(new PlaywrightAtsAdapter("bamboohr", [
    /bamboohr\.com/i
  ]));

  registry.register(new PlaywrightAtsAdapter("jobvite", [
    /jobs\.jobvite\.com/i
  ]));

  registry.register(new PlaywrightAtsAdapter("successfactors", [
    /successfactors\.(?:com|eu)/i
  ]));

  registry.register(new PlaywrightAtsAdapter("taleo-oracle", [
    /taleo\.net/i,
    /oraclecloud\.com/i
  ]));

  registry.register(new PlaywrightAtsAdapter("eightfold", [
    /eightfold\.ai/i
  ]));

  registry.register(new PlaywrightAtsAdapter("job-board-redirect", [
    /remoteok\.com/i,
    /arbeitnow\.(?:com|ch|co\.uk|fr)/i,
    /remotive\.com/i,
    /himalayas\.app/i
  ], true));

  // Guarded fallback for ordinary web application forms. This path still
  // performs the same dry-run, DOM verification, CAPTCHA detection,
  // submission fencing and post-submit confirmation checks.
  registry.register(new PlaywrightAtsAdapter("generic-web-form", [
    /^https?:\/\//i
  ]));

  return registry;
}
