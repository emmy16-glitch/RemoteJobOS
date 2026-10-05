import { config, hasSupabase } from "./config.js";

type ApplicationRow = {
  id: string;
  job_id: string;
  profile_id: string | null;
  cv_version_id: string | null;
  status: string;
  submission_fenced_at: string | null;
  submitted_at: string | null;
};

type MatchRow = {
  job_id: string;
  profile_id: string;
};

type CvRow = {
  id: string;
  job_id: string | null;
  profile_id: string;
  created_at: string;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
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
  const text = await response.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

async function requestAll<T>(path: string, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];
  let offset = 0;
  while (true) {
    const separator = path.includes("?") ? "&" : "?";
    const page = await request<T[]>(`${path}${separator}limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
    offset += page.length;
  }
}

/**
 * A newly generated CV is a new automation input. Previously-shortlisted
 * applications were left permanently parked even after prepare-cvs produced a
 * fresh CV for a current strong match. Revive only those applications whose
 * CV actually changed. syncApplications() immediately re-applies the normal
 * URL/role safety gates before creating browser tasks, so discovery-only or
 * otherwise ineligible jobs are put back on the shortlist without execution.
 */
export async function requeueApplicationsWithFreshCv(): Promise<number> {
  if (!hasSupabase()) return 0;

  const applications = await requestAll<ApplicationRow>(
    "applications?select=id,job_id,profile_id,cv_version_id,status,submission_fenced_at,submitted_at&status=eq.shortlisted&submitted_at=is.null&submission_fenced_at=is.null"
  );
  if (!applications.length) return 0;

  const matches = await requestAll<MatchRow>(
    "job_matches?select=job_id,profile_id&decision=eq.strong-match"
  );
  const strong = new Set(matches.map((row) => `${row.profile_id}:${row.job_id}`));

  const cvs = await requestAll<CvRow>(
    "cv_versions?select=id,job_id,profile_id,created_at&job_id=not.is.null&order=created_at.desc"
  );
  const newest = new Map<string, CvRow>();
  for (const cv of cvs) {
    if (!cv.job_id) continue;
    const key = `${cv.profile_id}:${cv.job_id}`;
    if (!newest.has(key)) newest.set(key, cv);
  }

  const revive = applications.flatMap((application) => {
    if (!application.profile_id) return [];
    const key = `${application.profile_id}:${application.job_id}`;
    if (!strong.has(key)) return [];
    const cv = newest.get(key);
    if (!cv || cv.id === application.cv_version_id) return [];
    return [{ application, cv }];
  });

  for (const { application, cv } of revive) {
    await request(
      `applications?id=eq.${encodeURIComponent(application.id)}&status=eq.shortlisted&submitted_at=is.null&submission_fenced_at=is.null`,
      {
        method: "PATCH",
        body: JSON.stringify({
          cv_version_id: cv.id,
          status: "cv-prepared",
          next_action: "cloud-dry-run",
          updated_at: new Date().toISOString()
        })
      }
    );
  }

  console.log(`[application-queue] revived=${revive.length} shortlisted application(s) with fresh CVs`);
  return revive.length;
}
