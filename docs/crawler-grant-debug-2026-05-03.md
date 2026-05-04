# Tender Source + Grant Matching Debug Report — 2026-05-03

## Crawl Health Triage

| Source | Implementation | Scheduling / logging | Current state | Likely cause | Change made / smallest next fix |
|---|---|---|---|---|---|
| UNGM | `src/lib/crawlers/ungm.ts` via Cloudflare browser worker | Vercel cron `/api/cron/crawl`; per-source row from `syncAllTenders()` into `crawl_logs.errors` | Healthy in live DB; last run succeeded 2026-05-02 | Health threshold can report stale if daily cron misses one run | No crawler change. Keep 26h threshold for UNGM but monitor cron misses. |
| UNICEF | Consolidated inside UNGM agency coverage | Same UNGM crawl; agency counts surfaced by admin health | Missing logs false positive when old rows use `source_name='UNICEF'` | Source-name/logging mismatch | Admin health now rolls UNICEF rows into UNGM open-tender counts. |
| WFP | `wfp.ts` exists but disabled; WFP procurement is expected through UNGM | Same UNGM crawl | Missing logs false positive for old WFP rows | Consolidated source plus old direct rows | Admin health now rolls WFP rows into UNGM. Keep direct `wfp.ts` disabled unless UNGM agency coverage drops. |
| WHO | Expected through UNGM | Same UNGM crawl | Missing logs false positive for old WHO rows | Consolidated source plus old direct rows | Added WHO to UNGM family health and source rollup. |
| IOM | `src/lib/crawlers/iom.ts` plus UNGM coverage | Cron / per-source `crawl_logs` | Broken: crawler never succeeded recently | Static fetch now gets Akamai 403 | Added browser-worker fallback on 403/429. Live smoke test: success, 21 tenders. |
| World Bank | `src/lib/crawlers/world-bank.ts` | Cron / per-source `crawl_logs` | Healthy; copied stale warning was from threshold timing | Daily cron can appear stale after missed run | No code change. Validate with `crawlWorldBank()` or cron summary. |
| TED EU / EU | `src/lib/crawlers/ted-eu.ts` | Cron / per-source `crawl_logs` | Healthy; `EU` rows were observed alias with no direct log | Source-name alias mismatch | Admin health now rolls `EU` rows into `TED EU`. |
| SAM.gov / USAID | `src/lib/crawlers/sam-gov.ts` | Cron / per-source `crawl_logs`; requires `SAM_GOV_API_KEY` | Healthy; `USAID/SAM.gov` row was observed alias | Source-name alias mismatch | Admin health now rolls `USAID/SAM.gov` into `SAM.gov`. |
| UK Find a Tender / FCDO | `src/lib/crawlers/uk-fts.ts` existed but was not wired | Was not scheduled | Missing logs | Job misconfiguration / disabled crawler | Re-enabled `crawlUKFTS()` in `syncAllTenders()` and source priority; admin health now expects it and rolls `FCDO` rows into it. Live smoke test: success, 36 tenders. |
| KfW | `src/lib/crawlers/kfw.ts` | Cron / per-source `crawl_logs` | Broken/stale | GTAI search returns no parser-visible tender links and may present PerfDrive/hCaptcha | Improved failure propagation so `crawl_logs.errors` preserves listing/captcha cause. Next fix is an alternate GTAI endpoint or browser-accessible feed. |
| ADB | `src/lib/crawlers/adb.ts` via browser worker | Cron / per-source `crawl_logs` | Broken: no successful crawl recorded recently | Cloudflare / worker target request timing out or returning 403 | No code change in this pass. Next fix: inspect worker-rendered HTML and reduce page count or use ADB API/search endpoint if available. |
| AfDB | `src/lib/crawlers/afdb.ts` via browser worker | Cron / per-source `crawl_logs` | Broken: no successful crawl recorded recently | Worker timeout against protected documents listing | No code change in this pass. Next fix: browser-worker batch/navigate tuning or alternate AfDB documents query. |
| EBRD | `src/lib/crawlers/ebrd.ts` via browser worker | Cron / per-source `crawl_logs` | Broken: crawler never succeeds | Public ECEPP list redirects to CAS login | Added explicit login-redirect failure message. Next fix: use ECEPP public notice detail/index endpoints if discoverable, or mark source unavailable until public listing returns. |
| UNDP Atlas | `src/lib/crawlers/undp-atlas.ts` | Cron / per-source `crawl_logs` | Healthy in live DB | Copied stale warning was threshold timing | No code change. |
| ADB / AfDB / EBRD not yet fixed | Existing crawlers are implemented | Cron / per-source `crawl_logs` | Broken | Anti-bot/login access changes | Kept contracts intact; prioritize next once IOM/UK/grants are stable. |

