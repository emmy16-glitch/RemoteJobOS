import type { CareerProfile, JobScore, NormalizedJob } from "./types.js";

const seniorityRank = { intern: 0, entry: 1, junior: 2, mid: 3, senior: 4 } as const;

function inferredSeniority(title: string): keyof typeof seniorityRank {
  if (/principal|staff|lead|senior|sr\.?\b/i.test(title)) return "senior";
  if (/mid|intermediate/i.test(title)) return "mid";
  if (/junior|jr\.?\b|graduate|entry/i.test(title)) return "junior";
  if (/intern|internship/i.test(title)) return "intern";
  return "entry";
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
  if (matchedSkills.length) reasons.push(`Skills matched: ${matchedSkills.slice(0, 6).join(", ")}`);
  else missingSignals.push("No explicit profile skill matches found");

  const wanted = inferredSeniority(job.title);
  if (seniorityRank[wanted] <= seniorityRank[profile.maxSeniority]) {
    breakdown.seniority = 15;
    reasons.push("Seniority is within target range");
  } else {
    missingSignals.push(`Seniority appears too high: ${wanted}`);
  }

  const blocked = (profile.blockedRequirements ?? []).find((item) => text.includes(item.toLowerCase()));
  if (!blocked) breakdown.eligibility = 15;
  else reasons.push(`Blocked requirement detected: ${blocked}`);

  const total = Object.values(breakdown).reduce((sum, value) => sum + value, 0);
  const decision = blocked || total < 45 ? "reject" : total >= 75 ? "strong-match" : "review";

  return { total, decision, reasons, missingSignals, breakdown };
}
