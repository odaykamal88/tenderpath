# TenderPath: From Generic Assessment to Real Procurement Intelligence
### April 23–25, 2026 — Two Days, Four Commits, One Product Transformation

---

## What We Built

TenderPath is a procurement intelligence platform that crawls live tenders from UN agencies, development banks, and bilateral donors, assesses a company's fit, and guides them through relevant opportunities.

Before this sprint, the core flow was: crawl a company website → run an LLM assessment → return a list of tenders. Functional, but generic. The crawler grabbed whatever text landed first (usually hero copy). Matching was slug-based with no explanation. Results were a flat, undifferentiated list with no signal about *why* anything matched or what to do next.

After this sprint, TenderPath became something qualitatively different: a procurement workflow system that understands companies at the capability level, retrieves tenders with structured reasoning, and explains every match with confidence scoring, evidence, and caveats — in real time, on first assessment.

---

## The Problem

Procurement intelligence is a high-stakes domain. A company submitting a bid for the wrong tender wastes weeks of work and credibility. A company missing a tender they could win loses real revenue.

Existing tools either:
- Return raw tender lists with no company context (job boards for procurement)
- Offer expensive analyst-led services with multi-day turnaround
- Use keyword matching so naive that a logistics company sees software tenders and vice versa

The core unsolved problem: **relevance requires understanding what a company actually does, not what keywords appear on their homepage.**

---

## Sprint 1 — Crawl Fidelity (`35b2ebc`, Apr 23 18:18)

The first thing we fixed: garbage in, garbage out.

**Before:** `crawl.ts` fetched a URL, took whatever HTML came back, and fed it to the LLM. If the site was a React SPA, you got `<div id="root"></div>`. If it redirected to a login wall, you got a sign-in page. If the homepage was all hero copy ("We deliver excellence"), the 8,000-character context budget was spent on marketing fluff instead of what the company actually does.

**After:**

- **SPA detection**: text/HTML ratio < 4% or `<div id="root|app|__next">` triggers automatic fallback to the browser worker (Cloudflare Browser Rendering) in `navigate` mode — which waits for JS to execute before extracting content.
- **Redirect fidelity**: captures `finalUrl` after resolution; aborts if the domain drifted cross-origin (parked domain trap).
- **Login-wall detection**: `/login` path + password input = low-confidence signal; the LLM is explicitly told to rely on user-supplied description instead.
- **Content ordering**: probes 11 subpaths (was 4), assembles them *first* in the context budget, homepage body *last* — so the LLM sees what the company does, builds, supplies, and delivers rather than what they say about themselves.
- **Deduplication**: subpages that mirror the homepage are dropped before assembly.
- **Schema**: `renderMethod` (`"static" | "browser" | "failed"`) and `finalUrl` added to `CrawledData` — optional fields, no migration needed, old JSONB rows remain valid.

**Net effect:** Companies with modern JS sites, redirect chains, or content-heavy subpages now get assessed on real evidence instead of shell HTML.

---

## Sprint 2 — Matching v2: Adjacent Sectors, Regtech Signal, Tier Logic (`1f2d295`, Apr 23 19:57)

With better crawl input, we rebuilt the matching layer.

**Before:** Matching was slug-based. A company classified as `it` got IT tenders. A company classified as `logistics` got logistics tenders. No overlap, no adjacency, no nuance. Grants were scored with a flat floor of 8 — every company got the same grants regardless of fit. And the top tier recommendation (`Strategic Partnership`, $749) was the universal default.

**After:**

**A. Regtech signal detection**
`detectRegtechSignal()` scans capabilities for compliance, document management, ECM, and regtech language and promotes those companies into the `it` slug pool. This fixed Docstream's 0-tender problem — they do document management for regulated industries, which maps to IT procurement, not language services.

**B. Adjacent sector pass**
After main scoring, `sector-adjacency.ts` pulls tenders for neighbouring sectors (e.g. logistics → construction → engineering), scores them at a 0.6× discount, caps at 50, and marks them `is_adjacent: true`. The UI renders these in a separate "Adjacent Sector Opportunities" section with an explanatory note — so a logistics company doesn't miss a supply chain engineering tender, but the distinction is visible.

**C. Baseline pool tightening**
The 300-row deadline-sorted fallback pool now only fires when the per-slug candidate set has fewer than 10 rows. This eliminated off-sector noise for companies with a strong slug signal. Jad (jadunited.com), a general supplier, was getting irrelevant software tenders from the baseline pool bleeding through. Fixed.

**D. Grant scoring fix**
Removed the `score = 8` floor that made all grants identical across all companies. Replaced with token-overlap scoring on title and description, with a cap of 2 results per agency. Grants are now differentiated by actual fit.

**E. Tier logic**
Score ≥ 60 → Tender Intelligence ($49/mo). Score ≥ 40 → Submission Package ($299). Only score < 40 with ≥ 2 high gaps → Strategic Partnership ($749). Prevents the most expensive tier from being the universal default, which had been eroding trust in the recommendations.

---

## Sprint 3 — Matching Infrastructure: Preference Persistence + Source Control (`3ec1b90`, Apr 25 01:19)

