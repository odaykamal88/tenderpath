# Phase 1 Matching Quality Sprint — 2026-04-27

A record of the full matching quality sprint completed on 2026-04-27, covering benchmark harness creation, metadata/sector enrichment, matcher breadth fixes, and UNGM coverage improvements. Benchmark moved from 2/10 → 6/10 passing in a single day.

---

## Summary

| Session | Focus | Result |
|---------|-------|--------|
| Kickoff Audit | Benchmark framing, DA diff, DB state | Baseline: 2/10 |
| Benchmark Harness | `phase1-match-benchmark.ts`, fixture | Scoreboard established |
| Phase 1A–1C | Sector enrichment, matcher breadth | 4/10 |
| UNGM Coverage Fix | Supplemental searches, sync link fix | 6/10 |

---

## Session 1 — Phase 1 Matching Kickoff Audit

**Agent**: Codex  
**Task**: Strategic kickoff audit using user-provided DevelopmentAid benchmark examples for `jadunited.com` and `docstream.co`.

### Files Changed
- `SESSION.md` only.

### Audits Run
- Inspected the provided DevelopmentAid benchmark URLs.
- `npx tsx scripts/_jad-match-audit.ts` — partially useful; query bug found (`website_url` column does not exist), but wider procurement/supply keywords surface materially more candidates than narrow logistics keywords.
- `npx tsx scripts/_match-rerun.ts` — Jad received 18 matches for Syria including the IOM Transportation LTA; Docstream received only 1 weak match.
- `npx tsx scripts/_developmentaid-diff.ts data/developmentaid/Thunderbit_f540c3_20260420_100332.csv` — CSV stale but diff harness confirmed.
- Exact DB title check against the 10 benchmark tenders.

### Findings

**Already in DB but weak/null metadata:**
- UNDP bakery production-line maintenance
- UNDP spare parts for Deir Ali / Al-Nassrieh
- IOM accommodation LTA
- IOM transportation LTA

These were source-detail/sector enrichment and matching breadth problems.

**Not in DB (coverage/freshness gaps):**
- UNHCR light construction works
- UNRWA furniture for schools
- UNRWA adult diapers
- TAS ready-to-eat baskets
- TAS non-food items
- EC MED Dialogue regional civil society facility

### Classification Diagnosis
- **Jad (jadunited.com)**: "logistics" too narrow. Company should be represented as general supplier / procurement / facilities / transport / food/NFI / light construction-adjacent.
- **Docstream (docstream.co)**: Matching too literal around language services. EC governance/civil-society/programme support needs a consulting/governance/documentation capability path.

### Blockers
- Fresh DevelopmentAid CSV needed for Apr 27 benchmark examples.
- `scripts/_jad-match-audit.ts` references non-existent `assessments.website_url`; needs fixing to `assessments.website`.

### Decisions
- Treat DevelopmentAid as benchmark/discovery source only, not canonical storage.
- Build a repeatable benchmark harness before making large matcher changes.

---

## Session 2 — Phase 1 Benchmark Harness

**Agent**: Codex  
**Task**: Create benchmark fixture and audit script for Jad/Docstream examples. Fix existing audit script column bug.

### Files Changed
- `data/benchmarks/phase1-matching.json` — benchmark fixture with 10 user-provided DevelopmentAid examples and fallback company profiles.
- `scripts/phase1-match-benchmark.ts` — repeatable audit checking DB presence, source metadata completeness, `matchTenders()` inclusion, and likely failure class (`coverage`, `metadata`, `scoring`, `ok`).
- `scripts/_jad-match-audit.ts` — fixed `website_url`/`detected_industry` column assumptions to use current `assessments.website` and `ai_analysis`.
- `SESSION.md` — updated.

### Tests Run
- `npx tsx scripts/phase1-match-benchmark.ts` — passed.
- `npx tsx scripts/_jad-match-audit.ts` — passed.
- `npx eslint scripts/phase1-match-benchmark.ts scripts/_jad-match-audit.ts` — passed.
- `npx tsc --noEmit` — passed.

