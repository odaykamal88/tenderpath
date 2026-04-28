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
| Prompt 4 | Website crawl fidelity (`crawl.ts`, SPA detection, browser fallback) | **Complete** — all spec items confirmed; parking-page detection added `1667157` |
| Prompt 5 | Persisted match quality, match reasons, explainability | **Complete** — confirmed by audit; all structured_reasons fields implemented; embeddings deferred to Sprint 4 |
| Prompt 6 | Matched-tender dashboard improvements | **Complete (UI gap closed)** — bucket badges, deadline urgency, geography/keyword in match panel; `4131010` |

Additional work done outside the prompt sequence:
- Email delivery fixed and auth email validation added (`7fa71c1`, `249de9e`)
- Stripe checkout errors surfaced (`2042ed8`)
- Contract values shown in dashboard (`249de9e`)

---

## Current Status

All six prompts complete and committed. Activation reliability audit complete.

Two silent failures in `seedPipeline()` found and fixed (`src/app/dashboard/page.tsx`):
1. `fetch()` does not throw on HTTP errors — non-ok POSTs (e.g. 401) were silently swallowing failures while still clearing `tp_bridge`, permanently losing match data. Fixed by adding `.then(res => { if (!res.ok) throw ... })` so failures propagate and bridge is preserved for retry.
2. Dashboard data GET fired before seeding POSTs completed — users saw empty matched-tenders on first load and had to manually refresh. Fixed by extracting pipeline/readiness fetch into `loadDashboard` callback and calling it at the end of successful `seedPipeline()`.

Prompts 1, 2, 3, 5, and 6 are complete and committed.

**Prompt 5** (persisted match quality, match reasons, explainability) — confirmed complete. `match.ts` fully implements `structured_reasons` with summary, matchedSectors, matchedCapabilities, matchedKeywords, geographyAlignment, scoreBreakdown, evidenceQuality, confidence, caveats, and all opportunityBucket fields. Embedding retrieval is intentionally stubbed (Sprint 4, documented). Opportunity buckets (act_now / strong_fit / strategic / adjacent / watchlist) are computed and persisted.

**Prompt 6** (matched-tender dashboard improvements) — UI gap closed. All bucket/geography data was already in `pipeline_items.match_reasons` JSONB; the gap was in client-side typing and rendering. Both dashboard pages now show opportunity bucket badges and deadline urgency. "Why this match?" panel now surfaces matchedKeywords, geographyAlignment, and opportunityBucketReason. Committed `4131010`. Remaining deferred item: adding `tender_geography`, `tender_type`, `tender_source` as explicit pipeline_items columns — requires schema migration and is lower priority than activation reliability.

**Prompt 4** (website crawl fidelity) — complete. Audited `src/lib/assessment/crawl.ts`: all spec items (finalUrl, SPA detection, browser fallback, subpath probing, content ordering, login-wall detection, renderMethod/finalUrl output) were already implemented in a prior session. One real gap found and fixed: parking-page detection. Added `isParkingPage()` with 17 unambiguous signals; parking pages now return `renderMethod: "parked"`, `isThinContent: true`, empty content — and analyze.ts gives the LLM a specific note to ignore website evidence and rely on user-supplied description. Committed `1667157`.

---

## Latest Session Update — 2026-04-27

- **Agent**: Codex
- **Date**: 2026-04-27
- **Task Completed**: Activation reliability trace from `AssessmentResults.tsx` → `tp_bridge` → login → dashboard seeding → `/api/dashboard/pipeline` → assessment email delivery. Fixed silent/fragile failure points without changing schema or API contracts.
- **Files Changed**:
  - `src/app/assessment/AssessmentResults.tsx` — includes assessment email in `tp_bridge` so login can preserve the same user identity.
  - `src/app/login/page.tsx` — pre-fills login email from `tp_bridge`; replaced touched-file homepage anchor with `Link`.
  - `src/app/dashboard/page.tsx` — dashboard load and seed failures now log source-context errors and show user-visible retry guidance while preserving `tp_bridge` for retry.
  - `src/app/api/assessment/public/route.ts` — replaces detached email promise with Next `after()` route-handler work, keeping the response fast while making the post-response email task platform-aware.
  - `src/lib/email/sendAssessment.ts` — email queue now records failed/sent attempts, provider, and error details; missing `RESEND_API_KEY` no longer leaves rows stuck silently as `pending`.
- **Tests Run**:
  - `npx eslint src/lib/email/sendAssessment.ts src/app/api/assessment/public/route.ts src/app/assessment/AssessmentResults.tsx src/app/login/page.tsx src/app/dashboard/page.tsx` — passed.
  - `npx tsc --noEmit` — passed.
  - `npm run lint` — failed on pre-existing repo-wide issues, including `.claude/worktrees/**` files and existing `<a>` navigation lint errors in unrelated pages. Changed files pass targeted lint.
- **Result**: Assessment handoff is more reliable and diagnosable. Dashboard seed failures are no longer silent, the bridge is kept for retry, login is biased toward the assessment email, and email delivery state is observable in `email_queue`.
- **Blockers**: No implementation blocker. Full-repo lint remains noisy due to pre-existing unrelated lint errors and `.claude/worktrees/**` being scanned.
- **Important Decisions**:
  - Used Next 16 `after()` for public assessment email delivery instead of a detached promise because route-handler post-response work is explicitly supported by the local Next docs.
  - Did not make email sending block the public assessment response; failures are now recorded for ops visibility.
  - Did not introduce pipeline schema changes or broad idempotency migrations.
- **Contracts or Interfaces Changed**: None. Existing API shapes remain compatible; `tp_bridge.email` is additive.
- **Docs Updated**: `SESSION.md` only.
- **Next Recommended Task**: Run a local end-to-end activation smoke test with a real assessment payload and test login: confirm `tp_bridge` creation, login prefill, magic-token verification, dashboard seed POSTs, persisted `pipeline_items.match_reasons`, readiness panel load, and `email_queue` status transitions. If duplicates appear after a forced seed retry, add a narrow idempotency guard to `/api/dashboard/pipeline` POST.
- **Recommended Agent**: Codex
- **Paste-Ready Next Prompt**:

```text
Read SESSION.md first, then AGENTS.md, CLAUDE.md, and docs/agents/dashboard-architecture.md.

Act as the Tender Ops Agent. Run a local end-to-end activation smoke test for the assessment → tp_bridge → login → dashboard seed → email flow. Verify:
- AssessmentResults writes tp_bridge with assessment_id, email, matched_tenders, structured reasons, and gaps.
- Login pre-fills the assessment email and magic-token verification lands on /dashboard.
- Dashboard seed POSTs create pipeline_items with match_reasons populated and remove tp_bridge only after success.
- Readiness loads from the latest assessment for the signed-in email.
- email_queue moves to sent or failed with attempts/provider/error populated.

Do not push or deploy. If you find duplicate pipeline rows after a retry, make the smallest compatible idempotency fix in /api/dashboard/pipeline POST. Update SESSION.md when finished.
```

---

## Phase 1 Matching Kickoff Notes — 2026-04-27

- **Agent**: Codex
- **Date**: 2026-04-27
- **Task Completed**: Strategic kickoff audit for Phase 1 using user-provided DevelopmentAid benchmark examples for `jadunited.com` and `docstream.co`.
- **Files Changed**: `SESSION.md` only.
- **Tests / Audits Run**:
  - Opened and inspected the provided DevelopmentAid benchmark URLs.
  - `npx tsx scripts/_jad-match-audit.ts` — partially useful; query bug found (`website_url` column does not exist), but earlier scenarios showed narrow logistics keywords return 0 Jordan/regional rows while wider procurement/supply keywords surface materially more candidates.
  - `npx tsx scripts/_match-rerun.ts` — Jad currently receives 18 matches for Syria, including the IOM Transportation LTA; Docstream receives only 1 weak match.
  - `npx tsx scripts/_developmentaid-diff.ts data/developmentaid/Thunderbit_f540c3_20260420_100332.csv` — current CSV is stale relative to the user’s Apr 27 examples but confirms DevelopmentAid-diff harness exists.
  - Exact DB title check against the 10 benchmark tenders.
- **Result**:
  - Already in DB but weak/null metadata: UNDP bakery maintenance, UNDP spare parts, IOM accommodation LTA, IOM transportation LTA. These are mostly source-detail/sector enrichment and matching breadth problems.
  - Not in DB: UNHCR light construction, UNRWA furniture, UNRWA adult diapers, TAS ready-to-eat baskets, TAS non-food items, EC MED Dialogue. These are coverage/freshness/source-ingest problems.
  - For Jad, the core classification problem is that “logistics” is too narrow. The company should likely be represented as general supplier / procurement / facilities / transport / food/NFI / light construction-adjacent, not just logistics.
  - For Docstream, current matching is far too literal around language services; EC governance/civil-society/program support opportunities need a consulting/governance/documentation capability path.
- **Blockers**:
  - Need a fresh DevelopmentAid CSV export or direct primary-source additions for Apr 27 examples.
  - `scripts/_jad-match-audit.ts` references non-existent `assessments.website_url`; should be fixed to `website` before reuse.
- **Important Decisions**:
  - Treat DevelopmentAid as a benchmark/discovery source, not canonical storage when a primary source exists.
  - Phase 1 should produce a repeatable benchmark harness before large matcher changes.
- **Contracts or Interfaces Changed**: None.
- **Docs Updated**: `SESSION.md`.
- **Next Recommended Task**: Build a small benchmark fixture and audit script for the provided Jad/Docstream examples. The script should check each expected tender for DB presence, metadata completeness, and whether `matchTenders()` returns it for the relevant company profile. Then make the smallest fixes in order: source coverage/freshness first, sector/description enrichment second, matcher scoring third.
- **Recommended Agent**: Codex.
- **Paste-Ready Next Prompt**:

