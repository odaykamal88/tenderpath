# Tender + Grant Improvement Waves

## Wave 1 — Truthful Ops And Low-Risk Quality Guards

Goal: make health reports and grant matches stop lying by omission.

- Add source coverage matrix for direct, consolidated, disabled, blocked, and not-yet-implemented sources.
- Add `success_empty` crawl status for crawlers that run but produce no useful records.
- Store crawl metadata (`rawTenders`, `dedupedSurvivors`, `liveTenders`, `droppedBrokenLinks`) in `crawl_logs.metadata`.
- Normalize source aliases in admin health (`EU` → `TED EU`, `FCDO` → `UK Find a Tender`, `UNICEF/WFP/WHO` → `UNGM`).
- Add grant funding-scope guard so likely U.S.-domestic grants are not promoted as international development matches for non-U.S. users.

Status: started.

## Wave 2 — Tender Field Completeness

Goal: improve first-dashboard relevance without adding noisy source count.

- Enrich newest/highest-impact UNGM, TED EU, World Bank, and SAM.gov rows with descriptions/sectors where source detail pages or APIs expose them.
- Normalize numeric sector codes (NAICS/CPV/UNSPSC) into Tenderpath sector slugs before matching.
- Add per-source quality thresholds for description, deadline, sector, source URL, and broken-link rate.
- Treat high-volume null-sector sources as matching-quality incidents.

Status: started.

Implemented so far:

- Added NAICS and CPV prefix normalization in `src/lib/crawlers/sector-map.ts`, while preserving existing UNSPSC-style handling.
- Updated SAM.gov to store normalized Tenderpath sector slugs instead of raw NAICS codes where possible.
- Updated TED EU to request lot descriptions and CPV classifications, then derive `description` and normalized `sector`.
- Updated World Bank to handle live API sector arrays and normalize major-sector/sector descriptions into Tenderpath sector slugs.
- Updated UNGM detail enrichment to best-effort fill recent notice descriptions and sectors from the already-fetched detail pages.
- Added per-run output quality metadata to `crawl_logs.metadata` and surfaced it in recent admin crawl logs.
- Added source-specific quality thresholds so known listing-only sources do not drown out more actionable sector/deadline/source URL incidents.
- Added `scripts/backfill-tender-sectors.ts` as a dry-run-first operator script to convert existing open tender numeric/generic sector values into normalized slugs.

Validation:

- `npx tsc --noEmit`
- Targeted crawler/script ESLint
- `npx tsx scripts/backfill-tender-sectors.ts --limit=200` found 50 dry-run sector updates from 200 recent open rows.
- TED EU live smoke returned 300 tenders with description and sector enrichment.
- World Bank live smoke returned 600 tenders with normalized sector enrichment.
- UNGM live smoke returned 305 tenders in ~88s; best-effort detail enrichment added 6 descriptions and 7 sectors across 25 recent detail pages.
- SAM.gov live smoke was rate-limited by API 429 during repeated testing; code path is unchanged except sector normalization.

## Wave 3 — Blocked Source Recovery

Goal: recover high-value direct sources that are currently blocked.

- ADB: inspect worker-rendered challenge/HTML and find stable API/search endpoint or reduce worker timeout surface.
- AfDB: inspect protected documents listing and add alternate endpoint or batched browser navigation.
- EBRD: replace old public list with discoverable public ECEPP notice/detail endpoints, or mark source blocked in ops until public access returns.
- KfW: find alternate GTAI feed/search endpoint or browser-renderable listing path that avoids PerfDrive/hCaptcha.

Status: started.

Implemented so far:

- Confirmed direct ADB fetch returns Cloudflare challenge HTML.
- Confirmed direct AfDB fetch returns Cloudflare challenge HTML.
- Capped ADB and AfDB browser-worker fetches to 60 seconds and added clearer ADB challenge detection, so blocked runs fail within a bounded crawl budget instead of silently burning longer worker time.
- Updated source coverage notes to classify ADB/AfDB as blocked by anti-bot protection, not unimplemented.
- KfW live smoke is now successful against the GTAI/KfW listing, producing a low-volume but complete row; source coverage now marks it as direct-crawler rather than blocked.

Remaining:

- Find alternate public APIs/search endpoints for ADB and AfDB, or add a stronger worker navigation strategy if those portals must remain browser-rendered.
- EBRD still redirects public ECEPP listing access to CAS login and needs alternate endpoint/source recovery.

### Wave 3/4 crawler repair continuation — 2026-05-06

Implemented:

