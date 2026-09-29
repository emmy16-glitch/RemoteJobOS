# RemoteJobOS architecture

RemoteJobOS is cloud-first. A user's laptop is never part of the critical execution path.

## Principles

1. **Remote-only discovery, globally.** Discover first, classify geographic eligibility second.
2. **Truthful profile data.** AI may select and rephrase verified facts; it may not invent career history.
3. **Deterministic before AI.** Remote checks, duplicate detection, role families, seniority and hard eligibility rules should not consume LLM calls.
4. **Auto-except, not auto-blind.** Every application is dry-run verified first; clean runs may auto-submit under the policy fence, while CAPTCHA, unknown/sensitive answers and uncertain submit outcomes pause only that application.
5. **Audit every action.** Discovery, matching, CV generation and application attempts emit events.
6. **Replaceable providers.** Job sources, AI providers, storage and browser adapters expose narrow interfaces.

## Runtime

- **Web:** Next.js dashboard.
- **Database:** Supabase/Postgres.
- **Discovery/worker:** Node.js jobs executed by GitHub Actions schedules initially.
- **AI:** Optional Groq adapter using an OpenAI-compatible HTTP API. Model is environment-configured.
- **Browser automation:** deterministic Playwright adapters run first. A target resolver follows job-board Apply links to the employer form, named ATS adapters cover common platforms, a guarded generic-form adapter handles ordinary sites, and optional Stagehand v4 is a self-healing navigation fallback only.
- **Email:** standalone Gmail OAuth/API integration is planned; the ChatGPT Gmail connection is not treated as application infrastructure.

## Pipeline

```
Sources -> normalize -> remote gate -> deduplicate -> classify
       -> deterministic eligibility -> match -> optional AI enrichment
       -> CV composition -> target resolver -> deterministic ATS/form adapter\n       -> optional adaptive navigation fallback -> verify -> fenced submit -> status tracking
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

The scheduled review workflow remains dry-run only, but profiles in `auto-except`
mode can authorize a durable auto-submit task after successful deterministic
verification. The separate auto-submit worker is the only scheduled lane that
sets `REMOTEJOBOS_ALLOW_SUBMIT=true`; it still passes through the submission
policy fence and post-submit confirmation checks.

## Layered browser architecture

RemoteJobOS deliberately avoids making a model the owner of browser state or
submission policy.

```
job-board/source URL
        ↓
application target resolver
        ├─ known ATS URL → use directly
        ├─ deterministic Playwright Apply-link follow
        └─ optional Stagehand self-healing navigation fallback
        ↓
named ATS adapter
        ├─ Greenhouse / Lever / Ashby
        ├─ Workday / SmartRecruiters / Workable / iCIMS
        ├─ Recruitee / Teamtailor / Personio / BambooHR / Jobvite
        ├─ SuccessFactors / Taleo / Oracle / Eightfold
        └─ guarded generic web-form fallback
        ↓
scan → deterministic verified-answer plan → fill → DOM verify
        ↓
CAPTCHA / unknown or sensitive answer? → exception only
        ↓
durable policy authorization + submit fence
        ↓
submit → repeated confirmation checks → lifecycle tracking
```

The resolver persists a newly discovered employer application URL back onto the
job record, so later attempts reuse the direct target instead of repeatedly
starting from an aggregator page.

Stagehand is optional and intentionally constrained to navigation. It never gets
career-profile answers, never solves CAPTCHA, and never owns the final Submit
action. This keeps the core path free/deterministic while adding a self-healing
fallback for unfamiliar listing pages when a model key is configured.

Browser Use / BrowserCode and agent-browser influenced the capability-oriented
browser design, but are not runtime dependencies: Browser Use is centered on a
different Python/agent runtime and agent-browser currently targets Node 24,
while RemoteJobOS runs Node 22. Temporal's durable-workflow semantics are
implemented here through existing Supabase leases, checkpoints, idempotency,
submission fencing and recovery states instead of adding another infrastructure
service.