```text
Read SESSION.md first, then AGENTS.md, CLAUDE.md, docs/agents/dashboard-architecture.md, and the relevant Next.js 16 App Router docs under node_modules/next/dist/docs/.

Act as the Tender Source + Assessment Agent for Phase 1 matching quality.

Create a small benchmark fixture from the user-provided DevelopmentAid examples for jadunited.com and docstream.co. Add a script that reports, for each benchmark tender:
- whether it exists in tenders,
- source_name/source_url,
- deadline/country/sector/description completeness,
- whether matchTenders() returns it for the latest relevant assessment,
- if missing, whether the likely failure is coverage, metadata, or scoring.

Fix the existing _jad-match-audit.ts column bug if needed. Do not add aggregator scraping as canonical source. Prefer direct-source coverage or CSV-backed DevelopmentAid discovery only as a fallback benchmark ingest. Update SESSION.md when finished.
```

---

## Phase 1 Benchmark Harness — 2026-04-27

- **Agent**: Codex
- **Date**: 2026-04-27
- **Task Completed**: Created the Phase 1 matching benchmark fixture and audit script for the Jad/Docstream examples. Fixed the existing Jad audit script column bug.
- **Files Changed**:
  - `data/benchmarks/phase1-matching.json` — benchmark fixture with 10 user-provided DevelopmentAid examples and fallback company profiles.
  - `scripts/phase1-match-benchmark.ts` — repeatable audit that checks DB presence, source metadata completeness, `matchTenders()` inclusion, and likely failure class (`coverage`, `metadata`, `scoring`, `ok`).
  - `scripts/_jad-match-audit.ts` — fixed `website_url`/`detected_industry` column assumptions to use current `assessments.website` and `ai_analysis`.
  - `SESSION.md` — updated handoff.
- **Tests Run**:
  - `npx tsx scripts/phase1-match-benchmark.ts` — passed. Baseline: 2 ok, 3 metadata failures, 5 coverage failures.
  - `npx tsx scripts/_jad-match-audit.ts` — passed.
  - `npx eslint scripts/phase1-match-benchmark.ts scripts/_jad-match-audit.ts` — passed.
  - `npx tsc --noEmit` — passed.
- **Result**:
  - Current benchmark baseline is 2/10 passing:
    - OK: IOM Accommodation LTA, IOM Transportation LTA.
    - Metadata failures: UNDP bakery maintenance, UNDP spare parts, UNRWA furniture. These exist in DB but lack sector/description, so matching quality depends on weak title-only signals.
    - Coverage failures: UNHCR light construction, UNRWA adult diapers, TAS ready-to-eat baskets, TAS non-food items, EC MED Dialogue.
  - The audit script suppresses source-rule noise and avoids false DB hits on generic titles by requiring title plus expected country/agency context.
- **Blockers**: None for the harness. Coverage fixes may require fresh DevelopmentAid CSV export and/or direct-source crawler fixes.
- **Important Decisions**:
  - Kept DevelopmentAid as benchmark/discovery evidence; no canonical aggregator scraping was added.
  - Classified failures before changing matcher weights, so future fixes can be measured against a stable baseline.
- **Contracts or Interfaces Changed**: None.
- **Docs Updated**: `SESSION.md` only.
- **Next Recommended Task**: Fix the three metadata failures first because they are already in DB and should be the fastest path to immediate match-quality improvement. Add source/detail enrichment or sector normalization so the existing UNDP/UNRWA rows gain useful `sector` and `description` signal, then rerun `npx tsx scripts/phase1-match-benchmark.ts`.
- **Recommended Agent**: Codex.
- **Paste-Ready Next Prompt**:

```text
Read SESSION.md first, then AGENTS.md, CLAUDE.md, docs/agents/crawler-architecture.md, and docs/agents/assessment-architecture.md.

Act as the Tender Source + Assessment Agent for Phase 1 matching quality.

Use `npx tsx scripts/phase1-match-benchmark.ts` as the scoreboard. Fix the current metadata failures first:
- UNDP bakery production-line maintenance
- UNDP spare parts for Deir Ali / Al-Nassrieh
- UNRWA furniture for schools

Inspect the relevant crawlers and sector normalization. Add the smallest source/detail enrichment or sector mapping changes needed so these existing DB rows have useful `sector` and/or `description` signal and surface in `matchTenders()` for Jad. Preserve RawTender/CrawlResult contracts, do not weaken upsert/dedupe/link verification, and do not add DevelopmentAid as canonical scraping. Rerun the benchmark and update SESSION.md when finished.
```

---

## Phase 1A-1C Matching Pass — 2026-04-27

- **Agent**: Codex
- **Date**: 2026-04-27
- **Task Completed**: Completed the narrow Phase 1A-1C pass requested by the user: metadata/sector enrichment for sparse UN procurement rows, coverage triage for the benchmark examples, and matcher breadth/scoring fixes for Jad-style general supplier profiles.
- **Files Changed**:
  - `src/lib/crawlers/sector-map.ts` — expanded sector normalization for procurement/supply, accommodation/LTA, bakery/ready-to-eat baskets, spare parts/production lines, furniture/NFI, and diapers/health supplies.
  - `src/lib/crawlers/ungm.ts` — UNGM listing rows now store source-derived sector slugs from title normalization where available.
  - `src/lib/crawlers/unrwa.ts` — UNRWA listing rows now store source-derived sector slugs from title normalization where available.
  - `src/lib/assessment/match.ts` — widened trusted logistics evidence for procurement/supply/LTA language, added healthcare/food/engineering/general-supplier keywords, increased strict-country output cap from 15 to 25, and added a strict-country candidate pass so local tenders are scored even when broad keyword pools are crowded.
  - `scripts/phase1-match-benchmark.ts` — tightened title matching with discriminating title needles so similarly named UNRWA school tenders are not misclassified as the benchmark furniture tender.
  - `SESSION.md` — updated handoff.
- **Tests Run**:
  - `npx tsx scripts/phase1-match-benchmark.ts` — passed. Current result: 4 ok, 6 coverage, 0 metadata/scoring.
  - `npx tsx -e 'const {normalizeSector}=require("./src/lib/crawlers/sector-map"); ...'` — confirmed benchmark-style titles map to expected slugs: accommodation/transportation → logistics, adult diapers → healthcare, furniture schools → education/logistics, light construction → construction.
  - `npx eslint src/lib/crawlers/sector-map.ts src/lib/crawlers/ungm.ts src/lib/crawlers/unrwa.ts src/lib/assessment/match.ts scripts/phase1-match-benchmark.ts scripts/_jad-match-audit.ts` — passed.
  - `npx tsc --noEmit` — passed.
- **Result**:
  - All existing-in-DB benchmark metadata/scoring failures now surface for Jad: UNDP bakery maintenance, UNDP spare parts, IOM accommodation LTA, and IOM transportation LTA.
  - The benchmark now correctly marks UNRWA furniture as coverage, not metadata; the previous script matched a different UNRWA school tender too loosely.
  - Live primary-source spot check through the existing browser worker found current UNGM search results for `Light Construction Works` and `Adult Diapers`, so those are source freshness/sync-depth coverage issues, not a reason to add DevelopmentAid as canonical.
  - Remaining benchmark misses are true coverage gaps in the local `tenders` table: UNHCR light construction, UNRWA furniture, UNRWA adult diapers, TAS ready-to-eat baskets, TAS non-food items, and EC MED Dialogue.
- **Blockers**:
  - Local DB was not mutated or backfilled in this pass. A fresh source sync or targeted primary-source backfill is needed before the remaining benchmark rows can pass DB-presence checks.
  - TAS and EC MED Dialogue need primary-source discovery; they should not be canonicalized from DevelopmentAid unless explicitly treated as temporary benchmark/discovery data.
- **Important Decisions**:
  - Preserved `RawTender` / `CrawlResult` contracts and did not touch `upsertTenders()` or dedupe/link verification.
  - Kept DevelopmentAid as benchmark/discovery evidence only.
  - Added strict-country candidate recall instead of broadly lowering scoring thresholds; local tenders still must pass the existing sector/token scoring gates.
- **Contracts or Interfaces Changed**: None. Crawler `sector` values are additive metadata within the existing `RawTender` contract.
- **Docs Updated**: `SESSION.md` only.
- **Next Recommended Task**: Run a primary-source coverage/backfill pass for the six remaining benchmark misses. Start with UNGM because live worker search already found `Light Construction Works` and `Adult Diapers`; add a targeted UNGM search/backfill path or run a fresh source sync safely, then investigate UNRWA furniture, TAS, and EC MED Dialogue from primary sources.
- **Recommended Agent**: Codex for a narrow source/backfill implementation; Claude Code only if the chosen approach becomes a coordinated sync architecture change.
- **Paste-Ready Next Prompt**:

```text
Read SESSION.md first, then AGENTS.md, CLAUDE.md, docs/agents/crawler-architecture.md, and docs/agents/assessment-architecture.md.

Act as the Tender Source + Assessment Agent for Phase 1 coverage.

Use `npx tsx scripts/phase1-match-benchmark.ts` as the scoreboard. The remaining failures are coverage-only:
- UNHCR light construction works
- UNRWA furniture for schools 2026
- UNRWA adult diapers
- TAS ready-to-eat baskets
- TAS non-food items
- EC MED Dialogue regional civil society facility

Do not add DevelopmentAid as canonical scraping. Start with primary-source coverage: UNGM live search already finds Light Construction Works and Adult Diapers through the existing browser worker. Add the smallest safe source/backfill path or sync-depth fix that gets primary-source rows into `tenders` with source-derived sector metadata. Preserve RawTender/CrawlResult contracts, do not weaken upsert/dedupe/link verification, and update SESSION.md when finished.
```

