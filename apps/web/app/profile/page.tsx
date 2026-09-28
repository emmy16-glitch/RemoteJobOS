import { redirect } from "next/navigation";
import type {
  RoleFamily,
  VerifiedCareerFact
} from "@remotejobos/core";
import { authenticatedUserId } from "../../lib/auth";
import { publicSupabaseEnv } from "../../lib/supabase/env";
import { latestProfileForUser } from "../../lib/profile";
import { ProfileEditor, type EditableProfile } from "./profile-editor";

export const dynamic = "force-dynamic";

type StoredProfile = {
  skills?: string[];
  roleFamilies?: RoleFamily[];
  seniorityMode?: "any" | "capped";
  maxSeniority?: "intern" | "entry" | "junior" | "mid" | "senior";
  blockedRequirements?: string[];
  verifiedAnswers?: Record<string, string>;
  facts?: VerifiedCareerFact[];
  settings?: {
    autonomyMode?: "auto-except" | "review";
  };
};

export default async function ProfilePage({
  searchParams
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  if (!publicSupabaseEnv().configured) redirect("/");

  const userId = await authenticatedUserId();
  if (!userId) redirect("/login?next=/profile");

  const data = await latestProfileForUser(userId);

  const params = await searchParams;
  const stored =
    data?.profile && typeof data.profile === "object"
      ? data.profile as StoredProfile
      : {};

  const initial: EditableProfile = {
    displayName: data?.display_name ?? "",
    skills: stored.skills ?? [],
    roleFamilies: stored.roleFamilies ?? [
      "cybersecurity",
      "software",
      "devops",
      "cloud",
      "data",
      "qa",
      "it-support",
      "networking"
    ],
    seniorityMode: stored.seniorityMode ?? "any",
    maxSeniority: stored.maxSeniority ?? "senior",
    blockedRequirements: stored.blockedRequirements ?? [],
    verifiedAnswers: stored.verifiedAnswers ?? {},
    facts: stored.facts ?? [],
    autonomyMode: stored.settings?.autonomyMode ?? "auto-except"
  };

  return (
    <main className="profileShell">
      <header className="profileTopbar">
        <div>
          <a href="/" className="backLink">← Overview</a>
          <p className="eyebrow">CAREER PROFILE</p>
          <h1>Verified source of truth</h1>
          <p>
            RemoteJobOS may select and reorder these facts, but it is not
            allowed to invent experience that is not stored here.
          </p>
        </div>
        <div className="profileStatus">
          <span className="dot" />
          Deterministic matching
        </div>
      </header>

      {params.saved ? (
        <div className="notice">
          <b>Profile saved</b>
          <span>
            Future matching and CV planning will use this verified profile.
          </span>
        </div>
      ) : null}

      {params.error ? (
        <div className="notice warning">
          <b>Could not save profile</b>
          <span>{params.error}</span>
        </div>
      ) : null}

      <ProfileEditor initial={initial} />
    </main>
  );
}
