import { config, hasSupabase } from "./config.js";

type ProfileRow = {
  id: string;
  profile?: {
    settings?: {
      autonomyMode?: string;
    };
  };
};

type CvRow = {
  id: string;
  job_id: string | null;
  profile_id: string | null;
};

type ApplicationRow = {
  id: string;
  job_id: string;
  profile_id: string | null;
  cv_version_id: string | null;
  status: string;
};

async function getJson<T>(pathPart: string): Promise<T> {
  const response = await fetch(config.supabaseUrl + "/rest/v1/" + pathPart, {
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: "Bearer " + config.supabaseServiceRoleKey
    }
  });
  if (!response.ok) throw new Error("Supabase GET failed: " + response.status + " " + await response.text());
  return response.json() as Promise<T>;
}

async function postJson<T>(pathPart: string, body: unknown): Promise<T> {
  const response = await fetch(config.supabaseUrl + "/rest/v1/" + pathPart, {
    method: "POST",
    headers: {
      apikey: config.supabaseServiceRoleKey,
      authorization: "Bearer " + config.supabaseServiceRoleKey,
      "content-type": "application/json",
      prefer: "return=representation"
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error("Supabase POST failed: " + response.status + " " + await response.text());
  return response.json() as Promise<T>;
}

export async function syncApplications() {
  if (!hasSupabase()) {
    console.log("[applications] Supabase is not configured; skipping queue sync.");
    return 0;
  }

  const profiles = await getJson<ProfileRow[]>(
    "career_profiles?select=id,profile&order=updated_at.desc&limit=1"
  );
  const profile = profiles[0];
  if (!profile) {
    console.log("[applications] No career profile exists yet.");
    return 0;
  }

  const autonomyMode = profile.profile?.settings?.autonomyMode === "auto"
    ? "auto"
    : "review";

  const cvs = await getJson<CvRow[]>(
    "cv_versions?select=id,job_id,profile_id&profile_id=eq." +
      encodeURIComponent(profile.id) +
      "&job_id=not.is.null&order=created_at.desc&limit=500"
  );

  const existing = await getJson<ApplicationRow[]>(
    "applications?select=id,job_id,profile_id,cv_version_id,status&profile_id=eq." +
      encodeURIComponent(profile.id) +
      "&limit=1000"
  );

  const byJob = new Map(existing.map((row) => [row.job_id, row]));
  const newestCvByJob = new Map<string, CvRow>();

  for (const cv of cvs) {
    if (!cv.job_id || newestCvByJob.has(cv.job_id)) continue;
    newestCvByJob.set(cv.job_id, cv);
  }

  const newRows = [...newestCvByJob.values()]
    .filter((cv) => cv.job_id && !byJob.has(cv.job_id))
    .map((cv) => ({
      job_id: cv.job_id,
      profile_id: profile.id,
      cv_version_id: cv.id,
      status: "cv-prepared",
      autonomy_mode: autonomyMode,
      next_action: "Run verified application dry-run"
    }));

  let created: ApplicationRow[] = [];
  if (newRows.length) {
    created = await postJson<ApplicationRow[]>(
      "applications?select=id,job_id,profile_id,cv_version_id,status",
      newRows
    );
  }

  const allApplications = [...existing, ...created];
  const taskCandidates = allApplications.filter((app) => app.status === "cv-prepared" && app.cv_version_id);

  const existingTaskKeys = await getJson<Array<{ idempotency_key: string | null }>>(
    "agent_tasks?select=idempotency_key&task_type=eq.application-dry-run&limit=2000"
  );
  const knownKeys = new Set(existingTaskKeys.map((row) => row.idempotency_key).filter(Boolean));

  const tasks = taskCandidates
    .map((app) => ({
      task_type: "application-dry-run",
      payload: { applicationId: app.id },
      status: "pending",
      priority: 50,
      max_attempts: 3,
      idempotency_key: "application-dry-run:" + app.id + ":" + app.cv_version_id
    }))
    .filter((task) => !knownKeys.has(task.idempotency_key));

  if (tasks.length) {
    await postJson("agent_tasks", tasks);
  }

  console.log(
    "[applications] created=" + created.length +
    " dry-run-tasks=" + tasks.length +
    " total-ready=" + taskCandidates.length
  );

  return created.length + tasks.length;
}