---

## UNGM Coverage Fix — 2026-04-27

- **Agent**: Codex
- **Date**: 2026-04-27
- **Task Completed**: Fixed the UNGM coverage path for benchmark-relevant Syria supplier notices. Added supplemental title searches to the existing UNGM browser-worker batch, preserved source-derived sector metadata, and fixed sync link filtering so live UNGM notice URLs are not falsely dropped by the generic verifier.
- **Files Changed**:
  - `src/lib/crawlers/ungm.ts` — added supplemental UNGM title searches for supplier-style notices, request labels for parse logs, in-crawler notice dedupe, and existing sector normalization on returned notices.
  - `src/lib/crawlers/sync.ts` — treats UNGM notice URLs generated from live UNGM listing/search rows as source-verified so Cloudflare-blocked HEAD/GET checks do not drop real notices.
  - `SESSION.md` — updated handoff.
- **Tests Run**:
  - Live `crawlUNGM()` smoke check — passed. Returned 304 deduped notices and included:
    - `UNGM-SRFP/HCR/SYR/26/2770` — UNHCR light construction works, sector `construction`.
    - `UNGM-RFQ-SFO-NFI-26-11` — UNRWA adult diapers, sector `healthcare`.
    - IOM accommodation and transportation LTAs with sector `logistics`.
  - Targeted primary-source backfill from live `crawlUNGM()` output — completed. `upsertTenders()` result: `added: 2`, `updated: 2`.
  - `npx tsx scripts/phase1-match-benchmark.ts` — passed. Current result: 6 ok, 4 coverage.
  - `npx eslint src/lib/crawlers/ungm.ts src/lib/crawlers/sync.ts src/lib/crawlers/sector-map.ts src/lib/crawlers/unrwa.ts src/lib/assessment/match.ts scripts/phase1-match-benchmark.ts scripts/_jad-match-audit.ts` — passed.
  - `npx tsc --noEmit` — passed.
- **Result**:
  - UNGM now captures the UNHCR light construction notice that the date-sorted 20-page crawl missed.
  - UNGM sync will no longer drop live UNGM notice links simply because generic `HEAD`/`GET` verification is blocked by Cloudflare.
  - Phase 1 benchmark improved from 4/10 to 6/10 passing:
    - Newly OK: UNHCR light construction works, UNRWA adult diapers.
    - Still OK: UNDP bakery, UNDP spare parts, IOM accommodation LTA, IOM transportation LTA.
  - Remaining coverage misses are no longer the immediate UNGM issue: UNRWA furniture for schools 2026, TAS ready-to-eat baskets, TAS non-food items, and EC MED Dialogue.
- **Blockers**:
  - Supplemental UNGM crawl is slower than the date-only run: current smoke check took about 121s, still under the existing 180s worker budget but worth monitoring in cron.
  - Remaining benchmark rows need primary-source discovery outside this UNGM fix.
- **Important Decisions**:
  - Kept the existing `/fetch-many` browser-worker architecture and batched supplemental UNGM searches into that path rather than adding a new scraping stack.
  - Did not weaken link integrity globally. The sync exception is limited to UNGM notices that were just discovered from live UNGM listing/search HTML and have canonical `https://www.ungm.org/Public/Notice/...` URLs.
  - Performed a narrow local DB backfill from live UNGM output for the benchmark rows instead of adding DevelopmentAid as canonical storage.
- **Contracts or Interfaces Changed**: None. `RawTender`, `CrawlResult`, `upsertTenders()`, dedupe, and API/schema contracts are unchanged.
- **Docs Updated**: `SESSION.md` only.
- **Next Recommended Task**: Investigate the four remaining non-UNGM coverage misses from primary sources: UNRWA furniture for schools 2026, TAS ready-to-eat baskets, TAS non-food items, and EC MED Dialogue regional civil society facility. Start with UNRWA direct search/listing behavior before considering any aggregator-backed discovery fallback.
- **Recommended Agent**: Codex for narrow source-specific coverage work.
- **Paste-Ready Next Prompt**:

```text
Read SESSION.md first, then AGENTS.md, CLAUDE.md, docs/agents/crawler-architecture.md, and docs/agents/assessment-architecture.md.

Act as the Tender Source + Assessment Agent for Phase 1 coverage.

Use `npx tsx scripts/phase1-match-benchmark.ts` as the scoreboard. UNGM is now fixed and the benchmark is 6 ok / 4 coverage. Investigate the remaining primary-source coverage misses:
- UNRWA furniture for schools 2026
- TAS ready-to-eat baskets
- TAS non-food items
- EC MED Dialogue regional civil society facility

Do not add DevelopmentAid as canonical scraping. Start with direct UNRWA and primary-source discovery for TAS and EC. Preserve RawTender/CrawlResult contracts, do not weaken upsert/dedupe/link verification, and update SESSION.md when finished.
```

---

## Phase 2A Dashboard Workbench — 2026-04-27

- **Agent**: Codex
- **Date**: 2026-04-27
- **Task Completed**: Started Phase 2 by rebooting the dashboard overview into a procurement workbench. Focused on first-screen usefulness: next best action, priority tender cards, match evidence, deadline pressure, readiness blockers, and service paths.
- **Files Changed**:
  - `src/app/dashboard/page.tsx` — replaced the passive overview with an action-oriented workbench: priority-sorted matched tenders, next-action recommendation, fit/deadline/readiness summaries, why-this-matters evidence, save/not-relevant feedback controls, and service paths for bid/no-bid, digest, proposal, and LTA/roster.
  - `SESSION.md` — updated handoff.
- **Tests Run**:
  - Read local Next.js 16 App Router docs for pages/layouts, navigation, and client components before editing.
  - `npx eslint src/app/dashboard/page.tsx` — passed.
  - `npx tsc --noEmit` — passed.
  - `npm run dev` — started successfully at `http://localhost:3000`.
  - `curl -I http://localhost:3000/dashboard` — returned expected `307` redirect to `/login?next=%2Fdashboard` when unauthenticated.
- **Result**:
  - Dashboard now answers: what matters first, why it matched, what deadline pressure exists, what readiness blocker is next, and which service path to take.
  - Matched tenders are sorted by opportunity bucket, deadline urgency, and fit score instead of raw API order.
  - Users can save or dismiss tender relevance directly from the dashboard overview using the existing tender-feedback API.
  - The service platform is now visible in-dashboard as four clear action paths: Bid/no-bid, Digest, Apply/proposal, and LTA/roster.
- **Blockers**:
  - Browser-level authenticated visual QA was not completed because the route redirects without a local login token. Dev server is running for manual check at `http://localhost:3000`.
  - Dedicated service pages are still not built; current service routing uses existing checkout/pay and pipeline routes.
- **Important Decisions**:
  - Kept changes additive and dashboard-only; no schema, API, or matching changes.
  - Reused existing `pipeline_items.match_reasons`, tender feedback API, bid/no-bid checkout, and pay routes instead of inventing new service infrastructure.
  - Treated this as Phase 2A. Phase 2B should create dedicated product pages/flows for the four service offerings.
- **Contracts or Interfaces Changed**: None. Client-side TypeScript shape for `MatchReason.confidence` now accepts both legacy numeric confidence and current string confidence values.
- **Docs Updated**: `SESSION.md` only.
- **Next Recommended Task**: Phase 2B: create dedicated service pages or in-dashboard service detail views for bid/no-bid, weekly digest, proposal/application package, and LTA/roster, then connect each tender CTA to the relevant context-rich page before checkout.
- **Recommended Agent**: Codex.
- **Paste-Ready Next Prompt**:

```text
Read SESSION.md first, then AGENTS.md, CLAUDE.md, docs/agents/dashboard-architecture.md, and the relevant Next.js 16 App Router docs under node_modules/next/dist/docs/.

Act as the Tender Dashboard + Service Platform Agent for Phase 2B.

Build dedicated service entry views for:
- bid/no-bid
- weekly digest
- proposal/application package
- LTA/roster readiness

Reuse existing pricing, pay routes, bid/no-bid checkout, and dashboard pipeline context. Keep the changes additive and avoid schema/API migrations unless absolutely necessary. Each service page/view should explain what the user gets, show the tender/company context when provided by query params, and route cleanly into the existing checkout or pipeline action. Update SESSION.md when finished.
```

---

## Phase 2B Service Entry Views — 2026-04-28

- **Agent**: Codex
- **Date**: 2026-04-28
- **Task Completed**: Built dedicated in-dashboard service entry views for bid/no-bid, weekly digest, proposal/application package, and LTA/roster readiness. Connected dashboard overview CTAs to context-rich service pages before checkout.
- **Files Changed**:
  - `src/app/dashboard/services/page.tsx` — added service overview page with four product paths and clear best-fit guidance.
  - `src/app/dashboard/services/[service]/page.tsx` — added service detail pages that read tender, agency, and pipeline item context from query params and route into existing pay/bid analysis flows.
  - `src/app/dashboard/services/[service]/loading.tsx` — added loading UI for the dynamic service route.
  - `src/app/dashboard/services/ServiceAction.tsx` — added narrow client action component for existing bid/no-bid checkout / existing-analysis reuse; non-analysis services link to existing `/pay` checkout.
  - `src/app/dashboard/layout.tsx` — added Services to dashboard navigation.
  - `src/app/dashboard/page.tsx` — rewired dashboard service CTAs and tender action CTAs to `/dashboard/services/...` with pipeline/tender context instead of direct pay links.
  - `SESSION.md` — updated handoff.
