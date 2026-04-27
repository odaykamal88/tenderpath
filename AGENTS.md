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
6. Improve first-try assessment trust and stability.
7. Make the post-assessment dashboard immediately useful and actionable.
8. Optimize for conversion from assessment → matched workflow → paid action.
9. Favor workflow clarity and explainability over feature sprawl.

## Launch Priorities

Near launch, optimize for the following in order:

1. **Activation reliability**  
   A completed assessment should reliably result in:
   - stored assessment output,
   - persisted matches or match-ready state,
   - visible dashboard state,
   - and any promised follow-up email or notification.

2. **First-try trust**  
   The platform should identify the company correctly on the first pass whenever reasonably possible. Redirect handling, render detection, and evidence quality matter more than adding more scoring complexity.

3. **Matched dashboard usefulness**  
   Users should quickly see:
   - which tenders matter,
   - why they match,
   - what the deadline and value are,
   - and what to do next.

4. **Explainability and evidence**  
   Do not hide why the system made a recommendation. Put evidence, caveats, match reasons, and confidence cues close to the UI.

5. **Operational visibility**  
   Silent failures are launch blockers. If a source fails, an assessment produces no matches, or an email does not send, the system should make that diagnosable.

6. **Revenue-path continuity**  
   The product should guide users from assessment into the next valuable step:
   - bid/no-bid analysis,
   - proposal package,
   - roster / LTA preparation,
   - or readiness-fix workflow.

## Golden Rules

- Do not delete or weaken `upsertTenders()`, dedupe logic, or link verification without replacing them with an equivalent or stronger mechanism.
- Prefer adding primary sources (agency / donor / procurement portal) instead of scraping aggregator mirrors when both exist.
- When a site is JS-rendered, Cloudflare-protected, or returns thin HTML, reuse `workers/crawler-browser/` before introducing a new scraping stack.
- Any crawler change must preserve the `RawTender` and `CrawlResult` contracts unless a coordinated migration is included.
- Any assessment change must preserve graceful degradation when website content is poor, blocked, or misleading.
- Every major data pipeline change should add instrumentation or a health endpoint.
- Do not optimize for source count at the expense of match quality or dashboard usefulness.
- Do not ship generic dashboard filler; every UI module should help the user qualify, prepare, or act.
- Treat user-facing pipeline failures as production issues, not cosmetic bugs.

## Coding Conventions

- TypeScript first; keep functions small and typed.
- Reuse helpers from `src/lib/crawlers/types.ts` and existing utility modules.
- Never silently swallow parsing failures if they can be logged with platform context.
- On null / missing fields, degrade safely and return partial structured data instead of throwing.
- Keep source-specific parsing logic inside source files; keep orchestration logic in sync/orchestration modules.
- Favor the smallest coherent change set that materially improves reliability, clarity, or launch readiness.

## Crawler Quality Standards

- Source URL must point to the primary opportunity page whenever possible.
- `deadline` should be normalized if the source makes it available.
- `description` should be enriched when source data is too thin for matching.
- `sector` should be mapped consistently through sector-map or equivalent enrichment.
- `estimated_value`, budget, or amount should be captured and surfaced when the source makes it available.
- Dedup must work across cross-posted tenders from overlapping sources.
- Add respectful delays and retry logic for unstable sources.
- Favor field completeness that improves downstream ranking, explanation, and dashboard scanability.
- Support adjacent matching through richer metadata and sensible categorization, not through invented values.

## Assessment Quality Standards

- Confirm the final resolved site before probing subpaths.
- Detect SPA / JS-rendered shells and use browser rendering when needed.
- Prioritize text that explains what the company does, sells, builds, supplies, manages, or delivers.
- Mark thin, parked, login-walled, or obviously wrong sites as low-confidence inputs.
- Assessment output should distinguish hard evidence from inference.
- Prioritize first-try classification stability across repeated runs of the same company.
- Prefer user-supplied business description when website evidence is weak, contradictory, or too thin.
- Surface evidence snippets and confidence cues so the UI can explain classifications and matches.
- Avoid optimistic over-classification when confidence is low.

## Dashboard Quality Standards

- Show users why a tender matched, not only that it matched.
- Expose deadlines, source, type, sector, value, and next action clearly.
- Support preference feedback loops (`not relevant`, `saved`, `in progress`, `applied`).
- Keep readiness gaps actionable and tied to upsell/workflow paths.
- Optimize the first dashboard view after assessment for relevance, trust, and momentum.
- Avoid generic analytics-dashboard patterns; Tenderpath should feel like a procurement workflow system.
- Make every key view answer:
  - Why this matters,
  - Why it matches,
  - What to do next.

## UX / Product Experience Standards

- The assessment → onboarding → dashboard transition must feel seamless.
- Empty states, loading states, and success states should guide the user toward productive action.
- The first-session experience should create a credible “wow” moment through relevance and clarity, not decorative design.
- CTA hierarchy should support the business model:
  - bid/no-bid,
  - proposal package,
  - dashboard retention,
  - roster / LTA upsell.
- Favor simplification and clarity over redesign-for-redesign’s-sake.

## Ops / Reliability Standards

- Health visibility must include not only crawl success, but also whether useful records were produced.
- Admin tooling should make it easy to answer:
  - Did the source run?
  - Did it produce usable tenders?
  - Did the assessment complete?
  - Did the follow-up email send?
  - Did the dashboard populate?
- Grouped summaries are preferred over raw log inspection when possible.
- Silent no-op behavior is worse than explicit failure.

## Documentation Map

Before changing a subsystem, read its companion docs in `docs/agents/`:

- `docs/agents/crawler-architecture.md`
- `docs/agents/assessment-architecture.md`
- `docs/agents/dashboard-architecture.md`
- `docs/agents/managed-agents-setup.md`
- `docs/agents/claude-code-prompts.md`

Also read product strategy when working on flow, monetization, or dashboard direction:

- `docs/product/Tenderpath-research-report.md`

## Expected Workflow

1. Read `AGENTS.md` and the relevant subsystem doc.
2. Inspect current implementation before proposing changes.
3. Make the smallest coherent set of changes.
4. Add logs, comments, or docs only where they improve maintainability or diagnosability.
5. If schema/API contracts change, update scripts/docs in the same change set.
6. When near-launch issues are involved, prioritize activation reliability, first-try trust, and matched-dashboard usefulness over feature expansion.