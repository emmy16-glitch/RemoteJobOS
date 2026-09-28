"use client";

import { useMemo, useState } from "react";
import type {
  CareerFactKind,
  RoleFamily,
  VerifiedCareerFact
} from "@remotejobos/core";
import { saveCareerProfile } from "./actions";

const roleOptions: Array<{ value: RoleFamily; label: string }> = [
  { value: "cybersecurity", label: "Cybersecurity" },
  { value: "software", label: "Software Engineering / Development" },
  { value: "devops", label: "DevOps / SRE / Platform" },
  { value: "cloud", label: "Cloud Engineering" },
  { value: "data", label: "Data / Analytics" },
  { value: "qa", label: "QA / Test Automation" },
  { value: "it-support", label: "IT / Technical Support" },
  { value: "networking", label: "Networking / NOC" },
  { value: "ai-ml", label: "AI / Machine Learning" },
  { value: "product-technical", label: "Technical Product / Solutions" },
  { value: "other-tech", label: "Other technical roles" }
];

const factKinds: Array<{ value: CareerFactKind; label: string }> = [
  { value: "experience", label: "Experience" },
  { value: "project", label: "Project" },
  { value: "education", label: "Education" },
  { value: "certification", label: "Certification" },
  { value: "skill", label: "Skill evidence" },
  { value: "achievement", label: "Achievement" }
];

export type EditableProfile = {
  displayName: string;
  skills: string[];
  roleFamilies: RoleFamily[];
  seniorityMode: "any" | "capped";
  maxSeniority: "intern" | "entry" | "junior" | "mid" | "senior";
  blockedRequirements: string[];
  verifiedAnswers: Record<string, string>;
  facts: VerifiedCareerFact[];
};

function emptyFact(): VerifiedCareerFact {
  return {
    id:
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : "fact-" + Date.now(),
    kind: "project",
    title: "",
    body: "",
    keywords: [],
    roleFamilies: []
  };
}

function inputValue(
  answers: Record<string, string>,
  key: string
): string {
  return answers[key] ?? "";
}