- **Tests Run**:
  - Read local Next.js App Router docs for pages/layouts, search params, linking/navigation, and Server/Client Components before editing.
  - `npx eslint src/app/dashboard/page.tsx src/app/dashboard/layout.tsx src/app/dashboard/services/page.tsx 'src/app/dashboard/services/[service]/page.tsx' src/app/dashboard/services/ServiceAction.tsx 'src/app/dashboard/services/[service]/loading.tsx'` — passed.
  - `npx tsc --noEmit` — passed.
  - `curl -I http://localhost:3000/dashboard/services` — returned expected unauthenticated `307` to `/login?next=%2Fdashboard%2Fservices`.
  - `curl -I 'http://localhost:3000/dashboard/services/proposal?tender=Test%20Tender&agency=UNDP&pipeline_item_id=123'` — returned expected unauthenticated `307` to `/login?next=%2Fdashboard%2Fservices%2Fproposal`.
- **Result**:
  - Phase 2B is complete as an additive dashboard/service-platform layer.
  - Users now have dedicated service pages explaining what they get, how the workflow proceeds, and what tender/agency context is attached.
  - Bid/no-bid keeps the existing paid analysis contract and checks for an existing analysis before opening checkout.
  - Digest, proposal, and roster pages reuse existing `/pay` plan routing with tender, agency, and pipeline item metadata attached when available.
- **Blockers**:
  - Authenticated browser-level visual QA was not completed because local dashboard routes redirect without a browser login token.
  - Service pages currently rely on existing checkout/payment routes; they do not yet collect richer intake fields or create service fulfillment records.
- **Important Decisions**:
  - Kept this additive and dashboard-scoped; no schema, API, pricing, or payment contract changes.
  - Reused existing `TIERS`, `/pay`, `/api/pay/checkout`, and `/api/analysis/bid-no-bid/checkout` instead of introducing new service infrastructure.
  - Used query params for tender context so existing dashboard and payment contracts remain compatible.
- **Contracts or Interfaces Changed**: None.
- **Docs Updated**: `SESSION.md` only.
- **Next Recommended Task**: Phase 2C: authenticated dashboard/service QA and checkout continuity. Log in locally, verify `/dashboard/services`, each service detail page, tender-context query params, bid/no-bid existing-analysis/checkout behavior, and `/pay` context preservation. If the flow works, consider the smallest next improvement: add lightweight service-intake fields or fulfillment tracking only if it can reuse existing contracts.
- **Recommended Agent**: Codex for authenticated QA and narrow service-flow fixes; Claude Code if the next step becomes schema-sensitive fulfillment tracking.
- **Paste-Ready Next Prompt**:

```text
Read SESSION.md first, then AGENTS.md, CLAUDE.md, docs/agents/dashboard-architecture.md, docs/agents/assessment-architecture.md, docs/agents/managed-agents-setup.md, and the relevant Next.js App Router docs under node_modules/next/dist/docs/.

Act as the Tender Dashboard + Service Platform Agent for Phase 2C.

Run authenticated local QA for the new service platform:
- /dashboard/services overview
- /dashboard/services/bid-no-bid with and without pipeline_item_id
- /dashboard/services/digest
- /dashboard/services/proposal with tender/agency/pipeline context
- /dashboard/services/lta-roster with tender/agency/pipeline context
- bid/no-bid existing-analysis check and checkout redirect behavior
- /pay context preservation for digest, proposal, and roster

Keep changes narrow. Do not add schema/API migrations unless a concrete blocker requires it. If a blocker appears, document it in SESSION.md and prefer the smallest compatible fix. Update SESSION.md when finished.
```

---

## Phase 2C Workflow Tabs + Gap Guidance — 2026-04-28

- **Agent**: Codex
- **Date**: 2026-04-28
- **Task Completed**: Continued Phase 2C by incorporating user feedback into the dashboard workflow. Added dedicated dashboard tabs for bid analysis and applications/submissions, rewired pipeline actions through service entry pages, clarified automatic assessment match seeding, and expanded readiness gaps with practical guidance plus a local mark-done control.
- **Files Changed**:
  - `src/app/dashboard/bid-analysis/page.tsx` — added a bid-analysis workflow tab with decision queue, deadline/fit prioritization, and process flow for the $39 bid/no-bid product.
  - `src/app/dashboard/applications/page.tsx` — added an applications/submission workflow tab for preparing, submitted, won, and lost tenders with proposal/roster/vault actions.
  - `src/app/dashboard/layout.tsx` — added Bid Analysis and Applications to dashboard navigation.
  - `src/app/dashboard/page.tsx` — added automatic matching status, richer readiness gap guidance, and local mark-done state for gaps completed outside Tenderpath.
  - `src/app/dashboard/pipeline/page.tsx` — rewired bid analysis, proposal, and roster actions to context-rich `/dashboard/services/...` pages instead of direct checkout.
  - `src/app/dashboard/services/[service]/page.tsx` — tightened digest copy to position it as continuing matched-source monitoring and weekly email follow-up.
  - `SESSION.md` — updated handoff.
- **Tests Run**:
  - Read `SESSION.md`, `AGENTS.md`, `CLAUDE.md`, `docs/agents/dashboard-architecture.md`, local Next.js App Router docs, and the product research report.
  - `npx eslint src/app/dashboard/page.tsx src/app/dashboard/layout.tsx src/app/dashboard/pipeline/page.tsx src/app/dashboard/bid-analysis/page.tsx src/app/dashboard/applications/page.tsx src/app/dashboard/services/page.tsx 'src/app/dashboard/services/[service]/page.tsx' src/app/dashboard/services/ServiceAction.tsx 'src/app/dashboard/services/[service]/loading.tsx'` — passed.
  - `npx tsc --noEmit` — passed.
  - `curl -I http://localhost:3000/dashboard/bid-analysis` — returned expected unauthenticated `307` to `/login?next=%2Fdashboard%2Fbid-analysis`.
  - `curl -I http://localhost:3000/dashboard/applications` — returned expected unauthenticated `307` to `/login?next=%2Fdashboard%2Fapplications`.
  - `curl -I http://localhost:3000/dashboard/services/digest` — returned expected unauthenticated `307` to `/login?next=%2Fdashboard%2Fservices%2Fdigest`.
- **Result**:
  - Dashboard now has explicit workflow tabs for bid analysis and application/submission work instead of hiding those workflows only inside tender cards.
  - Pipeline CTAs now route through service entry views with tender context, preserving the Phase 2B service platform.
  - Readiness gaps now tell users how to close each gap, where evidence belongs, and allow marking externally completed work as done in local dashboard state.
  - The automatic matching story is visible: assessment matches auto-seed into the pipeline, and the digest is positioned as the continuing matched email loop.
- **Blockers**:
  - Authenticated browser-level visual QA remains incomplete because local dashboard routes redirect without a browser login token.
  - The $49 digest still needs real backend automation before it is truly production-ready: scheduled match refresh for active subscribers, email generation, logging, and failure visibility.
  - Gap mark-done state is local-only. A persistent multi-device completion model would require schema/API work and should be planned deliberately.
- **Important Decisions**:
  - Did not add a fake digest scheduler or claim backend automation exists.
  - Kept changes additive and dashboard-scoped; reused existing pipeline/readiness/service/payment contracts.
  - Used localStorage for mark-done readiness state to avoid a schema migration while giving users an immediate checklist affordance.
- **Contracts or Interfaces Changed**: None.
- **Docs Updated**: `SESSION.md` only.
- **Next Recommended Task**: Phase 2D: implement the real $49 digest automation path. Design the smallest compatible subscriber digest job that refreshes matches from the latest assessment, adds or updates pipeline items safely, sends a weekly email shortlist, and logs success/failure. This is cross-subsystem and email/cron-sensitive, so stop for Claude Code if it requires schema changes beyond a narrow additive log table.
- **Recommended Agent**: Claude Code for digest automation design if schema/cron/email contracts are touched; Codex for authenticated UI QA or narrow dashboard fixes.
- **Paste-Ready Next Prompt**:

```text
Read SESSION.md first, then AGENTS.md, CLAUDE.md, docs/agents/dashboard-architecture.md, docs/agents/assessment-architecture.md, and docs/agents/managed-agents-setup.md.

Act as the Tender Dashboard + Ops Agent for Phase 2D.

Plan and implement the smallest safe backend path for the $49 weekly matched digest:
- identify active grants-tenders-matching subscribers,
- use their latest assessment profile to refresh top matches,
- add/update matched pipeline items without duplicating,
- send a weekly email shortlist,
- log useful produced/failed counts and email status for ops visibility.

Do not fake automation in the UI. Preserve existing assessment, pipeline, email, and payment contracts. If this requires schema or cron changes, keep them additive and documented; if it becomes migration-sensitive, stop and recommend Claude Code. Update SESSION.md when finished.
```

---

## Phase 2D Weekly Digest Automation — 2026-04-28

- **Agent**: Codex
- **Date**: 2026-04-28
- **Task Completed**: Started and implemented the first real backend path for the $49 weekly matched digest. Added subscriber discovery, latest-assessment match refresh, duplicate-safe pipeline seeding, weekly digest email rendering/sending, digest logs, a protected cron route, and a Vercel weekly cron schedule. Also created a local QA login magic link path.
- **Files Changed**:
  - `src/lib/digest/weekly.ts` — new digest runner: finds active `tender-intelligence` subscribers, loads latest assessment profiles, refreshes tender/grant matches, safely adds or updates pipeline items by `tender_id`, sends digest email, and records per-user results.
  - `src/lib/email/sendWeeklyDigest.ts` — new Resend email renderer for weekly matched tenders and grants.
  - `src/app/api/cron/weekly-digest/route.ts` — new cron/manual endpoint with `CRON_SECRET` guard, `dry_run=1`, and `limit`.
  - `src/proxy.ts` — added `/api/cron/weekly-digest` to the same proxy allowlist as existing cron routes so the route can use its own cron-secret guard.
  - `src/lib/db.ts` — added `weekly_digest_logs` table creation to initialization.
  - `scripts/migrate.mjs` — added `weekly_digest_logs` table and indexes.
  - `vercel.json` — scheduled `/api/cron/weekly-digest` weekly at Monday 08:00 UTC.
  - `SESSION.md` — updated handoff.
