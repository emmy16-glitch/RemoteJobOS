export type JobEmailClassification =
  | "application-received"
  | "assessment"
  | "interview"
  | "offer"
  | "rejection"
  | "recruiter"
  | "unknown";

export interface JobEmailInput {
  subject?: string;
  snippet?: string;
  sender?: string;
}

export interface JobEmailResult {
  classification: JobEmailClassification;
  confidence: "high" | "medium" | "low";
  reason: string;
}

function haystack(input: JobEmailInput): string {
  return [input.subject, input.snippet, input.sender]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/\s+/g, " ");
}

export function classifyJobEmail(input: JobEmailInput): JobEmailResult {
  const text = haystack(input);

  if (
    /\b(job offer|offer of employment|pleased to offer|extend (?:you )?an offer|employment offer)\b/i.test(text)
  ) {
    return { classification: "offer", confidence: "high", reason: "Offer language detected" };
  }

  if (
    /\b(interview|schedule (?:a|your) (?:call|interview)|interview availability|meet with (?:the )?(?:team|hiring|manager)|select a time)\b/i.test(text)
  ) {
    return { classification: "interview", confidence: "high", reason: "Interview scheduling language detected" };
  }

  if (
    /\b(coding assessment|technical assessment|online assessment|take[- ]home|hackerrank|codility|codesignal|assessment invitation|complete (?:this|the) assessment)\b/i.test(text)
  ) {
    return { classification: "assessment", confidence: "high", reason: "Assessment language detected" };
  }

  if (
    /\b(unfortunately|not moving forward|will not be moving forward|decided not to proceed|other candidates|not selected|unable to offer you|position has been filled)\b/i.test(text)
  ) {
    return { classification: "rejection", confidence: "high", reason: "Rejection language detected" };
  }

  if (
    /\b(thank(?:s| you) for applying|application (?:has been )?(?:received|submitted)|we (?:have )?received your application|application confirmation|successfully applied)\b/i.test(text)
  ) {
    return {
      classification: "application-received",
      confidence: "high",
      reason: "Application receipt language detected"
    };
  }

  if (
    /\b(recruiter|talent acquisition|your profile|career opportunity|job opportunity|open role|hiring for)\b/i.test(text)
  ) {
    return { classification: "recruiter", confidence: "medium", reason: "Recruiting language detected" };
  }

  return { classification: "unknown", confidence: "low", reason: "No deterministic job lifecycle pattern matched" };
}
