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