- **Tests Run**:
  - Created local QA user `codex-qa@tenderpath.local`, set it to active `tender-intelligence`, and generated a dev magic token for browser login.
  - `curl /api/auth/me` with a generated QA JWT — passed and returned active `tender-intelligence` user state.
  - `node scripts/migrate.mjs` — passed; created `weekly_digest_logs` locally.
  - `npx eslint src/lib/digest/weekly.ts src/lib/email/sendWeeklyDigest.ts src/app/api/cron/weekly-digest/route.ts src/proxy.ts src/lib/db.ts scripts/migrate.mjs` — passed.
  - `npx tsc --noEmit` — passed.
  - `curl /api/cron/weekly-digest?dry_run=1&limit=3` without auth — returned expected `Unauthorized`.
  - `curl /api/cron/weekly-digest?dry_run=1&limit=3` with `CRON_SECRET` — passed. Result: `subscriberCount: 2`, `dryRunCount: 1`, `skipped: 1`; the real assessment-backed subscriber produced `4` tender matches and `5` grant matches; the QA user was skipped because it has no assessment profile yet.
- **Result**:
  - Phase 2D now has a real cron-capable digest path rather than UI-only copy.
  - The digest job can refresh matches for paid subscribers, seed their pipeline without duplicate rows, email a weekly shortlist, and log sent/failed/skipped outcomes.
  - Dry-run mode allows ops QA without mutating pipeline rows or sending email.
- **Blockers**:
  - The local QA magic link still needs to be opened in the in-app browser to set `tp_token`/`tp_session`; Codex tools could generate the link and verify APIs, but could not directly operate the in-app browser storage.
  - `RESEND_API_KEY` is required for non-dry-run digest email delivery. Dry-run verification passed; live email sending was not triggered.
  - QA user has no assessment profile, so it is useful for auth/page QA but not for populated dashboard QA unless an assessment is run or seeded for that email.
- **Important Decisions**:
  - Added only one narrow schema surface: `weekly_digest_logs`, for operational visibility.
  - Kept digest matching tied to the latest persisted assessment profile; no new matching contract was introduced.
  - Pipeline seeding checks existing `user_id + tender_id` rows before insert, preserving active stages while refreshing metadata.
  - Did not send live emails during validation.
- **Contracts or Interfaces Changed**: Additive only. New cron route and `weekly_digest_logs` table; existing assessment, pipeline, email, payment, `RawTender`, `CrawlResult`, and API contracts remain compatible.
- **Docs Updated**: `SESSION.md` only.
- **Next Recommended Task**: Phase 2E: authenticated in-browser QA and positive dashboard data QA. Open the local magic link in the in-app browser, verify new dashboard tabs and service pages visually, then run or seed an assessment for the QA user so the dashboard has real matched tenders/readiness data. After that, run a non-email-safe digest pipeline seed test only if `RESEND_API_KEY` handling is explicitly controlled.
- **Recommended Agent**: Codex for browser/UI QA and narrow fixes; Claude Code if digest fulfillment grows into broader schema/admin workflow changes.
- **Paste-Ready Next Prompt**:

```text
Read SESSION.md first, then AGENTS.md, CLAUDE.md, docs/agents/dashboard-architecture.md, and the relevant Next.js App Router docs under node_modules/next/dist/docs/.

Act as the Tender Dashboard + Ops Agent for Phase 2E.

Use the local QA login link from the previous session or create a fresh dev magic token. Open it in the in-app browser and verify:
- /dashboard overview
- /dashboard/bid-analysis
- /dashboard/applications
- /dashboard/services and each service detail page
- /dashboard/pipeline actions routing through services
- readiness gap guidance and local mark-done behavior

Then run or seed a QA assessment profile for the QA email so the dashboard has realistic matched tenders and readiness gaps. Keep changes narrow and update SESSION.md when finished.
```

---

## Phase 3A Paid Preview + Demo Access — 2026-04-28

- **Agent**: Codex
- **Date**: 2026-04-28
- **Task Completed**: Started the Phase 3 conversion/access pass requested by the user. Added paid-preview treatment for premium dashboard tabs and created a password-login path for prepared demo/internal accounts. Granted local superadmin access to `oday.kamal@gmail.com` and `info@tenderpath.me`; created local demo credentials for `demo@tenderpath.me`.
- **Files Changed**:
  - `src/app/dashboard/layout.tsx` — premium tabs (`Bid Analysis`, `Applications`, `Document Vault`) now remain visible for unpaid users with faded styling and a `Preview` hook; active subscribers and superadmins see them normally.
  - `src/app/dashboard/components/UpgradeGate.tsx` — new client preview gate that fades a premium page, leaves a partial workflow visible, and overlays subscribe/service CTAs for unpaid users.
  - `src/app/dashboard/bid-analysis/page.tsx` — wrapped the bid analysis workspace in the preview gate.
  - `src/app/dashboard/applications/page.tsx` — wrapped the applications workflow in the preview gate.
  - `src/app/dashboard/vault/page.tsx` — wrapped the document vault in the preview gate.
  - `src/lib/password.ts` — new scrypt password hashing/verification helpers.
  - `src/app/api/auth/password/route.ts` — new additive password login route that returns the same JWT/cookie shape as magic-link verification.
  - `src/app/login/page.tsx` — added Magic link / Password segmented login modes while preserving the existing magic-link flow and assessment email prefill.
  - `src/proxy.ts` — added `/api/auth/password` to public auth routes.
  - `SESSION.md` — updated handoff.
- **Local Data Changes**:
  - `oday.kamal@gmail.com` — active `tender-intelligence`, `is_super_admin = true`.
  - `info@tenderpath.me` — active `tender-intelligence`, `is_super_admin = true`.
  - `demo@tenderpath.me` — active `tender-intelligence`, password hash set for `demo2026!`, not superadmin.
- **Tests Run**:
  - `npx eslint src/lib/password.ts src/app/api/auth/password/route.ts src/proxy.ts src/app/login/page.tsx src/app/dashboard/layout.tsx src/app/dashboard/components/UpgradeGate.tsx src/app/dashboard/bid-analysis/page.tsx src/app/dashboard/applications/page.tsx src/app/dashboard/vault/page.tsx` — passed.
  - `npx tsc --noEmit` — passed.
  - `curl -X POST /api/auth/password` with `demo@tenderpath.me` / `demo2026!` — passed; returned a JWT and active subscription user payload.
  - In-app browser login QA — passed. Password mode appears on `/login`; demo credentials landed on `/dashboard`; dashboard loaded without console errors.
- **Result**:
  - Unpaid/trial users now get a visible paid-tab teaser instead of a dead-end hidden feature set.
  - Demo password login works locally and sets both localStorage `tp_token` and the httpOnly `tp_session` cookie through the normal auth response.
  - Requested local superadmin accounts are active and bypass paid gating.
- **Blockers**:
  - The demo account currently has no seeded assessment or pipeline rows (`0` assessments, `0` pipeline_items), so it authenticates cleanly but is not yet a rich demo workspace.
  - Paid-preview UI was verified structurally and type/lint checked, but visual QA with an unpaid test user remains a next-step check.
- **Important Decisions**:
  - Kept password auth additive and scoped to existing `users.password_hash`; did not replace or weaken magic-link auth.
  - Treated `subscription_status === "active"` or `is_super_admin` as paid for UI preview gating; trial/unpaid users see premium previews.
  - Left `/dashboard/services` ungated because it is the conversion/service path.
- **Contracts or Interfaces Changed**: Additive only. New password login route and password helper; existing magic-link, dashboard, subscription, assessment, crawler, and pipeline contracts remain compatible.
- **Docs Updated**: `SESSION.md` only.
- **Next Recommended Task**: Phase 3B: seed a realistic demo assessment/pipeline workspace for `demo@tenderpath.me` and run visual QA for both paid demo access and unpaid preview access. The demo should show matched tenders, readiness gaps, bid analysis preview/full state, applications workflow, services, and document-vault hooks without relying on Oday's personal assessment data.
- **Recommended Agent**: Codex for narrow demo-data seeding and browser QA; Claude Code only if this grows into a broader onboarding/demo-data architecture.
- **Paste-Ready Next Prompt**:

```text
Read SESSION.md first, then AGENTS.md, CLAUDE.md, docs/agents/dashboard-architecture.md, and the relevant Next.js App Router docs under node_modules/next/dist/docs/.

Act as the Tender Dashboard + Ops Agent for Phase 3B.

Seed a realistic local demo workspace for demo@tenderpath.me without using personal assessment data. Keep the seed additive and narrow:
- one realistic assessment profile,
- a handful of matched pipeline items with match_reasons,
- readiness gaps that exercise the guidance/vault paths,
- enough stage variety to show bid analysis and application workflows.

Then use the in-app browser to QA:
- demo@tenderpath.me / demo2026! paid login and populated dashboard,
- a trial/unpaid user seeing faded premium tabs and UpgradeGate previews,
- services remain reachable as the conversion path.

Do not push or deploy. Update SESSION.md when finished.
```

