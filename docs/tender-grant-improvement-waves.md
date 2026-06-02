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
- Updated the full ADB project-tenders parser for the current card layout (`adb.org/node/<id>` links plus Status, Deadline, Country/Economy, Sector, Posting Date, and Notice Type labels). This is used when the browser worker successfully clears Cloudflare on `projects/tenders`.
- Updated AfDB to the current canonical official listing at `/project-related-procurement/procurement-notices` instead of the stale `/specific-procurement-notices` path.
- Broadened AfDB parsing for current notice prefixes (`SPN`, `EOI`, `GPN`, `AMI`, `AOI`, `PPM`, `Contract Awards`, and French variants) and date/title listing layouts.
- Improved UNDP and GIZ source quality by adding lightweight descriptions and sector normalization from list-level fields.

Current source state:

- EBRD: repaired against current official public ECEPP search results.
- ADB: partially recovered. The primary ADB project-tenders page still returns Cloudflare block/challenge responses in this environment, but the parser now matches the current full-page layout for production/browser-worker runs. The CMS fallback covers official ADB consulting opportunities if full project tenders remain blocked.
- AfDB: canonical URL and parser repaired, but local validation is limited because static HTTP receives Cloudflare challenge HTML and this shell does not have `CRAWLER_WORKER_URL` / `CRAWLER_WORKER_KEY`.
- UNDP: quality improved, though some generic/individual-consultant rows still naturally lack precise sectors from list text alone.
- GIZ: quality improved, though some German procurement titles still need richer detail-page text for precise sector assignment.

Validation:

- EBRD live smoke returned 2,291 non-closed ECEPP rows with descriptions, deadlines where present, source URLs, and normalized sectors.
- ADB live smoke returned 25 current CMS consulting opportunities with normalized deadlines and sectors.
- AfDB static probe confirmed the current official listing exists but is Cloudflare-challenged outside the browser worker.
- UNDP live smoke returned 577 rows with descriptions and some normalized sectors.
- GIZ live smoke returned 17 rows with descriptions and some normalized sectors.
- `npx eslint src/lib/crawlers/adb.ts src/lib/crawlers/ebrd.ts src/lib/crawlers/undp.ts src/lib/crawlers/giz.ts`
- `npx tsc --noEmit`

Remaining:

- ADB full project procurement: validate through the deployed browser worker and, if it still fails, find a stable official data/API/search path or improve worker handling for Cloudflare-protected `projects/tenders`.
- AfDB: validate through the deployed browser worker and capture `crawl_logs.metadata`/errors after the canonical URL repair.
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

### Grant freshness automation — 2026-05-07

Implemented:

- Added `src/lib/grants/sync.ts` as the shared grant refresh service.
- Added `/api/cron/grants` with `GET`/`POST`, `CRON_SECRET` auth, `dry_run=1`, and optional per-source limits.
- Scheduled the grant refresh daily at 07:15 UTC in `vercel.json`, after the tender crawl and before the weekly digest.
- The refresh now:
  - expires stale open grants whose deadlines have passed;
  - refreshes EU Funding & Tenders;
  - refreshes UNDP CFP;
  - refreshes UN Women CFP;
  - returns open/future/stale/rich-description/theme/eligibility/source-url quality counts.

Validation:

- `npx eslint src/lib/grants/sync.ts src/app/api/cron/grants/route.ts`
- `npx tsc --noEmit`
- Dry-run smoke with `euLimit=5`, `undpLimit=3`, `unWomenLimit=3` completed successfully in ~9.5s.

Dry-run observation:

- Found 72 stale-open grant rows ready to expire on the next write-mode cron run.
- EU Funding & Tenders, UNDP CFP, and UN Women CFP all returned mapped rows.

### Grant-source expansion — feasibility pass — 2026-06-02

Context: founder asked to engage new crawler tiers (UN procurement) and improve the grants
crawler. Mapping the request against current coverage:

- **UN procurement tiers are ~80% already covered.** Coupa/WFP, UNICEF Supply, UNOPS,
  Quantum/UNDP-family, and SAP-Ariba/UN-Secretariat all post to UNGM (consolidated via the
  residential-proxy crawler); World Bank STEP = `world-bank.ts` procnotices; EuropeAid
  procurement = TED EU. The only genuinely-new procurement source is IsDB (hard).
- **Grants pipeline** already runs EU Funding & Tenders + UNDP CFP + UN Women CFP in the
  daily cron. Grants.gov (652 rows) was a one-time script import never wired into the cron
  (it only expired).

