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

  // Optional structured fields. These improve layout and ATS readability while
  // keeping the fact itself fully user-verified.
  location?: string;
  startDate?: string;
  endDate?: string;
  url?: string;
  highlights?: string[];
  technologies?: string[];
  evidenceUrls?: string[];
}

export interface ResumePlanItem {
  factId: string;
  relevance: number;
  matchedTerms: string[];
  reason: string;
}

export interface ResumePlan {
  strategy: "verified-facts-v2";
  roleFamily: RoleFamily;
  selected: ResumePlanItem[];
  omittedFactIds: string[];
}

export interface ResumeQualityReport {
  score: number;
  passed: boolean;
  selectedFactCount: number;
  matchedJobTerms: string[];
  warnings: string[];
}

const stopWords = new Set([
  "and", "the", "for", "with", "from", "that", "this", "you", "your", "our",
  "are", "will", "job", "role", "work", "remote", "team", "have", "has", "into",
  "who", "what", "where", "when", "using", "use", "years", "experience", "about",
  "their", "they", "them", "but", "not", "can", "all", "any", "per", "day"
]);

const sectionCaps: Record<CareerFactKind, number> = {
  experience: 4,
  project: 4,
  skill: 3,
  education: 2,
  certification: 2,
  achievement: 2
};

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

function factText(fact: VerifiedCareerFact): string {
  return [
    fact.title,
    fact.organization ?? "",
    fact.body,
    fact.location ?? "",
    ...(fact.highlights ?? []),
    ...(fact.technologies ?? []),
    ...fact.keywords
  ].join(" ");
}

function scoreFact(jobTerms: Set<string>, job: NormalizedJob, fact: VerifiedCareerFact) {
  const factTerms = terms(factText(fact));
  const matchedTerms = [...factTerms].filter((term) => jobTerms.has(term));
  let relevance = matchedTerms.length * 4;

  if (fact.roleFamilies?.includes(job.roleFamily)) relevance += 14;
  if (fact.kind === "experience") relevance += 5;
  if (fact.kind === "project") relevance += 3;
  if (fact.kind === "education") relevance += 7;
  if (fact.kind === "certification") relevance += 4;
  if (fact.kind === "skill") relevance += matchedTerms.length ? 5 : 0;
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

  const selected: typeof ranked = [];
  const selectedIds = new Set<string>();
  const counts = new Map<CareerFactKind, number>();

  const add = (entry: (typeof ranked)[number]) => {
    if (selectedIds.has(entry.fact.id)) return false;
    selected.push(entry);
    selectedIds.add(entry.fact.id);
    counts.set(entry.fact.kind, (counts.get(entry.fact.kind) ?? 0) + 1);
    return true;
  };

  // User-declared required facts always win.
  for (const entry of ranked.filter((item) => item.fact.alwaysInclude)) add(entry);

  // Education is a baseline resume section. Keep the strongest verified item
  // even when the job description does not repeat the degree title.
  const topEducation = ranked.find((entry) => entry.fact.kind === "education");
  if (topEducation) add(topEducation);

  // Prefer at least one verified experience item when one exists.
  const topExperience = ranked.find((entry) => entry.fact.kind === "experience");
  if (topExperience) add(topExperience);

  for (const entry of ranked) {
    if (selected.length >= Math.max(maxFacts, selected.filter((item) => item.fact.alwaysInclude).length)) break;
    if (selectedIds.has(entry.fact.id) || entry.relevance <= 0) continue;

    const currentCount = counts.get(entry.fact.kind) ?? 0;
    if (currentCount >= sectionCaps[entry.fact.kind]) continue;
    add(entry);
  }

  return {
    strategy: "verified-facts-v2",
    roleFamily: job.roleFamily,
    selected: selected.map((entry) => ({
      factId: entry.fact.id,
      relevance: entry.relevance,
      matchedTerms: entry.matchedTerms,
      reason: entry.fact.alwaysInclude
        ? "Required verified career fact"
        : entry.fact.kind === "education" && entry.fact.id === topEducation?.fact.id
          ? "Baseline verified education"
          : entry.fact.kind === "experience" && entry.fact.id === topExperience?.fact.id
            ? "Baseline verified experience"
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

export function auditResumePlan(
  job: NormalizedJob,
  plan: ResumePlan,
  facts: VerifiedCareerFact[]
): ResumeQualityReport {
  const selectedFacts = materializeResumeFacts(plan, facts);
  const selectedTerms = new Set(selectedFacts.flatMap((fact) => [...terms(factText(fact))]));
  const jobTerms = [...terms([job.title, job.description.slice(0, 12000), ...job.tags].join(" "))];
  const matchedJobTerms = jobTerms.filter((term) => selectedTerms.has(term));

  const hasExperience = selectedFacts.some((fact) => fact.kind === "experience");
  const hasEducation = selectedFacts.some((fact) => fact.kind === "education");
  const hasRelevantFact = plan.selected.some((entry) => entry.matchedTerms.length > 0);

  const warnings: string[] = [];
  if (!hasExperience) warnings.push("No verified experience fact selected.");
  if (!hasEducation) warnings.push("No verified education fact selected.");
  if (!hasRelevantFact) warnings.push("Selected facts have weak direct overlap with the job description.");
  if (selectedFacts.length > 14) warnings.push("CV contains too many facts for a focused 1–2 page resume.");

  const coverage = jobTerms.length
    ? Math.min(35, Math.round((matchedJobTerms.length / Math.min(jobTerms.length, 45)) * 35))
    : 0;
  const structure = (hasExperience ? 20 : 0) + (hasEducation ? 15 : 0);
  const relevance = hasRelevantFact ? 20 : 0;
  const focus = selectedFacts.length >= 4 && selectedFacts.length <= 12 ? 10 : 5;
  const score = Math.min(100, coverage + structure + relevance + focus);

  return {
    score,
    passed: score >= 55 && selectedFacts.length > 0,
    selectedFactCount: selectedFacts.length,
    matchedJobTerms: matchedJobTerms.slice(0, 30),
    warnings
  };
}
