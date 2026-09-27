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

function renderFact(fact: VerifiedCareerFact): string {
  const org = fact.organization ? "<span class=\"org\">" + escapeHtml(fact.organization) + "</span>" : "";
  return [
    "<div class=\"fact\">",
    "<div class=\"fact-head\"><strong>" + escapeHtml(fact.title) + "</strong>" + org + "</div>",
    "<p>" + escapeHtml(fact.body) + "</p>",
    "</div>"
  ].join("");
}

function section(title: string, facts: VerifiedCareerFact[]): string {
  if (!facts.length) return "";
  return "<section><h2>" + escapeHtml(title) + "</h2>" + facts.map(renderFact).join("") + "</section>";
}

function buildHtml(name: string, roleTitle: string, answers: Record<string, string>, facts: VerifiedCareerFact[]): string {
  const email = answer(answers, ["email", "email address"]);
  const phone = answer(answers, ["phone", "phone number", "mobile"]);
  const linkedin = answer(answers, ["linkedin", "linkedin url"]);
  const github = answer(answers, ["github", "github url"]);
  const location = answer(answers, ["location", "city", "country"]);

  const contact = [email, phone, location, linkedin, github].filter(Boolean).map(escapeHtml).join(" · ");
  const byKind = (kind: VerifiedCareerFact["kind"]) => facts.filter((fact) => fact.kind === kind);

  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
  @page { size: A4; margin: 15mm 16mm; }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    color: #111;
    font-family: Arial, Helvetica, sans-serif;
    font-size: 10.5pt;
    line-height: 1.35;
  }
  h1 { font-size: 22pt; margin: 0; letter-spacing: -0.4px; }
  .target { font-size: 11pt; margin-top: 3px; font-weight: 700; }
  .contact { margin-top: 6px; color: #333; font-size: 9pt; word-break: break-word; }
  section { margin-top: 13px; }
  h2 {
    font-size: 11pt;
    margin: 0 0 6px;
    padding-bottom: 3px;
    border-bottom: 1px solid #222;
    text-transform: uppercase;
    letter-spacing: .5px;
  }
  .fact { margin: 0 0 8px; break-inside: avoid; }
  .fact-head { display: flex; justify-content: space-between; gap: 12px; }
  .org { font-size: 9.5pt; color: #333; }
  p { margin: 2px 0 0; }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(name || "Candidate")}</h1>
    <div class="target">${escapeHtml(roleTitle)}</div>
    <div class="contact">${contact}</div>
  </header>
  ${section("Experience", byKind("experience"))}
  ${section("Projects", byKind("project"))}
  ${section("Skills", byKind("skill"))}
  ${section("Education", byKind("education"))}
  ${section("Certifications", byKind("certification"))}
  ${section("Achievements", byKind("achievement"))}
</body>
</html>`;
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

  const answers = profile?.profile?.verifiedAnswers ?? {};
  const name = profile?.display_name || answer(answers, ["full name", "fullname"]);
  const roleTitle = cv.content.job?.title ?? "Technology Professional";
  const html = buildHtml(name ?? "", roleTitle, answers, facts);

  const directory = path.resolve("artifacts", "cvs");
  await mkdir(directory, { recursive: true });
  const localPath = path.join(directory, applicationId + "-resume.pdf");

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: "load" });
    await page.pdf({
      path: localPath,
      format: "A4",
      printBackground: true,
      preferCSSPageSize: true
    });
  } finally {
    await browser.close();
  }

  const objectPath = "resumes/" + application.profile_id + "/" + cv.id + ".pdf";
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
