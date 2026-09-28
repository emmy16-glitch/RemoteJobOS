# RemoteJobOS architecture

RemoteJobOS is cloud-first. A user's laptop is never part of the critical execution path.

## Principles

1. **Remote-only discovery, globally.** Discover first, classify geographic eligibility second.
2. **Truthful profile data.** AI may select and rephrase verified facts; it may not invent career history.
3. **Deterministic before AI.** Remote checks, duplicate detection, role families, seniority and hard eligibility rules should not consume LLM calls.
4. **Review gate first.** Auto-submit is an explicit later capability, never the initial default.
5. **Audit every action.** Discovery, matching, CV generation and application attempts emit events.
6. **Replaceable providers.** Job sources, AI providers, storage and browser adapters expose narrow interfaces.

## Runtime

- **Web:** Next.js dashboard.
- **Database:** Supabase/Postgres.
- **Discovery/worker:** Node.js jobs executed by GitHub Actions schedules initially.
- **AI:** Optional Groq adapter using an OpenAI-compatible HTTP API. Model is environment-configured.
- **Browser automation:** Playwright adapters will run in GitHub-hosted workers. The foundation workflow is review/dry-run only.
- **Email:** standalone Gmail OAuth/API integration is planned; the ChatGPT Gmail connection is not treated as application infrastructure.

## Pipeline

```
Sources -> normalize -> remote gate -> deduplicate -> classify
       -> deterministic eligibility -> match -> optional AI enrichment
       -> CV composition -> review -> ATS browser adapter -> status tracking
       -> Gmail lifecycle -> analytics
```

## Open-source inspiration

We deliberately borrow architecture ideas rather than coupling the product to one monolithic bot:

- Career-Ops: job intelligence and truthful career profile approach.
- JobSpy / FreeHire: broad discovery patterns.
- ats-api-reference / ats-job-apis: direct ATS integrations.
- dyyfk/auto-apply: queue/worker separation.
- job-application-automation: human-in-the-loop fallback.
- JobSync / JobTrail / Job Tracker OS: tracking and lifecycle concepts.

### CV engine architecture

RemoteJobOS does **not** embed or depend on another resume application. It adopts the strongest architectural ideas while keeping its own verified-fact and application pipeline:

- **JSON Resume:** structured, portable resume data rather than treating a CV as one large text blob. RemoteJobOS keeps its own schema because it also stores evidence, role-family targeting and application answers, but the separation of content from presentation is the same core idea.
- **Reactive Resume:** template-driven rendering, clear typography, configurable presentation and a content-first document model. RemoteJobOS keeps a deliberately conservative single-column ATS template for automated applications instead of copying visually complex layouts.
- **Resume Matcher:** compare the resume against the job description and expose keyword/relevance gaps. RemoteJobOS performs this deterministically before rendering and stores the matched terms in the CV plan.
- **OpenResume-style ATS engines:** separate resume content, template rendering and ATS analysis. RemoteJobOS mirrors that separation through core planning, worker rendering and quality auditing.

The resulting pipeline is:

```
verified career facts
        ↓
job-specific deterministic ranking
        ↓
section-aware fact selection
        ↓
quality / relevance audit
        ↓
professional single-column template
        ↓
A4 Playwright PDF
        ↓
private Supabase asset + version history
        ↓
human review / application workflow
```

CV content remains fact-locked. Styling, ordering and wording may change, but no renderer or optional AI provider is allowed to create unsupported employment history, education, certification, metrics or technologies.

The default automated-application template intentionally uses:

- single-column reading order;
- strong but simple heading hierarchy;
- bold role and organization labels;
- generous print spacing;
- text links instead of icon-only contact information;
- no skill bars, progress charts, photos, sidebars or decorative columns;
- 1–2 page compaction when content grows;
- private PDF storage and deterministic versioning.

Any direct code reuse from an external project must be license-reviewed before inclusion.

## Free-first infrastructure

The foundation is designed for a public GitHub repository, GitHub Actions scheduled workers, Supabase Free, and free static/web hosting. Free-tier quotas can change, so no business-critical guarantee should depend on a provider remaining free forever.


## Durable agent harness

RemoteJobOS wraps application automation in a deterministic harness instead of
letting a model or browser worker own lifecycle state.

