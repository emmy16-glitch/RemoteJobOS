import type { CareerProfile, JobScore, NormalizedJob } from "./types.js";

const seniorityRank = { intern: 0, entry: 1, junior: 2, mid: 3, senior: 4 } as const;

const automaticRoleFamilies = new Set([
  "cybersecurity",
  "software",
  "devops",
  "data",
  "qa",
  "cloud",
  "it-support",
  "networking",
  "ai-ml",
  "product-technical"
]);

const executiveTitle =
  /\b(chief|cto|cio|ciso|vice president|vp\b|head of|director|managing director|general manager)\b/i;

const advancedSeniorityTitle =
  /\b(senior|sr\.?|staff|principal|lead)\b/i;

const clearlyNonTargetTitle =
  /\b(marketing|content creator|video creation|sales|vertrieb|verkauf|account executive|account manager|business development|customer service|kundenservice|kundendienst|recruiter|recruiting|human resources|hr coordinator|hr manager|talent acquisition|product management|product manager|project manager|program manager|programme manager|engineering manager|operations manager|voice actor|language trainer|student success coach|buchhalter|controller|marktforschung|befragungen|testkäufer|testkunde)\b/i;

const technicalTitleSignal =
  /security|cyber|soc analyst|appsec|pentest|penetration|iam|grc|threat|vulnerability|software|developer|entwickler|frontend|front-end|backend|back-end|full.?stack|devops|site reliability|\bsre\b|platform engineer|cloud|data analyst|data engineer|analytics engineer|data scientist|quality assurance|\bqa\b|test automation|sdet|network engineer|network administrator|noc analyst|technical support|it support|help ?desk|systems? administrator|linux administrator|machine learning|ml engineer|ai engineer|ai product engineer|llm engineer|technical product|solutions engineer|solutions architect|solution architect|it architect|systems architect|developer advocate|automation engineer|automatisierungsingenieur|robotics|\bsap\b/i;

export function automaticApplicationEligibility(
  job: Pick<NormalizedJob, "title" | "roleFamily">
): { allowed: boolean; reason: string } {
  if (executiveTitle.test(job.title)) {
    return { allowed: false, reason: "Executive-level title is outside unattended auto-apply scope" };
  }
  if (advancedSeniorityTitle.test(job.title)) {
    return { allowed: false, reason: "Senior/staff/lead title is outside unattended auto-apply scope" };
  }
  if (clearlyNonTargetTitle.test(job.title)) {
    return { allowed: false, reason: "Title is outside the technical auto-apply scope" };
  }
  if (!technicalTitleSignal.test(job.title)) {
    return { allowed: false, reason: "Title does not contain a verified technical-role signal" };
  }
  if (!automaticRoleFamilies.has(job.roleFamily)) {
    return { allowed: false, reason: "Role family requires review instead of unattended auto-apply" };
  }
  return { allowed: true, reason: "Role is inside the technical auto-apply scope" };
}

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

function normalizedVerifiedAnswers(profile: CareerProfile): string {
  return Object.entries(profile.verifiedAnswers ?? {})
    .map(([key, value]) => `${key} ${value}`)
    .join(" ")
    .toLowerCase();
}

function explicitRequirementReviewReason(
  job: NormalizedJob,
  profile: CareerProfile
): string | undefined {
  const text = `${job.title} ${job.description}`.toLowerCase();
  const verified = normalizedVerifiedAnswers(profile);

  const languageRequirements: Array<[RegExp, RegExp, string]> = [
    [
      /(german|deutsch)[^.!?\n]{0,80}(c1|c2|fluent|native|very good|sehr gut)|(?:c1|c2|fluent|native|very good|sehr gute?)[^.!?\n]{0,40}(german|deutsch)|sehr gute? deutschkenntnisse/i,
      /(german|deutsch)/i,
      "German proficiency requirement is not verified"
    ],
    [
      /(french|franz[oö]sisch)[^.!?\n]{0,80}(c1|c2|fluent|native|very good|sehr gut)|(?:c1|c2|fluent|native|very good|sehr gute?)[^.!?\n]{0,40}(french|franz[oö]sisch)|sehr gute? franz[oö]sischkenntnisse/i,
      /(french|franz[oö]sisch)/i,
      "French proficiency requirement is not verified"
    ],
    [
      /(italian|italienisch)[^.!?\n]{0,80}(c1|c2|fluent|native|very good|sehr gut)|(?:c1|c2|fluent|native|very good|sehr gute?)[^.!?\n]{0,40}(italian|italienisch)|sehr gute? italienischkenntnisse/i,
      /(italian|italienisch)/i,
      "Italian proficiency requirement is not verified"
    ]
  ];

  for (const [requirement, proof, reason] of languageRequirements) {
    if (requirement.test(text) && !proof.test(verified)) return reason;
  }

  const clearanceRequirement =
    /security clearance|clearance required|sü\s?2|süg|secret clearance|top secret/i;
  if (
    clearanceRequirement.test(text) &&
    !/(security clearance|clearance|sü\s?2|süg)/i.test(verified)
  ) {
    return "Security-clearance requirement is not verified";
  }

  const passportRequirement =
    /(swiss|schweizer|eu|european union)[^.!?\n]{0,60}(passport|pass\b|citizenship|citizen)|(?:passport|citizenship)[^.!?\n]{0,60}(swiss|schweizer|eu|european union)/i;
  if (
    passportRequirement.test(text) &&
    !/(passport|citizenship|citizen|work authorization|work permit)/i.test(verified)
  ) {
    return "Passport/citizenship requirement is not verified";
  }

  return undefined;
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
      forceReview: true,
      reason: "Remote geography is not explicit enough for unattended auto-apply"
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

  const autoScope = automaticApplicationEligibility(job);
  if (!autoScope.allowed && executiveTitle.test(job.title)) {
    return {
      total: 20,
      decision: "reject",
      reasons: ["Remote role", autoScope.reason],
      missingSignals,
      breakdown
    };
  }

  const geography = geographicEligibility(job, profile);
  reasons.push(geography.reason);
  const requirementReviewReason = explicitRequirementReviewReason(job, profile);
  if (requirementReviewReason) {
    missingSignals.push(requirementReviewReason);
  }

  if (!geography.allowed) {
    return {
      total: 20,
      decision: "reject",
      reasons,
      missingSignals,
      breakdown
    };
  }

  if (profile.roleFamilies.includes(job.roleFamily) && autoScope.allowed) {
    breakdown.role = 20;
    reasons.push(`Target role family: ${job.roleFamily}`);
  } else if (autoScope.allowed) {
    breakdown.role = 8;
    reasons.push("Adjacent technical role");
  } else {
    breakdown.role = 0;
    missingSignals.push(autoScope.reason);
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

  if (!blocked && !geography.forceReview && !requirementReviewReason) {
    breakdown.eligibility = 15;
  } else if (!blocked) {
    breakdown.eligibility = 5;
    if (!missingSignals.includes("Eligibility requires review")) {
      missingSignals.push("Eligibility requires review");
    }
  } else {
    reasons.push(`Blocked requirement detected: ${blocked}`);
  }

  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const decision =
    blocked
      ? "reject"
      : geography.forceReview || Boolean(requirementReviewReason) || !autoScope.allowed
        ? "review"
        : total < 45
          ? "reject"
          : total >= 75
            ? "strong-match"
            : "review";

  return { total, decision, reasons, missingSignals, breakdown };
}
