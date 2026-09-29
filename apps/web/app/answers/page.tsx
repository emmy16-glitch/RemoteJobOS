import { Sidebar } from "../components/sidebar";
import { requireDashboardUser } from "../../lib/page-auth";
import { latestProfileForUser } from "../../lib/profile";
import { createServerSupabaseClient } from "../../lib/supabase/server";
import {
  deleteAnswerVaultEntry,
  saveAnswerVaultEntry
} from "./actions";

export const dynamic = "force-dynamic";

type AnswerRow = {
  id: string;
  answer_key: string;
  label: string;
  answer_value: string;
  reuse_policy: "always" | "ask" | "never";
  sensitive: boolean;
  updated_at: string;
};

function prettyPolicy(value: string) {
  if (value === "always") return "Auto-use";
  if (value === "ask") return "Ask each time";
  return "One-off only";
}

export default async function AnswersPage() {
  const userId = await requireDashboardUser("/answers");
  const profile = await latestProfileForUser(userId);

  if (!profile) {
    return (
      <main className="shell">
        <Sidebar active="Answers" />
        <section className="content">
          <header className="topbar">
            <div><p className="eyebrow">ANSWER VAULT</p><h1>Reusable application answers</h1></div>
          </header>
          <div className="notice warning"><b>Career profile required</b></div>
        </section>
      </main>
    );
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("answer_vault")
    .select("id,answer_key,label,answer_value,reuse_policy,sensitive,updated_at")
    .eq("profile_id", profile.id)
    .order("updated_at", { ascending: false });

  if (error) throw new Error(error.message);
  const answers = (data ?? []) as AnswerRow[];

  return (
    <main className="shell">
      <Sidebar active="Answers" />
      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">ANSWER VAULT</p>
            <h1>Answer once, reuse safely</h1>
          </div>
          <div className="status">{answers.length} saved</div>
        </header>

        <nav className="sectionTabs" aria-label="AI and CV sections">
          <a href="/cvs">CV history</a>
          <a className="active" href="/answers">Answer vault</a>
          <a href="/analytics">Analytics</a>
        </nav>

        <div className="notice">
          <b>Verified answers only</b>
          <span>
            “Auto-use” answers may be reused in future applications. Sensitive answers are only auto-used when you explicitly choose that policy.
          </span>
        </div>

        <section className="panel answerComposer">
          <div className="panelHead">
            <div><p>NEW ANSWER</p><h2>Add or update a reusable answer</h2></div>
          </div>
          <form action={saveAnswerVaultEntry} className="exceptionForm">
            <label>
              <span>Application question</span>
              <input name="label" placeholder="e.g. Will you require visa sponsorship?" required />
            </label>
            <label>
              <span>Answer</span>
              <textarea name="answerValue" rows={3} placeholder="Your truthful answer" required />
            </label>
            <div className="formGrid two">
              <label>
                <span>Reuse policy</span>
                <select name="reusePolicy" defaultValue="always">
                  <option value="always">Use automatically</option>
                  <option value="ask">Remember, but ask me each time</option>
                  <option value="never">Do not reuse automatically</option>
                </select>
              </label>
              <label className="checkItem always">
                <input type="checkbox" name="sensitive" />
                <span>This is a sensitive/high-impact answer</span>
              </label>
            </div>
            <button className="primaryButton" type="submit">Save verified answer</button>
          </form>
        </section>

        <section className="answerList">
          {answers.length ? answers.map((answer) => (
            <article className="answerCard" key={answer.id}>
              <div className="answerMain">
                <div className="answerHead">
                  <div>
                    <span className="factNumber">{answer.sensitive ? "SENSITIVE" : "VERIFIED"}</span>
                    <h2>{answer.label}</h2>
                  </div>
                  <span className="decision">{prettyPolicy(answer.reuse_policy)}</span>
                </div>
                <p>{answer.answer_value}</p>
              </div>
              <form action={deleteAnswerVaultEntry}>
                <input type="hidden" name="id" value={answer.id} />
                <button className="textButton danger" type="submit">Delete</button>
              </form>
            </article>
          )) : (
            <div className="emptyState">
              No reusable answers yet. Answers you save from the Exception Center can appear here automatically.
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
