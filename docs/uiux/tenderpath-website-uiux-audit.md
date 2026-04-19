---
title: TenderPath Website UI/UX Audit
scope: Public-facing website only (homepage, assessment flow, login, nav/footer)
date: 2026-04-18
auditor: Claude Code
severity-scale: CRITICAL > MAJOR > MINOR > POLISH
---

# TenderPath Website UI/UX Audit

## Executive Summary

TenderPath's Vercel build is a functional, visually coherent marketing site with a strong dark-navy/gold brand identity. The core conversion funnel (homepage → /assessment → results) works end-to-end. However, several trust-eroding and conversion-killing issues need resolution before the site can perform at its potential:

**Critical (4 issues)**
- Pricing shown on homepage ($49/$199/$599) does not match the pricing shown after the free assessment ($49/$299/$999) — a visitor who completes the assessment and is then upsold at a higher price will feel bait-and-switched.
- The primary nav CTA says "My Dashboard" but links to `/assessment` — a label that implies an account already exists, creating confusion for first-time visitors.
- The login page has no TenderPath branding whatsoever (plain gray/white, no logo, no navy/gold) — visitors arriving from assessment results feel they've left the product.
- Dev tokens are rendered in the login UI (`body._devToken`) — a security exposure that must not ship to production.

**Major (7 issues)**
- Most footer links are `href="#"` placeholders — clicking any resource or company link silently does nothing, destroying trust.
- The assessment form omits `orgType` and `devThemes` fields that the backend uses for matching, reducing match accuracy without explanation.
- HowItWorks says "under 5 minutes"; the assessment page says "Takes 2 minutes" — inconsistent promise erodes trust.
- "Most Popular" badge is on the highest-priced tier ($599/$999) instead of the middle tier — a well-known conversion anti-pattern.
- The VendorReadinessCard in the hero is a static mockup with no indication it is illustrative, not live data — visitors may feel deceived after assessment.
- No social proof anywhere — no testimonials, customer logos, case studies, or use counts.
- AssessmentResults grant dimensions are approximated from a single score rather than returned individually from the API — data presented as precise is partially fabricated.

**Minor / Polish (10+ issues)**
- See per-page findings below.

---

## Page-by-Page Findings

### 1. Homepage (`/`)

#### Navbar
| Severity | Issue | Component | Fix |
|----------|-------|-----------|-----|
| CRITICAL | CTA label "My Dashboard" links to `/assessment` — wrong label for a first-time visitor | `Navbar.tsx` | Change label to "Free Assessment" or "Get Started" |
| MINOR | Scroll-spy not implemented — nav links are plain anchors, no active state on scroll | `Navbar.tsx` | Add IntersectionObserver active highlight |
| POLISH | Nav border is `border-gray-100` (very subtle) — visually disconnects nav from content on white backgrounds | `Navbar.tsx` | Increase to `border-gray-200` or add subtle shadow |

#### Hero
| Severity | Issue | Component | Fix |
|----------|-------|-----------|-----|
| MAJOR | `VendorReadinessCard` is labeled nowhere as illustrative/demo data — visitors may think this is their own live score | `Hero.tsx`, `VendorReadinessCard.tsx` | Add "Example Report" or "Sample" label in gold/italic |
| MINOR | Primary CTA "See What You're Missing — Free" is clever but buries the action verb — A/B test against "Run Free Assessment" | `Hero.tsx` | A/B test copy |
| MINOR | No sub-headline social proof (e.g., "Join 400+ vendors already matched") | `Hero.tsx` | Add after primary CTA |
| POLISH | On mobile, VendorReadinessCard stacks below hero copy — it's a large card and pushes the CTA out of the viewport | `Hero.tsx` | Hide card on mobile (<md) or reduce to a teaser strip |

#### Challenge
| Severity | Issue | Component | Fix |
|----------|-------|-----------|-----|
| MINOR | Stats ($40B, 70%, 190+, 30K+) have no source citation — B2B audience may be skeptical | `Challenge.tsx` | Add footnote or "Source: UN procurement reports" |
| POLISH | Three problem cards use identical icon treatment — visual monotony, no visual hierarchy between problems | `Challenge.tsx` | Vary icon color or weight to suggest severity |

#### HowItWorks
| Severity | Issue | Component | Fix |
|----------|-------|-----------|-----|
| MAJOR | Step copy: "Takes under 5 minutes" conflicts with assessment page copy "Takes 2 minutes" | `HowItWorks.tsx` | Align to one number — "2 minutes" is shorter and more credible |
| MINOR | Step 4 ("Win With Confidence") has no concrete action/CTA — the section ends with a feeling, not a next step | `HowItWorks.tsx` | Add inline CTA after step 4 linking to /assessment |

#### Services (Pricing)
| Severity | Issue | Component | Fix |
|----------|-------|-----------|-----|
| CRITICAL | Prices shown: $49/$199/$599/mo — Assessment Results shows: $49/$299/$999/mo — inconsistent pricing between pages | `Services.tsx` | Align to a single source of truth; update Services.tsx to $49/$299/$999 |
| MAJOR | "Most Popular" badge on highest-priced tier ($599/mo) — optimal conversion practice is to badge the middle tier | `Services.tsx` | Move badge to middle tier ($299/mo "Submission Package") |
| MINOR | All three plan CTAs link to `/assessment` — users who already completed assessment may be confused | `Services.tsx` | Differentiate: "Start Free" for tier 1, "Get Started" for tier 2, "Contact Us" for tier 3 |
| MINOR | No per-feature comparison table — users must mentally compare bullets across three cards | `Services.tsx` | Add horizontal feature-row comparison below tier cards |

