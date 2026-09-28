import type { CareerProfile, JobScore, NormalizedJob } from "./types.js";

const seniorityRank = { intern: 0, entry: 1, junior: 2, mid: 3, senior: 4 } as const;

const euCountries = new Set([
  "austria", "belgium", "bulgaria", "croatia", "cyprus", "czechia", "czech republic",
  "denmark", "estonia", "finland", "france", "germany", "greece", "hungary", "ireland",
  "italy", "latvia", "lithuania", "luxembourg", "malta", "netherlands", "poland",
  "portugal", "romania", "slovakia", "slovenia", "spain", "sweden"
]);

const africaCountries = new Set([
  "algeria", "angola", "benin", "botswana", "burkina faso", "burundi", "cabo verde",
  "cape verde", "cameroon", "central african republic", "chad", "comoros",
  "democratic republic of the congo", "congo", "djibouti", "egypt", "equatorial guinea",
  "eritrea", "eswatini", "ethiopia", "gabon", "gambia", "ghana", "guinea", "guinea bissau",
  "ivory coast", "cote d ivoire", "kenya", "lesotho", "liberia", "libya", "madagascar",
  "malawi", "mali", "mauritania", "mauritius", "morocco", "mozambique", "namibia",
  "niger", "nigeria", "rwanda", "sao tome and principe", "senegal", "seychelles",
  "sierra leone", "somalia", "south africa", "south sudan", "sudan", "tanzania",
  "togo", "tunisia", "uganda", "zambia", "zimbabwe"
]);

const middleEastCountries = new Set([
  "bahrain", "iran", "iraq", "israel", "jordan", "kuwait", "lebanon", "oman",
  "palestine", "qatar", "saudi arabia", "syria", "turkey", "united arab emirates", "yemen"
]);

