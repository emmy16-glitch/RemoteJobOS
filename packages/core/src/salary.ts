export interface SalaryExpectationJob {
  title?: string | null;
  description?: string | null;
  roleFamily?: string | null;
  salaryText?: string | null;
}

export interface SalaryExpectation {
  monthlyUsd: number;
  annualUsd: number;
  source: "advertised-range" | "role-policy";
}

function clampMonthly(value: number): number {
  return Math.max(500, Math.min(5000, Math.round(value / 500) * 500));
}

function parseAmount(raw: string, suffix?: string): number {
  const value = Number(raw.replace(/,/g, ""));
  if (!Number.isFinite(value)) return 0;
  return suffix?.toLowerCase() === "k" ? value * 1000 : value;
}

function advertisedMonthlyFloor(salaryText: string | null | undefined): number | undefined {
  const text = (salaryText ?? "").trim();
  if (!text || !/(?:\$|\bUSD\b)/i.test(text)) return undefined;

  const amounts: number[] = [];
  const pattern = /(?:\$\s*|\bUSD\s*)(\d{1,3}(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*([kK])?/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const parsed = parseAmount(match[1] ?? "", match[2]);
    if (parsed > 0) amounts.push(parsed);
  }
  if (!amounts.length) return undefined;

  const floor = Math.min(...amounts);
  if (/\b(month|monthly|per month)\b|\/\s*mo\b/i.test(text)) {
    return clampMonthly(floor);
  }
  if (/\b(year|yearly|annual|annually|per annum)\b|\/\s*yr\b/i.test(text)) {
    return clampMonthly(floor / 12);
  }
  return undefined;
}

function rolePolicyMonthly(job: SalaryExpectationJob): number {
  const title = (job.title ?? "").toLowerCase();
  const role = (job.roleFamily ?? "").toLowerCase();

  if (/\b(intern|internship|trainee|apprentice|graduate trainee)\b/.test(title)) {
    return 500;
  }

  if (/\b(junior|entry[- ]?level|associate|help\s*desk|technical support|support engineer|manual qa|qa tester|data analyst)\b/.test(title)) {
    return 1000;
  }

  if (/\b(staff|principal|lead|head|director|architect)\b/.test(title)) {
    return 5000;
  }

  if (/\b(senior|sr\.?|experienced)\b/.test(title)) {
    return /devops|cloud|cybersecurity|software|ai-ml/.test(role) ? 4000 : 3000;
  }

  if (/\b(mid[- ]?level|intermediate)\b/.test(title)) {
    return 3000;
  }

  if (/devops|cloud|cybersecurity|software|ai-ml/.test(role)) {
    return 2000;
  }

  if (/qa|data|networking|it-support|product-technical/.test(role)) {
    return 1000;
  }

  return 1000;
}

export function salaryExpectationForJob(job: SalaryExpectationJob): SalaryExpectation {
  const advertised = advertisedMonthlyFloor(job.salaryText);
  const monthlyUsd = advertised ?? rolePolicyMonthly(job);
  return {
    monthlyUsd,
    annualUsd: monthlyUsd * 12,
    source: advertised ? "advertised-range" : "role-policy"
  };
}

export function salaryExpectationAnswers(job: SalaryExpectationJob): Record<string, string> {
  const { monthlyUsd, annualUsd } = salaryExpectationForJob(job);
  const generic = `$${monthlyUsd.toLocaleString("en-US")} USD/month (approximately $${annualUsd.toLocaleString("en-US")} USD/year), negotiable depending on role scope and total compensation.`;
  const monthly = String(monthlyUsd);
  const annual = String(annualUsd);

  const answers: Record<string, string> = {
    "salary expectation": generic,
    "salary expectations": generic,
    "expected salary": generic,
    "desired salary": generic,
    "target salary": generic,
    "compensation expectation": generic,
    "compensation expectations": generic,
    "expected compensation": generic,
    "desired compensation": generic,
    "monthly salary expectation": monthly,
    "expected monthly salary": monthly,
    "desired monthly salary": monthly,
    "monthly compensation expectation": monthly,
    "annual salary expectation": annual,
    "expected annual salary": annual,
    "desired annual salary": annual,
    "annual compensation expectation": annual
  };

  return answers;
}