Grants.gov outcome (built → reverted → re-added geo-gated): the first `search2` importer
imported broadly and relied on the *matcher* to demote U.S.-domestic rows, which still leaked
them onto the dashboard, so it was reverted. It was then reconsidered with the right fix — a
**hard geography gate at ingestion**: keep a row only if it targets a specific developing-world
country or a developing region; drop U.S.-domestic / donor-country / unknown-geography before it
reaches the `grants` table. The gate runs on the cheap title+agency signal *before* per-row
detail enrichment, so detail calls aren't spent on rows that will be dropped. Measured: of ~626
candidates from the targeted passes, the gate keeps ~119 internationally-targeted rows (≈14 MENA,
≈33 Africa) — U.S. embassy public-diplomacy, DRL democracy/human-rights, PRM refugee,
religious-freedom, and CDC global-health-security grants for in-country partners — and drops ~507
U.S.-domestic ones. `src/lib/grants/grants-gov.ts` (`fetchGrantsGovGrants`) is wired into the cron
with a `grants_gov_limit` param (default 100). Validated: `tsc`/`eslint` clean; a live smoke of
`fetchGrantsGovGrants(40)` kept 39 rows with **zero** U.S.-domestic/Global leaks, all developing
regions, 39/39 rich descriptions. Reference id (`GRANTS_GOV:<id>`) and source url match the legacy
rows, so the cron refreshes them via `ON CONFLICT`; the matcher's `deadline >= CURRENT_DATE` filter
drops anything past.

Source-feasibility note (for the differentiation backlog): live probes of the requested
Tier-2 funders show most are NOT low-hanging — GCF has ~1 open RFP at a time (awarded-project
API only); GEF/SGP is decentralized across 50–80 UNDP country pages with no API; OCHA CBPF is
HC-allocated to pre-vetted partners (not open calls); AFESD/AGFUND/OFID publish only awarded
projects or ad-hoc rolling requests; IsDB's call portal is geo-blocked/Arabic. **IFAD is the
strongest next pick** (7–10 live agriculture/rural/food-security calls, high MENA relevance —
fills the documented SME-MENA-agriculture gap) but is Cloudflare-gated and needs the browser
worker, so it is a medium build, not a quick one.

### IFAD calls-for-proposals source — built — 2026-06-02

Picked IFAD as the differentiation source to build (GCF turned out to be a single open RFP —
not worth a crawler; the rest stay backlog). The IFAD calls listing is richer than the probe
suggested: `Showing 1 to 12 of 47`, and page 1 is overwhelmingly TenderPath's ICP — digital
remittances in rural Morocco, FO4IMPACT Near East/North Africa, macadamia value chain Rwanda,
sesame value chain Bangladesh, Somalia women's market access, irrigation in East/Southern Africa.

Implemented:

- Added `src/lib/grants/ifad.ts` (`fetchIfadGrants`) and wired it into `refreshGrantInventory`'s
  `Promise.all` + an `ifad_limit` cron param (default 12, clamp 1–25).
- The listing page (`/en/call-for-proposals`) is server-rendered Liferay and fetches with a plain
  browser UA; each `general-feature-card` yields title, a real description, posted date, and the
  call URL. `parseIfadListing` extracts these (the card's bare "Call for proposals" *category*
  label is skipped so the real, longer title is used).
