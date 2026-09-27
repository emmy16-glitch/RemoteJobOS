# RemoteJobOS

RemoteJobOS is a cloud-first operating system for discovering, evaluating, preparing, applying to, and tracking **remote technology jobs worldwide**.

The critical runtime does **not** depend on the user's laptop being online. Scheduled discovery and matching are designed to run in GitHub Actions, with state persisted in Postgres/Supabase.

## Current foundation

- Remote-only global discovery pipeline
- Free public feeds: Remotive, Remote OK, Arbeitnow
- Direct ATS adapters: Greenhouse, Lever, Ashby
- Dynamic ATS board registry stored in Postgres
- Cross-source deterministic deduplication
- Remote-scope classification: global, Africa, EMEA, US-only, EU-only, UK-only, restricted, unknown
- Broad technical role families: cybersecurity, software, DevOps, cloud, data, QA, IT support, networking, AI/ML, technical product roles
- Deterministic job scoring before any optional AI enrichment
- Shared application field planner with mandatory human review for sensitive/high-impact answers
- Postgres queue leasing, retries and idempotency keys
- Submission fences and per-company rate/duplicate protection
- Playwright form scanner/filler/verifier for Greenhouse, Lever and Ashby
- Verified file-asset handling with CAPTCHA detection and no bypass attempts
- Manual GitHub Actions dry-run/review workflow with screenshot evidence
- Responsive Next.js monitoring dashboard
- GitHub Actions CI, scheduled discovery and scheduled matching
- Optional Groq adapter; the system's core path works without AI

## Architecture

```
Remote feeds + employer ATS boards
             |
             v
      Discovery workers
             |
             v
 normalize -> remote gate -> deduplicate
             |
             v
 deterministic classification + eligibility
             |
             v
          matching
             |
       +-----+------+
       |            |
     reject       review/strong
                    |
                    v
              CV/application plan
                    |
                    v
             submission fence
                    |
                    v
             ATS browser worker
                    |
                    v
       applications + events + email
                    |
                    v
                dashboard
```

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for design details.

## Repository layout

```
apps/
  web/       Next.js monitoring dashboard
  worker/    discovery, matching and cloud worker commands

packages/
  core/      remote classification, role classification, scoring,
             identity/deduplication and application planning

supabase/
  migrations/ database schema, queue leases, dedupe and submission fences

.github/workflows/
  ci.yml
  discover-jobs.yml
  match-jobs.yml
  apply-jobs.yml
```

## Local development

Requirements: Node.js 22+.

```bash
npm install
npm run typecheck
npm test
npm run build
npm run dev
```

Worker checks:

```bash
npm run worker:health
npm run worker:discover
npm run worker:match
```

Without Supabase secrets, discovery can normalize jobs but persistence/matching will not become a production pipeline.

## Cloud configuration

Apply the SQL files under `supabase/migrations/` in numeric order.

Then configure these GitHub repository secrets:

```
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
```

Optional AI enrichment:

```
GROQ_API_KEY
```

Optional repository variable:

```
GROQ_MODEL=openai/gpt-oss-20b
```

AI is not required for discovery, deduplication, remote classification, eligibility checks, matching, queue leasing or application safety fences.

## Safety / quality policy

RemoteJobOS is designed to optimize **relevant applications**, not raw submission count.

It must not:

- invent employment, education, certifications, skills or achievements;
- silently guess sensitive application answers;
- submit the same role repeatedly;
- hammer one employer with duplicate applications;
- bypass CAPTCHA or anti-bot controls;
- make AI a dependency for basic job filtering.

Sensitive/high-impact questions such as compensation, citizenship, security clearance, sponsorship, criminal-history or demographic questions are routed to review.

## Job-source strategy

Prefer, in order:

1. public ATS/job APIs;
2. structured company career feeds;
3. public remote-job feeds;
4. scraping only when necessary and permitted.

Remote OK requires attribution/link-back when its feed is displayed publicly; RemoteJobOS retains the original source URL.

## CI/CD

Every push to `main` and every pull request runs:

```
install
  -> strict typecheck
  -> core tests
  -> production builds
```

Scheduled cloud workflows run discovery and matching independently of any personal computer.

## Status

The cloud foundation and guarded application-review pipeline are implemented and CI is green. Real submission remains intentionally disabled in the GitHub workflow until end-to-end dry runs use a configured private profile and verified CV assets. Authenticated live dashboard data, CV PDF rendering/storage, standalone Gmail OAuth tracking, broader ATS adapters, and production deployment are the next major slices.
