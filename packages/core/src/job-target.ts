const TITLE_NOISE = new Set(["remote", "role", "position", "opening", "job", "jobs"]);
const COMPANY_SUFFIXES = new Set([
  "inc", "llc", "ltd", "limited", "plc", "corp", "corporation", "company",
  "technologies", "technology", "solutions", "systems", "group", "global"
]);

function words(value: string): string[] {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

export function normalizedCompanyKey(value: string): string {
  return words(value)
    .filter((word) => !COMPANY_SUFFIXES.has(word))
    .join("");
}

function normalizedTitleTokens(value: string): string[] {
  return words(value).filter((word) => !TITLE_NOISE.has(word));
}

export function jobTitleSimilarity(left: string, right: string): number {
  const a = normalizedTitleTokens(left);
  const b = normalizedTitleTokens(right);
  if (!a.length || !b.length) return 0;
  if (a.join(" ") === b.join(" ")) return 1;

  const sa = new Set(a);
  const sb = new Set(b);
  const intersection = [...sa].filter((token) => sb.has(token)).length;
  const union = new Set([...sa, ...sb]).size;
  const containment = intersection / Math.min(sa.size, sb.size);
  const jaccard = union ? intersection / union : 0;
  return containment * 0.65 + jaccard * 0.35;
}

const SENIORITY_WORDS = new Set([
  "intern", "internship", "junior", "associate", "senior", "staff",
  "principal", "lead", "manager", "director", "head", "vp"
]);

export function isStrongJobTitleMatch(left: string, right: string): boolean {
  const a = normalizedTitleTokens(left);
  const b = normalizedTitleTokens(right);
  const aSeniority = new Set(a.filter((token) => SENIORITY_WORDS.has(token)));
  const bSeniority = new Set(b.filter((token) => SENIORITY_WORDS.has(token)));

  if (
    aSeniority.size &&
    bSeniority.size &&
    ![...aSeniority].some((token) => bSeniority.has(token))
  ) {
    return false;
  }

  return jobTitleSimilarity(left, right) >= 0.9;
}

function slugify(value: string): string {
  return words(value).join("-");
}

export function atsBoardKeyCandidates(
  company: string,
  sourceUrl?: string | null
): string[] {
  const candidates: string[] = [];

  if (sourceUrl) {
    try {
      const url = new URL(sourceUrl);
      const match = url.pathname.match(/\/companies\/([^/]+)(?:\/|$)/i);
      if (match?.[1]) candidates.push(decodeURIComponent(match[1]).toLowerCase());
    } catch {
      // Ignore malformed discovery URLs.
    }
  }

  const slug = slugify(company);
  const compact = normalizedCompanyKey(company);
  if (slug) candidates.push(slug);
  if (compact) {
    candidates.push(compact, compact + "career", compact + "careers", compact + "jobs");
  }

  for (const current of [...candidates]) {
    const cleaned = current.replace(/[^a-z0-9_-]+/g, "");
    if (cleaned) candidates.push(cleaned, cleaned.replace(/[-_]/g, ""));
  }

  return [...new Set(candidates)]
    .filter((value) => /^[a-z0-9][a-z0-9_-]{0,79}$/i.test(value))
    .slice(0, 10);
}