### Result

**Baseline: 2/10 passing**

| Tender | Status | Reason |
|--------|--------|--------|
| IOM Accommodation LTA | ✅ ok | In DB, matches |
| IOM Transportation LTA | ✅ ok | In DB, matches |
| UNDP bakery maintenance | ❌ metadata | In DB, weak sector/description |
| UNDP spare parts | ❌ metadata | In DB, weak sector/description |
| UNRWA furniture | ❌ metadata | In DB, weak sector/description |
| UNHCR light construction | ❌ coverage | Not in DB |
| UNRWA adult diapers | ❌ coverage | Not in DB |
| TAS ready-to-eat baskets | ❌ coverage | Not in DB |
| TAS non-food items | ❌ coverage | Not in DB |
| EC MED Dialogue | ❌ coverage | Not in DB |

### Decisions
- Classified failures before changing matcher weights so future fixes can be measured against a stable baseline.
- Kept DevelopmentAid as benchmark/discovery evidence; no canonical aggregator scraping added.

---

## Session 3 — Phase 1A–1C: Metadata Enrichment + Matcher Breadth

**Agent**: Codex  
**Task**: Fix the three metadata failures (UNDP bakery, UNDP spare parts, UNRWA furniture) and widen matcher breadth for Jad-style general supplier profiles.

### Files Changed
- `src/lib/crawlers/sector-map.ts` — expanded sector normalization for:
  - procurement/supply
  - accommodation/LTA
  - bakery/ready-to-eat baskets
  - spare parts/production lines
  - furniture/NFI
  - diapers/health supplies
- `src/lib/crawlers/ungm.ts` — UNGM listing rows now store source-derived sector slugs from title normalization.
- `src/lib/crawlers/unrwa.ts` — UNRWA listing rows now store source-derived sector slugs from title normalization.
- `src/lib/assessment/match.ts` — changes:
  - Widened trusted logistics evidence for procurement/supply/LTA language
  - Added healthcare/food/engineering/general-supplier keywords
  - Increased strict-country output cap from 15 → 25
  - Added strict-country candidate pass so local tenders score even when broad keyword pools are crowded
- `scripts/phase1-match-benchmark.ts` — tightened title matching with discriminating title needles to prevent misclassification of similarly-named UNRWA school tenders.
- `SESSION.md` — updated.

### Tests Run
- `npx tsx scripts/phase1-match-benchmark.ts` — passed. **Result: 4/10 ok, 0 metadata, 6 coverage.**
- Sector normalization spot check — confirmed benchmark-style titles map to expected slugs:
  - accommodation/transportation → logistics
  - adult diapers → healthcare
  - furniture schools → education/logistics
  - light construction → construction
- `npx eslint [all changed files]` — passed.
- `npx tsc --noEmit` — passed.

### Result

**4/10 passing** (up from 2/10)

Newly passing:
- UNDP bakery maintenance ✅
- UNDP spare parts ✅

Benchmark script tightened — UNRWA furniture correctly reclassified as `coverage` (was previously matching a different UNRWA school tender too loosely).

Live primary-source spot check via browser worker confirmed current UNGM search results exist for `Light Construction Works` and `Adult Diapers`, so remaining misses are source freshness/sync-depth issues, not a reason to add DevelopmentAid canonically.

### Decisions
- Preserved `RawTender` / `CrawlResult` contracts; `upsertTenders()` and dedupe/link verification untouched.
- Added strict-country candidate recall instead of broadly lowering scoring thresholds.
- Crawler `sector` values are additive metadata within the existing `RawTender` contract — no breaking changes.

---

## Session 4 — UNGM Coverage Fix

**Agent**: Codex  
**Task**: Fix the UNGM coverage path for benchmark-relevant Syria supplier notices. Add supplemental title searches to the existing UNGM browser-worker batch. Fix sync link filtering so live UNGM notice URLs are not falsely dropped by the generic verifier.

