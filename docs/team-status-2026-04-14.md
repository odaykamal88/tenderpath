# Tenderpath — Team Status Report

**Date:** 2026-04-14
**Author:** Engineering (Claude-assisted)
**Audience:** Team review → come back with next-wave priorities

---

## 1. Where we are today

Tenderpath's crawler layer now pulls **live, deduplicated opportunities from 6 sources** with a clear path to unlock ~10 more. The scariest blocker — Cloudflare bot protection on UN-run sites — is **solved** via a dedicated browser-rendering Worker, which also unblocks UNICEF, UNHCR, IOM, AfDB, IDB, and ADB on the same plumbing.

### Live sources (Tier-1, public, no paid credentials)

| Source | Status | Typical volume | Notes |
|---|---|---|---|
| **TED EU** | ✅ live | ~300 notices / run | EU-wide, 2.7s |
| **UK Find-a-Tender** | ✅ live | ~36 notices / run | Fast, stable |
| **World Bank** | ✅ live | ~600 notices / run | Largest single source |
| **SAM.gov** | ✅ live | ~300 notices / run | API key in `.env.local` ✅ |
| **UNDP** | ✅ live | ~17 notices / run | Rewritten this session (site had changed) |
| **UNGM** *(gateway to ~40 UN agencies)* | ✅ plumbing proven, full crawl pending first run | ~500 notices / run expected | Runs through browser Worker |
| **ReliefWeb** | ⏸️ blocked on free appname | ~100s/day | Needs one email to apidoc.reliefweb.int |

### Infrastructure shipped this session

- **Cloudflare Browser-Rendering Worker** — deployed at `https://crawler.tenderpath.me/fetch`
  - Auth via `X-Crawler-Key` shared secret (stored in Cloudflare, mirrored in `.env.local`)
  - Custom domain live on tenderpath.me zone
  - Observability + logs enabled (`wrangler tail` for debugging)
  - `@cloudflare/puppeteer@^1.0.2`, wrangler v4
- **`_browser.ts` helper** — all bot-protected crawlers funnel through a single client
- **Graceful degradation** — if Worker env vars are missing, UNGM returns a clean "not configured" failure instead of crashing the pipeline

---

## 2. What changed in this session

1. **UNDP crawler rewritten** — old endpoint (`/view_notices.cfm`) 404s. Switched to homepage scrape with labelled-cell regex parser + month-name date handler. **17 live notices.**
2. **SAM.gov API key** wired in and verified (300 notices).
3. **Cloudflare Browser-Rendering Worker built and deployed.** Cost of being careful: this took most of the day (see §4 concerns).
4. **UNGM crawler migrated** to the browser path; graceful-fail wrapper added.
5. **`_browser.ts` shared client** — the same helper will serve UNICEF, UNHCR, IOM, AfDB, IDB, ADB with zero new infra.

---

## 3. What is NOT done yet

- **End-to-end UNGM live run** — plumbing passes the `httpbin.org` sanity check (returned status 200 with real Chrome TLS fingerprint). The full UNGM crawl was kicked off but not yet observed to completion. First pass is expected to take 60–120s because of browser cold-start + 5 sequential pages. **This is the first thing to confirm on Monday.**
- **ReliefWeb appname** — one email, one day delay. Owner: whoever checks email first.
- **UNICEF / UNHCR / IOM / AfDB / IDB / ADB crawlers** — all unblocked by the Worker, none written yet. Each is a ~1–2 hour job using `_browser.ts` as a template.
- **Landing-page navbar** — still showing signed-in state when logged out. (Carry-over from prior session.)
- **Schema reconciliation** — `scripts/migrate.mjs` and `initializeDatabase()` have drifted; needs one sit-down to unify. (Carry-over.)

---

## 4. Concerns and worries (read this section)

### 🟡 Cloudflare Browser-Rendering is on a free/limited tier
The Worker runs on Cloudflare's Browser Rendering binding, which gives us roughly **10 minutes of browser time per day on the free tier**. One UNGM run uses ~60–120s of that budget. UNICEF/UNHCR/IOM/AfDB/IDB/ADB will each add similar cost. **Napkin math: 7 bot-protected sources × ~2 min = ~14 min/day → we will exceed the free cap once we're fully rolled out.**