## Code Changes Made

- `src/lib/crawlers/iom.ts`: added browser-rendering fallback for Akamai 403/429.
- `src/lib/crawlers/sync.ts`: re-enabled UK Find a Tender and restored source priority.
- `src/app/api/admin/stats/route.ts`: normalized observed source aliases into canonical crawler platforms; added WHO to UNGM family health.
- `src/lib/crawlers/kfw.ts`: preserved the real listing failure in `crawl_logs.errors`.
- `src/lib/crawlers/ebrd.ts`: detects CAS login redirects and reports the access change explicitly.
- `src/lib/assessment/match.ts` / `src/lib/types.ts`: added grant scoring geography, theme expansion, eligibility handling, and `match_reason` / `match_reasons` / `geography_alignment`.

## Grant Matching Behavior

Current problem:
- Most `grants` rows are sparse Grants.gov-style rows with no country, sector, themes, description, or eligibility.
- Old scoring gave broad no-geography rows too much credit through sector/title tokens.
- Results lacked explanations, so users could not tell whether a grant was a real fit or just a weak watchlist item.

Smallest coherent fix:
- Expand user sectors into grant themes through `SECTOR_TO_GRANT_THEME`.
- Prefer explicit country/global eligibility; demote unknown geography and cap geography mismatches.
- Boost explicit org-type eligibility; demote likely NGO-only grants for company profiles.
- Add additive explanation fields without changing assessment table shape.

Synthetic expected behavior:
- SME in MENA with agriculture/food themes: local/global food-security grants rank first when present; sparse U.S. agriculture rows fall to Watchlist with “no country eligibility listed.”
- NGO with WASH focus in Africa: WASH/public-health grants surface, but no-country rows remain Watchlist until the grant feed has country eligibility.
- Research institution with digital/IT themes: digital/research/technology grants can appear with sector/theme reasons; country-unknown rows no longer look like strong fits.
- SME in climate/energy: energy/climate rows surface, with geography caveats close to the match.

## Validation

- `npx tsx` live IOM smoke: success, 21 tenders.
- `npx tsx` live UK FTS smoke: success, 36 tenders.
- `npx tsx` live KfW smoke: still failure, now explicit.
- `npx eslint src/lib/crawlers/iom.ts src/lib/crawlers/kfw.ts src/lib/crawlers/sync.ts src/app/api/admin/stats/route.ts src/lib/assessment/match.ts src/lib/types.ts`
- `npx tsc --noEmit`

Recommended next validation:
- Run `curl /api/cron/crawl` with `CRON_SECRET` in staging and confirm new `IOM`, `UK Find a Tender`, `EBRD`, and `KfW` rows in `crawl_logs`.
- Re-run `scripts/_coverage-audit.ts` after a real sync to confirm observed `EU`, `FCDO`, `USAID/SAM.gov`, `UNICEF`, `WFP`, and `WHO` aliases no longer appear as separate missing-log platforms in admin health.

## Wave 2/3 Addendum — 2026-05-04

Tender field completeness:
- `src/lib/crawlers/sector-map.ts` now maps common NAICS and CPV prefixes into Tenderpath sector slugs.
- SAM.gov now normalizes `naicsCode` / `classificationCode` into a sector slug before returning `RawTender`.
- TED EU now requests lot descriptions and CPV classifications, then derives `description` and `sector`.
- World Bank now accepts live API sector arrays and normalizes sector descriptions/codes.
- `scripts/backfill-tender-sectors.ts` provides a dry-run-first backfill for existing open tenders with numeric or generic sector values.
- UNGM detail enrichment now reuses the capped detail-page pass to best-effort populate recent notice descriptions and sectors.
- Per-run output quality is now stored in `crawl_logs.metadata.outputQuality` and shown in recent admin crawl logs.
- Admin source quality now uses source-specific thresholds so known listing-only sources are still monitored without drowning out actionable sector/deadline/URL incidents.