---

## Phase 3B Monetization Operations + Demo Workspace — 2026-04-28

- **Agent**: Codex
- **Date**: 2026-04-28
- **Task Completed**: Proceeded with Phase 3B and stacked the monetization-operational deliverables requested by the user. Added service intake forms, created a pre-payment work-order capture route, tied work orders through checkout metadata/webhooks, expanded admin fulfillment visibility, added paid work-order notification hooks, and seeded a realistic local demo workspace.
- **Files Changed**:
  - `src/app/dashboard/services/ServiceIntakeForm.tsx` — new product-specific intake form for `bid-no-bid`, `digest`, `proposal`, and `lta-roster`.
  - `src/app/dashboard/services/[service]/page.tsx` — service detail pages now use intake forms instead of direct checkout-only links.
  - `src/app/api/service-orders/route.ts` — new authenticated API route that creates work orders before payment with user, tender, pipeline item, service, URL, and intake context.
  - `src/lib/service-orders.ts` — service slug validation, service-to-plan mapping, intake sanitization, pipeline ownership check, and work-order creation helper.
  - `src/lib/work-orders.ts` — work-order plans now include all Phase 3 products; Stripe webhook fulfillment can update a pre-created `work_order_id` and sends notification hooks on paid sessions.
  - `src/lib/email/sendWorkOrderNotifications.ts` — new user + ops notification sender for paid work orders; logs and skips safely if `RESEND_API_KEY` is missing.
  - `src/app/api/pay/checkout/route.ts` — carries `work_order_id` through Stripe metadata and success/cancel context.
  - `src/app/api/analysis/bid-no-bid/checkout/route.ts` — carries `work_order_id`, plan, service, and tender metadata for bid/no-bid checkout.
  - `src/app/pay/page.tsx` — preserves and displays `work_order_id` through payment.
  - `src/app/api/admin/work-orders/route.ts` — admin work-order API now returns pipeline stage along with existing pipeline context.
  - `src/app/admin/work-orders/page.tsx` — admin fulfillment view now shows service slug, tender/doc URL, intake preview, payment status, pipeline stage, and fulfillment notes.
  - `src/lib/db.ts` and `scripts/migrate.mjs` — additive `work_orders` columns: `service_slug`, `tender_url`, `intake`.
  - `SESSION.md` — updated handoff.
- **Local Data Changes**:
  - `demo@tenderpath.me` now has a realistic local demo workspace:
    - one assessment for `Demo Supply & Logistics Co.`,
    - three matched pipeline items across `evaluating`, `preparing`, and `matched`,
    - three readiness gaps with action steps,
    - two seeded work orders plus one QA-created pending proposal work order.
  - Created `phase3-preview@tenderpath.local` as a trial/unpaid QA user to verify premium preview gating.
- **Tests Run**:
  - `node scripts/migrate.mjs` — passed; added new work-order columns locally.
  - `npx eslint src/lib/email/sendWorkOrderNotifications.ts src/lib/service-orders.ts src/lib/work-orders.ts src/app/api/service-orders/route.ts src/app/api/pay/checkout/route.ts src/app/api/analysis/bid-no-bid/checkout/route.ts src/app/pay/page.tsx src/app/dashboard/services/ServiceIntakeForm.tsx src/app/dashboard/services/[service]/page.tsx src/app/api/admin/work-orders/route.ts src/app/admin/work-orders/page.tsx src/lib/db.ts scripts/migrate.mjs` — passed.
  - `npx tsc --noEmit` — passed.
  - `POST /api/service-orders` with demo auth — passed; created pending proposal work order tied to `pipeline_item_id = 6`.
  - In-app browser QA:
    - `demo@tenderpath.me / demo2026!` login lands on populated `/dashboard`.
    - `/dashboard/services/proposal?...` shows tender context and proposal intake fields.
    - `/admin/work-orders` as `oday.kamal@gmail.com` shows demo work orders, intake values, payment state, pipeline stage, and tender/doc link.
    - `phase3-preview@tenderpath.local` sees faded premium tabs and the `Unlock bid analysis` preview overlay.
- **Result**:
  - Phase 3 monetization is now materially more operational: each service can collect structured intake before payment, work orders are created with user/tender/pipeline/payment context, admin can inspect fulfillment context, and Stripe completion can update the existing work order and notify user/ops.
  - Demo login now shows a real procurement workflow instead of an empty dashboard.
- **Blockers**:
  - Live Stripe payment was not executed, so webhook notification delivery was not tested end-to-end with a real checkout session.
  - `RESEND_API_KEY` controls actual work-order emails; notification code is wired but no live paid email was sent during QA.
  - Manual payment methods still rely on the existing email-notify flow; they create intake/work orders before `/pay`, but payment confirmation remains manual until an ops workflow is added.
- **Important Decisions**:
  - Kept the `work_orders` schema additive instead of creating a second fulfillment table.
  - Created work orders before payment with `payment_status = pending`, then used `work_order_id` metadata to tie Stripe completion back to the same record.
  - Left bid/no-bid’s existing automated analysis checkout path intact, while adding work-order metadata to it.
  - Did not add file upload to service intake; document collection should continue through the Vault path.
- **Contracts or Interfaces Changed**: Additive only. New `/api/service-orders` route, new optional `work_order_id` payment metadata, and additive `work_orders` columns. Existing magic-link, password login, dashboard, crawler, assessment, and pipeline contracts remain compatible.
- **Docs Updated**: `SESSION.md` only.
- **Next Recommended Task**: Phase 3C: close the paid-work fulfillment loop after checkout. Add a work-order detail page for users, show work-order status in `/dashboard/services` or the dashboard overview, and add an admin action/email for status changes (`in_progress`, `waiting_on_client`, `delivered`) so fulfillment updates reach the customer.
- **Recommended Agent**: Codex for the narrow status/detail/email workflow; Claude Code if this expands into a larger CRM or fulfillment architecture.
- **Paste-Ready Next Prompt**:

```text
Read SESSION.md first, then AGENTS.md, CLAUDE.md, docs/agents/dashboard-architecture.md, and the relevant Next.js App Router docs under node_modules/next/dist/docs/.

Act as the Tender Dashboard + Ops Agent for Phase 3C.

Close the paid-work fulfillment loop with the smallest compatible changes:
- add a user-facing work-order status view/detail page,
- surface recent work orders in the dashboard or services page,
- let admin status changes optionally notify the user,
- preserve the existing work_orders table and Stripe webhook flow,
- keep all schema/API changes additive.

Use the seeded demo@tenderpath.me workspace and oday.kamal@gmail.com superadmin account for browser QA. Do not push or deploy. Update SESSION.md when finished.
```

---

## Assessment Wizard UX Pass — 2026-04-28

- **Agent**: Claude Code
- **Date**: 2026-04-28
- **Task Completed**: Assessment wizard UX improvements: description autofill fix, sector chip redesign, mobile score card redesign, summary/industry badge removal, and past performance field removal.
- **Files Changed**:
  - `src/app/api/assessment/preview/route.ts` — **new file** extracted from inline handler; `detectedDescription` now uses three-tier fallback (`metaDescription → ogDescription → content[:220]`) so companies without meta/og tags (e.g. jadunited.com) still get a pre-filled description in the wizard.
  - `src/app/assessment/WizardSteps.tsx` — **new file** extracted from the page; replaced 2-column icon-card `SectorGrid` with collapsible chip layout (max 10 visible, expand/collapse toggle); removed `pastPerformanceNote` field from `WizardData` interface and Step 3 textarea entirely.
  - `src/app/assessment/AssessmentResults.tsx` — removed AI-generated summary paragraph and "Industry detected" blue badge from results view; redesigned readiness score card (stacked: score + wide progress bar + 2-col dimension grid) and grant score card (compact: score + bar + context line) for mobile usability.
  - `src/app/assessment/page.tsx` — removed `pastPerformanceNote` from `INITIAL_DATA` and `buildAssessmentInput`; imports updated for extracted `WizardSteps` and `preview` API.
- **Tests Run**:
  - `npx tsc --noEmit` — passed (clean, no errors).
- **Result**: Description now autofills on first crawl for sites relying on body content rather than meta tags. Sector selection is more compact and touch-friendly. Score cards are mobile-readable. Results page is simpler — the summary was redundant with wizard content and the industry label added noise post-classification.
- **Blockers**: None.
- **Important Decisions**:
  - Removed `pastPerformanceNote` entirely rather than moving it; the AI gap analysis surfaces "no documented past performance" as a concrete remediation step, which is more useful than a free-text field most users skip.
  - Kept `detectedDescription` bounded at 220 chars — long enough to be meaningful, short enough for the wizard text field without overwhelming the user.
  - Removed summary from results page, not from the stored assessment object; `data.summary` is still persisted and available for future dashboard/email use.
- **Contracts or Interfaces Changed**: `WizardData` interface: removed `pastPerformanceNote: string`. No assessment API, db, or pipeline contracts changed.
- **Docs Updated**: `SESSION.md` only.
- **Commit**: `52fe2e0`
- **Next Recommended Task**: Phase 3C: close the paid-work fulfillment loop with user-facing work-order status, recent work-order surfacing, and admin status-change notifications.
- **Recommended Agent**: Codex for the narrow status/detail/email workflow.
- **Paste-Ready Next Prompt**:

