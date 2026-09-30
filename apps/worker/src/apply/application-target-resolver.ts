import { chromium, type Page } from "playwright";
import { localBrowser, Stagehand } from "@browserbasehq/stagehand";

export type ApplicationTargetStrategy =
  | "direct-known-ats"
  | "direct-form"
  | "playwright-follow"
  | "stagehand-follow"
  | "unresolved";

export type ApplicationTargetResolution = {
  url: string;
  strategy: ApplicationTargetStrategy;
  changed: boolean;
  sourceHost: string;
  targetHost: string;
  adaptiveAttempted: boolean;
};

const KNOWN_APPLICATION_HOSTS = [
  /(?:job-boards|boards)\.greenhouse\.io$/i,
  /greenhouse\.com$/i,
  /jobs\.lever\.co$/i,
  /lever\.co$/i,
  /jobs\.ashbyhq\.com$/i,
  /ashbyhq\.com$/i,
  /myworkdayjobs\.com$/i,
  /myworkdaysite\.com$/i,
  /jobs\.smartrecruiters\.com$/i,
  /apply\.workable\.com$/i,
  /icims\.com$/i,
  /recruitee\.com$/i,
  /teamtailor\.com$/i,
  /jobs\.personio\.(?:com|de)$/i,
  /bamboohr\.com$/i,
  /jobs\.jobvite\.com$/i,
  /successfactors\.(?:com|eu)$/i,
  /taleo\.net$/i,
  /oraclecloud\.com$/i,
  /eightfold\.ai$/i,
  /join\.com$/i
];

const AGGREGATOR_HOSTS = [
  /remoteok\.com$/i,
  /arbeitnow\.(?:com|ch|co\.uk|fr)$/i,
  /remotive\.com$/i,
  /himalayas\.app$/i
];

function httpUrl(value: string): URL | null {
  try {
    const parsed = new URL(value);
    return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed : null;
  } catch {
    return null;
  }
}

export function applicationHost(url: string): string {
  return httpUrl(url)?.hostname.toLowerCase().replace(/^www\./, "") ?? "";
}

export function isKnownApplicationHost(url: string): boolean {
  const host = applicationHost(url);
  return KNOWN_APPLICATION_HOSTS.some((pattern) => pattern.test(host));
}

export function isAggregatorHost(url: string): boolean {
  const host = applicationHost(url);
  return AGGREGATOR_HOSTS.some((pattern) => pattern.test(host));
}

const GENERIC_COMPANY_WORDS = new Set([
  "and", "the", "inc", "llc", "ltd", "limited", "plc", "corp", "corporation",
  "company", "group", "holdings", "services", "service", "solutions", "systems",
  "technology", "technologies", "tech", "global", "international"
]);

function normalizedWords(value: string): string[] {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part.length >= 3 && !GENERIC_COMPANY_WORDS.has(part));
}

export type ApplicationTargetValidation = {
  ok: boolean;
  reason: string;
  matchedCompanyTokens: string[];
  expectedCompanyTokens: string[];
  pageTitle: string;
};

