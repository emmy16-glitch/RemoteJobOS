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

  registry.register(new PlaywrightAtsAdapter("workable", [
    /apply\.workable\.com/i
  ]));

  registry.register(new PlaywrightAtsAdapter("smartrecruiters", [
    /(?:jobs|careers)\.smartrecruiters\.com/i,
    /smartrecruiters\.com/i
  ]));

  registry.register(new PlaywrightAtsAdapter("workday", [
    /myworkdayjobs\.com/i,
    /workdayjobs\.com/i
  ]));

  registry.register(new PlaywrightAtsAdapter("bamboohr", [
    /bamboohr\.com\/careers/i,
    /bamboohr\.com\/jobs/i
  ]));

  registry.register(new PlaywrightAtsAdapter("teamtailor", [
    /teamtailor\.com/i
  ]));

  registry.register(new PlaywrightAtsAdapter("icims", [
    /icims\.com\/jobs/i,
    /icims\.com.*careers/i
  ]));

  registry.register(new PlaywrightAtsAdapter("jobvite", [
    /jobs\.jobvite\.com/i,
    /jobvite\.com.*job/i
  ]));

  registry.register(new PlaywrightAtsAdapter("taleo", [
    /taleo\.net/i
  ]));

  return registry;
}