- Repaired EBRD by replacing the retired/login-gated ECEPP list URL with the current public `noticeSearchResults.html` table.
- Updated EBRD parsing for `displayNoticeId` links, visible notice columns, hidden metadata, non-closed status filtering, deadline normalization, descriptions, and sector normalization.
- Recovered ADB partially through the official ADB Consultant Management System CSRN page when the primary `www.adb.org/projects/tenders` page is Cloudflare-blocked.
- ADB CMS fallback returns current consulting opportunities with title, project URL, expertise, consultant type, engagement period, published date, deadline, country code where present, and normalized sector.
- Improved UNDP and GIZ source quality by adding lightweight descriptions and sector normalization from list-level fields.

Current source state:

- EBRD: repaired against current official public ECEPP search results.
- ADB: partially recovered. The primary ADB project-tenders page still returns Cloudflare block/challenge responses in this environment and should remain on the backlog for deeper browser/proxy work. The new fallback covers official ADB CMS consulting opportunities, not the full project procurement tender universe.
- UNDP: quality improved, though some generic/individual-consultant rows still naturally lack precise sectors from list text alone.
- GIZ: quality improved, though some German procurement titles still need richer detail-page text for precise sector assignment.

Validation:

- EBRD live smoke returned 2,291 non-closed ECEPP rows with descriptions, deadlines where present, source URLs, and normalized sectors.
- ADB live smoke returned 25 current CMS consulting opportunities with normalized deadlines and sectors.
- UNDP live smoke returned 577 rows with descriptions and some normalized sectors.
- GIZ live smoke returned 17 rows with descriptions and some normalized sectors.
- `npx eslint src/lib/crawlers/adb.ts src/lib/crawlers/ebrd.ts src/lib/crawlers/undp.ts src/lib/crawlers/giz.ts`
- `npx tsc --noEmit`

Remaining:

- ADB full project procurement: find a stable official data/API/search path or improve browser-worker handling for Cloudflare-protected `projects/tenders`.
- AfDB: still needs the same deeper current-source/browser investigation.
- ADB CMS pagination: current fallback captures the first 25 opportunities; extend only after confirming Oracle/OAF pagination can be automated without brittle session state.
- UNDP/GIZ: add detail-page enrichment if these become high-priority matching sources.

## UN Agency Coverage Backlog

Current UNGM data already contains useful coverage beyond the first tracked UNICEF/WFP/WHO set. Keep these as explicit monitored agencies rather than new standalone crawlers unless UNGM coverage drops:

- High-priority UNGM family: FAO, UNOPS, UNHCR, ILO, UNFPA, UNESCO, UN-Women, UNIDO, IAEA.
- Keep separate identities where they already exist or have different portals: UNDP / UNDP Atlas, IOM, UNRWA.
- Low-volume watchlist: UNCDF, ITC, WIPO, ICAO, IMO, ITU, IFAD, WMO, UNITAR, UNICC.

Smallest next improvement:

- Add agency-level UNGM coverage deltas to admin health so ops can see when a tracked UN agency drops from normal volume to zero.
- Avoid adding direct crawlers for agencies that are already reliably present in UNGM; that creates duplicates before it creates quality.

## Wave 4 — Grant Ingestion Enrichment

Goal: fix grant quality at the data layer, not only scorer weights.

- Backfill `themes`, `sector`, `eligible_org_types`, `country`, `region`, and `description` for existing grants.
- Add `funding_scope` concept in code first, then schema if it proves stable.
- Split domestic U.S. grants from international/global development grants.
- Prioritize EU/EuropeAid, UNDP/GEF, World Bank trust funds, AfDB/ADB windows, embassy calls, and international foundations.

Status: started.

Implemented so far:

- Added `scripts/audit-grant-quality.ts` to measure grant data completeness before and after enrichment.
- Added `src/lib/grants/enrichment.ts` and `scripts/backfill-grant-metadata.ts` as a dry-run-first enrichment pass for existing Grants.gov rows.
- Backfilled empty grant metadata from conservative title/agency evidence only:
  - `themes`: 0% -> 63% populated across all grant rows.
  - `eligible_org_types`: 0% -> 85%.
  - `country` / `region` / `countries`: 0% -> ~82-83%.
  - `sector`: 0% -> 42%.
  - `value_range`: 0% -> 19%, mainly embassy/public-diplomacy small-grant rows.