Blocked source recovery:
- Direct ADB and AfDB static fetches still return Cloudflare challenge pages.
- ADB and AfDB browser-worker calls are capped at 60 seconds so blocked sources fail within a bounded crawl budget.
- ADB now reports challenge HTML explicitly if the browser worker returns a challenge page.
- KfW live smoke is successful again through GTAI/KfW, currently low-volume but with deadline, description, sector, and source URL.
- EBRD still redirects the public ECEPP listing to CAS login.
- UNGM agency coverage now explicitly tracks FAO, UNOPS, UNHCR, ILO, UNFPA, UNESCO, UN-Women, UNIDO, and IAEA in addition to UNICEF/WFP/WHO/IOM/UNHCR/ILO/UNOPS.

Validation:
- `npx tsc --noEmit`
- Targeted ESLint for changed crawler and script files.
- `npx tsx scripts/backfill-tender-sectors.ts --limit=200` found 50 dry-run sector updates from 200 inspected open rows.
- TED EU live smoke: success, 300 tenders, with description and normalized sector on many rows.
- World Bank live smoke: success, 600 tenders, with normalized sector on many rows.
- UNGM live smoke: success, 305 tenders in ~88s; enriched 6 descriptions and 7 sectors across 25 recent detail pages.
- KfW live smoke: success, 1 tender with complete core fields.
- SAM.gov live smoke hit API 429 during repeated testing.
- ADB and AfDB live smokes failed after the bounded 60 second browser budget, confirming they remain blocked by anti-bot protection.
- EBRD live smoke failed with explicit CAS login redirect diagnosis.

UN agency backlog:
- Do not add direct crawlers yet for FAO, UNOPS, UNHCR, ILO, UNFPA, UNESCO, UN-Women, UNIDO, or IAEA; current DB evidence shows they are already present through UNGM.
- Add agency-level trend/zero-drop alerts next so a UNGM agency disappearing is visible even if the overall UNGM crawl remains healthy.
- Keep UNDP / UNDP Atlas, IOM, and UNRWA distinct because they already have source-specific crawler identities or source rows.

## Wave 4 Grant Addendum — 2026-05-04

Current grant data finding:
- The `grants` table contained 652 Grants.gov rows, 593 open.
- Before Wave 4, useful matching metadata was effectively empty: 0 rich descriptions, 0 themes, 0 eligible org types, 0 country/region/countries, 0 sector, and 0 value range.
- Source URLs were present on all rows, so the immediate issue was not link coverage; it was sparse metadata.

Changes made:
- Added `scripts/audit-grant-quality.ts` for repeatable grant completeness reporting.
- Added `src/lib/grants/enrichment.ts` and `scripts/backfill-grant-metadata.ts`.
- Backfilled only empty fields, using conservative title/agency evidence:
  - Department of State post-code geography and small-grant pattern.
  - U.S.-domestic agency prefixes.
  - Sector/theme/org eligibility keywords from titles and agencies.
  - No synthetic descriptions.
- Improved `matchGrants()`:
  - Normalizes org-type aliases before comparing eligibility.
  - Separates explicit countries from region labels when inferring domestic/international scope.
  - Lets regional grant rows match user countries through their region group.
  - Requires at least one sector/theme/keyword fit signal so org + geography alone does not create filler grant cards.

Result after backfill:
- Themes populated on 411 / 652 rows (63%).
- Eligible org types populated on 555 / 652 rows (85%).
- Country populated on 539 / 652 rows (83%).
- Region populated on 537 / 652 rows (82%).
- Countries populated on 539 / 652 rows (83%).
- Sector populated on 273 / 652 rows (42%).
- Value range populated on 124 / 652 rows (19%).

