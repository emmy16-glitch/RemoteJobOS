import { config, hasSupabase } from "./config.js";

export interface ClaimedTask {
  id: string;
  task_type: string;
  payload: Record<string, unknown>;
  lease_token: string;
  attempts: number;
  max_attempts: number;
}

async function rpc<T>(name: string, body: unknown): Promise<T> {
  if (!hasSupabase()) throw new Error("Supabase is required for queue operations");

  const response = await fetch(`${config.supabaseUrl}/rest/v1/rpc/${name}`, {
    method: "POST",
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    throw new Error(`RPC ${name} failed: ${response.status} ${await response.text()}`);
  }

  return response.json() as Promise<T>;
}

export async function claimTask(
  workerId: string,
  taskTypes?: string[],
  leaseSeconds = 900
): Promise<ClaimedTask | null> {
  const rows = await rpc<ClaimedTask[]>("claim_agent_task", {
    p_worker_id: workerId,
    p_task_types: taskTypes ?? null,
    p_lease_seconds: leaseSeconds
  });

  return rows[0] ?? null;
}

export async function finishTask(
  task: Pick<ClaimedTask, "id" | "lease_token">,
  success: boolean,
  error?: string,
  retryDelaySeconds = 300
): Promise<void> {
  const finished = await rpc<boolean>("finish_agent_task", {
    p_task_id: task.id,
    p_lease_token: task.lease_token,
    p_success: success,
    p_error: error ?? null,
    p_retry_delay_seconds: retryDelaySeconds
  });

  if (!finished) {
    throw new Error(`Task ${task.id} could not be finished; lease may be stale`);
  }
}

export async function claimTaskByIdempotencyKey(
  workerId: string,
  idempotencyKey: string,
  leaseSeconds = 900
): Promise<ClaimedTask | null> {
  const rows = await rpc<ClaimedTask[]>("claim_agent_task_by_key", {
    p_worker_id: workerId,
    p_idempotency_key: idempotencyKey,
    p_lease_seconds: leaseSeconds
  });

  return rows[0] ?? null;
}