#### WhyUs
| Severity | Issue | Component | Fix |
|----------|-------|-----------|-----|
| MAJOR | No social proof anywhere on the page — no logos, no testimonials, no case studies, no counts | `WhyUs.tsx` | Add at least 2–3 testimonial cards with name/company/country or a logo strip |
| MINOR | "Procurement Experts" card has no concrete credential — vague | `WhyUs.tsx` | Add "Team includes ex-UNDP, UNICEF procurement officers" or similar |

#### CTA Section
| Severity | Issue | Component | Fix |
|----------|-------|-----------|-----|
| MINOR | Trust line says "Results in under 5 minutes" — inconsistent with "2 minutes" on assessment page | `CTA.tsx` | Align to "2 minutes" |
| POLISH | Section has only one CTA button — consider adding a secondary "See Pricing" link | `CTA.tsx` | Add ghost button "See Pricing" → #services |

#### Footer
| Severity | Issue | Component | Fix |
|----------|-------|-----------|-----|
| MAJOR | 11 of 15 footer links are `href="#"` placeholders — clicking silently fails | `Footer.tsx` | Resolve or remove placeholder links; stub pages or use `mailto:` for Contact |
| MINOR | No social links (LinkedIn, Twitter/X) — common trust signal for B2B SaaS | `Footer.tsx` | Add social icons |
| MINOR | Copyright is left-aligned on large screens but center-aligned on mobile — not intentional | `Footer.tsx` | Consistent `text-center` |

---

### 2. Assessment Form (`/assessment`)

| Severity | Issue | Component | Fix |
|----------|-------|-----------|-----|
| MAJOR | Form missing `orgType` and `devThemes` fields used by backend matcher — reduces match quality silently | `assessment/page.tsx` | Add optional selectors for org type (NGO/Private/Government) and development themes (Health, Education, etc.) |
| MAJOR | Subheading says "Takes 2 minutes" — HowItWorks says "under 5 minutes" — inconsistent | `assessment/page.tsx` | Align across site |
| MINOR | Nav CTA says "Get Assessment" on the same page as the assessment form — redundant | `assessment/page.tsx` | Replace with "How It Works" or remove inline nav on this page |
| MINOR | No progress indicator for form fields (e.g., "Step 1 of 1") — step indicators at top show steps 1/2/3 but step 1 has no internal validation progress | `assessment/page.tsx` | Show green checkmarks next to filled required fields |
| MINOR | Country dropdown `onBlur` uses `setTimeout(..., 150)` — fast tabbing can cause dropdown to close before mousedown fires | `assessment/page.tsx` | Use `relatedTarget` check instead of timeout |
| POLISH | No character count on description textarea | `assessment/page.tsx` | Add `maxLength={500}` with counter |

---

### 3. Assessment Results (`/assessment` step 3)

| Severity | Issue | Component | Fix |
|----------|-------|-----------|-----|
| MAJOR | Grant readiness dimensions are approximated from total score (frontend hack) — not returned by API | `AssessmentResults.tsx` | Either fetch real grant dimensions from API or remove the breakdown and show only the aggregate score with a note |
| MAJOR | Pricing in TIER_INFO ($49/$299/$999) does not match Services.tsx ($49/$199/$599) — one will always be wrong | `AssessmentResults.tsx` | Align pricing to single source; update Services.tsx to match |
| MINOR | "Go to my dashboard →" CTA at bottom links to `/login?next=/dashboard` — this works but after completing assessment the visitor likely wants to see value before logging in, not immediately redirect | `AssessmentResults.tsx` | Keep CTA but add a "Save and continue later" framing |
| MINOR | Tier upsell card selection is purely visual with no "Select Plan" action — clicking a tier card does nothing | `AssessmentResults.tsx` | Add onClick to tier cards that redirects to `/login?plan=<slug>` |
| POLISH | Print/export functionality absent — results page is high-value; users want to share it internally | `AssessmentResults.tsx` | Add "Download PDF" or "Share Report" button |

---

### 4. Login Page (`/login`)

| Severity | Issue | Component | Fix |
|----------|-------|-----------|-----|
| CRITICAL | Page has no TenderPath branding — white/gray card on gray-50 background, no logo, no navy/gold | `login/page.tsx` | Apply navy background, gold accents, show TenderPath logo; match visual language of assessment flow |
| CRITICAL | `devToken` rendered in UI: `Dev token: <code>{devToken}</code>` — must be removed or gated to localhost-only | `login/page.tsx` | Remove or gate: `process.env.NODE_ENV === 'development'` |
| MINOR | No back-link to homepage or assessment from login page | `login/page.tsx` | Add `← Back` link |
| MINOR | "14-day free trial. No credit card required." — this copy is good but not connected to what the visitor just completed | `login/page.tsx` | Contextualize: "Save your assessment results — free for 14 days" |
| MINOR | Pasting token manually is an unusual UX pattern — most magic link flows auto-verify via URL param | `login/page.tsx` | Consider implementing auto-verify via query param in email link |

---

## Summary Severity Count

| Severity | Count |
|----------|-------|
| CRITICAL | 4 |
| MAJOR | 11 |
| MINOR | 16 |
| POLISH | 6 |

Total issues identified: **37**
