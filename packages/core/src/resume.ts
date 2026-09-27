import type { NormalizedJob, RoleFamily } from "./types.js";

export type CareerFactKind =
  | "experience"
  | "project"
  | "education"
  | "certification"
  | "skill"
  | "achievement";

export interface VerifiedCareerFact {
  id: string;
  kind: CareerFactKind;
  title: string;
  organization?: string;
  body: string;
  keywords: string[];
  roleFamilies?: RoleFamily[];
  alwaysInclude?: boolean;
}

export interface ResumePlanItem {
  factId: string;
  relevance: number;
  matchedTerms: string[];
  reason: string;
}

export interface ResumePlan {
  strategy: "verified-facts-v1";
  roleFamily: RoleFamily;
  selected: ResumePlanItem[];
  omittedFactIds: string[];
}

const stopWords = new Set([
  "and", "the", "for", "with", "from", "that", "this", "you", "your", "our",
  "are", "will", "job", "role", "work", "remote", "team", "have", "has", "into",
  "who", "what", "where", "when", "using", "use", "years", "experience"
]);

function terms(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9+#.]+/g, " ")
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length > 2 && !stopWords.has(term))
  );
}

function scoreFact(jobTerms: Set<string>, job: NormalizedJob, fact: VerifiedCareerFact) {
  const factTerms = terms([
    fact.title,
    fact.organization ?? "",
    fact.body,
    ...fact.keywords
  ].join(" "));

  const matchedTerms = [...factTerms].filter((term) => jobTerms.has(term));
  let relevance = matchedTerms.length * 4;

  if (fact.roleFamilies?.includes(job.roleFamily)) relevance += 12;
  if (fact.kind === "experience" || fact.kind === "project") relevance += 2;
  if (fact.alwaysInclude) relevance += 100;

  return { relevance, matchedTerms };
}

export function planResume(
  job: NormalizedJob,
  facts: VerifiedCareerFact[],
  maxFacts = 12
): ResumePlan {
  const jobTerms = terms([
    job.title,
    job.description.slice(0, 12000),
    ...job.tags
  ].join(" "));

  const ranked = facts
    .map((fact) => ({ fact, ...scoreFact(jobTerms, job, fact) }))
    .sort((a, b) =>
      b.relevance - a.relevance ||
      Number(Boolean(b.fact.alwaysInclude)) - Number(Boolean(a.fact.alwaysInclude)) ||
      a.fact.id.localeCompare(b.fact.id)
    );

  const required = ranked.filter((entry) => entry.fact.alwaysInclude);
  const relevant = ranked.filter((entry) => !entry.fact.alwaysInclude && entry.relevance > 0);
  const selectedEntries = [...required, ...relevant]
    .filter((entry, index, all) => all.findIndex((candidate) => candidate.fact.id === entry.fact.id) === index)
    .slice(0, Math.max(maxFacts, required.length));

  const selectedIds = new Set(selectedEntries.map((entry) => entry.fact.id));

  return {
    strategy: "verified-facts-v1",
    roleFamily: job.roleFamily,
    selected: selectedEntries.map((entry) => ({
      factId: entry.fact.id,
      relevance: entry.relevance,
      matchedTerms: entry.matchedTerms,
      reason: entry.fact.alwaysInclude
        ? "Required verified career fact"
        : entry.fact.roleFamilies?.includes(job.roleFamily)
          ? "Verified fact matches role family and job language"
          : "Verified fact matches job language"
    })),
    omittedFactIds: facts.filter((fact) => !selectedIds.has(fact.id)).map((fact) => fact.id)
  };
}

export function materializeResumeFacts(
  plan: ResumePlan,
  facts: VerifiedCareerFact[]
): VerifiedCareerFact[] {
  const byId = new Map(facts.map((fact) => [fact.id, fact]));
  return plan.selected.map((entry) => {
    const fact = byId.get(entry.factId);
    if (!fact) throw new Error(`Resume plan references unknown fact: ${entry.factId}`);
    return fact;
  });
}