export async function validateApplicationTarget(
  url: string,
  expectedCompany: string,
  expectedTitle = ""
): Promise<ApplicationTargetValidation> {
  const expectedCompanyTokens = [...new Set(normalizedWords(expectedCompany))];
  if (!expectedCompanyTokens.length) {
    return {
      ok: false,
      reason: "Expected employer name has no distinctive token that can be validated safely",
      matchedCompanyTokens: [],
      expectedCompanyTokens,
      pageTitle: ""
    };
  }

  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      locale: "en-US"
    });
    const page = await context.newPage();
    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });
    await page.waitForTimeout(700);

    const pageTitle = await page.title().catch(() => "");
    const body = await page.locator("body").innerText().catch(() => "");
    const evidence = [
      page.url(),
      pageTitle,
      body.slice(0, 30_000)
    ].join(" ").toLowerCase();
    const challengeTitle =
      /^(?:just a moment|attention required|verify you are human|checking your browser)/i.test(
        pageTitle.trim()
      );
    const challengeBody =
      /checking your browser before accessing|verify you are human|performing security verification|enable javascript and cookies to continue|cloudflare ray id|cf-chl-/i.test(
        body.slice(0, 2_500)
      );
    const challengePage = challengeTitle || challengeBody;
    const unresolvedAggregator =
      isAggregatorHost(page.url()) && !(await hasApplicationForm(page));

    const matchedCompanyTokens = expectedCompanyTokens.filter((token) =>
      evidence.includes(token)
    );

    const expectedTitleTokens = [...new Set(normalizedWords(expectedTitle))]
      .filter((token) => !/^(remote|job|jobs|engineer|developer|software|fullstack|frontend|backend)$/.test(token));
    const matchedTitleTokens = expectedTitleTokens.filter((token) =>
      evidence.includes(token)
    );
    const requiredTitleMatches =
      expectedTitleTokens.length === 0 ? 0 : Math.min(2, expectedTitleTokens.length);
    const titleMatched =
      requiredTitleMatches === 0 || matchedTitleTokens.length >= requiredTitleMatches;
    const companyMatched = matchedCompanyTokens.length > 0;
    const externalExactTitleFallback =
      !isAggregatorHost(page.url()) && titleMatched;
    const currentPath = httpUrl(page.url())?.pathname ?? "";
    const jobSpecificAtsPath =
      /\/\d{5,}(?:\/|$)/.test(currentPath) ||
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(currentPath);
    const knownAtsExactFormFallback =
      isKnownApplicationHost(page.url()) &&
      companyMatched &&
      jobSpecificAtsPath &&
      await hasApplicationForm(page);
    const recruitingText = `${pageTitle} ${body.slice(0, 8_000)}`;
    const genericRecruitingDestination =
      /talent community|join our pack|register your interest|general application|general talent/i.test(
        recruitingText
      );
    const path = httpUrl(page.url())?.pathname.replace(/\/+$/, "") ?? "";
    const genericCareerLanding = path === "" || /^\/(?:careers?|jobs?)$/i.test(path);
    const titleMissingFromGenericLanding =
      Boolean(expectedTitleTokens.length) &&
      genericCareerLanding &&
      matchedTitleTokens.length === 0;

    const ok =
      (
        companyMatched && titleMatched ||
        externalExactTitleFallback ||
        knownAtsExactFormFallback
      ) &&
      !challengePage &&
      !unresolvedAggregator &&
      !genericRecruitingDestination &&
      !titleMissingFromGenericLanding;

    return {
      ok,
      reason: ok
        ? "Resolved page matches the expected employer and job context"
        : challengePage
          ? "Resolved page is an anti-bot challenge, not an application form"
          : unresolvedAggregator
            ? "Resolved page is still an aggregator listing and no application form is available"
            : genericRecruitingDestination
              ? "Resolved page is a generic talent-community/general-interest form, not the exact job application"
              : !titleMatched && !knownAtsExactFormFallback
                ? "Resolved page does not identify the expected job title strongly enough"
                : titleMissingFromGenericLanding
                  ? "Resolved page is only a generic careers landing page and does not identify the expected job"
                  : "Resolved page does not contain enough employer or exact-job evidence",
      matchedCompanyTokens,
      expectedCompanyTokens,
      pageTitle
    };
  } catch (error) {
    return {
      ok: false,
      reason: "Could not validate resolved employer page: " +
        (error instanceof Error ? error.message : String(error)),
      matchedCompanyTokens: [],
      expectedCompanyTokens,
      pageTitle: ""
    };
  } finally {
    await browser.close();
  }
}

const NON_APPLICATION_HOSTS = [
  /(^|\.)facebook\.com$/i,
  /(^|\.)instagram\.com$/i,
  /(^|\.)x\.com$/i,
  /(^|\.)twitter\.com$/i,
  /(^|\.)linkedin\.com$/i,
  /(^|\.)youtube\.com$/i,
  /(^|\.)producthunt\.com$/i
];

function isNonApplicationHost(url: string): boolean {
  const host = applicationHost(url);
  return NON_APPLICATION_HOSTS.some((pattern) => pattern.test(host));
}

function externalTargetScore(
  candidateUrl: string,
  label: string,
  sourceHost: string
): number {
  const targetHost = applicationHost(candidateUrl);
  if (!targetHost || targetHost === sourceHost) return -1;
  if (NON_APPLICATION_HOSTS.some((pattern) => pattern.test(targetHost))) return -1;
  if (/talent community|join our pack|register your interest|general application/i.test(label)) {
    return -1;
  }

  let score = 0;
  if (isKnownApplicationHost(candidateUrl)) score += 100;
  if (/application form|apply here|apply by|creative network|join our creative network/i.test(label)) score += 140;
  if (/apply|application|careers?|jobs?|join|work with us|company portal|employer portal|apply directly|prefer to apply directly|directly/i.test(label)) score += 60;
  if (/apply|application|careers?|jobs?|join|work/i.test(candidateUrl)) score += 30;
  if (!isAggregatorHost(candidateUrl)) score += 10;
  return score;
}

