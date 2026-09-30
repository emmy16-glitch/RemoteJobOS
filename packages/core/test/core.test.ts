import assert from "node:assert/strict";
import test from "node:test";
import {
  classifyRemoteScope,
  classifyRoleFamily,
  scoreJob,
  type CareerProfile,
  type NormalizedJob
} from "../src/index.ts";

test("classifies worldwide remote scope", () => {
  assert.equal(classifyRemoteScope("Remote worldwide — work from anywhere"), "global");
});

test("classifies US-only restrictions before global wording", () => {
  assert.equal(
    classifyRemoteScope("Global company. Remote role, US residents only."),
    "us-only"
  );
});

test("classifies broad technical role families", () => {
  assert.equal(classifyRoleFamily("SOC Security Analyst"), "cybersecurity");
  assert.equal(classifyRoleFamily("Business Intelligence Data Analyst"), "data");
  assert.equal(classifyRoleFamily("Site Reliability Engineer"), "devops");
});

test("rejects a non-remote job immediately", () => {
  const profile: CareerProfile = {
    skills: ["linux", "docker"],
    roleFamilies: ["devops"],
    maxSeniority: "junior"
  };
  const job: NormalizedJob = {
    source: "test",
    externalId: "1",
    title: "Junior DevOps Engineer",
    company: "Example",
    description: "Linux and Docker",
    applyUrl: "https://example.com",
    remote: false,
    remoteScope: "unknown",
    roleFamily: "devops",
    tags: []
  };
  const result = scoreJob(job, profile);
  assert.equal(result.decision, "reject");
  assert.equal(result.total, 0);
});

test("any-seniority mode does not cap senior technical roles", () => {
  const profile: CareerProfile = {
    skills: ["linux", "docker", "git"],
    roleFamilies: ["devops"],
    seniorityMode: "any",
    maxSeniority: "junior",
    country: "Nigeria"
  };
  const job: NormalizedJob = {
    source: "test",
    externalId: "seniority-any",
    title: "Senior DevOps Engineer",
    company: "Example",
    description: "Remote worldwide role using Linux, Docker and Git.",
    applyUrl: "https://example.com/apply",
    remote: true,
    remoteScope: "global",
    roleFamily: "devops",
    tags: ["linux", "docker", "git"]
  };

  const result = scoreJob(job, profile);
  assert.equal(result.breakdown.seniority, 15);
  assert.match(result.reasons.join(" "), /any seniority/i);
});

test("marks a strong, eligible remote role as a strong match", () => {
  const profile: CareerProfile = {
    skills: ["linux", "docker", "git"],
    roleFamilies: ["devops", "cloud"],
    maxSeniority: "junior",
    blockedRequirements: ["ts/sci clearance"]
  };
  const job: NormalizedJob = {
    source: "test",
    externalId: "2",
    title: "Junior DevOps Engineer",
    company: "Example",
    description: "Remote worldwide role using Linux, Docker and Git.",
    applyUrl: "https://example.com/apply",
    remote: true,
    remoteScope: "global",
    roleFamily: "devops",
    tags: ["linux", "docker", "git"]
  };
  const result = scoreJob(job, profile);
  assert.equal(result.decision, "strong-match");
  assert.ok(result.total >= 75);
});


test("keeps CV plans fact-locked and selects relevant verified facts", async () => {
  const { planResume, materializeResumeFacts } = await import("../src/resume.ts");
  const job: NormalizedJob = {
    source: "test",
    externalId: "cv-1",
    title: "Junior Security Analyst",
    company: "Example",
    description: "Remote role using Linux, Wireshark, network security and vulnerability analysis.",
    applyUrl: "https://example.com/apply",
    remote: true,
    remoteScope: "global",
    roleFamily: "cybersecurity",
    tags: ["linux", "wireshark", "security"]
  };
  const facts = [
    {
      id: "security-lab",
      kind: "project" as const,
      title: "Mobile Security Lab",
      body: "Used Wireshark and Linux for traffic and security analysis.",
      keywords: ["wireshark", "linux", "security"],
      roleFamilies: ["cybersecurity" as const]
    },
    {
      id: "design-project",
      kind: "project" as const,
      title: "UI Design",
      body: "Designed marketing layouts.",
      keywords: ["figma"],
      roleFamilies: ["product-technical" as const]
    }
  ];

  const plan = planResume(job, facts, 1);
  assert.equal(plan.selected[0]?.factId, "security-lab");
  const selected = materializeResumeFacts(plan, facts);
  assert.equal(selected[0]?.body, facts[0].body);
  assert.equal(selected.length, 1);
});




