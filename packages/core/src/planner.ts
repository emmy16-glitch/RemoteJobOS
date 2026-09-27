import type { ApplicationField, FillPlanEntry } from "./application.js";
import { requiresHumanReview } from "./application.js";

export type VerifiedAnswers = Record<string, string>;

function answerKey(label: string) {
  return label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function buildDeterministicFillPlan(
  fields: ApplicationField[],
  verifiedAnswers: VerifiedAnswers
): FillPlanEntry[] {
  const normalizedAnswers = new Map(
    Object.entries(verifiedAnswers).map(([key, value]) => [answerKey(key), value])
  );

  return fields.map((field) => {
    if (requiresHumanReview(field)) {
      return {
        field,
        action: { type: "human-review", reason: "Sensitive or high-impact answer requires explicit review" },
        source: "policy",
        confidence: 1
      };
    }

    const exact = normalizedAnswers.get(answerKey(field.label));
    if (exact !== undefined && exact !== "") {
      return {
        field,
        action: { type: "fill", value: exact },
        source: "verified-profile",
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