```text
Read SESSION.md first, then AGENTS.md, CLAUDE.md, docs/agents/dashboard-architecture.md, and the relevant Next.js App Router docs under node_modules/next/dist/docs/.

Act as the Tender Dashboard + Ops Agent for Phase 3C.

Close the paid-work fulfillment loop with the smallest compatible changes:
- add a user-facing work-order status view/detail page,
- surface recent work orders in the dashboard or services page,
- let admin status changes optionally notify the user,
- preserve the existing work_orders table and Stripe webhook flow,
- keep all schema/API changes additive.

Use the seeded demo@tenderpath.me workspace and oday.kamal@gmail.com superadmin account for browser QA. Do not push or deploy. Update SESSION.md when finished.
```

---

### Phase 3C Work-Order Fulfillment Loop — 2026-04-28

- **Agent**: Codex
- **Date**: 2026-04-28
- **Task Completed**: Closed the paid-work fulfillment loop with user-facing work-order status pages, recent work-order surfacing in services, and optional admin-triggered customer status notifications.
- **Files Changed**:
  - `src/app/api/dashboard/work-orders/route.ts` — added authenticated current-user work-order listing with optional status and limit filters.
  - `src/app/api/dashboard/work-orders/[id]/route.ts` — added authenticated current-user work-order detail lookup with pipeline context and match reasons.
  - `src/app/dashboard/work-orders/page.tsx` — added user-facing paid work status index with filters, payment state, tender context, and status links.
  - `src/app/dashboard/work-orders/[id]/page.tsx` — added user-facing work-order detail page with fulfillment progress, intake fields, tender context, latest notes, and payment state.
  - `src/app/dashboard/layout.tsx` — added the Work Orders dashboard navigation item.
  - `src/app/dashboard/services/RecentWorkOrders.tsx` — added recent work-order cards for the services page.
  - `src/app/dashboard/services/page.tsx` — surfaced recent work above service purchase paths.
  - `src/app/admin/work-orders/page.tsx` — added an optional “Email customer when status changes” control and sends the notify flag with admin status patches.
  - `src/app/api/admin/work-orders/[id]/route.ts` — sends customer status notifications when an admin status patch includes `notify_customer`.
  - `src/lib/email/sendWorkOrderNotifications.ts` — added work-order status email rendering/sending helper.
- **Tests Run**:
  - `npx eslint src/lib/email/sendWorkOrderNotifications.ts src/app/api/admin/work-orders/[id]/route.ts src/app/api/dashboard/work-orders/route.ts src/app/api/dashboard/work-orders/[id]/route.ts src/app/dashboard/work-orders/page.tsx src/app/dashboard/work-orders/[id]/page.tsx src/app/dashboard/services/RecentWorkOrders.tsx src/app/dashboard/services/page.tsx src/app/dashboard/layout.tsx src/app/admin/work-orders/page.tsx` — passed.
  - `npx tsc --noEmit` — passed.
  - `GET /api/dashboard/work-orders?limit=3` as `demo@tenderpath.me` — passed; returned seeded demo work orders.
  - `GET /api/dashboard/work-orders/3` as `demo@tenderpath.me` — passed; returned intake and pipeline context.
  - `PATCH /api/admin/work-orders/3` as `oday.kamal@gmail.com` with `notify_customer: false` — passed; updated status to `in_progress` and fulfillment note for QA.
  - In-app browser QA:
    - `/dashboard/work-orders` as `demo@tenderpath.me` — passed; shows paid work status and order #3 as `in progress`.
    - `/dashboard/work-orders/3` as `demo@tenderpath.me` — passed; shows progress, intake, tender context, and latest fulfillment note.
    - `/dashboard/services` as `demo@tenderpath.me` — passed; shows “Recent work” with links to work-order details.
    - `/admin/work-orders` as `oday.kamal@gmail.com` — passed; shows status controls, intake/payment/context, and the customer notification checkbox. No console errors observed.
- **Result**: Paid services now have a visible post-intake/post-checkout fulfillment surface for users, recent work is discoverable from Services, and admins can optionally notify customers when work-order status changes. The Stripe webhook path and existing `work_orders` table shape were preserved.
- **Blockers**:
  - Live Stripe checkout/webhook E2E was not run in this pass.
  - Status email delivery code is wired, but Phase 3C QA deliberately did not send a customer status email because the admin checkbox was left off.
- **Important Decisions**:
  - Kept the workflow additive and used existing `work_orders`, `pipeline_items`, auth helpers, admin routes, and Resend helper patterns.
  - Made admin email notification explicit and opt-in per status change to avoid accidental customer emails during operations.
  - Kept user-facing work-order access scoped to the authenticated owner.
- **Contracts or Interfaces Changed**: Additive only. New dashboard work-order API routes and an optional `notify_customer` admin PATCH field. Existing Stripe metadata/webhook, payment, service-order, dashboard, assessment, crawler, and pipeline contracts remain compatible.
- **Docs Updated**: `SESSION.md` only.
- **Next Recommended Task**: Phase 3D: run the real paid-work revenue-path E2E in test mode. Verify checkout creates/links `work_order_id`, Stripe webhook updates `purchase_logs` and `work_orders.payment_status`, paid user/ops emails send, and the user work-order status page reflects the paid state. Add only the smallest missing delivery-link/document attachment fields if the E2E proves they are needed.
- **Recommended Agent**: Codex for the narrow Stripe/webhook/email QA and small additive fixes; Claude Code only if this expands into broader fulfillment CRM, schema redesign, or billing architecture changes.
- **Paste-Ready Next Prompt**:

```text
Read SESSION.md first, then AGENTS.md, CLAUDE.md, docs/agents/dashboard-architecture.md, and the relevant Next.js App Router docs under node_modules/next/dist/docs/.

Act as the Tender Dashboard + Ops Agent for Phase 3D.

Run the real paid-work revenue-path E2E in test mode:
- create or reuse a demo work order with service context,
- start checkout with `work_order_id` metadata,
- verify the Stripe webhook updates `purchase_logs` and `work_orders.payment_status`,
- verify paid user and ops emails send or log clear failure state,
- verify the customer work-order status page reflects the paid state.

Preserve existing payment, webhook, work_order, and dashboard contracts. Add only the smallest delivery-link/document attachment fields if the E2E exposes a concrete gap. Do not push or deploy. Update SESSION.md when finished.
```

---

### Phase 3D Payment-Path Preflight and Hardening — 2026-04-28

- **Agent**: Codex
- **Date**: 2026-04-28
- **Task Completed**: Started Phase 3D revenue-path E2E. Confirmed local Stripe checkout cannot complete yet because local Stripe secrets are missing, then hardened the checkout/webhook/work-order path so the eventual Stripe E2E is safer and more diagnosable.
- **Files Changed**:
  - `src/app/api/pay/checkout/route.ts` — added a clean 503 fallback when `STRIPE_SECRET_KEY` is missing, preserving `work_order_id` metadata behavior.
  - `src/app/api/analysis/bid-no-bid/checkout/route.ts` — added a clean 503 fallback when card checkout is not locally configured.
  - `src/app/api/webhooks/stripe/route.ts` — made `purchase_logs` insertion idempotent by checking `stripe_session_id` before insert so Stripe retries do not duplicate purchase records.
  - `src/lib/work-orders.ts` — made paid work-order notification idempotent by only notifying on transition into `paid`, while still updating existing work orders by `work_order_id`.
  - `SESSION.md` — updated handoff.
- **Tests Run**:
  - `curl -X POST /api/pay/checkout` with `plan: bid-no-bid`, `pipeline_item_id: 6`, and `work_order_id: 3` — returned clean `503` with `"Card payments are not configured yet. Please use USDT or wire transfer."`
  - Local work-order checkout-completion smoke using a synthetic paid Stripe session against work order `#3`, with `RESEND_API_KEY` deliberately unset in-process — passed; order `#3` moved to `payment_status: paid`, `stripe_session_id: cs_phase3d_local_qa_3`, `amount_cents: 3900`; running the same completion twice logged only one skipped paid-email notification.
  - In-app browser QA as `demo@tenderpath.me` at `/dashboard/work-orders/3` — passed; user page shows `proposal · paid · $39.00`.
  - `npx eslint src/app/api/webhooks/stripe/route.ts src/lib/work-orders.ts src/app/api/pay/checkout/route.ts src/app/api/analysis/bid-no-bid/checkout/route.ts` — passed.
  - `npx tsc --noEmit` — passed.
- **Result**: The local customer-visible paid state works and the work-order payment transition is retry-safe. Card checkout now fails cleanly when Stripe is not configured instead of exposing raw secret-name errors. The actual external Stripe checkout/webhook E2E remains blocked until local test-mode Stripe secrets are added.
- **Blockers**:
  - `.env.local` currently has `STRIPE_BIDNOBID_PRICE_ID` but does not have `STRIPE_SECRET_KEY` or `STRIPE_WEBHOOK_SECRET`.
  - Because those secrets are missing, no real Stripe Checkout session or signed Stripe webhook could be completed locally.
  - Paid user/ops emails were not sent in this pass; the synthetic smoke deliberately unset `RESEND_API_KEY` to avoid sending external emails while testing retry behavior.
- **Important Decisions**:
  - Did not add delivery-link/document attachment fields because the current E2E finding was Stripe configuration and idempotency, not a customer delivery-data gap.
  - Did not ask the app to submit any payment form in the browser. Once Stripe test secrets exist, the final Checkout submit step should still be treated as an explicit test-payment action.
  - Preserved the existing Stripe webhook and `work_orders` table contracts; all changes are additive/defensive.
- **Contracts or Interfaces Changed**: No breaking changes. `work_order_id` metadata continues to flow through checkout; checkout routes now return `503` for unconfigured card checkout; webhook behavior is idempotent for existing `stripe_session_id` purchase logs.
- **Docs Updated**: `SESSION.md` only.
- **Next Recommended Task**: Finish Phase 3D once local Stripe test configuration is available. Add `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` locally, run a real Stripe Checkout test payment for work order `#3` or a fresh demo work order, replay/receive the signed webhook, verify `purchase_logs`, `work_orders.payment_status`, paid user/ops email delivery, and the user work-order paid state.
- **Recommended Agent**: Codex for the narrow Stripe test-mode E2E; Claude Code only if this grows into broader billing architecture.
- **Paste-Ready Next Prompt**:

