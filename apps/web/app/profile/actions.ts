"use server";

import { redirect } from "next/navigation";
import type {
  RoleFamily,
  VerifiedCareerFact
} from "@remotejobos/core";
import { authenticatedUserId } from "../../lib/auth";
import { createServerSupabaseClient } from "../../lib/supabase/server";

const roleFamilies = new Set<RoleFamily>([
  "cybersecurity",
  "software",
  "devops",
  "data",
  "qa",
  "cloud",
  "it-support",
  "networking",
  "ai-ml",
  "product-technical",
  "other-tech"
]);

const seniorities = new Set(["intern", "entry", "junior", "mid", "senior"]);
const factKinds = new Set([
  "experience",
  "project",
  "education",
  "certification",
  "skill",
  "achievement"
]);

function text(formData: FormData, key: string): string {
  return String(formData.get(key) ?? "").trim();
}

function list(value: string): string[] {
  return [...new Set(
    value
      .split(/[\n,]/)
      .map((item) => item.trim())
      .filter(Boolean)
  )];
}

function parseFacts(value: string): VerifiedCareerFact[] {
  if (!value.trim()) return [];

  const raw = JSON.parse(value) as unknown;
  if (!Array.isArray(raw)) throw new Error("Career facts must be an array");

  return raw.flatMap((item, index) => {
    if (!item || typeof item !== "object") return [];
    const candidate = item as Record<string, unknown>;
    const kind = String(candidate.kind ?? "");
    const title = String(candidate.title ?? "").trim();
    const body = String(candidate.body ?? "").trim();

    if (!factKinds.has(kind) || !title || !body) return [];

    const keywords = Array.isArray(candidate.keywords)
      ? candidate.keywords.map(String).map((entry) => entry.trim()).filter(Boolean)
      : [];

    const scopedRoles = Array.isArray(candidate.roleFamilies)
      ? candidate.roleFamilies
          .map(String)
          .filter((entry): entry is RoleFamily => roleFamilies.has(entry as RoleFamily))
      : [];

    const idValue = String(candidate.id ?? "").trim();
    const id = idValue || `fact-${index + 1}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48)}`;

    return [{
      id,
      kind: kind as VerifiedCareerFact["kind"],
      title,
      organization: String(candidate.organization ?? "").trim() || undefined,
      body,
      keywords,
      roleFamilies: scopedRoles.length ? scopedRoles : undefined,
      alwaysInclude: candidate.alwaysInclude === true
    }];
  });
}

export async function saveCareerProfile(formData: FormData) {
  const userId = await authenticatedUserId();
  if (!userId) redirect("/login");

  const displayName = text(formData, "displayName");
  if (!displayName) {
    redirect("/profile?error=" + encodeURIComponent("Your name is required."));
  }

  const selectedRoles = formData
    .getAll("roleFamilies")
    .map(String)
    .filter((entry): entry is RoleFamily => roleFamilies.has(entry as RoleFamily));

  if (!selectedRoles.length) {
    redirect("/profile?error=" + encodeURIComponent("Choose at least one target role family."));
  }

  const maxSeniorityRaw = text(formData, "maxSeniority") || "junior";
  const maxSeniority = seniorities.has(maxSeniorityRaw)
    ? maxSeniorityRaw
    : "junior";

  let facts: VerifiedCareerFact[];
  try {
    facts = parseFacts(text(formData, "factsJson"));
  } catch {
    redirect("/profile?error=" + encodeURIComponent("The verified career facts could not be saved."));
  }

  const verifiedAnswers: Record<string, string> = {
    "full name": displayName,
    email: text(formData, "email"),
    phone: text(formData, "phone"),
    linkedin: text(formData, "linkedin"),
    github: text(formData, "github"),
    portfolio: text(formData, "portfolio"),
    city: text(formData, "city"),
    country: text(formData, "country"),
    "current company": text(formData, "currentCompany"),
    "current title": text(formData, "currentTitle"),
    "years of experience": text(formData, "yearsExperience")
  };

  for (const [key, value] of Object.entries(verifiedAnswers)) {
    if (!value) delete verifiedAnswers[key];
  }

  const supabase = await createServerSupabaseClient();
  const { data: existing, error: existingError } = await supabase
    .from("career_profiles")
    .select("id,profile")
    .eq("owner_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existingError) {
    redirect("/profile?error=" + encodeURIComponent(existingError.message));
  }

  const previous =
    existing?.profile && typeof existing.profile === "object"
      ? existing.profile as Record<string, unknown>
      : {};

  const profile = {
    ...previous,
    skills: list(text(formData, "skills")),
    roleFamilies: selectedRoles,
    maxSeniority,
    blockedRequirements: list(text(formData, "blockedRequirements")),
    verifiedAnswers,
    facts,
    settings: {
      ...(
        previous.settings && typeof previous.settings === "object"
          ? previous.settings as Record<string, unknown>
          : {}
      ),
      autonomyMode: "review"
    }
  };

  const write = existing?.id
    ? supabase
        .from("career_profiles")
        .update({
          display_name: displayName,
          profile,
          updated_at: new Date().toISOString()
        })
        .eq("id", existing.id)
    : supabase
        .from("career_profiles")
        .insert({
          owner_id: userId,
          display_name: displayName,
          profile
        });

  const { error } = await write;
  if (error) {
    redirect("/profile?error=" + encodeURIComponent(error.message));
  }

  redirect("/profile?saved=1");
}
