const TRACKING_PARAMS = new Set([
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "gh_src",
  "lever-source",
  "source",
  "ref",
  "referrer"
]);

export function normalizeWords(value: string): string {
  return value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

export function canonicalizeJobUrl(raw: string): string {
  try {
    const url = new URL(raw);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (TRACKING_PARAMS.has(key.toLowerCase()) || key.toLowerCase().startsWith("utm_")) {
        url.searchParams.delete(key);
      }
    }
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return url.toString();
  } catch {
    return raw.trim();
  }
}

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function makeJobDedupeKey(input: {
  company: string;
  title: string;
  locationText?: string;
}): string {
  const company = normalizeWords(input.company);
  const title = normalizeWords(input.title);
  const location = normalizeWords(input.locationText ?? "remote");
  return `job:${fnv1a(`${company}|${title}|${location}`)}`;
}

export function contentFingerprint(input: {
  title: string;
  company: string;
  description: string;
}): string {
  const normalized = [
    normalizeWords(input.company),
    normalizeWords(input.title),
    normalizeWords(input.description).slice(0, 6000)
  ].join("|");
  return `content:${fnv1a(normalized)}`;
}
