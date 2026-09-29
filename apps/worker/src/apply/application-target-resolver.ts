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
  /eightfold\.ai$/i
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
    page.getByRole("button", { name: /continue to application/i }).first()
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
      return { page: popup, moved: true };
    }

    await page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch(() => undefined);
    await page.waitForTimeout(700);
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

    if (await hasApplicationForm(page)) {
      return { url: page.url(), strategy: "direct-form" };
    }

    for (let step = 0; step < 3; step += 1) {
      const result = await clickApplyLikeControl(page);
      page = result.page;
      if (!result.moved) break;

      if (isKnownApplicationHost(page.url()) || await hasApplicationForm(page)) {
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
        modelName: process.env.STAGEHAND_MODEL!,
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
      let finalUrl = page.url();

      if (finalUrl === initialUrl || isAggregatorHost(finalUrl)) {
        await stagehand.act(
          "If this is still only a job listing page, continue to the employer's actual application form. " +
          "Do not fill fields and do not submit anything."
        );
        finalUrl = page.url();
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
