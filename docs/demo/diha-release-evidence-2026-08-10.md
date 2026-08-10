# DIHA production-readiness evidence

**Prepared:** 10 August 2026  
**Production:** `https://www.tenderpath.me`  
**Release-candidate tag:** `diha-demo-rc-2026-08-10`  
**Private fixture:** `tenderpath-diha-walkthrough-v1`  
**Decision:** conditional GO for the rehearsed path; the time-based and physical event gates below must close before the DIHA presentation

The tag is an RC, not evidence that a 48-hour window elapsed on the day it was created. Create the tag only after the strict release check, the tagged first-client rehearsal, and two clean browser walkthroughs pass on the frozen runtime commit.

## Release train

| Sprint | Shipped outcome | Evidence |
|---|---|---|
| DR0 · production truth | Neon connectivity restored, canonical crawler executed, worker endpoint/health fixed, partial-source failure remains explicit | Deep health `200`; DB connected; worker healthy; 7,521 open tenders; manual crawl summary at `2026-08-10T17:01:03Z` |
| DR1 · private walkthrough | Isolated, idempotent Asteria tenant with 10 current matches, 3 evidence gaps, one amendment-aware RFP, calibration and two revisions | `demo:diha:reset` dry-run/apply convergence; production release check |
| DR2 · truthful states | Unassessed, failed, empty and unscored states no longer fabricate zero-fit conclusions | TypeScript/build, browser/API checks, focused React review |
| DR3 · source integrity | Cross-source canonical dedup with lot/amendment/non-Latin safeguards | 257 duplicate copies superseded; inventory moved 7,778 → 7,521 (3.3%); dry rerun returned zero groups |
| DR4 · narrative | Augmentation, evidence, monitored freshness, expert approval and official submission boundary are consistent across the stage path | Copy review and the seven-minute runbook |
| DR5 · release gates | CI/security/trust suite, preview + production rehearsal, failure seams, source/deadline and tenant checks | Commands and deployment ledger below |
| DR6 · freeze/operate | Read-only release check, freeze rules, fallback media, RC tag policy and daily monitor | Runbook, local evidence bundle, automation `diha-production-readiness-monitor` |

## Deployment ledger

| Batch | Commit | Vercel evidence |
|---|---|---|
| DR0–DR1 | `6a268f0` | Production baseline and canonical crawl recovery |
| DR2–DR3 | `f4bddb4` | Production deployment `dpl_6jJkBweCSDZMdbY9ujpjy9CQ7rzg` |
| Date regression hotfix | `0fc23d5` | Production deployment `dpl_92GQLQSSG3eCTE9FF4T6nmPYUGDz` |
| DR4–DR5 preview | `e372ff4` | Preview `dpl_AkawYQJTt4U86VchsS4bv1BJh8dD` |
| DR4–DR5 production | `e372ff4` | Production `dpl_6GjP7w2WZV5SrBAwqPoNVT8thT6r` |
| DR6 freeze | tag target | Resolve with `git rev-list -n 1 diha-demo-rc-2026-08-10`; inspect the custom domain before presenting |

## Automated gates passed

- `npm run lint` — zero errors; nine documented pre-existing unused-variable warnings.
- `npx tsc --noEmit`.
- `npm run build` — Next.js 16.2.6, 117 routes.
- `npm run security:sprint0` and `npm run security:sprint0-db` — private storage/schema contracts green; zero legacy public vault, artifact or payment-proof objects.
- `npm run smoke:sprint1`, `smoke:sprint2`, `smoke:sprint3`, `smoke:sprint4`.
- `npm run smoke:diha-ops`, `smoke:diha-dedup`, `smoke:diha-submission-date`, `smoke:diha-failure-seams`.
- `npm run release:diha:check -- --base-url=https://www.tenderpath.me --credentials=.env.diha.local`.
- `npm run rehearsal:first-client -- --base-url=https://www.tenderpath.me` — tagged users/objects cleaned after the run; competing-tenant reads/exports/receipts/grants returned `404`; admin content stayed locked without a time-boxed customer grant; both immutable versions exported; accepted email events were observable.

The release check validates a warm homepage response under 1.5 seconds, shallow/deep health, the exact private non-admin owner, score/dimensions, ten reasons-and-caveats matches, three gaps, a first deadline at least 21 days away, a resolving primary link, merit and contestability separation, amendment, answered Q&A, two versions, calibration, visible deduplication and truthful unscored rows. Passwords and bearer tokens are never printed.

## Browser and fallback evidence

The evidence bundle is local and deliberately not committed because it contains a private logged-in walkthrough:

`/Users/odaykamal/.codex/visualizations/2026/08/10/019fec61-f4e0-74b1-aff0-e77c39ecfc5e/diha/`

It contains homepage, overview, expanded match, gaps, submission drawer and Revision 2 reader captures for the 1,440 × 900 event viewport. The silent WebM is a local fallback, not a narrated marketing asset. Never share private screenshots or the video without checking the visible tenant email and tender details.

## Known operational defects

- `SAM.gov` returns `401` without its production API credential.
- `KfW` currently returns no usable opportunity links.
- `ADA` currently returns `404`.

These are explicit crawl failures, not silent successes. They are outside the chosen DIHA stage opportunities and below the crawler safe-stop threshold. Do not describe every source as green; say the live source set is monitored and show the fresh load-bearing sources.

## Pending gates that cannot close on 10 August

- One scheduled Vercel crawler invocation after the Neon restoration. The configured schedule is 06:00 UTC daily; the 10 August recovery run was manual.
- 48 continuous hours of green shallow/deep health and fresh load-bearing sources.
- Founder verbal rehearsal/signoff on the final seven-minute wording.
- Presenter-laptop check: venue display adapter, hotspot, power, disabled notifications/updates and the fallback bundle opened locally.
- A narrated offline seven-minute recording, if the presenter wants a self-contained fallback rather than speaking over the silent capture.

The daily, read-only `diha-production-readiness-monitor` closes the first two when evidence exists and reports only failure, meaningful drift or completion. Keep the desktop app running for local scheduled checks.

## Freeze, rollback and event-day safe stop

- From the RC tag until the event, permit only BLOCK-level security, authentication, data-loss or rehearsed-path fixes.
- Re-run the full strict check and browser route after any exception.
- Never reset `demo@tenderpath.me` or any customer tenant. The private restore requires the exact confirmed DIHA email and defaults to dry-run.
- If auth, Neon, the selected World Bank source or a core route fails on stage, try the hotspot once and switch to fallback within 20 seconds.
- If rollback is required, promote the last verified production deployment in Vercel, then run the strict release check before using it.
