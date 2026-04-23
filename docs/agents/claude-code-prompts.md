# Tenderpath Claude Code Prompt Pack

Use these prompts in Claude Code after adding the repo docs.

## Prompt 1 — Install the agent operating system

Read `AGENTS.md`, `CLAUDE.md`, and all files in `docs/agents/`.
Then replace the current root `AGENTS.md` with the Tenderpath-specific operating guidance while preserving the existing Next.js warning block at the top.
Update `CLAUDE.md` so it references `AGENTS.md` and instructs Claude Code to read `docs/agents/` before changing crawler, assessment, dashboard, or worker code.
Do not modify application code in this task. Only create/update documentation files.

## Prompt 2 — Harden UNGM + worker

Act as the Tender Source Agent.
Read `AGENTS.md` and `docs/agents/crawler-architecture.md` first.
Then update `workers/crawler-browser/src/index.ts` to improve Cloudflare resilience with realistic browser setup, UA rotation, Turnstile-aware warmup checks, and a lightweight `/health` endpoint.
After that, update `src/lib/crawlers/ungm.ts` so it retries once with a longer wait profile when the worker response suggests Cloudflare challenge HTML or malformed payloads.
Preserve existing fetch-many behavior and do not change crawler interfaces.

## Prompt 3 — Add direct sources instead of Devex scraping

Act as the Tender Source Agent.
Read `AGENTS.md` and `docs/agents/crawler-architecture.md` first.
Then add direct source crawlers for NRC, AFD, KfW, JICA, and ADA under `src/lib/crawlers/` using existing helper utilities and `CrawlResult`/`RawTender` contracts.
Wire them into the sync orchestrator and update sector mapping coverage where needed.
Do not remove any existing sources.
Treat Devex as a discovery signal, not a canonical source.

## Prompt 4 — Fix website crawl fidelity

Act as the Tender Assessment Agent.
Read `AGENTS.md` and `docs/agents/assessment-architecture.md` first.
Then improve `src/lib/assessment/crawl.ts` so it:
- resolves and stores final URL,
- detects SPA shells,
- uses the browser worker for fallback rendering,
- expands subpath probing,
- prioritizes business-description text,
- marks wrong/thin/login-walled sites as low-confidence,
- adds `renderMethod` and `finalUrl` to the returned crawl data.
Update any related types minimally and preserve graceful fallback behavior.

## Prompt 5 — Persist and explain matching

Act as the Tender Assessment Agent.
Read `AGENTS.md` and `docs/agents/assessment-architecture.md` first.
Then review `src/lib/assessment/` and propose the smallest coherent implementation for persisted top matches, clearer match reasons, and a path toward embedding-based retrieval.
If schema changes are needed, include matching migration updates in `scripts/`.
Prioritize explainability and backward compatibility.

## Prompt 6 — Build the matched-tender dashboard

Act as the Tender Dashboard Agent.
Read `AGENTS.md` and `docs/agents/dashboard-architecture.md` first.
Then build or improve the dashboard experience for matched tenders using existing auth and subscription patterns.
Prioritize:
- main matched tender feed,
- why-matched explanations,
- readiness checklist,
- onboarding flow,
- deadline urgency,
- related tenders.
Do not add a new UI framework. Reuse existing stack and conventions.
