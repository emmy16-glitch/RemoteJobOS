import { redirect } from "next/navigation";
import type {
  RoleFamily,
  VerifiedCareerFact
} from "@remotejobos/core";
import { authenticatedUserId } from "../../lib/auth";
import { createServerSupabaseClient } from "../../lib/supabase/server";
import { publicSupabaseEnv } from "../../lib/supabase/env";
import { ProfileEditor, type EditableProfile } from "./profile-editor";

export const dynamic = "force-dynamic";

type StoredProfile = {
  skills?: string[];
  roleFamilies?: RoleFamily[];
  maxSeniority?: "intern" | "entry" | "junior" | "mid" | "senior";
  blockedRequirements?: string[];
  verifiedAnswers?: Record<string, string>;
  facts?: VerifiedCareerFact[];
};

export default async function ProfilePage({
  searchParams
}: {
  searchParams: Promise<{ saved?: string; error?: string }>;
}) {
  if (!publicSupabaseEnv().configured) redirect("/");

  const userId = await authenticatedUserId();
  if (!userId) redirect("/login?next=/profile");

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("career_profiles")
    .select("display_name,profile")
    .eq("owner_id", userId)
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

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
    maxSeniority: stored.maxSeniority ?? "junior",
    blockedRequirements: stored.blockedRequirements ?? [],
    verifiedAnswers: stored.verifiedAnswers ?? {},
    facts: stored.facts ?? []
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

      {params.error || error ? (
        <div className="notice warning">
          <b>Could not save profile</b>
          <span>{params.error ?? error?.message}</span>
        </div>
      ) : null}

      <ProfileEditor initial={initial} />
    </main>
  );
}
