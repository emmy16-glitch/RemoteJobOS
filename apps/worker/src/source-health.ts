import { config, hasSupabase } from "./config.js";

type SourceState = {
  source: string;
  circuit_open_until?: string | null;
};

export async function sourceAvailable(source: string): Promise<boolean> {
  if (!hasSupabase()) return true;

  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/job_source_state?select=source,circuit_open_until&source=eq.${encodeURIComponent(source)}&limit=1`,
    {
      headers: {
        apikey: config.supabaseServiceRoleKey,
        authorization: `Bearer ${config.supabaseServiceRoleKey}`
      }
    }
  );

  if (!response.ok) return true;
  const rows = await response.json() as SourceState[];
  const until = rows[0]?.circuit_open_until;
  return !until || new Date(until).getTime() <= Date.now();
}

export async function recordSourceRun(input: {
  source: string;
  success: boolean;
  jobCount: number;
  durationMs: number;
  error?: string;
}): Promise<void> {
  if (!hasSupabase()) return;

  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/record_job_source_run`, {
    method: "POST",
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      p_source: input.source,
      p_success: input.success,
      p_job_count: input.jobCount,
      p_duration_ms: input.durationMs,
      p_error: input.error ?? null
    })
  });

  if (!response.ok) {
    console.error(`[source-health] failed to record ${input.source}: ${response.status}`);
  }
}