test("keeps CV v2 balanced and audits verified relevance", async () => {
  const { planResume, materializeResumeFacts, auditResumePlan } = await import("../src/resume.ts");
  const job: NormalizedJob = {
    source: "test",
    externalId: "cv-v2",
    title: "DevOps Engineer",
    company: "Example",
    description: "Remote role using Linux, Docker, GitHub Actions, CI/CD and cloud deployment.",
    applyUrl: "https://example.com/apply",
    remote: true,
    remoteScope: "global",
    roleFamily: "devops",
    tags: ["linux", "docker", "github actions", "ci/cd"]
  };
  const facts = [
    {
      id: "exp",
      kind: "experience" as const,
      title: "DevOps Engineer",
      organization: "Example Systems",
      body: "Built and supported Linux deployment workflows.",
      keywords: ["linux", "deployment"],
      technologies: ["Docker", "GitHub Actions"],
      roleFamilies: ["devops" as const]
    },
    {
      id: "edu",
      kind: "education" as const,
      title: "B.Tech. Cybersecurity",
      organization: "Example University",
      body: "Bachelor of Technology in Cybersecurity.",
      keywords: ["cybersecurity"]
    },
    ...Array.from({ length: 8 }, (_, index) => ({
      id: "project-" + index,
      kind: "project" as const,
      title: "Docker Project " + index,
      body: "Containerized a Linux service with Docker and CI/CD.",
      keywords: ["docker", "linux", "ci/cd"],
      roleFamilies: ["devops" as const]
    }))
  ];

  const plan = planResume(job, facts, 8);
  const selected = materializeResumeFacts(plan, facts);
  const report = auditResumePlan(job, plan, facts);

  assert.equal(plan.strategy, "verified-facts-v2");
  assert.ok(selected.some((fact) => fact.kind === "experience"));
  assert.ok(selected.some((fact) => fact.kind === "education"));
  assert.ok(selected.filter((fact) => fact.kind === "project").length <= 4);
  assert.ok(report.selectedFactCount > 0);
  assert.ok(report.score > 0);
});

test("rejects a remote role when explicit country scope does not match profile", () => {
  const profile: CareerProfile = {
    skills: ["linux", "docker", "git"],
    roleFamilies: ["devops"],
    maxSeniority: "junior",
    country: "Nigeria"
  };

  const job: NormalizedJob = {
    source: "test",
    externalId: "geo-us",
    title: "Junior DevOps Engineer",
    company: "Example",
    description: "Linux Docker Git",
    applyUrl: "https://example.com/apply",
    locationText: "United States",
    remote: true,
    remoteScope: "us-only",
    roleFamily: "devops",
    tags: ["linux", "docker", "git"]
  };

  const result = scoreJob(job, profile);
  assert.equal(result.decision, "reject");
  assert.match(result.reasons.join(" "), /US-only remote scope does not match/i);
});

test("allows Africa-scoped remote roles for a Nigeria profile", () => {
  const profile: CareerProfile = {
    skills: ["linux", "docker", "git"],
    roleFamilies: ["devops"],
    maxSeniority: "junior",
    country: "Nigeria"
  };

  const job: NormalizedJob = {
    source: "test",
    externalId: "geo-africa",
    title: "Junior DevOps Engineer",
    company: "Example",
    description: "Linux Docker Git",
    applyUrl: "https://example.com/apply",
    locationText: "Africa",
    remote: true,
    remoteScope: "africa",
    roleFamily: "devops",
    tags: ["linux", "docker", "git"]
  };

  const result = scoreJob(job, profile);
  assert.equal(result.decision, "strong-match");
  assert.equal(result.breakdown.eligibility, 15);
});

test("forces review when a restricted remote role is missing profile country", () => {
  const profile: CareerProfile = {
    skills: ["linux", "docker", "git"],
    roleFamilies: ["devops"],
    maxSeniority: "junior"
  };

  const job: NormalizedJob = {
    source: "test",
    externalId: "geo-unknown-user",
    title: "Junior DevOps Engineer",
    company: "Example",
    description: "Linux Docker Git",
    applyUrl: "https://example.com/apply",
    locationText: "Germany, France",
    remote: true,
    remoteScope: "country-restricted",
    roleFamily: "devops",
    tags: ["linux", "docker", "git"]
  };

  const result = scoreJob(job, profile);
  assert.equal(result.decision, "review");
  assert.ok(result.missingSignals.some((item) => /eligibility requires review/i.test(item)));
});


