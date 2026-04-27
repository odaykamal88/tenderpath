# SESSION.md — Tenderpath Canonical Handoff

> **Read this file first.** It is the authoritative state of the session.  
> Do not infer progress from commits alone. If something is not recorded here, treat it as unverified.

---

## Current Objective

Maintain a shared handoff state so Claude Code and Codex can resume work accurately without re-deriving repo state from git history.

The operating assumption:
1. `AGENTS.md` and `docs/agents/` are the implementation truth.
2. Work follows the documented rollout order unless this file explicitly records otherwise.
3. Agents must preserve system contracts and make the smallest coherent change set.

---

## Repo Operating Rules

Read these before making any changes:

- `AGENTS.md` — product areas, priorities, golden rules, coding conventions, quality standards
- `CLAUDE.md` — agent operating instructions (reads `AGENTS.md` and `docs/agents/`)
- `docs/agents/crawler-architecture.md` — before touching any crawler or worker code
- `docs/agents/assessment-architecture.md` — before touching assessment or matching code
- `docs/agents/dashboard-architecture.md` — before touching dashboard or UI code
- `docs/agents/managed-agents-setup.md` — Managed Agent role definitions (source, assessment, dashboard, ops, UX)
- `docs/agents/claude-code-prompts.md` — the canonical six prompts and their scope

Core contracts to preserve in every session:
- `upsertTenders()`, dedupe logic, and link verification must not be weakened without an equivalent or stronger replacement.
- `RawTender` and `CrawlResult` interfaces must not change without a coordinated migration included in the same change set.
- Assessment must degrade gracefully when website content is poor, blocked, or misleading.
- Prefer direct primary sources over aggregator copies at all times.
- Reuse `workers/crawler-browser/` before introducing any new scraping stack.
- Every major pipeline change must add instrumentation, a health endpoint, or observable retry behavior.

---

## Completed So Far

### Prompt 1 — Documentation layer (committed)
- `AGENTS.md`: full Tenderpath operating system with Launch Priorities, items 6–9 in Agent Priorities, and three additional Golden Rules.
- `CLAUDE.md`: references `@AGENTS.md` and `SESSION.md`; instructs agents to read `docs/agents/` before touching subsystems.
- `docs/agents/managed-agents-setup.md`: expanded with richer system prompts and field-completeness language for all five managed agent roles.
- All subsystem docs committed under `docs/agents/`: `crawler-architecture.md`, `assessment-architecture.md`, `dashboard-architecture.md`, `claude-code-prompts.md`, `implementation-checklist.md`.
- `SESSION.md` (this file) created.

### Prompt 2 — UNGM worker hardening (complete)
Verified by code inspection:
- `/health` endpoint: ✅ exists, launches Chromium when authorized
- Cloudflare warmup with `cf_clearance` cookie polling: ✅
- `navigate` mode for SPA pages (EBRD/ECEPP): ✅
- Batch mode `/fetch-many` with amortized warmup: ✅
- UA rotation: ✅ added — 5 realistic Chrome UAs (Mac/Win/Linux, 123–124) picked randomly per session
- UNGM fast-fail detection + retry with `waitMs=6000`: ✅ in `src/lib/crawlers/ungm.ts`
- Challenge HTML detection (`"Just a moment"`, `"cf-challenge"`): ✅
- 0-tender result treated as failure: ✅

### Prompt 3 — Direct source expansion (complete)
Verified by code inspection of `src/lib/crawlers/` and `sync.ts`:
- `nrc.ts` ✅ — Norwegian Refugee Council, server-rendered, detail-page fetch
- `afd.ts` ✅ — Agence Française de Développement
- `kfw.ts` ✅ — KfW Development Bank
- `ada.ts` ✅ — Austrian Development Agency
- `jica.ts` ✅ (disabled with documented reason: English listing returns 404, real listing is Japanese-only with PDF-only detail pages)
- All live crawlers wired into `sync.ts` `syncAllTenders()` ✅
- Source priority table in `sync.ts` updated for all new sources ✅

### Application layer (partially completed, order not strictly followed)
Based on git history — treat as implemented but not fully audited against prompt specs:

| Prompt | Scope | Status |
|--------|-------|--------|
| Prompt 4 | Website crawl fidelity (`crawl.ts`, SPA detection, browser fallback) | **Partially done** — `f96a441 Fix assessment classification and matching` — needs audit |
| Prompt 5 | Persisted match quality, match reasons, explainability | **Substantially done** — multiple commits: dedup, buckets, adjacent fields, briefs, logistics/food/grants tuning |
| Prompt 6 | Matched-tender dashboard improvements | **Partially done** — `01e1c3f Deepen workflows and source quality ops` — needs audit |

Additional work done outside the prompt sequence:
- Email delivery fixed and auth email validation added (`7fa71c1`, `249de9e`)
- Stripe checkout errors surfaced (`2042ed8`)
- Contract values shown in dashboard (`249de9e`)

---

## Current Status

Prompts 1, 2, and 3 are complete and committed.

Prompt 4 (website crawl fidelity) is the active next target. The assessment architecture doc specifies: final URL resolution, SPA shell detection, browser-rendered fallback, expanded subpath probing, business-description text prioritization, `renderMethod` and `finalUrl` fields on crawl output. These need to be audited against `src/lib/assessment/crawl.ts` — some may be partially in place from `f96a441`.

Prompts 5 and 6 have been substantially worked ahead of schedule but need audit against the prompt specs before being marked complete.

---

## Next Recommended Task