- Geography comes from the title/description with a `DONOR_EXCLUDE` set so diaspora/donor
  countries (e.g. Italy in a Senegal remittances call) don't mask the beneficiary country; region
  phrases ("Near East, North Africa", "Latin America and the Caribbean", "East and Southern
  Africa") map to the matcher's region groups.
- **Deadlines live only on Akamai-protected detail pages (403 to a plain fetch).** Enrichment
  routes through the shared browser worker (`fetchViaBrowser`, navigate mode) — the UNGM/IOM/ADB
  pattern. `extractIfadDeadline` is a resilient text parser (handles "25 May 2026", "16th August",
  "31/12/2026", ISO, "August 30, 2026"; future-only; cue-proximity primary, soonest-future
  fallback so a 2028 project date isn't mistaken for the closing date). Grounded on real IFAD
  phrasings ("the deadline for submission of proposals is …").
- Fail safe: the grant matcher requires `deadline >= CURRENT_DATE`, so a row whose deadline can't
  be resolved is dropped. With no worker configured (local dev) the source yields **0** rows; in
  production the worker resolves deadlines and rows flow.

Validation:

- `npx tsc --noEmit` — clean. `npx eslint src/lib/grants/ifad.ts src/lib/grants/sync.ts src/app/api/cron/grants/route.ts` — clean.
- `parseIfadListing` against the live listing HTML: 12 cards, real titles, geography resolved
  (Rwanda, Bangladesh, Near East/North Africa → MENA, FO4IMPACT LAC → Latin America & Caribbean,
  Morocco), agriculture/food/value-chain themes.
- `extractIfadDeadline` unit cases (incl. multi-date page with a 2028 project date present): the
  submission deadline is selected via cue-proximity; past dates rejected; no-cue fallback picks soonest.
- `fetchIfadGrants(5)` locally: scanned 12, 0 grants (expected — deadlines need the prod worker).
- **Prod validation (founder):** after deploy, run `/api/cron/grants?dry_run=1` (or with `ifad_limit=5`)
  and confirm the `IFAD` source reports `mapped > 0`. If `mapped = 0`, the worker either can't reach
  IFAD detail pages or the deadline phrasing differs — paste one rendered detail page and the
  `extractIfadDeadline` regex can be finalized. The listing parse and mapping are already verified.

## Sprint 3 — Prospect Outreach Readiness

Goal: make sure real vendors see credible first-dashboard value before outreach.

Implemented:

- Added `scripts/prospect-match-smoke.ts`, a non-mutating CSV smoke test for real prospect lists.
- The script builds conservative synthetic profiles from public CSV columns, then checks tender/grant match count, top-tender actionability, and outreach readiness.
- Tightened sector normalization so `water technology` maps to WASH/water instead of generic IT.
- Tightened grant matching for company WASH/water profiles so generic technology or innovation grants do not appear without explicit water signal.

Validation:

- `npx tsx scripts/prospect-match-smoke.ts /Users/odaykamal/Downloads/tenderpath_first50_prospects.csv --limit=5`
- `npx tsx scripts/prospect-match-smoke.ts /Users/odaykamal/Downloads/tenderpath_first50_prospects.csv --limit=50`
- `npx tsx scripts/grant-match-benchmark.ts`
- `npx eslint src/lib/assessment/match.ts src/lib/crawlers/sector-map.ts scripts/prospect-match-smoke.ts`
- `npx tsc --noEmit`

First-50 smoke result:

- 39 / 50 prospects cleared the outreach-ready bar.
- Median tender matches: 7.
- Median grant matches: 5.
- Hold/manual-enrichment list before outreach: ADDAX ENERGY SA, Advancedlab GmbH, Alfer Constructions SA, Geoscience Engineering & Laboratory Services, National Pharmaceutical Industries CO.SAOG, LABIB MEDICAL CENTER s.a.l, Environment Solutions ApS, Converged Network Solutions - CNS SAL, EMIRATES WATER TECHNOLOGY COMPANY L.L.C, Water Engineering Services FZE, Healthy Air Solutions Pty Ltd.

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

## Wave 5A — Grant Miss Retrospective And Self-Learning Loop

Goal: make obvious user-relevant grants surface without relying on manual dashboard entry as the normal path.

Trigger case:

- `https://aljumhuriya.net/ar/` should see the EU PROSPECT grant `185831PROSPECTSEN` / `EuropeAid/185831/DD/ACT/SY` as a strong grant match.
- The opportunity is visible in the EU Funding & Tenders portal and has application material, but it is currently missed because:
  - the EU importer excludes PROSPECT rows with SEDIA `type = 2`;
  - the importer over-filters mixed/older programme periods;
  - EU rows are stored as global by default, so Syria-specific evidence in the title/reference does not receive country priority;
  - the company assessment crawler drops Cloudflare/JS-blocked 403 responses before browser fallback can run.

Sprint 1 — Recover EU PROSPECT / EuropeAid grant coverage:

- Include SEDIA `type = 2` rows in EU grant refresh when they are open/forthcoming calls for proposals.
- Map `PROSPECTS` / `EuropeAid` references into first-class grant rows, preserving both `185831PROSPECTSEN` and `EuropeAid/185831/DD/ACT/SY`.
- Derive country and region from clear evidence in identifier, title, and detail metadata (`SY` / Syria in this case).
- Add themes for justice, freedom of expression, civil society, media, social cohesion, democracy, and human rights when present.
- Capture attachment/document links from the stable official source path or browser-rendered page where available; store enough source provenance for dashboard trust and operator debugging.
- Add a non-mutating smoke fixture asserting that `185831PROSPECTSEN` is imported with deadline, source URL, country/theme evidence, and non-empty application-document metadata when source access allows it.

Sprint 2 — Fix blocked-site assessment fidelity:

- Treat 403/503 anti-bot pages and "enable JavaScript/cookies" shells as browser-fallback candidates instead of failed static responses.
- Add crawl diagnostics for blocked/static/browser/failed render path so assessment misses can be explained from logs.
- Add an assessment regression fixture for Al Jumhuriya:
  - expected org type: nonprofit / NGO / civil-society media organization;
  - expected sectors/themes: media, journalism, freedom of expression, civil society, Syria;
  - expected caveat if browser fallback fails: ask for user description and mark website evidence low-confidence.

Sprint 3 — Match diagnosis for known-good pairs:

- Add an operator script or admin action that accepts a company URL/profile plus an opportunity URL/reference and reports:
  - whether the opportunity was ingested;
  - which importer filter accepted or rejected it;
  - stored grant fields and metadata quality;
  - assessment crawl render method and detected sectors/themes/org type/countries;
  - whether the grant entered `matchGrants()`;
  - score components, caveats, final bucket, and the exact gate that dropped it.
- Convert the Al Jumhuriya + `185831PROSPECTSEN` pair into a permanent regression case with an expected strong/direct grant outcome.

Sprint 4 — Dashboard feedback as crawler intelligence:

- Keep manual tender/grant entry as a recovery path, but treat every manually added source URL as a learning signal.
- Add a weekly feedback miner that groups:
  - manually entered pipeline items with source URLs;
  - saved / pursuing / applied grants;
  - not-relevant grants and tenders;
  - assessments that completed with no matches;
  - source URLs users paste into service intake forms.
- For each cluster, classify the root cause:
  - source not ingested;
  - source ingested but detail fields too thin;
  - company website crawl failed or under-classified;
  - geography/org eligibility was misread;
  - match gate too strict or too loose;
  - dashboard rank/bucket hid an otherwise good match.
- Produce weekly operator output with:
  - top missed source domains;
  - high-confidence missed opportunities to add to source backlog;
  - false positives to suppress;
  - regression fixture candidates;
  - recommended crawler/enrichment/matcher patch list.
- Promote repeated user-added official source URLs into crawler backlog before adding new aggregator sources.

Weekly operating rhythm:

- Run the learning loop every week before outreach/digest quality review.
- Only auto-file code tasks from high-confidence patterns; ambiguous cases stay in an operator review queue.
- After each implemented fix, add or update a regression fixture so the same miss cannot quietly recur.
- Track impact as: imported rows recovered, strong matches recovered, false positives reduced, manual-add rate by source, and no-match assessment rate.

Implemented so far:

- EU Funding & Tenders importer now includes SEDIA `type = 2` PROSPECT rows and no longer excludes mixed programme-period records when deadline/status are open.
- EU PROSPECT rows now preserve the public `PROSPECTS` reference as the grant key and source URL, derive explicit countries/regions from identifiers and title text, and enrich civil-society/media/governance themes from title evidence.
- EU refresh/import now sorts mapped rows by deadline before applying the configured limit, so urgent PROSPECT rows are not clipped by unstable raw API ordering.
- Company assessment crawl now treats anti-bot 403/429/503 JavaScript shells as browser-render candidates instead of dropping them before fallback.
- Manual dashboard pipeline entries now persist `source_url`, giving the weekly learning loop real official-source URLs to mine.
- Added `scripts/diagnose-grant-miss.ts` for known company/opportunity pair diagnosis.
- Added `scripts/weekly-learning-review.ts` for the non-mutating weekly feedback/manual-addition learning report.
- Updated the weekly Codex heartbeat automation to run the learning review.

Validation:

- `npx tsx -e "import { fetchEuFundingGrantByReference } from './src/lib/grants/eu-funding-tenders'; ..."` mapped `185831PROSPECTSEN` to Syria / MENA with civil-society, media, freedom-of-expression, social-cohesion, governance, and rule-of-law themes.
- `npx tsx scripts/import-eu-funding-grants.ts --limit=8 --pages=1` now includes `EU_FT:185831PROSPECTSEN` in the earliest mapped future rows.
- `npx tsx scripts/diagnose-grant-miss.ts` confirms SEDIA lookup succeeds and the local DB miss is currently ingestion/table state, not source absence.
- `npx tsx scripts/weekly-learning-review.ts --days=7` ran and surfaced repeated `ec.europa.eu` work-order source URLs.
- Targeted ESLint passed for the touched implementation and script files.

## Wave 6 — Dashboard Trust Polish

Goal: make weak versus strong matches obvious to users.

- Show grant caveats near grant cards: country unknown, eligibility unclear, domestic-scope risk, theme inferred from title only.
- Separate grant cards into strong/direct, strategic/global, and watchlist.
- Prefer “no strong grants yet” over filling the dashboard with weak rows.

## Admin Dashboard Backlog

- Add a separate admin tab for logged-in assessment sessions.
- Show the email address entered during assessment, assessment/session timestamp, completion state, and whether matched tenders/grants were generated.
- Make the view searchable/filterable by email so support can trace a user's assessment-to-dashboard path quickly.
