import { existsSync } from "node:fs";
import { spawn } from "node:child_process";
import { chromium } from "playwright";
import { discoverJobs } from "./discover.js";
import { matchJobs } from "./match.js";
import { enrichApplicationTargets } from "./target-enrichment.js";
import { prepareCvPlans } from "./prepare-cvs.js";
import { requeueApplicationsWithFreshCv } from "./requeue-fresh-cv.js";
import {
  syncApplications,
  processApplicationTasks,
  processAutoSubmissionTasks
} from "./application-queue.js";
import {
  syncGmailLifecycle,
  sendPendingNotifications
} from "./gmail-automation.js";

type StepResult = {
  name: string;
  ok: boolean;
  error?: string;
};

async function runStep(name: string, fn: () => Promise<unknown>): Promise<StepResult> {
  const started = Date.now();
  console.log("[render-cycle] start " + name);
  try {
    await fn();
    console.log("[render-cycle] done " + name + " in " + (Date.now() - started) + "ms");
    return { name, ok: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[render-cycle] failed " + name + ": " + message);
    return { name, ok: false, error: message };
  }
}

async function ensureChromium(): Promise<void> {
  const path = chromium.executablePath();
  if (existsSync(path)) return;

  console.log("[render-cycle] Chromium missing; installing Playwright Chromium once for this Render instance.");
  await new Promise<void>((resolve, reject) => {
    const child = spawn("npx", ["playwright", "install", "chromium"], {
      cwd: process.cwd(),
      stdio: "inherit",
      env: process.env
    });

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error("Chromium install exceeded 5 minutes"));
    }, 5 * 60_000);

    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error("Chromium install exited with code " + String(code)));
    });
  });
}

export async function runRenderAutomationCycle() {
  const results: StepResult[] = [];

  results.push(await runStep("discover", () => discoverJobs()));
  results.push(await runStep("match", () => matchJobs()));

  // Target enrichment scans the full jobs/matches corpus and can temporarily use
  // hundreds of MB. On the 512 MB Render web service that can kill the process
  // before queued applications are reviewed/submitted. Keep it opt-out so larger
  // workers can still run it, while the constrained production web service can
  // prioritize the application pipeline and run enrichment elsewhere/later.
  if (process.env.REMOTEJOBOS_RENDER_TARGET_ENRICHMENT !== "false") {
    results.push(await runStep("enrich-targets", () => enrichApplicationTargets()));
  } else {
    console.log("[render-cycle] skip enrich-targets (REMOTEJOBOS_RENDER_TARGET_ENRICHMENT=false)");
  }

  results.push(await runStep("prepare-cvs", () => prepareCvPlans()));
  results.push(await runStep("requeue-fresh-cvs", () => requeueApplicationsWithFreshCv()));
  results.push(await runStep("sync-applications", () => syncApplications()));

  const browserReady = await runStep("chromium-ready", () => ensureChromium());
  results.push(browserReady);

  if (browserReady.ok) {
    const reviewLimit = Math.max(
      1,
      Math.min(5, Number(process.env.REMOTEJOBOS_RENDER_REVIEW_TASKS ?? "2") || 2)
    );
    const submitLimit = Math.max(
      1,
      Math.min(5, Number(process.env.REMOTEJOBOS_RENDER_SUBMIT_TASKS ?? "2") || 2)
    );

    results.push(
      await runStep("application-review", () => processApplicationTasks(reviewLimit))
    );
    results.push(
      await runStep("auto-submit", () => processAutoSubmissionTasks(submitLimit))
    );
  }

  results.push(await runStep("gmail-sync", () => syncGmailLifecycle()));
  results.push(await runStep("notifications", () => sendPendingNotifications(20)));

  const failed = results.filter((result) => !result.ok);
  console.log(JSON.stringify({
    event: "render-cycle.completed",
    ok: failed.length === 0,
    failed: failed.map((result) => result.name),
    results,
    timestamp: new Date().toISOString()
  }));

  if (failed.length) process.exitCode = 1;
}

if (process.argv[1]?.endsWith("render-cycle.ts") || process.argv[1]?.endsWith("render-cycle.js")) {
  await runRenderAutomationCycle();
}