**Prompt 4 — Website crawl fidelity** in `src/lib/assessment/crawl.ts`.

Act as the Tender Assessment Agent. Read `AGENTS.md` and `docs/agents/assessment-architecture.md` first, then open `src/lib/assessment/crawl.ts` and audit whether it:
- resolves and stores the final URL after redirect chains,
- detects SPA/JS-rendered shells,
- falls back to `workers/crawler-browser/` for browser rendering,
- probes a broader subpath list (`/about`, `/services`, `/what-we-do`, `/solutions`),
- prioritizes business-description text over boilerplate,
- marks thin/parked/login-walled sites as low-confidence,
- returns `renderMethod` and `finalUrl` fields.

Add anything missing. Preserve graceful fallback behavior throughout.

---

## Recommended Agent

**Claude Code** for Prompts 1–3 (docs, infrastructure, crawler expansion).  
**Codex** for additive implementation work (new crawler files, field-level parsing) once the operating context is established.

Use Managed Agent role definitions from `docs/agents/managed-agents-setup.md` to frame Claude Code tasks:
- Crawler work → Tender Source Agent framing
- Assessment work → Tender Assessment Agent framing  
- Dashboard work → Tender Dashboard Agent framing
- Ops/monitoring → Tender Ops Agent framing

---

## Starting Prompt

Paste this into the next Claude Code or Codex session:

```
Read SESSION.md first, then AGENTS.md, then docs/agents/assessment-architecture.md.

Act as the Tender Assessment Agent.

Open src/lib/assessment/crawl.ts and audit whether it:
- resolves and stores the final URL after redirect chains,
- detects SPA / JS-rendered shells (thin HTML, missing body text),
- falls back to workers/crawler-browser/ for browser rendering when needed,
- probes a useful subpath list (/about, /services, /what-we-do, /solutions, /capabilities),
- prioritizes business-description paragraphs over nav / footer boilerplate,
- marks thin, parked, login-walled, or clearly wrong sites as low-confidence,
- returns renderMethod ("static" | "browser") and finalUrl on the crawl output.

Add whatever is missing. Preserve graceful fallback — never throw when the
site is unreachable or returns poor content. Update SESSION.md when finished.
```

---

## Files To Read First

Every session, mandatory:
- `SESSION.md` (this file)
- `AGENTS.md`
- `CLAUDE.md`

Then read the subsystem doc matching the task:
- `docs/agents/crawler-architecture.md` — crawler, worker, sync, dedup work
- `docs/agents/assessment-architecture.md` — assessment, matching, classification work
- `docs/agents/dashboard-architecture.md` — dashboard, onboarding, post-assessment flow work
- `docs/agents/managed-agents-setup.md` — role definitions and agent framing
- `docs/agents/claude-code-prompts.md` — canonical prompts and scope

---

## Constraints / Do Not Touch

At all times:
- Do not break `RawTender` or `CrawlResult` contracts without a coordinated migration in the same change set.
- Do not weaken `upsertTenders()`, dedupe logic, or link verification.
- Do not replace direct-source strategy with aggregator dependence.
- Do not remove graceful fallback behavior in assessment.
- Do not make undocumented breaking changes to schema or API routes.
- Do not introduce a new UI framework or scraping stack without explicit approval.
- Do not commit secrets, credentials, or `.env` files.

Until Prompt 2 and 3 are confirmed complete:
- Do not remove or bypass the existing UNGM crawler.
- Do not remove any existing crawler source.

---

## Open Questions

1. Are the Prompt 4 crawl fidelity improvements (`renderMethod`, `finalUrl`, SPA detection) already reflected in `src/lib/assessment/crawl.ts`? Read the file before implementing to avoid double work.
2. Prompts 5 and 6 have been substantially worked — do they need a gap audit against the prompt specs, or are they good enough to mark complete?
3. Should Codex be restricted to additive crawler and test work only, with Claude Code owning architecture, migrations, and docs?
4. Is the production match quality now stable enough to shift focus to activation reliability (assessment → email → dashboard flow)?

---

## Files Changed This Session

- `SESSION.md` — created and updated
- `CLAUDE.md` — updated to reference `SESSION.md`; corrected wrong `docsagents` path to `docs/agents/`
- `AGENTS.md` — committed expansion (Launch Priorities, Agent Priority items 6–9, three additional Golden Rules)
- `docs/agents/managed-agents-setup.md` — committed expansion (richer system prompts, field-completeness language)
- `workers/crawler-browser/src/index.ts` — added UA rotation (5-entry `USER_AGENTS` array, random pick per session)

---

## Blockers

None recorded. The uncommitted docs changes should be reviewed and committed before the next implementation task begins.

---

## Handoff Notes

The next agent must not infer progress from commits alone.  
This file is the canonical session memory.  
If something was done but is not recorded here, treat it as unverified.

Every session should:
1. Read `SESSION.md` first.
2. Read `AGENTS.md` and the relevant subsystem doc.
3. Complete exactly one coherent task.
4. Update this file before ending the session.

---

## End-of-Session Update Template

Copy this block and fill it in at the end of each session.

```
### Session Update
- Agent:
- Date:
- Task Completed:
- Files Changed:
- Tests Run:
- Result:
- Blockers:
- Important Decisions:
- Contracts or Interfaces Changed:
- Docs Updated:
- Next Recommended Task:
- Recommended Agent:
- Paste-Ready Next Prompt:

### Short Resume State
- What is now true:
- What remains:
- What the next agent must read first:
```