Validation:
- `npx tsx scripts/audit-grant-quality.ts`
- `npx tsx scripts/backfill-grant-metadata.ts --write --limit=1000`
- `npx tsx scripts/grant-match-benchmark.ts`
- `npx eslint src/lib/assessment/match.ts src/lib/grants/enrichment.ts scripts/audit-grant-quality.ts scripts/backfill-grant-metadata.ts scripts/grant-match-benchmark.ts`
- `npx tsc --noEmit`

Important caveat:
- Current grant source coverage is still Grants.gov-only. Wave 4 improves quality and avoids bad filler, but stronger international grant UX still needs additional non-U.S. development grant sources.

## Wave 4 Grants.gov Detail Addendum — 2026-05-04

Grants.gov detail endpoint:
- The current Grants.gov Nuxt route calls `POST https://apply07.grants.gov/grantsws/rest/opportunity/details`.
- Request body supports `oppId=<numeric id>` from URLs like `https://www.grants.gov/search-results-detail/361904`.
- The endpoint returns real `synopsisDesc` / `forecastDesc`, applicant types, eligibility text, funding activity categories, funding amounts, and response dates.

Changes made:
- Added `src/lib/grants/grants-gov-detail.ts`.
- Added `scripts/enrich-grants-gov-details.ts`.
- Ran `npx tsx scripts/enrich-grants-gov-details.ts --write --limit=700`, writing detail patches to 577 Grants.gov rows.
- Ran the same script again after public-diplomacy normalization, writing 59 classification repair patches for AEIF/alumni rows.
- Updated grant matching so long descriptions do not create hard sector matches by themselves; stored/enriched sector plus title are used for hard sector fit, while descriptions remain useful for softer keyword evidence.

Result after detail enrichment:
- Rich descriptions: 572 / 652 rows (88%).
- Themes: 593 / 652 rows (91%).
- Eligible org types: 587 / 652 rows (90%).
- Sector: 563 / 652 rows (86%).
- Value range: 504 / 652 rows (77%).

Benchmark result:
- SME MENA agriculture/food: no weak filler grants returned.
- NGO WASH Africa: one strong international public-health grant; AEIF and domestic clinic noise suppressed.
- Research institution digital/IT: NASA/DOE/NSF-style grants plus relevant international digital calls.
- SME climate/energy: regional international MENA energy fit remains top.

## Wave 4 EU Funding & Tenders Addendum — 2026-05-04

EU Funding & Tenders endpoint:
- The European Commission SEDIA search API accepts multipart JSON requests at `https://api.tech.ec.europa.eu/search-api/prod/rest/search?apiKey=SEDIA`.
- The import uses open/forthcoming call status filters, future deadline filtering, and SEDIA display fields for title, identifier, deadline, description, programme, action type, and URL.

Changes made:
- Added `src/lib/grants/eu-funding-tenders.ts`.
- Added `scripts/import-eu-funding-grants.ts`.
- Added `scripts/expire-grants.ts`.
- Imported 100 future EU Funding & Tenders rows into the existing `grants` table.
- Expired 46 now-past Grants.gov rows still marked open.
- Tightened `matchGrants()` to cap agencies at two returned grants, sort grant cards by score before bucket priority, and demote generic health grants for WASH-focused profiles when no explicit WASH signal exists.
- Added benchmark assertions so grant regression checks now fail on domestic grant noise, AEIF filler, missing sector rationale, or implausible top climate/energy matches.

Result:
- Grant source coverage is no longer Grants.gov-only: `Grants.gov` 652 rows / 547 open and `EU Funding & Tenders` 100 rows / 100 open.
- Total grant rows: 752.
- Open grant rows: 647.
- Source URLs are present on 100% of rows.

Validation:
- `npx tsx scripts/import-eu-funding-grants.ts --write --limit=100 --pages=3`
- `npx tsx scripts/expire-grants.ts --write`
- `npx tsx scripts/audit-grant-quality.ts`
- `npx tsx scripts/grant-match-benchmark.ts`
- `npx eslint src/lib/assessment/match.ts src/lib/grants/eu-funding-tenders.ts scripts/import-eu-funding-grants.ts scripts/expire-grants.ts scripts/audit-grant-quality.ts scripts/grant-match-benchmark.ts`
- `npx tsc --noEmit`
