import { spawn, type ChildProcess } from "node:child_process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type AutomationState = {
  child?: ChildProcess;
  startedAt?: string;
  lastExitCode?: number | null;
};

const globalState = globalThis as typeof globalThis & {
  __remoteJobOsAutomation?: AutomationState;
};

function state(): AutomationState {
  if (!globalState.__remoteJobOsAutomation) {
    globalState.__remoteJobOsAutomation = {};
  }
  return globalState.__remoteJobOsAutomation;
}

function authorized(request: Request): boolean {
  const secret = process.env.REMOTEJOBOS_HEARTBEAT_TOKEN;
  if (!secret) return false;
  return request.headers.get("authorization") === "Bearer " + secret;
}

export async function POST(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const current = state();
  if (current.child && current.child.exitCode === null) {
    return Response.json({
      ok: true,
      accepted: false,
      reason: "cycle-already-running",
      startedAt: current.startedAt ?? null
    }, { status: 202 });
  }

  const child = spawn(
    "npx",
    ["tsx", "apps/worker/src/render-cycle.ts"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        REMOTEJOBOS_ALLOW_SUBMIT: "true",
        REMOTEJOBOS_DRY_RUN: "false",
        REMOTEJOBOS_MAX_REVIEW_TASKS: process.env.REMOTEJOBOS_RENDER_REVIEW_TASKS ?? "2",
        REMOTEJOBOS_MAX_AUTO_SUBMIT_TASKS: process.env.REMOTEJOBOS_RENDER_SUBMIT_TASKS ?? "2"
      },
      stdio: "inherit"
    }
  );

  current.child = child;
  current.startedAt = new Date().toISOString();
  current.lastExitCode = null;

  child.once("exit", (code) => {
    const latest = state();
    latest.lastExitCode = code;
    if (latest.child === child) latest.child = undefined;
  });

  child.once("error", (error) => {
    console.error("[automation-heartbeat] child process failed:", error);
    const latest = state();
    latest.lastExitCode = -1;
    if (latest.child === child) latest.child = undefined;
  });

  child.unref();

  return Response.json({
    ok: true,
    accepted: true,
    startedAt: current.startedAt
  }, { status: 202 });
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const current = state();
  return Response.json({
    ok: true,
    running: Boolean(current.child && current.child.exitCode === null),
    startedAt: current.startedAt ?? null,
    lastExitCode: current.lastExitCode ?? null
  });
}
