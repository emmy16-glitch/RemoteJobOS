import type { RoleFamily } from "./types.js";

const titleFamilies: Array<[RoleFamily, RegExp]> = [
  ["cybersecurity", /security|cyber|soc analyst|appsec|pentest|penetration|iam|grc|threat|vulnerability/i],
  ["devops", /devops|site reliability|\bsre\b|platform engineer|release engineer|ci\/cd/i],
  ["cloud", /cloud engineer|cloud operations|aws engineer|azure engineer|gcp engineer/i],
  ["data", /data analyst|data engineer|business intelligence|\bbi analyst\b|analytics engineer|data scientist/i],
  ["qa", /quality assurance|\bqa\b|test automation|software tester|sdet/i],
  ["networking", /network engineer|network administrator|noc analyst/i],
  ["it-support", /technical support|it support|help ?desk|application support|systems? administrator|linux administrator/i],
  ["ai-ml", /machine learning|ml engineer|ai engineer|ai product engineer|llm engineer/i],
  ["software", /software|developer|entwickler|frontend|front-end|backend|back-end|full.?stack|mobile developer|web engineer|api engineer|automation engineer|automatisierungsingenieur/i],
  ["product-technical", /technical product|solutions engineer|technical customer success|developer advocate/i]
];

const clearlyNonTargetTitle =
  /\b(marketing|content creator|video creation|sales|account executive|account manager|business development|customer service|kundenservice|recruiter|recruiting|human resources|hr coordinator|talent acquisition|voice actor|language trainer|student success coach)\b/i;

export function classifyRoleFamily(title: string, description = ""): RoleFamily {
  for (const [family, pattern] of titleFamilies) {
    if (pattern.test(title)) return family;
  }

  // Never let unrelated prose in a job description turn an obviously
  // non-technical title into a technical role family.
  if (clearlyNonTargetTitle.test(title)) return "other-tech";

  const descriptionSlice = description.slice(0, 2000);
  for (const [family, pattern] of titleFamilies) {
    if (pattern.test(descriptionSlice)) return family;
  }

  return "other-tech";
}