function FactCard({
  fact,
  index,
  onChange,
  onRemove
}: {
  fact: VerifiedCareerFact;
  index: number;
  onChange: (next: VerifiedCareerFact) => void;
  onRemove: () => void;
}) {
  const set = <K extends keyof VerifiedCareerFact>(
    key: K,
    value: VerifiedCareerFact[K]
  ) => onChange({ ...fact, [key]: value });

  return (
    <article className="factEditor">
      <div className="factEditorHead">
        <div>
          <span className="factNumber">FACT {index + 1}</span>
          <strong>{fact.title || "New verified fact"}</strong>
        </div>
        <button type="button" className="textButton danger" onClick={onRemove}>
          Remove
        </button>
      </div>

      <div className="formGrid two">
        <label>
          <span>Type</span>
          <select
            value={fact.kind}
            onChange={(event) =>
              set("kind", event.target.value as CareerFactKind)
            }
          >
            {factKinds.map((kind) => (
              <option key={kind.value} value={kind.value}>
                {kind.label}
              </option>
            ))}
          </select>
        </label>

        <label>
          <span>Organization / school</span>
          <input
            value={fact.organization ?? ""}
            onChange={(event) =>
              set("organization", event.target.value || undefined)
            }
            placeholder="Optional"
          />
        </label>
      </div>

      <label>
        <span>Title</span>
        <input
          value={fact.title}
          onChange={(event) => set("title", event.target.value)}
          placeholder="e.g. Echoo live audio reliability work"
          required
        />
      </label>

      <div className="formGrid two">
        <label>
          <span>Start date</span>
          <input
            value={fact.startDate ?? ""}
            onChange={(event) => set("startDate", event.target.value || undefined)}
            placeholder="e.g. 2025"
          />
        </label>

        <label>
          <span>End date</span>
          <input
            value={fact.endDate ?? ""}
            onChange={(event) => set("endDate", event.target.value || undefined)}
            placeholder="e.g. Present or 2026"
          />
        </label>

        <label>
          <span>Location</span>
          <input
            value={fact.location ?? ""}
            onChange={(event) => set("location", event.target.value || undefined)}
            placeholder="e.g. Abuja, Nigeria / Remote"
          />
        </label>

        <label>
          <span>Project / evidence URL</span>
          <input
            type="url"
            value={fact.url ?? ""}
            onChange={(event) => set("url", event.target.value || undefined)}
            placeholder="https://..."
          />
        </label>
      </div>

      <label>
        <span>Verified description</span>
        <textarea
          value={fact.body}
          onChange={(event) => set("body", event.target.value)}
          placeholder="Only write things you can truthfully claim. Include what you did, tools used, and the result."
          rows={4}
          required
        />
      </label>

      <label>
        <span>Keywords / tools</span>
        <input
          value={fact.keywords.join(", ")}
          onChange={(event) =>
            set(
              "keywords",
              event.target.value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
            )
          }
          placeholder="Linux, Docker, Playwright, Wireshark"
        />
      </label>

      <label>
        <span>Achievement / responsibility bullets</span>
        <textarea
          value={(fact.highlights ?? []).join("\n")}
          onChange={(event) =>
            set(
              "highlights",
              event.target.value
                .split("\n")
                .map((item) => item.trim())
                .filter(Boolean)
            )
          }
          placeholder={"One verified bullet per line\nBuilt ...\nTested ...\nImproved ..."}
          rows={4}
        />
      </label>

      <label>
        <span>Technologies</span>
        <input
          value={(fact.technologies ?? []).join(", ")}
          onChange={(event) =>
            set(
              "technologies",
              event.target.value
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
            )
          }
          placeholder="React, TypeScript, Docker, LiveKit"
        />
      </label>

      <fieldset className="roleScope">
        <legend>Use this fact for</legend>
        <div className="checkGrid compact">
          {roleOptions.map((role) => {
            const selected = fact.roleFamilies?.includes(role.value) ?? false;
            return (
              <label className="checkItem" key={role.value}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={(event) => {
                    const next = new Set(fact.roleFamilies ?? []);
                    if (event.target.checked) next.add(role.value);
                    else next.delete(role.value);
                    set("roleFamilies", [...next]);
                  }}
                />
                <span>{role.label}</span>
              </label>
            );
          })}
        </div>
      </fieldset>

      <label className="checkItem always">
        <input
          type="checkbox"
          checked={fact.alwaysInclude ?? false}
          onChange={(event) => set("alwaysInclude", event.target.checked)}
        />
        <span>Always include this fact in tailored CVs</span>
      </label>
    </article>
  );
}

