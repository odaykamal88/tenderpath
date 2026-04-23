<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Tenderpath Agent Operating System

Tenderpath is a procurement intelligence platform that crawls live tenders, assesses company fit, and guides users through relevant opportunities. The live app is deployed on Vercel and the codebase is a Next.js + TypeScript application with crawlers, assessment logic, and dashboard flows.

## Core Product Areas

- `src/lib/crawlers/`: source-specific crawlers, sync orchestration, dedup, verification, sector mapping.
- `src/lib/assessment/`: website crawl, company classification, readiness analysis, tender matching.
- `src/app/`: App Router pages and API routes.
- `workers/crawler-browser/`: Cloudflare Browser Rendering worker used for anti-bot and JS-rendered pages.
- `scripts/`: migrations, sync scripts, operational helpers.

## Agent Priorities

1. Protect crawl quality and source integrity.
2. Prefer direct primary-source tenders over aggregator copies.
3. Improve matching precision before increasing surface area.
4. Keep schema/interface compatibility unless explicitly migrating.
5. Ship observable systems: logs, health checks, retry behavior.

## Golden Rules

- Do not delete or weaken `upsertTenders()`, dedupe logic, or link verification without replacing them with an equivalent or stronger mechanism.
- Prefer adding primary sources (agency / donor / procurement portal) instead of scraping aggregator mirrors when both exist.
- When a site is JS-rendered, Cloudflare-protected, or returns thin HTML, reuse `workers/crawler-browser/` before introducing a new scraping stack.
- Any crawler change must preserve the `RawTender` and `CrawlResult` contracts unless a coordinated migration is included.
- Any assessment change must preserve graceful degradation when website content is poor, blocked, or misleading.
- Every major data pipeline change should add instrumentation or a health endpoint.

## Coding Conventions

- TypeScript first; keep functions small and typed.
- Reuse helpers from `src/lib/crawlers/types.ts` and existing utility modules.
- Never silently swallow parsing failures if they can be logged with platform context.
- On null / missing fields, degrade safely and return partial structured data instead of throwing.
- Keep source-specific parsing logic inside source files; keep orchestration logic in sync/orchestration modules.

## Crawler Quality Standards

- Source URL must point to the primary opportunity page whenever possible.
- `deadline` should be normalized if the source makes it available.
- `description` should be enriched when source data is too thin for matching.
- `sector` should be mapped consistently through sector-map or equivalent enrichment.
- Dedup must work across cross-posted tenders from overlapping sources.
- Add respectful delays and retry logic for unstable sources.

## Assessment Quality Standards

- Confirm the final resolved site before probing subpaths.
- Detect SPA / JS-rendered shells and use browser rendering when needed.
- Prioritize text that explains what the company does, sells, builds, supplies, manages, or delivers.
- Mark thin, parked, login-walled, or obviously wrong sites as low-confidence inputs.
- Assessment output should distinguish hard evidence from inference.

## Dashboard Quality Standards

- Show users why a tender matched, not only that it matched.
- Expose deadlines, source, type, sector, and next action clearly.
- Support preference feedback loops (`not relevant`, `saved`, `in progress`).
- Keep readiness gaps actionable and tied to upsell/workflow paths.

## Documentation Map

Before changing a subsystem, read its companion docs in `docs/agents/`:

- `docs/agents/crawler-architecture.md`
- `docs/agents/assessment-architecture.md`
- `docs/agents/dashboard-architecture.md`
- `docs/agents/managed-agents-setup.md`
- `docs/agents/claude-code-prompts.md`

## Expected Workflow

1. Read `AGENTS.md` and the relevant subsystem doc.
2. Inspect current implementation before proposing changes.
3. Make the smallest coherent set of changes.
4. Add logs, comments, or docs only where they improve maintainability.
5. If schema/API contracts change, update scripts/docs in the same change set.
