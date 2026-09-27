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
