export type RoleFamily =
  | "cybersecurity"
  | "software"
  | "devops"
  | "data"
  | "qa"
  | "cloud"
  | "it-support"
  | "networking"
  | "ai-ml"
  | "product-technical"
  | "other-tech";

export type RemoteScope =
  | "global"
  | "africa"
  | "emea"
  | "us-only"
  | "eu-only"
  | "uk-only"
  | "country-restricted"
  | "unknown";

export interface NormalizedJob {
  source: string;
  externalId: string;
  title: string;
  company: string;
  description: string;
  applyUrl: string;
  sourceUrl?: string;
  postedAt?: string;
  salaryText?: string;
  locationText?: string;
  remote: boolean;
  remoteScope: RemoteScope;
  roleFamily: RoleFamily;
  tags: string[];
}

export type Seniority = "intern" | "entry" | "junior" | "mid" | "senior";

export interface CareerProfile {
  skills: string[];
  roleFamilies: RoleFamily[];
  seniorityMode?: "any" | "capped";
  maxSeniority: Seniority;
  country?: string;
  blockedRequirements?: string[];
  verifiedAnswers?: Record<string, string>;
}

export interface ScoreBreakdown {
  remote: number;
  role: number;
  skills: number;
  seniority: number;
  eligibility: number;
}

export interface JobScore {
  total: number;
  decision: "reject" | "review" | "strong-match";
  reasons: string[];
  missingSignals: string[];
  breakdown: ScoreBreakdown;
}
