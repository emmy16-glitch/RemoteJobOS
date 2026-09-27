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
