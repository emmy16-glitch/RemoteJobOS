import { config, hasSupabase } from "./config.js";
import { sourceFromBoard, type AtsBoard, type AtsProvider } from "./sources/ats.js";
import type { JobSource } from "./sources/types.js";

type RegistryRow = {
  provider: AtsProvider;
  board_key: string;
};

export async function loadRegisteredAtsSources(): Promise<JobSource[]> {
  if (!hasSupabase()) return [];

  const response = await fetch(
    `${config.supabaseUrl}/rest/v1/job_source_registry?select=provider,board_key&enabled=eq.true&order=provider.asc,board_key.asc&limit=1000`,
    {
      headers: {
        apikey: config.supabaseServiceRoleKey,
        authorization: `Bearer ${config.supabaseServiceRoleKey}`
      }
    }
  );

  if (!response.ok) {
    throw new Error(`Could not load ATS registry: ${response.status} ${await response.text()}`);
  }

  const rows = (await response.json()) as RegistryRow[];
  return rows
    .filter((row) => Boolean(row.provider && row.board_key?.trim()))
    .map((row) => sourceFromBoard({
      provider: row.provider,
      boardKey: row.board_key.trim()
    } satisfies AtsBoard));
}
