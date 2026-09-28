import type { ApplicationField, FillPlanEntry } from "./application.js";
import { requiresHumanReview } from "./application.js";

export type VerifiedAnswers = Record<string, string>;

function answerKey(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

const aliases: Array<{ pattern: RegExp; keys: string[] }> = [
  { pattern: /\bfirst\s*name\b/i, keys: ["first name", "firstname", "first_name"] },
  { pattern: /\blast\s*name\b|\bsurname\b/i, keys: ["last name", "lastname", "last_name", "surname"] },
  { pattern: /\bfull\s*name\b|\blegal\s*name\b/i, keys: ["full name", "fullname", "full_name"] },
  { pattern: /\bemail\b/i, keys: ["email", "email address"] },
  { pattern: /\bphone\b|\bmobile\b|telephone/i, keys: ["phone", "phone number", "mobile"] },
  { pattern: /linkedin/i, keys: ["linkedin", "linkedin url", "linkedin profile"] },
  { pattern: /github/i, keys: ["github", "github url", "github profile"] },
  { pattern: /portfolio|personal website|website url/i, keys: ["portfolio", "website", "portfolio url"] },
  { pattern: /^city$|\bcity\b/i, keys: ["city"] },
  { pattern: /state|province|region/i, keys: ["state", "province", "region"] },
  { pattern: /postal|zip/i, keys: ["postal code", "postcode", "zip code", "zip"] },
  { pattern: /country/i, keys: ["country", "country of residence"] },
  { pattern: /current company|current employer/i, keys: ["current company", "current employer"] },
  { pattern: /current title|current role|job title/i, keys: ["current title", "current role", "job title"] },
  { pattern: /years? of experience|total experience/i, keys: ["years of experience", "experience years"] }
];

function findVerifiedAnswer(
  field: ApplicationField,
  normalizedAnswers: Map<string, string>
): { key: string; value: string } | undefined {
  const exactKey = answerKey(field.label);
  const exact = normalizedAnswers.get(exactKey);
  if (exact !== undefined && exact !== "") return { key: exactKey, value: exact };

  for (const alias of aliases) {
    if (!alias.pattern.test(field.label)) continue;
    for (const key of alias.keys) {
      const normalizedKey = answerKey(key);
      const value = normalizedAnswers.get(normalizedKey);
      if (value !== undefined && value !== "") return { key: normalizedKey, value };
    }
  }

  return undefined;
}

export function buildDeterministicFillPlan(
  fields: ApplicationField[],
  verifiedAnswers: VerifiedAnswers,
  availableAssets: Iterable<string> = [],
  autoApprovedAnswerKeys: Iterable<string> = []
): FillPlanEntry[] {
  const normalizedAnswers = new Map(
    Object.entries(verifiedAnswers).map(([key, value]) => [answerKey(key), value])
  );
  const assets = new Set(availableAssets);
  const approvedKeys = new Set([...autoApprovedAnswerKeys].map(answerKey));

  return fields.map((field) => {
    if (field.kind === "file") {
      const resumeField = /resume|curriculum vitae|\bcv\b/i.test(field.label);
      const coverField = /cover letter/i.test(field.label);
      const assetKey = resumeField ? "resume" : coverField ? "coverLetter" : undefined;

      if (assetKey && assets.has(assetKey)) {
        return {
          field,
          action: { type: "upload", assetKey },
          source: "verified-profile",
          confidence: 1
        };
      }

      return {
        field,
        action: {
          type: field.required ? "human-review" : "skip",
          reason: field.required
            ? "Required file has no verified application asset"
            : "Optional file has no verified application asset"
        },
        source: "policy",
        confidence: 1
      };
    }

    const verified = findVerifiedAnswer(field, normalizedAnswers);

    if (requiresHumanReview(field)) {
      if (verified && approvedKeys.has(verified.key)) {
        return {
          field,
          action: { type: "fill", value: verified.value },
          source: "verified-profile",
          confidence: 1
        };
      }

      return {
        field,
        action: {
          type: "human-review",
          reason: verified
            ? "Verified answer exists, but this sensitive/high-impact field is not approved for automatic reuse"
            : "Sensitive or high-impact answer requires explicit review"
        },
        source: "policy",
        confidence: 1
      };
    }

    if (field.kind === "multi-select" || field.kind === "unknown") {
      return {
        field,
        action: {
          type: field.required ? "human-review" : "skip",
          reason: field.required
            ? "Required field type is not supported deterministically yet"
            : "Unsupported optional field"
        },
        source: "policy",
        confidence: 1
      };
    }

    if (verified !== undefined) {
      return {
        field,
        action: { type: "fill", value: verified.value },
        source: "verified-profile",
        confidence: 1
      };
    }

    if (field.kind === "custom") {
      return {
        field,
        action: {
          type: field.required ? "human-review" : "skip",
          reason: field.required
            ? "Required custom field has no verified reusable answer"
            : "Optional custom field has no verified reusable answer"
        },
        source: "policy",
        confidence: 1
      };
    }

    return {
      field,
      action: {
        type: field.required ? "human-review" : "skip",
        reason: field.required
          ? "No verified answer exists for a required field"
          : "No verified answer exists"
      },
      source: "policy",
      confidence: 1
    };
  });
}
