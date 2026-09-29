import { Sidebar } from "../components/sidebar";
import { requireDashboardUser } from "../../lib/page-auth";
import { createServerSupabaseClient } from "../../lib/supabase/server";

export const dynamic = "force-dynamic";

type CompanyPolicy = {
  normalized_company: string;
  blocked: boolean;
  block_reason: string | null;
  max_daily_submissions: number;
  max_lifetime_submissions: number;
  cooldown_until: string | null;
};

export default async function RulesPage() {
  await requireDashboardUser("/rules");
  const supabase = await createServerSupabaseClient();

  const { data, error } = await supabase
    .from("company_policy")
    .select("normalized_company,blocked,block_reason,max_daily_submissions,max_lifetime_submissions,cooldown_until")
    .order("normalized_company", { ascending: true })
    .limit(100);

  if (error) throw new Error(error.message);
  const policies = (data ?? []) as CompanyPolicy[];

  return (
    <main className="shell">
      <Sidebar active="Rules" />
      <section className="content">
        <header className="topbar">
          <div>
            <p className="eyebrow">FAIL-CLOSED POLICY</p>
            <h1>Application rules</h1>
          </div>
          <div className="status">Auto-except enabled</div>
        </header>

        <nav className="sectionTabs" aria-label="Settings sections">
          <a href="/profile">Career profile</a>
          <a className="active" href="/rules">Rules</a>
        </nav>

        <section className="rulesGrid">
          <article className="panel ruleCard">
            <p className="eyebrow">SUBMISSION</p>
            <h2>Verify before click</h2>
            <p>
              Every required field must have a deterministic verified answer,
              and the browser must re-read the DOM value before submission.
            </p>
          </article>

          <article className="panel ruleCard">
            <p className="eyebrow">SENSITIVE FIELDS</p>
            <h2>Ask only when needed</h2>
            <p>
              Sensitive or high-impact questions pause unless you have already
              stored that exact truthful answer and explicitly allowed
              automatic reuse in the Answer Vault.
            </p>
          </article>

          <article className="panel ruleCard">
            <p className="eyebrow">ANTI-BOT</p>
            <h2>No CAPTCHA bypass</h2>
            <p>
              A CAPTCHA or ambiguous custom field blocks automation and moves
              the application into review.
            </p>
          </article>

          <article className="panel ruleCard">
            <p className="eyebrow">IDEMPOTENCY</p>
            <h2>Never double-submit</h2>
            <p>
              Queue leases, durable submission fences, bounded safe retries and
              verified confirmation checks prevent concurrent or blind repeat
              submissions.
            </p>
          </article>

          <article className="panel ruleCard">
            <p className="eyebrow">AI</p>
            <h2>Not in the critical path</h2>
            <p>
              Discovery, matching, CV selection, form planning and browser
              verification remain operational when every AI provider is down.
            </p>
          </article>

          <article className="panel ruleCard">
            <p className="eyebrow">COMPANY LIMITS</p>
            <h2>5 daily · 10 lifetime</h2>
            <p>
              Those database defaults stop a broad role search from turning
              into repeated applications to one employer.
            </p>
          </article>
        </section>

        <article className="panel policyPanel">
          <div className="panelHead">
            <div>
              <p>OVERRIDES</p>
              <h2>Company policies</h2>
            </div>
          </div>

          {policies.length ? (
            <div className="policyTable">
              {policies.map((policy) => (
                <div className="policyRow" key={policy.normalized_company}>
                  <div>
                    <b>{policy.normalized_company}</b>
                    <small>{policy.block_reason ?? "No custom reason"}</small>
                  </div>
                  <span>{policy.blocked ? "Blocked" : "Allowed"}</span>
                  <span>{policy.max_daily_submissions}/day</span>
                  <span>{policy.max_lifetime_submissions} lifetime</span>
                  <span>
                    {policy.cooldown_until
                      ? "Cooldown active"
                      : "No cooldown"}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="emptyState">
              No company-specific overrides. Database defaults are active.
            </div>
          )}
        </article>
      </section>
    </main>
  );
}