export function ProfileEditor({
  initial
}: {
  initial: EditableProfile;
}) {
  const [facts, setFacts] = useState<VerifiedCareerFact[]>(
    initial.facts.length ? initial.facts : [emptyFact()]
  );

  const factsJson = useMemo(() => JSON.stringify(facts), [facts]);

  return (
    <form action={saveCareerProfile} className="profileForm">
      <input type="hidden" name="factsJson" value={factsJson} />

      <section className="formSection">
        <div className="sectionTitle">
          <div>
            <p className="eyebrow">IDENTITY</p>
            <h2>Application details</h2>
          </div>
          <span>Stored as verified answers</span>
        </div>

        <div className="formGrid two">
          <label>
            <span>Full name</span>
            <input
              name="displayName"
              defaultValue={initial.displayName}
              required
            />
          </label>

          <label>
            <span>Email</span>
            <input
              name="email"
              type="email"
              defaultValue={inputValue(initial.verifiedAnswers, "email")}
            />
          </label>

          <label>
            <span>Phone</span>
            <input
              name="phone"
              type="tel"
              defaultValue={inputValue(initial.verifiedAnswers, "phone")}
            />
          </label>

          <label>
            <span>Secondary phone</span>
            <input
              name="secondaryPhone"
              type="tel"
              defaultValue={inputValue(initial.verifiedAnswers, "secondary phone")}
            />
          </label>

          <label>
            <span>Country</span>
            <input
              name="country"
              defaultValue={inputValue(initial.verifiedAnswers, "country")}
            />
          </label>

          <label>
            <span>City</span>
            <input
              name="city"
              defaultValue={inputValue(initial.verifiedAnswers, "city")}
            />
          </label>

          <label>
            <span>GitHub</span>
            <input
              name="github"
              type="url"
              defaultValue={inputValue(initial.verifiedAnswers, "github")}
            />
          </label>

          <label>
            <span>X / professional social profile</span>
            <input
              name="xProfile"
              type="url"
              defaultValue={inputValue(initial.verifiedAnswers, "x")}
              placeholder="https://x.com/..."
            />
          </label>

          <label>
            <span>Portfolio / website</span>
            <input
              name="portfolio"
              type="url"
              defaultValue={inputValue(initial.verifiedAnswers, "portfolio")}
            />
          </label>

          <label>
            <span>Current title</span>
            <input
              name="currentTitle"
              defaultValue={inputValue(initial.verifiedAnswers, "current title")}
            />
          </label>

          <label>
            <span>Current company</span>
            <input
              name="currentCompany"
              defaultValue={inputValue(initial.verifiedAnswers, "current company")}
            />
          </label>

          <label>
            <span>Years of experience</span>
            <input
              name="yearsExperience"
              inputMode="decimal"
              defaultValue={inputValue(
                initial.verifiedAnswers,
                "years of experience"
              )}
            />
          </label>
        </div>

        <label>
          <span>Professional summary</span>
          <textarea
            name="professionalSummary"
            defaultValue={inputValue(initial.verifiedAnswers, "professional summary")}
            placeholder="A concise, verified summary of your professional background. No invented metrics or experience."
            rows={4}
          />
        </label>
      </section>

      <section className="formSection">
        <div className="sectionTitle">
          <div>
            <p className="eyebrow">TARGETING</p>
            <h2>What should RemoteJobOS search for?</h2>
          </div>
          <span>Remote jobs only</span>
        </div>

        <fieldset className="roleScope">
          <legend>Role families</legend>
          <div className="checkGrid">
            {roleOptions.map((role) => (
              <label className="checkItem" key={role.value}>
                <input
                  name="roleFamilies"
                  type="checkbox"
                  value={role.value}
                  defaultChecked={initial.roleFamilies.includes(role.value)}
                />
                <span>{role.label}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <div className="formGrid two">
          <label>
            <span>Seniority targeting</span>
            <select
              name="seniorityTarget"
              defaultValue={
                initial.seniorityMode === "any"
                  ? "any"
                  : initial.maxSeniority
              }
            >
              <option value="any">Any seniority — evaluate all roles</option>
              <option value="intern">Up to internship</option>
              <option value="entry">Up to entry level</option>
              <option value="junior">Up to junior</option>
              <option value="mid">Up to mid-level</option>
              <option value="senior">Up to senior</option>
            </select>
          </label>

          <label>
            <span>Skills</span>
            <textarea
              name="skills"
              defaultValue={initial.skills.join(", ")}
              placeholder="Python, JavaScript, Linux, Git, Docker..."
              rows={3}
            />
          </label>
        </div>

        <label>
          <span>Hard blockers</span>
          <textarea
            name="blockedRequirements"
            defaultValue={initial.blockedRequirements.join("\n")}
            placeholder={"One per line, e.g.\nTS/SCI clearance\nUS citizenship required"}
            rows={3}
          />
          <small>
            Jobs containing these explicit requirements are rejected before any
            application work begins.
          </small>
        </label>
      </section>

      <section className="formSection">
        <div className="sectionTitle">
          <div>
            <p className="eyebrow">VERIFIED CAREER FACTS</p>
            <h2>The only facts CV tailoring may use</h2>
          </div>
          <button
            type="button"
            className="secondaryButton"
            onClick={() => setFacts((current) => [...current, emptyFact()])}
          >
            Add fact
          </button>
        </div>

        <div className="factsList">
          {facts.map((fact, index) => (
            <FactCard
              key={fact.id}
              fact={fact}
              index={index}
              onChange={(next) =>
                setFacts((current) =>
                  current.map((item) => (item.id === fact.id ? next : item))
                )
              }
              onRemove={() =>
                setFacts((current) =>
                  current.length === 1
                    ? [emptyFact()]
                    : current.filter((item) => item.id !== fact.id)
                )
              }
            />
          ))}
        </div>
      </section>

      <div className="profileSave">
        <div>
          <strong>Review-before-submit stays enabled.</strong>
          <span>
            Saving this profile does not enable automatic live submission.
          </span>
        </div>
        <button type="submit" className="primaryButton">
          Save verified profile
        </button>
      </div>
    </form>
  );
}