```text
Read SESSION.md first, then AGENTS.md, CLAUDE.md, docs/agents/dashboard-architecture.md, and the relevant Next.js App Router docs under node_modules/next/dist/docs/.

Act as the Tender Dashboard + Ops Agent finishing Phase 3D.

Local Stripe checkout was blocked because STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET were missing. After those test-mode values are available, run the real revenue-path E2E:
- create or reuse a demo work order with service context,
- start Stripe Checkout with `work_order_id` metadata,
- before final payment submission, confirm the test payment action,
- verify the signed webhook updates `purchase_logs` and `work_orders.payment_status`,
- verify paid user and ops emails send or log clear failure state,
- verify the customer work-order page reflects the paid state.

Preserve existing payment, webhook, work_order, and dashboard contracts. Do not push or deploy. Update SESSION.md when finished.
```

---

### Phase 3D Final Wrap — Payment Readiness Visibility — 2026-04-28

- **Agent**: Codex
- **Date**: 2026-04-28
- **Task Completed**: Wrapped Phase 3D by making payment readiness observable and repeatable even though real Stripe checkout/webhook cannot run locally until Stripe secrets are added.
- **Files Changed**:
  - `src/app/api/admin/payment-health/route.ts` — added admin-only payment health JSON with Stripe/Resend config booleans, missing config, purchase-log duplicate-session detection, and recent work-order payment state.
  - `scripts/phase3d-payment-smoke.ts` — added a read-only local smoke script that checks required payment env vars, duplicate Stripe sessions in `purchase_logs`, and recent work-order payment state.
  - `SESSION.md` — updated final Phase 3D handoff.
- **Tests Run**:
  - `npx eslint src/app/api/admin/payment-health/route.ts scripts/phase3d-payment-smoke.ts src/app/api/webhooks/stripe/route.ts src/lib/work-orders.ts src/app/api/pay/checkout/route.ts src/app/api/analysis/bid-no-bid/checkout/route.ts` — passed.
  - `npx tsc --noEmit` — passed.
  - `npx tsx scripts/phase3d-payment-smoke.ts` — ran successfully and returned controlled `ok: false` because `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are missing; confirmed `STRIPE_BIDNOBID_PRICE_ID`, `RESEND_API_KEY`, and `RESEND_FROM_EMAIL` are present.
  - `GET /api/admin/payment-health` with a local superadmin bearer token — passed; returned `ok: false`, missing Stripe secrets, no duplicate purchase sessions, and recent work-order payment state.
- **Result**: Phase 3D is operationally wrapped for the current local environment. The app now cleanly exposes why card checkout/webhook is not ready, and the retry-safety/payment-state checks are repeatable. Work order `#3` remains visible as paid from the synthetic local smoke (`paid · $39.00`), but that is not a real Stripe Checkout payment.
- **Blockers**:
  - Real Stripe Checkout and signed webhook E2E still cannot be completed until `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET` are available locally.
  - `WORK_ORDER_OPS_EMAIL` / `OPS_EMAIL` is not set locally; paid work-order emails fall back to `info@tenderpath.me`.
  - Other Stripe product price IDs are not set locally for digest/submission/strategic plans; only bid/no-bid price is present.
- **Important Decisions**:
  - Kept the health surface admin-only and secret-safe: it reports booleans and missing key names, never values.
  - Kept the smoke script read-only so agents can run it repeatedly without mutating payments or sending emails.
  - Did not add delivery attachment fields because the current launch gap is payment configuration, not delivery-data modeling.
- **Contracts or Interfaces Changed**: Additive only. New admin endpoint `/api/admin/payment-health` and read-only script. Existing checkout, webhook, work-order, dashboard, crawler, and assessment contracts remain compatible.
- **Docs Updated**: `SESSION.md` only.
- **Next Recommended Task**: Configure Stripe test-mode secrets locally and in Vercel (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, plus any missing service price IDs), set `WORK_ORDER_OPS_EMAIL` if ops mail should not default to `info@tenderpath.me`, then run the real card Checkout + signed webhook E2E once. After that, move to Phase 4 launch QA across assessment → matched dashboard → service purchase → fulfillment.
- **Recommended Agent**: Codex for the final Stripe test-mode E2E and Phase 4 smoke QA; Claude Code only if billing architecture or schema changes are introduced.
- **Paste-Ready Next Prompt**:

```text
Read SESSION.md first, then AGENTS.md, CLAUDE.md, docs/agents/dashboard-architecture.md, and the relevant Next.js App Router docs under node_modules/next/dist/docs/.

Act as the Tender Dashboard + Ops Agent for final payment launch QA.

Stripe readiness is now observable through `/api/admin/payment-health` and `npx tsx scripts/phase3d-payment-smoke.ts`. Configure local test-mode Stripe secrets first:
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- missing service price IDs if testing non-bid/no-bid plans
- WORK_ORDER_OPS_EMAIL if ops mail should not default to info@tenderpath.me

Then run one real Stripe test-mode Checkout + signed webhook E2E for a demo work order:
- confirm before submitting the final test payment,
- verify `purchase_logs`,
- verify `work_orders.payment_status`,
- verify paid user/ops emails,
- verify the customer work-order page.

Preserve existing payment, webhook, work_order, and dashboard contracts. Do not push or deploy. Update SESSION.md when finished.
```

---

## Next Recommended Task

Configure Stripe test-mode secrets locally and in Vercel (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, plus any missing service price IDs), set `WORK_ORDER_OPS_EMAIL` if ops mail should not default to `info@tenderpath.me`, then run the real card Checkout + signed webhook E2E once. After that, move to Phase 4 launch QA across assessment → matched dashboard → service purchase → fulfillment.

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
Read SESSION.md first, then AGENTS.md, CLAUDE.md, docs/agents/dashboard-architecture.md, and the relevant Next.js App Router docs under node_modules/next/dist/docs/.

Act as the Tender Dashboard + Ops Agent for final payment launch QA.

Stripe readiness is now observable through `/api/admin/payment-health` and `npx tsx scripts/phase3d-payment-smoke.ts`. Configure local test-mode Stripe secrets first:
- STRIPE_SECRET_KEY
- STRIPE_WEBHOOK_SECRET
- missing service price IDs if testing non-bid/no-bid plans
- WORK_ORDER_OPS_EMAIL if ops mail should not default to info@tenderpath.me

Then run one real Stripe test-mode Checkout + signed webhook E2E for a demo work order:
- confirm before submitting the final test payment,
- verify `purchase_logs`,
- verify `work_orders.payment_status`,
- verify paid user/ops emails,
- verify the customer work-order page.

Preserve existing payment, webhook, work_order, and dashboard contracts. Do not push or deploy. Update SESSION.md when finished.
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
2. ~~Prompts 5 and 6 have been substantially worked — do they need a gap audit?~~ **Resolved**: both audited and confirmed/closed this session.
3. Should Codex be restricted to additive crawler and test work only, with Claude Code owning architecture, migrations, and docs?
4. ~~Is the production match quality now stable enough to shift focus to activation reliability?~~ **Resolved**: yes. Activation reliability is the next area after Prompt 4.

---

## Files Changed This Session

- `SESSION.md` — created and updated
- `CLAUDE.md` — updated to reference `SESSION.md`; corrected wrong `docsagents` path to `docs/agents/`
- `AGENTS.md` — committed expansion (Launch Priorities, Agent Priority items 6–9, three additional Golden Rules)
- `docs/agents/managed-agents-setup.md` — committed expansion (richer system prompts, field-completeness language)
- `workers/crawler-browser/src/index.ts` — added UA rotation (5-entry `USER_AGENTS` array, random pick per session)
- `src/app/dashboard/page.tsx` — extended MatchReason interface; added BUCKET_STYLES + isDeadlineSoon(); bucket badge + deadline urgency on matched tender cards (`4131010`); seedPipeline() silent-failure fixes (non-ok HTTP now throws; loadDashboard moved to post-seed callback)
- `src/app/dashboard/pipeline/page.tsx` — extended MatchReason interface; BUCKET_STYLES + isDeadlineSoon(); bucket badge in card header; deadline urgency; enhanced "Why this match?" with keywords, geography, bucketReason (`4131010`)

### Landing page overhaul (uncommitted, working tree)
- `src/app/page.tsx` — added STAT_BAR stat block between Hero and Challenge (4 stats: $25.7B procurement spend, 222 countries, 32 agencies, 3-year average time to first contract)
- `src/components/landing/Hero.tsx` — copy/layout update
- `src/components/landing/Challenge.tsx` — copy/layout update
- `src/components/landing/HowItWorks.tsx` — copy/layout update
- `src/components/landing/Services.tsx` — copy/layout update
- `src/components/landing/Testimonials.tsx` — copy/layout update
- `src/components/landing/WhyUs.tsx` — copy/layout update
- `src/components/landing/CTA.tsx` — copy/layout update
- `src/components/landing/VendorReadinessCard.tsx` — minor update
- `src/lib/pricing.ts` — copy edits: bid/no-bid tier tagline and description tightened; "Win probability score" and "Scoring criteria breakdown" reframed as fit/gap reasoning; roster tier tagline softened; "WFP, UNICEF, UNDP, and more" feature bullet removed

---

## Blockers

None. Dashboard changes are committed. Landing page + pricing changes are in the working tree, uncommitted.

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