**Preference persistence:** `includeConsultancies` is now saved as a boolean in the `assessments` table. Both assessment routes write it. Users who say "don't show me consultancy tenders" stay opted out across sessions.

**Configurable source blocklist:** Replaced hardcoded SAM.gov suppression with `shouldSuppressSource()` driven by a `SOURCE_RULES` config in `source-rules.ts`. Adding a new source gate now requires zero changes to `match.ts`. The suppression logic is explicit, auditable, and extensible.

**Remote bucket:** Tenders with `country = "remote"` now get `bucket: "remote"` instead of being folded into "global". The UI groups remote into the Regional & Global section. Backward-compatible — existing rows unaffected.

**Embedding scaffolding:** `embeddings.ts` defines `ProfileEmbedding`, `buildProfilePrompt()`, and `retrieveTendersByEmbedding()` stubs with inline comments marking the exact insertion point in `match.ts` for hybrid retrieval in Sprint 4. The interface is locked; Sprint 4 fills in the implementation.

---

## Sprint 4 — Explainability + Feedback Loop (`5117066`, Apr 25 19:30)

This was the step that changed what the product *is*.

**Before:** The assessment returned a list of tender titles and scores. Nothing explained *why* a tender matched. There was no way to say "not relevant." There was no confidence signal. The user had to take the system's word for it.

**After:**

**Structured match reasoning**
`MatchReason` type added to `MatchedTender`:
```typescript
{
  summary: string
  matchedSectors: string[]
  matchedCapabilities: string[]
  matchedKeywords: string[]
  geographyAlignment: string
  confidence: "high" | "medium" | "low"
  caveats: string[]
  scoreBreakdown: { sector, keyword, geography, recency }
}
```

`matchTenders()` now generates `structured_reasons` for every tender returned — scoring confidence as high/medium/low based on sector overlap, keyword density, and geography alignment. Sparse-profile companies get an explicit caveat noting the assessment is based on limited evidence.

**"Why this match?" panel**
`TenderCard` in `AssessmentResults.tsx` got a full rewrite: expandable panel showing sector/capability/keyword breakdown, confidence badge, geography alignment note, and any readiness blockers specific to that tender. Not a tooltip — a real evidence panel.

**Feedback loop**
Users can mark any tender as `saved` or `not_relevant`. Feedback is persisted to localStorage immediately and optionally POSTed to `/api/dashboard/tender-feedback` for authenticated users. `not_relevant` tenders are filtered out of the feed before `groupTenders()` runs — they disappear from view and don't come back.

**`user_tender_feedback` table**: `user_id`, `tender_id`, `feedback` (`saved | not_relevant`), `created_at`. Simple, additive, no migration risk to existing rows.

**Observability**: Panel opens, feedback changes, and confidence distribution are logged for ops visibility.

---

## Before / After

| Dimension | Before | After |
|-----------|--------|-------|
| Crawl input quality | Hero copy, SPA shells, login walls | Business-description text, subpath-first assembly, browser fallback |
| Matching basis | Slug classification only | Slug + adjacent sectors at 0.6× + regtech signal detection |
| Grant matching | Flat score=8 for all companies | Token-overlap scoring, 2/agency cap |
| Tier recommendation | Strategic Partnership as default | Score-tiered: $49 / $299 / $749 based on fit |
| Match explanation | None | Structured reasons: sectors, capabilities, keywords, geography, confidence, caveats |
| User feedback | None | Save / not_relevant with persistence and feed filtering |
| Source control | Hardcoded SAM.gov suppression | Configurable `SOURCE_RULES`, zero `match.ts` changes to add new gates |
| Preference persistence | Session-only | Written to `assessments` table, survives across sessions |

---

## Numbers

- **1,352 lines added** in the crawl fidelity commit alone (26 files)
- **768 lines added** in the explainability commit (12 files)
- **11 subpaths probed** per assessment (was 4)
- **0.6×** discount applied to adjacent-sector tenders, keeping them visible but clearly secondary
- **2 grants per agency** cap on scored results (was uncapped with flat score)
- **0 schema migrations** required for crawl changes — `finalUrl` and `renderMethod` are optional JSONB fields

---

## What This Unlocked

The product before this sprint could tell you *that* tenders exist. After this sprint, it tells you *why each one matters to your specific company*, with evidence, confidence, and a feedback loop to get smarter over time.

That's the difference between a procurement search engine and a procurement intelligence system.

The explainability layer also made the matching quality problems visible for the first time — which is what enabled the April 27 benchmarking sprint (2/10 → 6/10 on a real-company benchmark) to happen at all. You can't improve what you can't see.

---

## Commits

| Hash | Title | Date |
|------|-------|------|
| `35b2ebc` | feat(assessment): website crawl fidelity | Apr 23 18:18 |
| `1f2d295` | feat(matching): Matching & Personalization v2 | Apr 23 19:57 |
| `3ec1b90` | feat(sprint3): controls + matching infrastructure | Apr 25 01:19 |
| `5117066` | feat(sprint5): precision, explainability, and actionability | Apr 25 19:30 |
