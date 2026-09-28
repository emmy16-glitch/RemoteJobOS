export type ApplicationStage =
  | "detect"
  | "scan"
  | "plan"
  | "fill"
  | "verify"
  | "fence"
  | "submit"
  | "confirm"
  | "report";

export type FieldKind =
  | "text"
  | "email"
  | "tel"
  | "textarea"
  | "file"
  | "select"
  | "radio"
  | "checkbox"
  | "typeahead"
  | "multi-select"
  | "custom"
  | "unknown";

export interface FieldLocator {
  strategy: "id" | "name" | "index";
  value: string;
  tag: "input" | "textarea" | "select" | "button" | "other";
}

export interface ApplicationField {
  key: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  options?: string[];
  sensitive?: boolean;
  locator?: FieldLocator;
}

export type PlanAction =
  | { type: "fill"; value: string }
  | { type: "upload"; assetKey: string }
  | { type: "decline" }
  | { type: "skip"; reason: string }
  | { type: "human-review"; reason: string };

export interface FillPlanEntry {
  field: ApplicationField;
  action: PlanAction;
  source: "verified-profile" | "policy" | "human";
  confidence: number;
}

export interface VerificationIssue {
  fieldKey: string;
  code: "empty-required" | "value-mismatch" | "invalid-option" | "unverified" | "sensitive";
  message: string;
}

export interface VerificationReport {
  ok: boolean;
  issues: VerificationIssue[];
  verifiedFieldCount: number;
  totalFieldCount: number;
}

export interface SubmissionFence {
  allowed: boolean;
  reason: string;
}

export function requiresHumanReview(field: ApplicationField): boolean {
  const label = field.label.toLowerCase();
  return field.sensitive === true ||
    /salary|compensation|citizenship|clearance|criminal|disability|race|ethnicity|gender|veteran|demographic|relocation|sponsorship|visa|work authorization|work permit|legally authorized/.test(label);
}
