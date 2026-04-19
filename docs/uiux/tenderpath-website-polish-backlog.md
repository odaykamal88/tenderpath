---
title: TenderPath Website Polish Backlog
date: 2026-04-18
format: Prioritized implementation backlog
---

# TenderPath Website Polish Backlog

Severity: CRITICAL > MAJOR > MINOR > POLISH
Effort: S = hours, M = 1–2 days, L = 3+ days

---

## P0 — Critical (Ship Blockers)

| # | Issue | Why It Matters | Severity | Effort | Component |
|---|-------|---------------|----------|--------|-----------|
| ~~P0-1~~ | ~~Fix pricing inconsistency~~ | **RESOLVED 2026-04-18** — New 4-tier model implemented. Single source of truth: `src/lib/pricing.ts`. Services.tsx and AssessmentResults both import from it. Old 3-tier prices removed. | RESOLVED | — | `src/lib/pricing.ts` |
| ~~P0-2~~ | ~~Fix nav CTA: "My Dashboard" → "Free Assessment"~~ | **RESOLVED 2026-04-18** — Both desktop and mobile nav updated. | RESOLVED | — | `Navbar.tsx` |
| ~~P0-3~~ | ~~Brand the login page with navy bg, logo, gold accents~~ | **RESOLVED 2026-04-18** — Login page now uses navy bg, navy-light card, gold accents, TenderPath logo, and back-link. | RESOLVED | — | `login/page.tsx` |
| ~~P0-4~~ | ~~Remove dev token from login UI~~ | **RESOLVED 2026-04-18** — Dev token now gated to `process.env.NODE_ENV === "development"` only. | RESOLVED | — | `login/page.tsx` |

---

## P1 — Major (High-Impact, Pre-Launch)

| # | Issue | Why It Matters | Severity | Effort | Component |
|---|-------|---------------|----------|--------|-----------|
| P1-1 | Fix footer: resolve or remove all `href="#"` placeholder links | Clicking 11/15 footer links silently fails; destroys trust signal | MAJOR | S | `Footer.tsx` |
| P1-2 | Move "Most Popular" badge from tier 3 to tier 2 ($299 Submission Package) | Conversion best practice; badging the highest tier implies it's the default, not aspirational | MAJOR | S | `Services.tsx` |
| P1-3 | Add social proof section: logo strip + testimonials | No credibility signal on entire site; B2B buyers require proof | MAJOR | L | New section component |
| P1-4 | Label VendorReadinessCard as "Sample Report" | Visitors may feel deceived if they expect the card to be their result | MAJOR | S | `VendorReadinessCard.tsx` |
| P1-5 | Align time claim across site: use "2 minutes" everywhere | HowItWorks says "5 min", assessment page says "2 min", CTA says "5 min" — inconsistency erodes trust | MAJOR | S | `HowItWorks.tsx`, `CTA.tsx` |
| P1-6 | Fix AssessmentResults grant dimensions: remove approximated breakdown or fetch real data | Showing fabricated precision on a data-driven results page is a trust failure | MAJOR | M | `AssessmentResults.tsx`, API |
| P1-7 | Add assessment form fields: orgType and devThemes | Missing fields reduce match quality; users who know procurement care about development themes | MAJOR | M | `assessment/page.tsx` |

---

## P2 — Minor (Quality Improvements)

| # | Issue | Why It Matters | Severity | Effort | Component |
|---|-------|---------------|----------|--------|-----------|
| P2-1 | Differentiate per-tier CTAs: "Start Free" / "Get Started" / "Contact Us" | All three going to /assessment is confusing for repeat visitors | MINOR | S | `Services.tsx` |
| P2-2 | Add pricing comparison feature table below tier cards | Users can't easily compare plans without scrolling back and forth | MINOR | M | `Services.tsx` |
| P2-3 | Add source citation to Challenge stats ($40B, 70%, 190+, 30K+) | B2B/procurement audience is skeptical of unsourced claims | MINOR | S | `Challenge.tsx` |
| P2-4 | Add "Pricing" as explicit nav link | Pricing is the most sought page for evaluating SaaS — should be one click from anywhere | MINOR | S | `Navbar.tsx` |
| P2-5 | Add social proof micro-copy beneath hero CTAs ("Join 400+ vendors matched") | Reduces friction at top-of-funnel; first-time visitors need a nudge | MINOR | S | `Hero.tsx` |
| P2-6 | Add scroll shadow to sticky nav | Visual cue that page has scrolled; standard pattern for sticky navs | MINOR | S | `Navbar.tsx` |
| P2-7 | Add inline CTA after HowItWorks step 4 | Step 4 ends with "Win With Confidence" — a natural moment to convert | MINOR | S | `HowItWorks.tsx` |
| P2-8 | Add "← Back to TenderPath" link on login page | No escape route from login if visitor changed mind | MINOR | S | `login/page.tsx` |
| P2-9 | Make tier selection in AssessmentResults interactive | Clicking a tier card currently does nothing; should redirect to `/login?plan=<slug>` | MINOR | S | `AssessmentResults.tsx` |
| P2-10 | Contextualize login page copy: "Save your results — free for 14 days" | Current copy ("14-day free trial") is generic; personalize to assessment completion | MINOR | S | `login/page.tsx` |
| P2-11 | Fix country dropdown `onBlur` race condition (setTimeout 150ms) | Fast tabbing can close dropdown before mousedown fires | MINOR | S | `assessment/page.tsx` |
| P2-12 | Add credential note to "Procurement Experts" WhyUs card | "Procurement Experts" is vague without evidence | MINOR | S | `WhyUs.tsx` |

---

## P3 — Polish (Nice to Have)

| # | Issue | Why It Matters | Severity | Effort | Component |
|---|-------|---------------|----------|--------|-----------|
| P3-1 | Add scroll-triggered count-up animation to Challenge stats | Standard premium pattern for stat-heavy sections | POLISH | S | `Challenge.tsx` |
| P3-2 | Hide VendorReadinessCard on mobile or reduce to teaser | Card overflows viewport on small screens, pushing CTA below fold | POLISH | S | `Hero.tsx` |
| P3-3 | Add print/share button to AssessmentResults | High-value report; users want to share with colleagues | POLISH | M | `AssessmentResults.tsx` |
| P3-4 | Add social links to footer (LinkedIn) | B2B trust signal | POLISH | S | `Footer.tsx` |
| P3-5 | Add character counter to description textarea in assessment form | UX courtesy for open-text fields | POLISH | S | `assessment/page.tsx` |
| P3-6 | Add animated timeline connector to HowItWorks | Polsia reference uses this — more polished visual hierarchy | POLISH | M | `HowItWorks.tsx` |
| P3-7 | Add secondary "See Pricing" ghost CTA to bottom CTA section | Give pricing-curious visitors an alternative path at bottom of page | POLISH | S | `CTA.tsx` |

---

## Backlog Summary

| Priority | Items | Total Effort |
|----------|-------|-------------|
| P0 Critical | 4 | ~1 day |
| P1 Major | 7 | ~1 week |
| P2 Minor | 12 | ~3–4 days |
| P3 Polish | 7 | ~2–3 days |

**Recommended sprint order**: P0 all → P1-1, P1-2, P1-5 (quick wins) → P1-3 (social proof, long pole) → remaining P1 → P2 batch.