- Kept `description` untouched because the current Grants.gov rows do not contain reliable long descriptions in the local table; no synthetic descriptions were written.
- Improved `matchGrants()` org-type normalization so `company`, SME/private sector labels, NGOs, research institutions, education institutions, government entities, and cooperatives compare consistently.
- Fixed grant funding-scope inference so region labels are not misread as non-U.S. countries.
- Added region-aware grant filtering/scoring so regional rows like `Middle East & North Africa` can match an Egypt/Jordan profile without re-opening unrelated U.S.-domestic grants.
- Added a minimum fit-signal guard: geography and org eligibility alone are not enough to show a grant; there must be sector, theme, or keyword overlap.
- Added `scripts/grant-match-benchmark.ts` for four synthetic scenarios:
  - SME in MENA with agriculture/food themes.
  - NGO with WASH focus in Africa.
  - Research institution with digital/IT themes.
  - SME in climate/energy.
- Discovered the official Grants.gov detail endpoint used by the Nuxt app:
  - `POST https://apply07.grants.gov/grantsws/rest/opportunity/details`
  - Body: `oppId=<numeric search-results-detail id>`
- Added `src/lib/grants/grants-gov-detail.ts` and `scripts/enrich-grants-gov-details.ts` to enrich existing Grants.gov rows with real synopsis/forecast descriptions, precise applicant eligibility, funding activity categories, funding amounts, and response deadlines.
- Ran the detail enrichment across current Grants.gov rows, then repaired AEIF/alumni public-diplomacy rows so they classify as education/civil-society grants instead of generic IT/innovation grants.
- Tightened `matchGrants()` again so long grant descriptions contribute soft keyword signal but do not create hard sector matches by themselves.

Validation:

- `npx tsx scripts/audit-grant-quality.ts`
- `npx tsx scripts/backfill-grant-metadata.ts --write --limit=1000`
- `npx tsx scripts/enrich-grants-gov-details.ts --write --limit=700`
- `npx tsx scripts/grant-match-benchmark.ts`
- `npx eslint src/lib/assessment/match.ts src/lib/grants/enrichment.ts src/lib/grants/grants-gov-detail.ts scripts/audit-grant-quality.ts scripts/backfill-grant-metadata.ts scripts/enrich-grants-gov-details.ts scripts/grant-match-benchmark.ts`
- `npx tsc --noEmit`

Benchmark observations:

- After Grants.gov detail enrichment, rich descriptions increased to 572 / 652 rows (88%), themes to 593 / 652 (91%), eligible org types to 587 / 652 (90%), sectors to 563 / 652 (86%), and value ranges to 504 / 652 (77%).
- MENA agriculture/food still returns no weak matches when the current Grants.gov inventory has no credible regional agriculture/food grant. This is preferable to filler.
- Africa NGO WASH surfaces an international public-health grant; AEIF/public-diplomacy and U.S.-domestic clinic/program noise remain suppressed.
- U.S. research/digital surfaces NASA/DOE/NSF-style domestic research grants plus relevant international digital calls with clear sector/theme/eligibility reasons.
- MENA climate/energy surfaces a regional international energy/security grant and suppresses unrelated regional-only embassy rows.

Remaining:

- Add non-Grants.gov development grant sources: EU/EuropeAid, UNDP/GEF, World Bank trust funds, ADB/AfDB windows, embassy calls outside Grants.gov, and reputable international foundations.
- Add UI caveats for inferred grant metadata: title-inferred themes, country inferred from post code, country unknown, domestic-scope risk.
- Consider a future additive schema field for `funding_scope` only after the inferred code path stabilizes.

### EU Funding & Tenders continuation — 2026-05-04

Implemented:

- Added `src/lib/grants/eu-funding-tenders.ts` for the European Commission Funding & Tenders SEDIA search API.
- Added `scripts/import-eu-funding-grants.ts`, dry-run-first, to upsert open/forthcoming EU calls into the existing `grants` table without schema changes.
- Added `scripts/expire-grants.ts`, dry-run-first, to mark open grant rows expired when their deadline has passed.
- Imported the first 100 future EU Funding & Tenders calls.
- Expired 46 now-past Grants.gov rows that were still marked `open`.
- Tightened grant matching:
  - cap returned rows at two per grant agency so one global source does not dominate the dashboard;
  - sort final grant cards primarily by score before bucket priority;
  - apply a specificity caveat/score reduction when WASH-focused profiles match generic health grants with no explicit WASH, water, sanitation, or hygiene signal.
- Added assertions to `scripts/grant-match-benchmark.ts` so it fails on domestic grant noise, AEIF filler, missing sector rationale, or implausible top climate/energy matches.

Current data quality after EU import and expiry:

