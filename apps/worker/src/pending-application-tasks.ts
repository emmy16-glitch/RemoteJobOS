import { config, hasSupabase } from "./config.js";

export async function pendingApplicationTaskCount(): Promise<number> {
  if (!hasSupabase()) return 0;

  const response = await fetch(
    config.supabaseUrl +
      "/rest/v1/agent_tasks?select=id&task_type=eq.application-dry-run&status=in.(pending,failed)&limit=100",
    {
      headers: {
        apikey: config.supabaseServiceRoleKey,
        authorization: "Bearer " + config.supabaseServiceRoleKey
      }
    }
  );

  if (!response.ok) {
    throw new Error(
      "Could not inspect application task queue: " +
        response.status +
        " " +
        await response.text()
    );
  }

  const rows = await response.json() as Array<{ id: string }>;
  return rows.length;
}
