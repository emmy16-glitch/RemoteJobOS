import type { RemoteScope } from "./types.js";

const patterns: Array<[RemoteScope, RegExp]> = [
  ["us-only", /\b(us|u\.s\.|united states)\s*(only|residents?|based|work authorization)|must be (?:located|based) in (?:the )?(?:us|united states)/i],
  ["eu-only", /\b(eu|european union)\s*(only|residents?|based)|must be (?:located|based) in (?:the )?eu\b/i],
  ["uk-only", /\b(?:uk|united kingdom)\s*(only|residents?|based)|must be (?:located|based) in (?:the )?uk\b/i],
  ["emea", /\bemea\b/i],
  ["africa", /\bafrica(?:n)?\s*(?:time zones?|residents?|based)?\b/i],
  ["global", /\b(?:worldwide|work from anywhere|anywhere in the world|global remote|remote globally)\b/i]
];

export function classifyRemoteScope(text: string): RemoteScope {
  for (const [scope, pattern] of patterns) {
    if (pattern.test(text)) return scope;
  }
  return "unknown";
}

export function looksRemote(text: string): boolean {
  return /\b(remote|work from home|work from anywhere|distributed)\b/i.test(text);
}
