import { config, hasSupabase } from "./config.js";

type ProfileRow = { id: string };
type MatchRow = { job_id: string };
type CvRow = { id: string; job_id: string; created_at: string };
type ApplicationRow = { id: string; job_id: string; status: string };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!hasSupabase()) throw new Error("Supabase is required for application promotion");

  const response = await fetch(`${config.supabaseUrl}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: `Bearer ${config.supabaseServiceRoleKey}`,
      "content-type": "application/json",
      ...(init?.headers ?? {})
    }
  });

  if (!response.ok) {
    throw new Error(`Supabase request failed: ${response.status} ${await response.text()}`);
  }

  if (response.status === 204) return undefined as T;
  const body = await response.text();
  return (body ? JSON.parse(body) : undefined) as T;
}

export async function promoteStrongMatchesToApplications(): Promise<number> {
  if (!hasSupabase()) {
    console.log("[promote] Supabase is not configured; skipping.");
    return 0;
  }

  const profiles = await request<ProfileRow[]>(
    "career_profiles?select=id&order=updated_at.desc&limit=1"
  );
  const profile = profiles[0];
  if (!profile) {
    console.log("[promote] No career profile exists yet.");
    return 0;
  }

  const matches = await request<MatchRow[]>(
    `job_matches?select=job_id&profile_id=eq.${encodeURIComponent(profile.id)}&decision=eq.strong-match&order=created_at.desc&limit=150`
  );
  const strongJobIds = new Set(matches.map((row) => row.job_id));
  if (!strongJobIds.size) {
    console.log("[promote] No strong matches.");
    return 0;
  }

  const cvs = await request<CvRow[]>(
    `cv_versions?select=id,job_id,created_at&profile_id=eq.${encodeURIComponent(profile.id)}&order=created_at.desc&limit=500`
  );
  const latestCvByJob = new Map<string, string>();
  for (const cv of cvs) {
    if (strongJobIds.has(cv.job_id) && !latestCvByJob.has(cv.job_id)) {
      latestCvByJob.set(cv.job_id, cv.id);
    }
  }

  const applications = await request<ApplicationRow[]>(
    `applications?select=id,job_id,status&profile_id=eq.${encodeURIComponent(profile.id)}`
  );
  const existingJobIds = new Set(applications.map((row) => row.job_id));

  const newRows = [...latestCvByJob.entries()]
    .filter(([jobId]) => !existingJobIds.has(jobId))
    .map(([jobId, cvVersionId]) => ({
      job_id: jobId,
      profile_id: profile.id,
      cv_version_id: cvVersionId,
      status: "cv-prepared",
      autonomy_mode: "review",
      next_action: "cloud-dry-run"
    }));

  let created = 0;
  if (newRows.length) {
    const inserted = await request<ApplicationRow[]>(
      "applications?select=id,job_id,status",
      {
        method: "POST",
        headers: { prefer: "return=representation" },
        body: JSON.stringify(newRows)
      }
    );
    created = inserted.length;
  }

  const reviewable = await request<ApplicationRow[]>(
    `applications?select=id,job_id,status&profile_id=eq.${encodeURIComponent(profile.id)}&status=in.(cv-prepared,ready-for-review)`
  );

  const tasks = reviewable
    .filter((application) => application.status === "cv-prepared")
    .map((application) => ({
      task_type: "application-review",
      payload: { applicationId: application.id },
      status: "pending",
      priority: 50,
      idempotency_key: `application-review:${application.id}`
    }));

  if (tasks.length) {
    await request(
      "agent_tasks?on_conflict=idempotency_key",
      {
        method: "POST",
        headers: { prefer: "resolution=ignore-duplicates,return=minimal" },
        body: JSON.stringify(tasks)
      }
    );
  }

  console.log(`[promote] created=${created} review-tasks=${tasks.length}`);
  return created;
}