**Decision to make this week:** do we (a) upgrade to Workers Paid ($5/mo + browser usage), (b) stagger crawls across days, or (c) consolidate into one daily "big run" that shares a browser instance? I recommend **(a)** — $5/mo is noise against the business case and removes an entire class of operational fragility.

### 🟡 UNGM first run not yet observed end-to-end
Everything technically proves out up to the Worker returning a real HTTP 200 from an arbitrary URL. But until we watch UNGM actually return live notices, there is non-zero risk that UNGM-specific anti-bot logic (CAPTCHAs, JS challenges beyond Cloudflare's layer) will still block us. **Contingency if UNGM still fights back:** fall back to the email-inbox crawler (we already have `info@tenderpath.me` UNGM credentials with daily opportunity emails).

### 🟡 Crawl reliability vs. freshness tradeoff
We currently run crawlers on-demand. For a credible product we need a scheduler — probably a Cloudflare Cron Trigger or a Vercel cron that hits an internal endpoint daily at 06:00 UTC. **This is not built.** Without it, data goes stale and we look bad.

### 🟢 Data volume already strong
With just today's live sources we pull **~1,250 opportunities per run** before UNGM/UN-agency expansion. The coverage problem is basically solved for public tenders; the remaining work is quality (dedup, classification, translation) more than quantity.

### 🔴 Secrets hygiene — one-time debt
During debugging we pasted the worker shared secret into several terminals. It is in Cloudflare secrets and `.env.local` only — not in git — but **we should rotate it once before production launch** (30-second job). `.env.local` lines got duplicated during setup; not harmful (last-wins) but worth a cleanup.

### 🟢 No new technical debt introduced
The session did not cut corners on type safety, error boundaries, or the graceful-fail pattern. `_browser.ts` is the only new shared abstraction and it's ~70 lines.

---

## 5. Suggested path for the next waves

### Wave 1 — Harden what we shipped (this week)
- [ ] Confirm UNGM end-to-end with a live run; capture sample output
- [ ] Request ReliefWeb appname (1-line email)
- [ ] Decide on Workers Paid ($5/mo) vs. free-tier stagger
- [ ] Dedupe `.env.local`; rotate `CRAWLER_KEY` once
- [ ] Build the cron scheduler (daily 06:00 UTC) — probably `/api/cron/crawl` + Vercel cron

### Wave 2 — UN family expansion (next week)
Using `_browser.ts` as the template, stand up crawlers for:
- [ ] UNICEF Supply Portal
- [ ] UNHCR procurement
- [ ] IOM
- [ ] AfDB (African Development Bank)
- [ ] IDB (Inter-American Development Bank)
- [ ] ADB (Asian Development Bank)

Each is a bounded ~1–2 hour task; can be parallelized.

### Wave 3 — Product-facing polish
- [ ] Fix landing-page navbar (logged-out state)
- [ ] Reconcile schema: `scripts/migrate.mjs` vs `initializeDatabase()`
- [ ] Deduplication across sources (e.g., UNGM + UNICEF Supply for the same tender)
- [ ] Opportunity classification / tagging pass (LLM? rules?)

### Wave 4 — Tier-2 paid sources (quarter-long)
- Dev/IDB Business, SCANMARKET, TenderNed, AusTender, CanadaBuys paid tiers, etc.
- Only after Wave 1–3 are solid. Paid APIs are easy; the hard problem was bot-protected free sources, and that's done.

---

## 6. Asks for the team

1. **Approve or decline Workers Paid upgrade** ($5/mo) — unblocks Wave 2
2. **Who owns the cron-scheduler story?** — needed before we can call crawling "production"
3. **Classification/tagging strategy** — LLM-based enrichment or rule-based? This drives infra costs
4. **Product side:** is there anything in the roadmap that needs a *different* data source we haven't identified yet? (e.g., private-sector RFPs, foundation grants, EU Horizon) — better to surface it now than after Wave 2

---

**TL;DR:** We went from "UN data is unreachable because of Cloudflare" to "we have a production browser-rendering pipeline, one UN source proven, and six more that slot in trivially." The next session's first 10 minutes should be watching UNGM return real notices live. Then we decide Paid-tier and start Wave 2.