The design borrows the strongest general-purpose ideas from the open-source
Company Brain harness while keeping RemoteJobOS on its existing Supabase +
GitHub Actions architecture:

- durable run state and checkpoints;
- explicit step budgets;
- progressive tool-family exposure by phase;
- deterministic result verification;
- one persisted salvage pass from durable evidence;
- approval suspension and resumption on the same run;
- recovery rules that distinguish safe restarts from ambiguous post-submit
  states.

The application lifecycle is:

```
application-review task
        ↓
durable agent_run
        ↓
context / CV checkpoints
        ↓
scan → plan → fill → verify
        ↓
result verifier
        ↓
verified dry-run
        ↓
agent_approval (pending)
        ↓
same run suspended
        ↓
explicit approval
        ↓
application-submit task references same run
        ↓
fresh browser session
        ↓
fence → submit → confirm
        ↓
durable confirmation
        ↓
completed run
```

A process crash before the submission fence is classified as `safe-restart`.
The task lease may expire and another worker can restart the application from a
safe browser boundary using persisted run context.

A crash or uncertain outcome after `submission_fenced_at` is different:
RemoteJobOS marks the run `manual-reconcile` and refuses automatic retry.
This prevents a recovery mechanism from turning into a duplicate job
application.

Tool families are intentionally phase-scoped:

```
context   → profile
cv        → profile + CV renderer
scan      → browser
plan      → profile + browser
fill      → profile + CV + browser
verify    → browser + evidence
approval  → evidence only
fence     → policy
submit    → browser + policy + submission
confirm   → browser + submission + confirmation + evidence
finalize  → evidence + tracking
```

The current scheduled review workflow remains dry-run only. Live submission is
not enabled automatically. A separate manual workflow requires an explicit
approval ID and an explicit live-submission confirmation before setting
`REMOTEJOBOS_ALLOW_SUBMIT=true`.


## Auto-except application operations

The default operating model is **auto-except**:

```
discovery → matching → verified CV → browser dry-run → deterministic verification
                                                        │
                           clean ────────────────────────┤
                             │                          │ blocker
                             ▼                          ▼
                    policy authorization          Exception Center
                             │                          │
                             ▼                     user resolves once
                       auto-submit                      │
                             │                          └── resume same run
                             ▼
                      confirmation
                             │
                             ▼
                     lifecycle tracking
```

A clean dry-run may receive a policy approval record and enter the dedicated
`application-auto-submit` queue. Manual `review` mode remains available, but
it is not the default. Database submission fences still require an approved
authorization record, so auto-except does not bypass the consequential-action
policy; it creates an auditable **policy** authorization only after deterministic
verification succeeds.

Exceptions are first-class durable records. Missing answers, sensitive answers
without reuse permission, CAPTCHA, unsupported ATS flows, exhausted retries,
verification failures, and uncertain submit outcomes pause only that
application. Resolving the final open exception can resume the same durable run.

The Answer Vault separates **verified reusable user facts** from live form
state. Each answer has one of three reuse policies:

- `always`: deterministic reuse is permitted;
- `ask`: remember the answer but interrupt before reuse;
- `never`: one-application use only.

Optional sensitive/demographic fields do not create noise: RemoteJobOS selects
an explicit decline/prefer-not-to-say option when available, otherwise skips an
optional field. Required high-impact questions still stop unless the user has
explicitly approved a reusable answer.

### Gmail lifecycle and notifications

Gmail OAuth tokens remain encrypted at rest. The connected account grants
`gmail.readonly` for lifecycle classification and `gmail.send` for
RemoteJobOS alerts. The notification outbox is durable and deduplicated; if
Gmail has not been connected yet, notifications remain pending rather than
being discarded.

Lifecycle messages are classified deterministically into application receipt,
assessment, interview, offer, rejection, or recruiter response. A uniquely
matched employer application-receipt email can act as external confirmation of
an otherwise uncertain submission. Ambiguous email matches never mutate
application state.

### Supported browser families

The shared fail-closed Playwright adapter currently routes Greenhouse, Lever,
Ashby, Workable, SmartRecruiters, Workday, BambooHR, Teamtailor, iCIMS,
Jobvite, and Taleo URLs. It supports bounded multi-page progression by clicking
only explicit Next/Continue-style controls after the current page has been
filled and re-verified. A final Submit control must be visible and enabled
before an auto-except dry-run is considered clean.
