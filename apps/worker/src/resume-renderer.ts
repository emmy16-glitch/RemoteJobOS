import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { VerifiedCareerFact } from "@remotejobos/core";
import { config, hasSupabase } from "./config.js";

type ApplicationRow = {
  id: string;
  profile_id: string | null;
  cv_version_id: string | null;
  job_id: string;
};

type CvContent = {
  strategy?: string;
  template?: string;
  quality?: {
    score?: number;
    passed?: boolean;
    warnings?: string[];
  };
  job?: { title?: string; company?: string };
  facts?: VerifiedCareerFact[];
};

type CvRow = {
  id: string;
  content: CvContent;
  storage_path?: string | null;
};

type ProfileRow = {
  display_name?: string | null;
  profile?: {
    verifiedAnswers?: Record<string, string>;
  };
};

async function request<T>(pathPart: string, init?: RequestInit): Promise<T> {
  if (!hasSupabase()) throw new Error("Supabase is required to render application assets");

  const response = await fetch(config.supabaseUrl + "/rest/v1/" + pathPart, {
    ...init,
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: "Bearer " + config.supabaseServiceRoleKey,
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error("Supabase request failed: " + response.status + " " + await response.text());
  }

  if (response.status === 204) return undefined as T;
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function safeHref(value: string): string {
  const trimmed = value.trim();
  if (/^(https?:|mailto:|tel:)/i.test(trimmed)) return escapeHtml(trimmed);
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return "mailto:" + escapeHtml(trimmed);
  return "";
}

function answer(answers: Record<string, string>, keys: string[]): string {
  for (const key of keys) {
    const direct = answers[key];
    if (direct) return direct;
    const found = Object.entries(answers).find(([candidate]) =>
      candidate.toLowerCase().replace(/[^a-z0-9]/g, "") === key.toLowerCase().replace(/[^a-z0-9]/g, "")
    );
    if (found?.[1]) return found[1];
  }
  return "";
}

function unique(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function formatDateRange(fact: VerifiedCareerFact): string {
  const start = fact.startDate?.trim();
  const end = fact.endDate?.trim();
  if (start && end) return start + " – " + end;
  return start || end || "";
}

function factMeta(fact: VerifiedCareerFact): string {
  return [formatDateRange(fact), fact.location?.trim() ?? ""].filter(Boolean).join(" · ");
}

function renderLink(url: string | undefined): string {
  if (!url) return "";
  const href = safeHref(url);
  if (!href) return "";
  return `<div class="fact-link"><a href="${href}">${escapeHtml(url)}</a></div>`;
}

function renderHighlights(highlights: string[] | undefined): string {
  const items = unique(highlights ?? []);
  if (!items.length) return "";
  return `<ul class="highlights">${items.map((item) => `<li>${escapeHtml(item)}</li>`).join("")}</ul>`;
}

function renderTechnologies(fact: VerifiedCareerFact): string {
  const technologies = unique([...(fact.technologies ?? []), ...fact.keywords]);
  if (!technologies.length || fact.kind === "skill") return "";
  return `<div class="technology-line"><strong>Technologies:</strong> ${escapeHtml(technologies.join(", "))}</div>`;
}

function renderFact(fact: VerifiedCareerFact): string {
  const organization = fact.organization?.trim() ?? "";
  const meta = factMeta(fact);
  const body = fact.body.trim();

  return [
    '<article class="fact">',
    '<div class="fact-head">',
    '<div class="fact-main">',
    '<div class="fact-title">' + escapeHtml(fact.title) + "</div>",
    organization ? '<div class="fact-org">' + escapeHtml(organization) + "</div>" : "",
    "</div>",
    meta ? '<div class="fact-meta">' + escapeHtml(meta) + "</div>" : "",
    "</div>",
    body ? '<p class="fact-body">' + escapeHtml(body) + "</p>" : "",
    renderHighlights(fact.highlights),
    renderTechnologies(fact),
    renderLink(fact.url),
    "</article>"
  ].join("");
}

function section(title: string, facts: VerifiedCareerFact[]): string {
  if (!facts.length) return "";
  return `<section><h2>${escapeHtml(title)}</h2>${facts.map(renderFact).join("")}</section>`;
}

function renderSkills(facts: VerifiedCareerFact[]): string {
  const skillFacts = facts.filter((fact) => fact.kind === "skill");
  if (!skillFacts.length) return "";

  const skills = unique(
    skillFacts.flatMap((fact) => [
      fact.title,
      ...(fact.technologies ?? []),
      ...fact.keywords
    ])
  );

  if (!skills.length) return "";
  return `<section><h2>Core Skills</h2><div class="skills-line">${skills.map((skill) => `<strong>${escapeHtml(skill)}</strong>`).join('<span class="skill-separator">•</span>')}</div></section>`;
}

function contactLink(label: string, value: string, href?: string): string {
  if (!value) return "";
  const target = href ? safeHref(href) : "";
  const content = '<strong>' + escapeHtml(label) + ":</strong> " + escapeHtml(value);
  return target
    ? `<a class="contact-item" href="${target}">${content}</a>`
    : `<span class="contact-item">${content}</span>`;
}

function buildHtml(
  name: string,
  roleTitle: string,
  answers: Record<string, string>,
  facts: VerifiedCareerFact[]
): string {
  const email = answer(answers, ["email", "email address"]);
  const phone = answer(answers, ["phone", "phone number", "mobile"]);
  const secondaryPhone = answer(answers, ["secondary phone", "phone 2", "second phone"]);
  const github = answer(answers, ["github", "github url"]);
  const xProfile = answer(answers, ["x", "x profile", "twitter", "twitter url"]);
  const portfolio = answer(answers, ["portfolio", "portfolio url", "website"]);
  const city = answer(answers, ["city"]);
  const country = answer(answers, ["country"]);
  const location = [city, country].filter(Boolean).join(", ") || answer(answers, ["location"]);
  const currentTitle = answer(answers, ["current title", "professional title"]);
  const summary = answer(answers, ["professional summary", "summary"]);

  const contact = [
    contactLink("Email", email, email ? "mailto:" + email : undefined),
    contactLink("Phone", phone, phone ? "tel:" + phone.replace(/\s+/g, "") : undefined),
    contactLink("Phone", secondaryPhone, secondaryPhone ? "tel:" + secondaryPhone.replace(/\s+/g, "") : undefined),
    location ? '<span class="contact-item"><strong>Location:</strong> ' + escapeHtml(location) + "</span>" : "",
    contactLink("GitHub", github, github),
    contactLink("X", xProfile, xProfile),
    contactLink("Portfolio", portfolio, portfolio)
  ].filter(Boolean).join('<span class="contact-divider">|</span>');

  const byKind = (kind: VerifiedCareerFact["kind"]) => facts.filter((fact) => fact.kind === kind);
  const headline = currentTitle || roleTitle;

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<meta name="color-scheme" content="light only" />
<style>
  @page { size: A4; margin: 14mm 15mm 15mm; }
  * { box-sizing: border-box; }
  html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body {
    margin: 0;
    color: #111827;
    background: #ffffff;
    font-family: "Source Sans 3", "Noto Sans", "Liberation Sans", "DejaVu Sans", sans-serif;
    font-size: 9.9pt;
    line-height: 1.43;
    font-variant-numeric: proportional-nums;
  }
  .cv-root { width: 100%; }
  header {
    padding-bottom: 10px;
    border-bottom: 2px solid #111827;
  }
  h1 {
    margin: 0;
    font-family: "Manrope", "Noto Sans", "Liberation Sans", sans-serif;
    font-size: 23pt;
    line-height: 1.05;
    font-weight: 800;
    letter-spacing: -0.45px;
    color: #0f172a;
  }
  .headline {
    margin-top: 4px;
    font-family: "Manrope", "Noto Sans", "Liberation Sans", sans-serif;
    font-size: 11.1pt;
    line-height: 1.25;
    font-weight: 700;
    color: #1f2937;
  }
  .target-role {
    margin-top: 2px;
    font-size: 9.3pt;
    font-weight: 600;
    color: #4b5563;
  }
  .contact {
    margin-top: 7px;
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 2px 7px;
    font-size: 8.7pt;
    line-height: 1.35;
    color: #374151;
  }
  .contact-item {
    color: #374151;
    text-decoration: none;
    white-space: normal;
    word-break: break-word;
  }
  .contact-item strong { font-weight: 700; color: #111827; }
  .contact-divider { color: #9ca3af; }
  .summary {
    margin-top: 10px;
    font-size: 9.8pt;
    line-height: 1.48;
    color: #1f2937;
  }
  section { margin-top: 13px; }
  h2 {
    margin: 0 0 7px;
    padding: 0 0 3px;
    border-bottom: 1.25px solid #374151;
    font-family: "Manrope", "Noto Sans", "Liberation Sans", sans-serif;
    font-size: 10.7pt;
    line-height: 1.2;
    font-weight: 800;
    letter-spacing: 0.65px;
    text-transform: uppercase;
    color: #111827;
  }
  .fact {
    margin: 0 0 9px;
    break-inside: avoid;
    page-break-inside: avoid;
  }
  .fact:last-child { margin-bottom: 0; }
  .fact-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }
  .fact-main { min-width: 0; }
  .fact-title {
    font-family: "Manrope", "Noto Sans", "Liberation Sans", sans-serif;
    font-size: 10.1pt;
    line-height: 1.3;
    font-weight: 800;
    color: #111827;
  }
  .fact-org {
    margin-top: 1px;
    font-size: 9.4pt;
    line-height: 1.3;
    font-weight: 700;
    color: #374151;
  }
  .fact-meta {
    flex: 0 0 auto;
    max-width: 36%;
    text-align: right;
    font-size: 8.8pt;
    line-height: 1.3;
    font-weight: 600;
    color: #4b5563;
  }
  .fact-body {
    margin: 3px 0 0;
    color: #1f2937;
  }
  .highlights {
    margin: 4px 0 0 16px;
    padding: 0;
  }
  .highlights li {
    margin: 1.5px 0;
    padding-left: 2px;
  }
  .technology-line,
  .fact-link {
    margin-top: 3px;
    font-size: 8.9pt;
    line-height: 1.35;
    color: #374151;
  }
  .technology-line strong { font-weight: 800; color: #111827; }
  .fact-link a { color: #1f2937; text-decoration: none; word-break: break-all; }
  .skills-line {
    display: flex;
    flex-wrap: wrap;
    gap: 3px 7px;
    font-size: 9.2pt;
    line-height: 1.45;
  }
  .skills-line strong { font-weight: 700; }
  .skill-separator { color: #9ca3af; }
  body.compact {
    font-size: 9.35pt;
    line-height: 1.38;
  }
  body.compact section { margin-top: 10px; }
  body.compact .fact { margin-bottom: 7px; }
  body.compact h1 { font-size: 21pt; }
  body.compact h2 { margin-bottom: 5px; }
  body.compact .summary { margin-top: 7px; }
</style>
</head>
<body>
  <main class="cv-root">
    <header>
      <h1>${escapeHtml(name || "Candidate")}</h1>
      <div class="headline">${escapeHtml(headline)}</div>
      ${roleTitle && roleTitle !== headline ? '<div class="target-role">Target role: ' + escapeHtml(roleTitle) + "</div>" : ""}
      <div class="contact">${contact}</div>
    </header>
    ${summary ? '<section><h2>Professional Summary</h2><p class="summary">' + escapeHtml(summary) + "</p></section>" : ""}
    ${section("Professional Experience", byKind("experience"))}
    ${section("Selected Projects", byKind("project"))}
    ${renderSkills(facts)}
    ${section("Education", byKind("education"))}
    ${section("Certifications", byKind("certification"))}
    ${section("Achievements", byKind("achievement"))}
  </main>
</body>
</html>`;
}

function slug(value: string): string {
  const normalized = value
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return normalized.slice(0, 80) || "CV";
}

async function uploadPrivateAsset(localPath: string, objectPath: string): Promise<void> {
  const bytes = await readFile(localPath);
  const response = await fetch(
    config.supabaseUrl + "/storage/v1/object/application-assets/" + objectPath,
    {
      method: "POST",
      headers: {
        apikey: config.supabaseServiceRoleKey,
        authorization: "Bearer " + config.supabaseServiceRoleKey,
        "content-type": "application/pdf",
        "x-upsert": "true"
      },
      body: bytes
    }
  );

  if (!response.ok) {
    throw new Error("CV storage upload failed: " + response.status + " " + await response.text());
  }
}

export async function renderApplicationResume(applicationId: string): Promise<string | undefined> {
  if (!hasSupabase()) return undefined;

  const applications = await request<ApplicationRow[]>(
    "applications?select=id,profile_id,cv_version_id,job_id&id=eq." + encodeURIComponent(applicationId) + "&limit=1"
  );
  const application = applications[0];
  if (!application?.profile_id) throw new Error("Application has no career profile");

  let cvVersionId = application.cv_version_id;
  if (!cvVersionId) {
    const candidates = await request<Array<{ id: string }>>(
      "cv_versions?select=id&profile_id=eq." + encodeURIComponent(application.profile_id) +
      "&job_id=eq." + encodeURIComponent(application.job_id) +
      "&order=created_at.desc&limit=1"
    );
    cvVersionId = candidates[0]?.id ?? null;
  }

  if (!cvVersionId) throw new Error("Application has no verified CV plan");

  const [cvRows, profileRows] = await Promise.all([
    request<CvRow[]>(
      "cv_versions?select=id,content,storage_path&id=eq." + encodeURIComponent(cvVersionId) + "&limit=1"
    ),
    request<ProfileRow[]>(
      "career_profiles?select=display_name,profile&id=eq." + encodeURIComponent(application.profile_id) + "&limit=1"
    )
  ]);

  const cv = cvRows[0];
  const profile = profileRows[0];
  if (!cv) throw new Error("CV plan not found");

  const facts = cv.content.facts ?? [];
  if (!facts.length) throw new Error("CV plan contains no verified facts");
  if (cv.content.quality?.passed === false) {
    throw new Error("CV plan failed deterministic quality checks and requires review");
  }

  const answers = profile?.profile?.verifiedAnswers ?? {};
  const name = profile?.display_name || answer(answers, ["full name", "fullname"]);
  const roleTitle = cv.content.job?.title ?? "Technology Professional";
  const html = buildHtml(name ?? "", roleTitle, answers, facts);

  const directory = path.resolve("artifacts", "cvs");
  await mkdir(directory, { recursive: true });

  const fileName =
    slug(name || "Candidate") + "_" +
    slug(roleTitle) + "_" +
    applicationId.slice(0, 8) +
    ".pdf";
  const localPath = path.join(directory, fileName);

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.evaluate(async () => {
      if ("fonts" in document) await document.fonts.ready;
    });

    const height = await page.evaluate(() => document.body.scrollHeight);
    if (height > 2050) {
      await page.evaluate(() => document.body.classList.add("compact"));
    }

    await page.pdf({
      path: localPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true
    });
  } finally {
    await browser.close();
  }

  const objectPath =
    "resumes/" + application.profile_id + "/" + cv.id + "/" + fileName;
  await uploadPrivateAsset(localPath, objectPath);

  await request("cv_versions?id=eq." + encodeURIComponent(cv.id), {
    method: "PATCH",
    body: JSON.stringify({ storage_path: objectPath })
  });

  if (!application.cv_version_id) {
    await request("applications?id=eq." + encodeURIComponent(applicationId), {
      method: "PATCH",
      body: JSON.stringify({ cv_version_id: cv.id })
    });
  }

  return localPath;
}
