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
- Resume Matcher / SimplyApply / Bespoke: truthful tailoring.
- Reactive Resume: ATS-safe document rendering ideas.
- JobSync / JobTrail / Job Tracker OS: tracking and lifecycle concepts.

Any direct code reuse must be license-reviewed before inclusion.

## Free-first infrastructure

The foundation is designed for a public GitHub repository, GitHub Actions scheduled workers, Supabase Free, and free static/web hosting. Free-tier quotas can change, so no business-critical guarantee should depend on a provider remaining free forever.
