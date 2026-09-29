import type { ConfirmationResult, ApplicationStore } from "./types.js";
import { config, hasSupabase } from "../config.js";

type ProfileFact = {
  id?: string;
  kind?: string;
  title?: string;
  body?: string;
  url?: string;
  organization?: string;
  startDate?: string;
  endDate?: string;
  highlights?: string[];
  keywords?: string[];
  technologies?: string[];
};

type CareerProfilePayload = {
  verifiedAnswers?: Record<string, string>;
  assets?: Record<string, string>;
  facts?: ProfileFact[];
};

function compactText(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function normalizedAnswerKey(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function verifiedProfileAnswer(
  profile: CareerProfilePayload,
  ...keys: string[]
): string | undefined {
  const wanted = new Set(keys.map(normalizedAnswerKey));
  for (const [key, value] of Object.entries(profile.verifiedAnswers ?? {})) {
    if (wanted.has(normalizedAnswerKey(key)) && compactText(value)) {
      return compactText(value);
    }
  }
  return undefined;
}

function deriveSafeApplicationAnswers(
  profile: CareerProfilePayload,
  job: { source: string | null; title: string | null; company: string | null; description: string | null }
): Record<string, string> {
  const facts = profile.facts ?? [];
  const agentFacts = facts.filter((fact) => {
    const haystack = [
      fact.title,
      fact.body,
      ...(fact.keywords ?? []),
      ...(fact.technologies ?? [])
    ].join(" ");
    return /\bagent\b|ai agent|automation|orlynx|remotejobos|agentdesk|auctorail/i.test(haystack);
  });

  const built = agentFacts.slice(0, 4).map((fact) => {
    const title = compactText(fact.title) || "Technical automation project";
    const detail = compactText(fact.body);
    return detail ? `${title}: ${detail}` : title;
  });

  const answers: Record<string, string> = {};

  const fullName = verifiedProfileAnswer(
    profile,
    "full name",
    "fullname",
    "full_name",
    "legal name"
  );
  if (fullName) {
    const parts = fullName.split(/\s+/).filter(Boolean);
    const firstName = parts[0];
    const lastName = parts.length > 1 ? parts[parts.length - 1] : undefined;

    answers["full name"] = fullName;
    if (firstName) {
      answers["first name"] = firstName;
      answers.firstname = firstName;
      answers.first_name = firstName;
    }
    if (lastName) {
      answers["last name"] = lastName;
      answers.lastname = lastName;
      answers.last_name = lastName;
      answers.surname = lastName;
    }
  }

  const country = verifiedProfileAnswer(profile, "country", "country of residence");
  const city = verifiedProfileAnswer(profile, "city");
  const rawPhone = verifiedProfileAnswer(profile, "phone", "phone number", "mobile");
  if (rawPhone) {
    const compactPhone = rawPhone.replace(/[\s()-]+/g, "");
    const internationalPhone =
      /^(?:nigeria|ng)$/i.test(country ?? "") && /^0\d{10}$/.test(compactPhone)
        ? "+234" + compactPhone.slice(1)
        : rawPhone;
    answers.phone = internationalPhone;
    answers["phone number"] = internationalPhone;
    answers.mobile = internationalPhone;
  }

  if (city || country) {
    const currentLocation = [city, country].filter(Boolean).join(", ");
    answers["where are you presently located"] = currentLocation;
    answers["current location"] = currentLocation;
  }
  if (/^(?:nigeria|ng)$/i.test(country ?? "")) {
    answers["what region of the world do you live in"] = "Africa";
    answers["region of the world"] = "Africa";
  }

  if (built.length) {
    answers["what agents have you built"] =
      "I have built and worked on agent-oriented and automation systems including " +
      built.join(" ") +
      " My focus is on durable workflows, explicit tool boundaries, verification, and safe automation rather than unrestricted agent actions.";
  }

  const company = compactText(job.company) || "the company";
  const title = compactText(job.title) || "this role";
  answers[`what agents would you recommend building for ${company.toLowerCase()}`] =
    `For ${company}, I would prioritize agents around repetitive, measurable workflows: customer/support triage, operational exception handling, content or asset quality checks, and internal engineering/knowledge assistance. I would keep consequential actions behind verification and clear escalation paths so the agents automate routine work while humans handle ambiguous or high-impact cases.`;

  const profileSummary = verifiedProfileAnswer(profile, "professional summary");
  const usesSupabase = facts.some((fact) =>
    [fact.title, fact.body, ...(fact.technologies ?? []), ...(fact.keywords ?? [])]
      .join(" ")
      .toLowerCase()
      .includes("supabase")
  );

  const interestAnswer =
    `I am interested in joining ${company} because the ${title} role aligns closely with my hands-on work across software engineering, cybersecurity, DevOps, cloud infrastructure, QA automation, and production troubleshooting.` +
    (usesSupabase && /supabase/i.test(company)
      ? " I have also used Supabase and PostgreSQL in practical project work, so the product and engineering environment is directly relevant to tools I already work with."
      : "") +
    " I am especially motivated by roles where I can build reliable systems, improve developer or user workflows, and keep learning through real production problems.";

  answers[`why are you interested in joining the ${company.toLowerCase()} team`] = interestAnswer;
  answers[`why are you interested in joining ${company.toLowerCase()}`] = interestAnswer;
  answers["why are you interested in this role"] = interestAnswer;
  answers["why do you want to work here"] = interestAnswer;
  answers["why would you like to work with us and in this role"] = interestAnswer;
  answers["why would you like to work with us"] = interestAnswer;

  const education = facts.find((fact) =>
    fact.kind === "education" &&
    Boolean(compactText(fact.organization)) &&
    /bachelor|b\.?(?:tech|sc)|degree|university|college/i.test(
      [fact.title, fact.body, fact.organization].join(" ")
    )
  );
  if (education) {
    const school = compactText(education.organization);
    const degree = compactText(education.title);
    const startYear = compactText(education.startDate).match(/\b(19|20)\d{2}\b/)?.[0];
    const endYear = compactText(education.endDate).match(/\b(19|20)\d{2}\b/)?.[0];

    if (school) {
      answers.school = school;
      answers.university = school;
      answers.institution = school;
      answers["school name"] = school;
    }
    if (degree) {
      answers.degree = degree;
      answers["degree name"] = degree;
      answers["field of study"] = degree;
    }
    if (startYear) {
      answers["start year"] = startYear;
      answers["start date year"] = startYear;
      answers["education start year"] = startYear;
    }
    if (endYear) {
      answers["end year"] = endYear;
      answers["end date year"] = endYear;
      answers["graduation year"] = endYear;
      answers["expected graduation year"] = endYear;
    }
  }

  const postgresFacts = facts.filter((fact) =>
    [fact.title, fact.body, ...(fact.highlights ?? []), ...(fact.technologies ?? []), ...(fact.keywords ?? [])]
      .join(" ")
      .toLowerCase()
      .includes("postgres")
  );
  if (postgresFacts.length) {
    const postgresEvidence = postgresFacts.slice(0, 3).map((fact) => {
      const context = [compactText(fact.title), compactText(fact.body)]
        .filter(Boolean)
        .join(": ");
      return context;
    }).filter(Boolean);

    answers["describe your postgres experience"] =
      "I have hands-on PostgreSQL experience through software, backend, deployment, and cloud-hosted project work. " +
      (postgresEvidence.length ? postgresEvidence.join(" ") + " " : "") +
      "My work has focused on practical application data, integration, deployment, troubleshooting, and reliability rather than claiming database-scale experience I have not verified.";
  }

  const remoteAnswer =
    "I have worked across software development, cybersecurity, DevOps, QA automation, deployment, and technical product work using GitHub-based workflows, automated tests, CI/CD, issue-based collaboration, logs, and written technical documentation. " +
    "The practices that work best for me are clear task context, small reviewable changes, reproducible steps, frequent status updates, and automated checks that give the team shared evidence. " +
    "The main challenge in async or remote work is missing context or delayed feedback, so I reduce that by documenting decisions, attaching evidence such as logs or test results, and making handoffs explicit.";

  answers["tell us about your experience working in an async and or remote environment what practices or approaches have worked well for you what challenges have you faced"] = remoteAnswer;
  answers["remote work experience"] = remoteAnswer;
  answers["async work experience"] = remoteAnswer;

  if (profileSummary) {
    answers["professional summary"] = profileSummary;
  }

  return answers;
}

function sourceLabel(source: string | null): string | undefined {
  if (!source) return undefined;
  const labels: Record<string, string> = {
    remoteok: "Remote OK",
    remotive: "Remotive",
    arbeitnow: "Arbeitnow",
    himalayas: "Himalayas"
  };
  return labels[source.toLowerCase()] ?? source;
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  if (!hasSupabase()) throw new Error("Supabase is required for application persistence");

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

async function applicationContext(applicationId: string): Promise<{
  profileId: string | null;
  answers: Record<string, string>;
  profile: CareerProfilePayload;
  source: string | null;
  job: { source: string | null; title: string | null; company: string | null; description: string | null };
}> {
  const apps = await request<Array<{
    profile_id: string | null;
    job_id: string;
    answers: Record<string, string> | null;
  }>>(
    `applications?select=profile_id,job_id,answers&id=eq.${encodeURIComponent(applicationId)}&limit=1`
  );
  const app = apps[0];
  const profileId = app?.profile_id ?? null;

  const jobs = app?.job_id
    ? await request<Array<{ source: string; title: string; company: string; description: string }>>(
        `jobs?select=source,title,company,description&id=eq.${encodeURIComponent(app.job_id)}&limit=1`
      )
    : [];
  const source = jobs[0]?.source ?? null;
  const job = {
    source,
    title: jobs[0]?.title ?? null,
    company: jobs[0]?.company ?? null,
    description: jobs[0]?.description ?? null
  };

  if (!profileId) {
    return { profileId: null, answers: app?.answers ?? {}, profile: {}, source, job };
  }

  const profiles = await request<Array<{ profile: CareerProfilePayload }>>(
    `career_profiles?select=profile&id=eq.${encodeURIComponent(profileId)}&limit=1`
  );
  return {
    profileId,
    answers: app?.answers ?? {},
    profile: profiles[0]?.profile ?? {},
    source,
    job
  };
}

export type ApplicationStageObserver = (event: {
  stage: string;
  status: "started" | "blocked" | "failed" | "verified" | "submitted" | "unknown";
  report?: Record<string, unknown>;
  error?: string;
}) => Promise<void>;

export class SupabaseApplicationStore implements ApplicationStore {
  constructor(private readonly stageObserver?: ApplicationStageObserver) {}
  async getVerifiedAnswers(applicationId: string): Promise<Record<string, string>> {
    const context = await applicationContext(applicationId);
    const reusable = context.profileId
      ? await request<Array<{ answer_key: string; answer_value: string }>>(
          `answer_vault?select=answer_key,answer_value&profile_id=eq.${encodeURIComponent(context.profileId)}&reuse_policy=eq.always`
        )
      : [];

    const jobSource = sourceLabel(context.source);
    const derived = deriveSafeApplicationAnswers(context.profile, context.job);
    return {
      ...(context.profile.verifiedAnswers ?? {}),
      ...derived,
      ...(jobSource ? {
        "job source": jobSource,
        source: jobSource,
        "how did you hear about this role": jobSource,
        "how did you hear about this job": jobSource
      } : {}),
      ...Object.fromEntries(reusable.map((row) => [row.answer_key, row.answer_value])),
      ...(context.answers ?? {})
    };
  }

  async getAutoApprovedAnswerKeys(applicationId: string): Promise<string[]> {
    const context = await applicationContext(applicationId);
    const reusable = context.profileId
      ? await request<Array<{ answer_key: string }>>(
          `answer_vault?select=answer_key&profile_id=eq.${encodeURIComponent(context.profileId)}&reuse_policy=eq.always`
        )
      : [];

    return [
      ...reusable.map((row) => row.answer_key),
      ...Object.keys(context.answers ?? {})
    ];
  }

  async getAssets(applicationId: string): Promise<Record<string, string>> {
    return (await applicationContext(applicationId)).profile.assets ?? {};
  }

  async canSubmit(applicationId: string): Promise<{ allowed: boolean; reason: string }> {
    const rows = await request<Array<{ allowed: boolean; reason: string }>>(
      "rpc/can_submit_application",
      {
        method: "POST",
        body: JSON.stringify({ p_application_id: applicationId })
      }
    );
    return rows[0] ?? { allowed: false, reason: "submission-policy-unavailable" };
  }

  async startAttempt(applicationId: string, workerId: string): Promise<string> {
    const rows = await request<Array<{ id: string }>>("application_attempts?select=id", {
      method: "POST",
      headers: { prefer: "return=representation" },
      body: JSON.stringify({
        application_id: applicationId,
        worker_id: workerId,
        stage: "detect",
        status: "started"
      })
    });

    const id = rows[0]?.id;
    if (!id) throw new Error("Could not create application attempt");

    await request(`applications?id=eq.${encodeURIComponent(applicationId)}`, {
      method: "PATCH",
      body: JSON.stringify({ last_attempt_id: id })
    });

    return id;
  }

  async recordStage(
    attemptId: string,
    stage: string,
    status: "started" | "blocked" | "failed" | "verified" | "submitted" | "unknown",
    report: Record<string, unknown> = {},
    error?: string
  ): Promise<void> {
    await request(`application_attempts?id=eq.${encodeURIComponent(attemptId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        stage,
        status,
        field_report: report,
        error: error ?? null,
        finished_at: status === "started" ? null : new Date().toISOString()
      })
    });

    await request("agent_events", {
      method: "POST",
      body: JSON.stringify({
        event_type: `application.${stage}`,
        severity: status === "failed" || status === "blocked" ? "warning" : "info",
        message: `Application stage ${stage}: ${status}`,
        metadata: { attemptId, stage, status, ...report, error: error ?? null }
      })
    });

    await this.stageObserver?.({
      stage,
      status,
      report,
      error
    });
  }

  async fenceSubmission(applicationId: string, attemptId: string): Promise<boolean> {
    const rows = await request<Array<{ id: string }>>(
      `applications?id=eq.${encodeURIComponent(applicationId)}&submission_fenced_at=is.null&submitted_at=is.null&select=id`,
      {
        method: "PATCH",
        headers: { prefer: "return=representation" },
        body: JSON.stringify({
          submission_fenced_at: new Date().toISOString(),
          last_attempt_id: attemptId
        })
      }
    );

    return rows.length === 1;
  }

  async releaseSubmissionFence(applicationId: string, attemptId: string): Promise<boolean> {
    const released = await request<boolean>("rpc/release_submission_fence", {
      method: "POST",
      body: JSON.stringify({
        p_application_id: applicationId,
        p_attempt_id: attemptId
      })
    });
    return released === true;
  }

  async markSubmitted(applicationId: string, confirmation: ConfirmationResult): Promise<void> {
    await request(`applications?id=eq.${encodeURIComponent(applicationId)}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "applied",
        submitted_at: new Date().toISOString(),
        confirmation_verified_at: confirmation.confirmed ? new Date().toISOString() : null,
        confirmation_url: confirmation.url ?? null
      })
    });
  }
}