function normalizeGeo(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function countryAliases(country: string): string[] {
  const normalized = normalizeGeo(country);
  const aliases = new Set([normalized]);

  if (["us", "usa", "u s", "united states", "united states of america"].includes(normalized)) {
    ["us", "usa", "united states", "united states of america"].forEach((item) => aliases.add(item));
  }

  if (["uk", "u k", "united kingdom", "great britain", "britain"].includes(normalized)) {
    ["uk", "united kingdom", "great britain", "britain"].forEach((item) => aliases.add(item));
  }

  return [...aliases];
}

function inferredSeniority(title: string): keyof typeof seniorityRank {
  if (/principal|staff|lead|senior|sr\.?\b/i.test(title)) return "senior";
  if (/mid|intermediate/i.test(title)) return "mid";
  if (/junior|jr\.?\b|graduate|entry/i.test(title)) return "junior";
  if (/intern|internship/i.test(title)) return "intern";
  return "entry";
}

function geographicEligibility(
  job: NormalizedJob,
  profile: CareerProfile
): { allowed: boolean; forceReview: boolean; reason: string } {
  if (job.remoteScope === "global") {
    return { allowed: true, forceReview: false, reason: "Worldwide remote eligibility" };
  }

  if (job.remoteScope === "unknown") {
    return {
      allowed: true,
      forceReview: false,
      reason: "Remote geography not explicitly restricted"
    };
  }

  const country = normalizeGeo(profile.country ?? "");
  if (!country) {
    return {
      allowed: true,
      forceReview: true,
      reason: "Remote geography is restricted but profile country is missing"
    };
  }

  const aliases = countryAliases(country);
  const location = normalizeGeo(job.locationText ?? "");

  if (job.remoteScope === "us-only") {
    const allowed = aliases.some((alias) =>
      ["us", "usa", "united states", "united states of america"].includes(alias)
    );
    return {
      allowed,
      forceReview: false,
      reason: allowed ? "US-only remote scope matches profile" : "US-only remote scope does not match profile country"
    };
  }

  if (job.remoteScope === "uk-only") {
    const allowed = aliases.some((alias) =>
      ["uk", "united kingdom", "great britain", "britain"].includes(alias)
    );
    return {
      allowed,
      forceReview: false,
      reason: allowed ? "UK-only remote scope matches profile" : "UK-only remote scope does not match profile country"
    };
  }

  if (job.remoteScope === "eu-only") {
    const allowed = euCountries.has(country);
    return {
      allowed,
      forceReview: false,
      reason: allowed ? "EU-only remote scope matches profile" : "EU-only remote scope does not match profile country"
    };
  }

  if (job.remoteScope === "africa") {
    const allowed = africaCountries.has(country);
    return {
      allowed,
      forceReview: false,
      reason: allowed ? "Africa remote scope matches profile" : "Africa remote scope does not match profile country"
    };
  }

  if (job.remoteScope === "emea") {
    const allowed =
      africaCountries.has(country) ||
      euCountries.has(country) ||
      middleEastCountries.has(country) ||
      ["united kingdom", "uk", "norway", "switzerland", "iceland", "liechtenstein"].includes(country);

    return {
      allowed,
      forceReview: false,
      reason: allowed ? "EMEA remote scope matches profile" : "EMEA remote scope does not match profile country"
    };
  }

  if (job.remoteScope === "country-restricted") {
    if (!location) {
      return {
        allowed: true,
        forceReview: true,
        reason: "Country-restricted role has no machine-readable location list"
      };
    }

    const allowed = aliases.some((alias) => location.includes(alias));
    return {
      allowed,
      forceReview: false,
      reason: allowed
        ? "Country restriction matches profile"
        : "Country restriction does not match profile country"
    };
  }

  return { allowed: true, forceReview: true, reason: "Remote eligibility needs review" };
}

export function scoreJob(job: NormalizedJob, profile: CareerProfile): JobScore {
  const reasons: string[] = [];
  const missingSignals: string[] = [];
  const breakdown = { remote: 0, role: 0, skills: 0, seniority: 0, eligibility: 0 };

  if (!job.remote) {
    return { total: 0, decision: "reject", reasons: ["Not a remote role"], missingSignals, breakdown };
  }

  breakdown.remote = 20;
  reasons.push("Remote role");

  const geography = geographicEligibility(job, profile);
  reasons.push(geography.reason);

  if (!geography.allowed) {
    return {
      total: 20,
      decision: "reject",
      reasons,
      missingSignals,
      breakdown
    };
  }

  if (profile.roleFamilies.includes(job.roleFamily)) {
    breakdown.role = 20;
    reasons.push(`Target role family: ${job.roleFamily}`);
  } else {
    breakdown.role = 8;
    reasons.push("Adjacent technical role");
  }

  const text = `${job.title} ${job.description} ${job.tags.join(" ")}`.toLowerCase();
  const matchedSkills = profile.skills.filter((skill) => text.includes(skill.toLowerCase()));
  breakdown.skills = Math.min(30, matchedSkills.length * 5);

  if (matchedSkills.length) {
    reasons.push(`Skills matched: ${matchedSkills.slice(0, 6).join(", ")}`);
  } else {
    missingSignals.push("No explicit profile skill matches found");
  }

  const wanted = inferredSeniority(job.title);
  if (profile.seniorityMode === "any") {
    breakdown.seniority = 15;
    reasons.push("Any seniority level is eligible for evaluation");
  } else if (seniorityRank[wanted] <= seniorityRank[profile.maxSeniority]) {
    breakdown.seniority = 15;
    reasons.push("Seniority is within target range");
  } else {
    missingSignals.push(`Seniority appears too high: ${wanted}`);
  }

  const blocked = (profile.blockedRequirements ?? []).find((item) =>
    text.includes(item.toLowerCase())
  );

  if (!blocked && !geography.forceReview) {
    breakdown.eligibility = 15;
  } else if (!blocked) {
    breakdown.eligibility = 5;
    missingSignals.push("Eligibility requires review");
  } else {
    reasons.push(`Blocked requirement detected: ${blocked}`);
  }

  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const decision =
    blocked
      ? "reject"
      : geography.forceReview
        ? "review"
        : total < 45
          ? "reject"
          : total >= 75
            ? "strong-match"
            : "review";

  return { total, decision, reasons, missingSignals, breakdown };
}