test("classifies job lifecycle emails without an AI provider", async () => {
  const { classifyJobEmail } = await import("../src/email.ts");

  assert.equal(
    classifyJobEmail({
      subject: "Thank you for applying",
      snippet: "We have received your application."
    }).classification,
    "application-received"
  );

  assert.equal(
    classifyJobEmail({
      subject: "Interview availability",
      snippet: "Please select a time to meet with the hiring manager."
    }).classification,
    "interview"
  );

  assert.equal(
    classifyJobEmail({
      subject: "Application update",
      snippet: "Unfortunately, we will not be moving forward with your application."
    }).classification,
    "rejection"
  );
});


test("harness exposes progressive tool families by phase", async () => {
  const {
    toolFamiliesForPhase,
    recoveryDisposition,
    canStartHarnessStep,
    remainingHarnessSteps,
    toolFamilyAllowed,
    assertToolFamilyAllowed,
    retryDelayMs,
    DEFAULT_SAFE_SUBMIT_RETRIES
  } = await import("../src/harness.ts");

  assert.deepEqual(toolFamiliesForPhase("scan"), ["browser"]);
  assert.deepEqual(
    toolFamiliesForPhase("submit"),
    ["browser", "policy", "submission"]
  );
  assert.equal(toolFamilyAllowed("scan", "browser"), true);
  assert.equal(toolFamilyAllowed("scan", "submission"), false);
  assert.throws(
    () => assertToolFamilyAllowed("approval", "submission"),
    /policy denied/i
  );
  assert.equal(DEFAULT_SAFE_SUBMIT_RETRIES, 3);
  assert.equal(retryDelayMs(1), 1000);
  assert.equal(retryDelayMs(2), 2000);
  assert.equal(canStartHarnessStep({ used: 4, limit: 5 }), true);
  assert.equal(canStartHarnessStep({ used: 5, limit: 5 }), false);
  assert.equal(remainingHarnessSteps({ used: 4, limit: 5 }), 1);
  assert.equal(
    recoveryDisposition({
      submissionFencedAt: null,
      submittedAt: null,
      confirmationVerifiedAt: null
    }),
    "safe-restart"
  );
  assert.equal(
    recoveryDisposition({
      submissionFencedAt: "2026-09-28T00:00:00Z",
      submittedAt: null,
      confirmationVerifiedAt: null
    }),
    "manual-reconcile"
  );
  assert.equal(
    recoveryDisposition({
      submissionFencedAt: "2026-09-28T00:00:00Z",
      submittedAt: "2026-09-28T00:01:00Z",
      confirmationVerifiedAt: "2026-09-28T00:02:00Z"
    }),
    "already-complete"
  );
});


test("auto-except reuses sensitive answers only when explicitly allowed", async () => {
  const { buildDeterministicFillPlan } = await import("../src/planner.ts");

  const fields = [{
    key: "sponsorship",
    label: "Will you require visa sponsorship?",
    kind: "select" as const,
    required: true,
    options: ["Yes", "No"],
    sensitive: true
  }];

  const blocked = buildDeterministicFillPlan(
    fields,
    { "will you require visa sponsorship": "Yes" }
  );
  assert.equal(blocked[0]?.action.type, "human-review");

  const allowed = buildDeterministicFillPlan(
    fields,
    { "will you require visa sponsorship": "Yes" },
    [],
    ["will you require visa sponsorship"]
  );
  assert.deepEqual(allowed[0]?.action, { type: "fill", value: "Yes" });
});

test("auto-except still blocks unknown required fields without verified answers", async () => {
  const { buildDeterministicFillPlan } = await import("../src/planner.ts");
  const plan = buildDeterministicFillPlan([
    {
      key: "custom-question",
      label: "Describe a private company-specific requirement",
      kind: "custom" as const,
      required: true
    }
  ], {});

  assert.equal(plan[0]?.action.type, "human-review");
});

test("application planner reuses verified identity aliases across common ATS labels", async () => {
  const { buildDeterministicFillPlan } = await import("../src/planner.ts");
  const plan = buildDeterministicFillPlan(
    [
      { key: "given", label: "Given Name", kind: "text" as const, required: true },
      { key: "family", label: "Family Name", kind: "text" as const, required: true },
      { key: "mail", label: "E-mail", kind: "email" as const, required: true }
    ],
    {
      "first name": "Ada",
      "last name": "Lovelace",
      email: "ada@example.com"
    }
  );

  assert.deepEqual(plan.map((entry) => entry.action), [
    { type: "fill", value: "Ada" },
    { type: "fill", value: "Lovelace" },
    { type: "fill", value: "ada@example.com" }
  ]);
});