- Total grants: 752.
- Open grants: 647.
- Source split: Grants.gov 652 rows / 547 open; EU Funding & Tenders 100 rows / 100 open.
- Rich descriptions: 597 / 752 (79%).
- Themes: 685 / 752 (91%).
- Eligible org types: 687 / 752 (91%).
- Country/region/countries: ~85%.
- Sector: 612 / 752 (81%).
- Source URL: 752 / 752 (100%).

Validation:

- `npx tsx scripts/import-eu-funding-grants.ts --limit=40 --pages=2`
- `npx tsx scripts/import-eu-funding-grants.ts --write --limit=100 --pages=3`
- `npx tsx scripts/expire-grants.ts`
- `npx tsx scripts/expire-grants.ts --write`
- `npx tsx scripts/audit-grant-quality.ts`
- `npx tsx scripts/grant-match-benchmark.ts`
- `npx eslint src/lib/assessment/match.ts src/lib/grants/eu-funding-tenders.ts scripts/import-eu-funding-grants.ts scripts/expire-grants.ts scripts/audit-grant-quality.ts scripts/grant-match-benchmark.ts`
- `npx tsc --noEmit`

Remaining:

- EU SEDIA rows often need richer detail-page enrichment for exact eligibility, budgets, destinations, and better descriptions.
- Obvious public EU topic-detail JSON paths returned the Angular app shell or 404 during this session; avoid brittle HTML scraping until a stable endpoint is confirmed.
- WASH/Africa still lacks a true WASH-specific grant source in the current inventory; generic health grants are now demoted but should be supplemented with UNDP/GEF/SGP, EU INTPA, World Bank trust funds, or foundation calls.

### UNDP CFP continuation — 2026-05-05

Implemented:

- Added `src/lib/grants/undp-cfp.ts` to convert grant-like UNDP procurement-notice rows into grants.
- Added `scripts/import-undp-cfp-grants.ts`, dry-run-first, with a conservative filter:
  - includes CFP/call-for-proposals, legal-aid service calls, women-led/SME support, microfinance, civil-society, and community-based grant-like rows;
  - excludes service procurements that merely mention grants, such as grant-accounting automation, lead consultants, assessors, videos, rosters, and individual consultant calls.
- Imported 5 future UNDP CFP rows.
- Added an NGO civil-society Kenya benchmark scenario.
- Updated grant scoring to give country-specific grant rows a stronger geography priority and cap region-only matches, so directly relevant CFPs are not buried under broader regional/global rows.

Current data quality after UNDP CFP import:

- Total grants: 757.
- Open grants: 652.
- Source split: Grants.gov 652 rows / 547 open; EU Funding & Tenders 100 / 100 open; UNDP CFP 5 / 5 open.
- Themes and eligible org types remain at 91% populated.
- Source URL remains 100%.

Validation:

- `npx tsx scripts/import-undp-cfp-grants.ts --limit=30`
- `npx tsx scripts/import-undp-cfp-grants.ts --write --limit=30`
- `npx tsx scripts/audit-grant-quality.ts`
- `npx tsx scripts/grant-match-benchmark.ts`
- `npx eslint src/lib/assessment/match.ts src/lib/grants/undp-cfp.ts scripts/import-undp-cfp-grants.ts scripts/grant-match-benchmark.ts`
- `npx tsc --noEmit`

Remaining:

- UNDP CFP rows are list-derived and currently thin on descriptions; detail-page enrichment should be added if this source proves valuable.
- Still need a true WASH-specific primary grant source; this adds civil-society and local-implementer CFP coverage rather than WASH-specific funding.

## Wave 5 — Benchmark And Regression Tests

Goal: prevent quality drift.

- Add grant benchmark fixture with synthetic companies:
  - SME in MENA with agriculture/food themes.
  - NGO with WASH focus in Africa.
  - Research institution with digital/IT themes.
  - SME in climate/energy.
- Assert expected classes of grants and caveats rather than brittle exact IDs.
- Add crawler health smoke script that reports status, useful rows, metadata completeness, and likely root-cause class.

## Wave 6 — Dashboard Trust Polish

Goal: make weak versus strong matches obvious to users.

- Show grant caveats near grant cards: country unknown, eligibility unclear, domestic-scope risk, theme inferred from title only.
- Separate grant cards into strong/direct, strategic/global, and watchlist.
- Prefer “no strong grants yet” over filling the dashboard with weak rows.

## Admin Dashboard Backlog

- Add a separate admin tab for logged-in assessment sessions.
- Show the email address entered during assessment, assessment/session timestamp, completion state, and whether matched tenders/grants were generated.
- Make the view searchable/filterable by email so support can trace a user's assessment-to-dashboard path quickly.
