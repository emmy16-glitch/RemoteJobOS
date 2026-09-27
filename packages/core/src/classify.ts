import type { RoleFamily } from "./types.js";

const families: Array<[RoleFamily, RegExp]> = [
  ["cybersecurity", /security|cyber|soc analyst|appsec|pentest|penetration|iam|grc|threat|vulnerability/i],
  ["devops", /devops|site reliability|\bsre\b|platform engineer|release engineer|ci\/cd/i],
  ["cloud", /cloud engineer|cloud operations|aws engineer|azure engineer|gcp engineer/i],
  ["data", /data analyst|data engineer|business intelligence|\bbi analyst\b|analytics engineer|data scientist/i],
  ["qa", /quality assurance|\bqa\b|test automation|software tester|sdet/i],
  ["networking", /network engineer|network administrator|noc analyst/i],
  ["it-support", /technical support|it support|help ?desk|application support|systems? administrator|linux administrator/i],
  ["ai-ml", /machine learning|ml engineer|ai engineer|llm engineer/i],
  ["software", /software|developer|frontend|front-end|backend|back-end|full.?stack|mobile developer|web engineer|api engineer/i],
  ["product-technical", /technical product|solutions engineer|technical customer success|developer advocate/i]
];

export function classifyRoleFamily(title: string, description = ""): RoleFamily {
  const haystack = `${title} ${description.slice(0, 2000)}`;
  for (const [family, pattern] of families) {
    if (pattern.test(haystack)) return family;
  }
  return "other-tech";
}