test("adapts salary expectations by role and advertised USD range", async () => {
  const { salaryExpectationForJob } = await import("../src/salary.ts");

  assert.equal(
    salaryExpectationForJob({ title: "Software Engineering Intern", roleFamily: "software" }).monthlyUsd,
    500
  );
  assert.equal(
    salaryExpectationForJob({ title: "Junior Data Analyst", roleFamily: "data" }).monthlyUsd,
    1000
  );
  assert.equal(
    salaryExpectationForJob({ title: "Backend Software Engineer", roleFamily: "software" }).monthlyUsd,
    2000
  );
  assert.equal(
    salaryExpectationForJob({ title: "Senior DevOps Engineer", roleFamily: "devops" }).monthlyUsd,
    4000
  );
  assert.equal(
    salaryExpectationForJob({ title: "Principal Security Architect", roleFamily: "cybersecurity" }).monthlyUsd,
    5000
  );
  assert.equal(
    salaryExpectationForJob({
      title: "Software Engineer",
      roleFamily: "software",
      salaryText: "USD $30,000 - $45,000 per year"
    }).monthlyUsd,
    2500
  );
});

test("salary expectation fields can be reused only when explicitly auto-approved", async () => {
  const { buildDeterministicFillPlan, salaryExpectationAnswers } = await import("../src/index.ts");
  const answers = salaryExpectationAnswers({
    title: "Junior Software Engineer",
    roleFamily: "software"
  });

  const field = {
    key: "salary",
    label: "Expected annual salary",
    kind: "text" as const,
    required: true
  };

  const blocked = buildDeterministicFillPlan([field], answers);
  assert.equal(blocked[0]?.action.type, "human-review");

  const allowed = buildDeterministicFillPlan(
    [field],
    answers,
    [],
    Object.keys(answers)
  );
  assert.deepEqual(allowed[0]?.action, { type: "fill", value: "12000" });
});


test("does not fabricate compensation attestations", async () => {
  const { salaryExpectationAnswers } = await import("../src/salary.ts");
  const answers = salaryExpectationAnswers({
    title: "Senior Software Engineer",
    roleFamily: "software",
    salaryText: "USD $60,000 - $90,000 per year",
    description: "Please review our compensation range before applying."
  });

  assert.equal(answers["have you reviewed the compensation details"], undefined);
  assert.equal(answers["have you reviewed the salary range"], undefined);
  assert.equal(
    answers["have you reviewed the compensation details salary range provided in the job description above"],
    undefined
  );
});


test("reuses explicitly approved consent variants without bypassing employer no-AI attestations", async () => {
  const { buildDeterministicFillPlan } = await import("../src/planner.ts");

  const answers = {
    "please confirm that you have read and agree to canonical s recruitment privacy notice and privacy policy": "Yes",
    "are you comfortable using your own device": "Yes",
    "this role requires up to 15 20 travel to asia are you able to commit to this": "Yes",
    "have you reviewed the compensation details salary range provided in the job description above": "Yes"
  };
  const approved = Object.keys(answers);

  const plan = buildDeterministicFillPlan(
    [
      { key: "privacy", label: "Please confirm you agree to our Recruitment Privacy Policy", kind: "select" as const, required: true, options: ["Yes", "No"], sensitive: true },
      { key: "device", label: "Are you willing to use your own computer for work?", kind: "select" as const, required: true, options: ["Yes", "No"] },
      { key: "travel", label: "This position involves travel. Are you able to commit to the travel requirement?", kind: "select" as const, required: true, options: ["Yes", "No"], sensitive: true },
      { key: "comp", label: "Have you reviewed the salary and compensation details?", kind: "select" as const, required: true, options: ["Yes", "No"], sensitive: true },
      { key: "no-ai", label: "During this application process I agree to use only my own words. I understand that the use of AI-generated content will disqualify my application.", kind: "select" as const, required: true, options: ["Yes", "No"], sensitive: true }
    ],
    answers,
    [],
    approved
  );

  assert.deepEqual(plan.slice(0, 4).map((entry) => entry.action), [
    { type: "fill", value: "Yes" },
    { type: "fill", value: "Yes" },
    { type: "fill", value: "Yes" },
    { type: "fill", value: "Yes" }
  ]);
  assert.equal(plan[4]?.action.type, "human-review");
});


test("does not reuse email or phone aliases inside compound prompts", async () => {
  const { buildDeterministicFillPlan } = await import("../src/planner.ts");
  const plan = buildDeterministicFillPlan(
    [
      {
        key: "references",
        label: "Please provide three professional references with name, phone, and email for each reference.",
        kind: "textarea" as const,
        required: false
      }
    ],
    {
      email: "candidate@example.com",
      phone: "+2348000000000"
    }
  );

  assert.equal(plan[0]?.action.type, "skip");
});