async function externalApplicationTargetFromPage(
  page: Page,
  sourceUrl: string
): Promise<string | null> {
  const sourceHost = applicationHost(sourceUrl);

  const links = await page.locator("a[href]").evaluateAll((nodes) =>
    nodes.map((node) => {
      const anchor = node as HTMLAnchorElement;
      return {
        href: anchor.href,
        label: [
          anchor.textContent ?? "",
          anchor.getAttribute("aria-label") ?? "",
          anchor.getAttribute("title") ?? ""
        ].join(" ")
      };
    })
  );

  const ranked = links
    .map((item) => ({
      ...item,
      score: externalTargetScore(item.href, item.label, sourceHost)
    }))
    .filter((item) => item.score >= 40)
    .sort((a, b) => b.score - a.score);

  if (ranked[0]?.href) {
    return httpUrl(ranked[0].href)?.toString() ?? null;
  }

  const body = await page.locator("body").innerText().catch(() => "");
  const textMatch = body.match(
    /(?:application\s+url|how\s+do\s+you\s+apply)[\s\S]{0,500}?(https?:\/\/[^\s<>"')\]]+)/i
  );

  if (textMatch?.[1]) {
    const candidate = textMatch[1].replace(/[.,;:!?]+$/, "");
    if (externalTargetScore(candidate, "application url", sourceHost) >= 40) {
      return httpUrl(candidate)?.toString() ?? null;
    }
  }

  return null;
}

async function hasApplicationForm(page: Page): Promise<boolean> {
  const controls = page.locator(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]), textarea, select'
  );
  const controlCount = await controls.count();
  if (controlCount < 2) return false;

  return Boolean(
    (await page.locator("form").count()) ||
    (await page.locator('input[type="file"]').count()) ||
    (await page.locator('button[type="submit"], input[type="submit"]').count()) ||
    (await page.getByRole("button", { name: /submit application|continue|next/i }).count())
  );
}

async function clickApplyLikeControl(page: Page): Promise<{ page: Page; moved: boolean }> {
  const candidates = [
    page.getByRole("link", { name: /^apply$/i }).first(),
    page.getByRole("link", { name: /apply (for this job|now)/i }).first(),
    page.getByRole("button", { name: /^apply$/i }).first(),
    page.getByRole("button", { name: /apply (for this job|now)/i }).first(),
    page.getByRole("link", { name: /continue to application/i }).first(),
    page.getByRole("button", { name: /continue to application/i }).first(),
    page.getByRole("link", { name: /application form|apply here|creative network|join our creative network/i }).first(),
    page.getByRole("button", { name: /application form|apply here|creative network|join our creative network/i }).first()
  ];

  for (const candidate of candidates) {
    if (!(await candidate.count()) || !(await candidate.isVisible().catch(() => false))) {
      continue;
    }

    const before = page.url();
    const href = await candidate.getAttribute("href").catch(() => null);

    if (href) {
      const target = httpUrl(new URL(href, before).toString());
      if (target) {
        if (isNonApplicationHost(target.toString())) {
          continue;
        }
        await page.goto(target.toString(), {
          waitUntil: "domcontentloaded",
          timeout: 30_000
        });
        await page.waitForTimeout(700);
        return { page, moved: page.url() !== before };
      }
    }

    const popupPromise = page.context().waitForEvent("page", { timeout: 3_000 }).catch(() => undefined);
    await candidate.click();
    const popup = await popupPromise;

    if (popup) {
      await popup.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
      await popup.waitForTimeout(700);
      if (isNonApplicationHost(popup.url())) {
        await popup.close().catch(() => undefined);
        continue;
      }
      return { page: popup, moved: true };
    }

    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(700);
    if (isNonApplicationHost(page.url())) {
      await page.goBack({ waitUntil: "domcontentloaded", timeout: 15_000 }).catch(() => undefined);
      await page.waitForTimeout(400).catch(() => undefined);
      continue;
    }
    return { page, moved: page.url() !== before };
  }

  return { page, moved: false };
}

async function resolveDeterministically(initialUrl: string): Promise<{
  url: string;
  strategy: "direct-form" | "playwright-follow" | "unresolved";
}> {
  const browser = await chromium.launch({ headless: true });

  try {
    const context = await browser.newContext({
      viewport: { width: 1440, height: 1100 },
      locale: "en-US"
    });
    let page = await context.newPage();
    await page.goto(initialUrl, {
      waitUntil: "domcontentloaded",
      timeout: 30_000
    });
    await page.waitForTimeout(600);

    if (isAggregatorHost(initialUrl)) {
      const preferredExternal = await externalApplicationTargetFromPage(page, initialUrl);
      if (preferredExternal) {
        await page.goto(preferredExternal, {
          waitUntil: "domcontentloaded",
          timeout: 30_000
        });
        await page.waitForTimeout(700);
      }
    }

    if (await hasApplicationForm(page)) {
      return {
        url: page.url(),
        strategy: page.url() === initialUrl ? "direct-form" : "playwright-follow"
      };
    }

    // A trusted aggregator can point first to the employer's job-description
    // page (Notion, company careers page, etc.), which then contains the real
    // external application-form link. Follow that explicit second hop too.
    const extractedTarget = await externalApplicationTargetFromPage(page, page.url());
    if (extractedTarget) {
      await page.goto(extractedTarget, {
        waitUntil: "domcontentloaded",
        timeout: 30_000
      });
      await page.waitForTimeout(700);
      return { url: page.url(), strategy: "playwright-follow" };
    }

    for (let step = 0; step < 3; step += 1) {
      const result = await clickApplyLikeControl(page);
      page = result.page;
      if (!result.moved) break;

      if (isKnownApplicationHost(page.url()) || await hasApplicationForm(page)) {
        return { url: page.url(), strategy: "playwright-follow" };
      }

      const extractedAfterMove = await externalApplicationTargetFromPage(page, initialUrl);
      if (extractedAfterMove) {
        await page.goto(extractedAfterMove, {
          waitUntil: "domcontentloaded",
          timeout: 30_000
        });
        await page.waitForTimeout(700);
        return { url: page.url(), strategy: "playwright-follow" };
      }
    }

    return {
      url: page.url(),
      strategy: page.url() !== initialUrl ? "playwright-follow" : "unresolved"
    };
  } finally {
    await browser.close();
  }
}

