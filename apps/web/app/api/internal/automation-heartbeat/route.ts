import { spawn, type ChildProcess } from "node:child_process";
import { resolve } from "node:path";

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

async function authorized(request: Request): Promise<boolean> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  const supabaseUrl = process.env.SUPABASE_URL ?? "";
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!token || !supabaseUrl || !serviceRoleKey) {
    console.error("[automation-heartbeat] auth prerequisites missing", {
      hasToken: Boolean(token),
      hasSupabaseUrl: Boolean(supabaseUrl),
      hasServiceRoleKey: Boolean(serviceRoleKey)
    });
    return false;
  }

  try {
    const response = await fetch(
      supabaseUrl + "/rest/v1/rpc/validate_automation_heartbeat",
      {
        method: "POST",
        headers: {
          apikey: serviceRoleKey,
          authorization: "Bearer " + serviceRoleKey,
          "content-type": "application/json"
        },
        body: JSON.stringify({ p_token: token }),
        cache: "no-store"
      }
    );

    if (!response.ok) {
      console.error("[automation-heartbeat] Supabase validator request failed", {
        status: response.status,
        body: (await response.text()).slice(0, 500)
      });
      return false;
    }

    const valid = (await response.json()) === true;
    if (!valid) {
      console.error("[automation-heartbeat] Supabase validator rejected heartbeat");
    }
    return valid;
  } catch (error) {
    console.error(
      "[automation-heartbeat] validator transport error",
      error instanceof Error ? error.message : String(error)
    );
    return false;
  }
}

export async function POST(request: Request) {
  if (!(await authorized(request))) {
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

  const currentWorkingDirectory = process.cwd();
  const repositoryRoot = currentWorkingDirectory.endsWith("/apps/web")
    ? resolve(currentWorkingDirectory, "../..")
    : currentWorkingDirectory;

  const child = spawn(
    "npx",
    ["tsx", "apps/worker/src/render-cycle.ts"],
    {
      cwd: repositoryRoot,
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
  if (!(await authorized(request))) {
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