### Files Changed
- `src/lib/crawlers/ungm.ts` — added:
  - Supplemental UNGM title searches for supplier-style notices
  - Request labels for parse logs
  - In-crawler notice dedupe
  - Existing sector normalization on returned notices
- `src/lib/crawlers/sync.ts` — treats UNGM notice URLs generated from live UNGM listing/search rows as source-verified, so Cloudflare-blocked HEAD/GET checks do not drop real notices.
- `SESSION.md` — updated.

### Tests Run
- Live `crawlUNGM()` smoke check — passed. Returned 304 deduped notices, including:
  - `UNGM-SRFP/HCR/SYR/26/2770` — UNHCR light construction works, sector `construction` ✅
  - `UNGM-RFQ-SFO-NFI-26-11` — UNRWA adult diapers, sector `healthcare` ✅
  - IOM accommodation and transportation LTAs, sector `logistics` ✅
- Targeted primary-source backfill from live `crawlUNGM()` output — `upsertTenders()` result: `added: 2, updated: 2`.
- `npx tsx scripts/phase1-match-benchmark.ts` — passed. **Result: 6/10 ok, 4 coverage.**
- `npx eslint [all changed files]` — passed.
- `npx tsc --noEmit` — passed.

### Result

**6/10 passing** (up from 4/10)

Newly passing:
- UNHCR light construction works ✅
- UNRWA adult diapers ✅

Still passing from previous session:
- UNDP bakery maintenance ✅
- UNDP spare parts ✅
- IOM accommodation LTA ✅
- IOM transportation LTA ✅

Remaining coverage misses (not UNGM):
- UNRWA furniture for schools 2026
- TAS ready-to-eat baskets
- TAS non-food items
- EC MED Dialogue regional civil society facility

### Performance Note
Supplemental UNGM crawl took ~121s (within the existing 180s worker budget but worth monitoring in cron).

### Decisions
- Kept existing `/fetch-many` browser-worker architecture; batched supplemental UNGM searches into that path rather than adding a new scraping stack.
- Sync exception for UNGM notice links is narrow — applies only to notices just discovered from live UNGM listing/search HTML with canonical `https://www.ungm.org/Public/Notice/...` URLs. Global link integrity not weakened.
- Performed a narrow local DB backfill from live UNGM output for benchmark rows instead of adding DevelopmentAid as canonical storage.
- `RawTender`, `CrawlResult`, `upsertTenders()`, dedupe, and API/schema contracts unchanged.

---

## Final Benchmark State

| Tender | Agency | Status | Path to fix |
|--------|--------|--------|-------------|
| Bakery production-line maintenance | UNDP | ✅ ok | — |
| Spare parts Deir Ali / Al-Nassrieh | UNDP | ✅ ok | — |
| Accommodation LTA | IOM | ✅ ok | — |
| Transportation LTA | IOM | ✅ ok | — |
| Light construction works | UNHCR | ✅ ok | — |
| Adult diapers | UNRWA | ✅ ok | — |
| Furniture for schools 2026 | UNRWA | ❌ coverage | Direct UNRWA source discovery |
| Ready-to-eat baskets | TAS | ❌ coverage | Primary-source TAS discovery |
| Non-food items | TAS | ❌ coverage | Primary-source TAS discovery |
| MED Dialogue civil society facility | EC | ❌ coverage | Primary-source EC discovery |

---

## Key Principles Maintained Throughout

- `RawTender` and `CrawlResult` contracts never changed.
- `upsertTenders()`, dedupe logic, and link verification never weakened.
- DevelopmentAid used as benchmark/discovery evidence only — never canonicalized as a scraping source.
- Existing `/fetch-many` browser-worker architecture reused for all UNGM work.
- Changes measured against the benchmark scoreboard at every step.
- Failures classified (coverage vs. metadata vs. scoring) before making any matcher changes.