function stagehandConfigured(): boolean {
  return (
    (process.env.REMOTEJOBOS_ADAPTIVE_BROWSER ?? "").toLowerCase() === "stagehand" &&
    Boolean(process.env.STAGEHAND_MODEL) &&
    Boolean(process.env.STAGEHAND_MODEL_API_KEY)
  );
}

async function resolveWithStagehand(initialUrl: string): Promise<string | null> {
  if (!stagehandConfigured()) return null;

  const browser = await localBrowser.launch({
    headless: true,
    executablePath: chromium.executablePath()
  });

  try {
    const stagehand = await Stagehand.create({
      browser,
      cache: true,
      model: {
        modelName: process.env.STAGEHAND_MODEL! as never,
        apiKey: process.env.STAGEHAND_MODEL_API_KEY!
      }
    });

    try {
      const [page] = await browser.context.pages();
      if (!page) return null;

      await page.goto(initialUrl);

      const instruction =
        "Navigate only to the employer's actual job application form. " +
        "You may click Apply, Apply now, Continue to application, or an equivalent control. " +
        "Do not fill any field, do not sign in, do not accept terms, do not solve or bypass CAPTCHA, " +
        "and never click a final Submit application button. Stop as soon as the application form is visible.";

      await stagehand.act(instruction);
      let finalUrl = await page.url();

      if (finalUrl === initialUrl || isAggregatorHost(finalUrl)) {
        await stagehand.act(
          "If this is still only a job listing page, continue to the employer's actual application form. " +
          "Do not fill fields and do not submit anything."
        );
        finalUrl = await page.url();
      }

      return httpUrl(finalUrl)?.toString() ?? null;
    } finally {
      await stagehand.close();
    }
  } finally {
    await browser.close();
  }
}

export async function resolveApplicationTarget(
  initialUrl: string
): Promise<ApplicationTargetResolution> {
  const initial = httpUrl(initialUrl);
  if (!initial) {
    throw new Error("Application URL is not a valid HTTP(S) URL");
  }

  if (isKnownApplicationHost(initial.toString())) {
    return {
      url: initial.toString(),
      strategy: "direct-known-ats",
      changed: false,
      sourceHost: applicationHost(initial.toString()),
      targetHost: applicationHost(initial.toString()),
      adaptiveAttempted: false
    };
  }

  const deterministic = await resolveDeterministically(initial.toString()).catch(() => ({
    url: initial.toString(),
    strategy: "unresolved" as const
  }));

  if (
    deterministic.strategy !== "unresolved" &&
    (!isAggregatorHost(deterministic.url) || deterministic.url !== initial.toString())
  ) {
    return {
      url: deterministic.url,
      strategy: deterministic.strategy,
      changed: deterministic.url !== initial.toString(),
      sourceHost: applicationHost(initial.toString()),
      targetHost: applicationHost(deterministic.url),
      adaptiveAttempted: false
    };
  }

  const adaptiveUrl = await resolveWithStagehand(deterministic.url).catch((error) => {
    console.warn(
      "[application-target] Stagehand fallback failed:",
      error instanceof Error ? error.message : String(error)
    );
    return null;
  });

  if (adaptiveUrl && adaptiveUrl !== initial.toString()) {
    return {
      url: adaptiveUrl,
      strategy: "stagehand-follow",
      changed: true,
      sourceHost: applicationHost(initial.toString()),
      targetHost: applicationHost(adaptiveUrl),
      adaptiveAttempted: true
    };
  }

  return {
    url: deterministic.url,
    strategy: deterministic.strategy,
    changed: deterministic.url !== initial.toString(),
    sourceHost: applicationHost(initial.toString()),
    targetHost: applicationHost(deterministic.url),
    adaptiveAttempted: stagehandConfigured()
  };
}
