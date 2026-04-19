---
title: TenderPath Site Diff — Polsia Reference (tenderpath.me) vs Vercel Build (tenderpath.vercel.app)
date: 2026-04-18
auditor: Claude Code
---

# Site Diff: Polsia Reference vs Vercel Build

## Overview

| Dimension | Polsia / tenderpath.me | Vercel Build |
|-----------|------------------------|--------------|
| Visual brand | Dark navy, gold accents, serif hero headings, cream/warm tones | Navy, gold — broadly matches but less refined spacing and contrast |
| Homepage sections | Hero → Social proof strip → Problem → How It Works → Features → Pricing → Testimonials → CTA | Hero → Challenge → How It Works → Services → Why Us → CTA |
| Social proof | Customer logo strip + 2–3 testimonial cards with names/companies | None |
| Pricing display | Three tiers at $49/$299/$999, middle tier badged "Most Popular" | Three tiers at $49/$199/$599 (WRONG), badge on highest tier (WRONG) |
| Assessment flow | Full assessment flow with matching results | Full assessment flow — functionally equivalent |
| Login/auth | Not shown in reference (auth is post-assessment) | Login exists but is unbranded |
| Footer | Minimal, branded, real links where applicable | 4-column grid but mostly placeholder `href="#"` |
| Mobile | Responsive, card collapses gracefully | Hero card overflows viewport on mobile |
| Copy/tone | More benefit-driven ("You're locked out of a $40B market") | Similar structure, slight variation in micro-copy |
| Illustrations/visuals | Uses iconography and subtle background textures | Flat, no illustrations, VendorReadinessCard as primary visual |

---

## Section-by-Section Comparison

### Navigation / Header

| Element | Polsia Reference | Vercel Build | Recommendation |
|---------|-----------------|--------------|----------------|
| Logo | TenderPath wordmark with gold Path | Same | Keep Vercel version |
| Nav links | The Challenge, How It Works, Pricing, Login | The Challenge, How It Works, Services, Why Us | Add "Pricing" as nav link; remove or rename "Why Us" → "Features" |
| Primary CTA | "Get Free Assessment" | "My Dashboard" → /assessment | **Fix Vercel**: change to "Free Assessment" |
| Sticky behavior | Sticky with shadow on scroll | Sticky, no scroll shadow | Add scroll shadow to Vercel |

### Hero

| Element | Polsia Reference | Vercel Build | Recommendation |
|---------|-----------------|--------------|----------------|
| Eyebrow | "$40B UN Market" | "$40B UN Market — You're Being Locked Out" | Keep Vercel (slightly more emotional) |
| H1 | "Qualified businesses lose millions in UN contracts they never even find." | Same | Keep |
| Sub-copy | More detailed value prop sentence | Similar | Keep Polsia sub-copy — slightly clearer |
| Primary CTA | "Run Free Assessment" | "See What You're Missing — Free" | Test both; Polsia's is clearer action |
| Secondary CTA | "See How It Works" | Same | Keep |
| Right column visual | Animated score card with live-like state | Static VendorReadinessCard labeled as example | **Vercel needs**: add "Sample Report" label; consider subtle animation |
| Social proof below CTAs | "Join 500+ vendors already matched" badge | None | **Add to Vercel** |

### Social Proof Strip (Polsia only)

Polsia reference includes a logo strip of UN agencies (UNDP, UNICEF, WFP, UNHCR, WHO) as buyer logos — positioned just below the hero fold, serving as an immediate credibility signal.

**Vercel build has no equivalent section.**

Recommendation: **Add** — this is a high-value trust signal. Even if TenderPath doesn't have a formal partnership with these agencies, framing as "Tenders from 190+ UN agencies including..." is accurate and adds authority.

### The Challenge / Problem

| Element | Polsia Reference | Vercel Build | Recommendation |
|---------|-----------------|--------------|----------------|
| Stat presentation | Animated counter on scroll | Static text | Add scroll-triggered count-up animation to Vercel |
| Problem cards | 3 cards, icon + heading + body | Same structure | Merge — Vercel version is well-structured |
| Source citation | Stats have footnote source | None | Add source footnote to Vercel |

### How It Works

| Element | Polsia Reference | Vercel Build | Recommendation |
|---------|-----------------|--------------|----------------|
| Step count | 4 steps | 4 steps | Same |
| Step labels | Slightly different wording | Similar | Minor difference, keep Vercel |
| Time claim | "Under 5 minutes" | "Under 5 minutes" | Align with assessment page which says "2 minutes" |
| Visual connector | Animated timeline line | Static horizontal numbering | Polsia treatment is more polished — adopt |

### Features / Why Us

| Element | Polsia Reference | Vercel Build | Recommendation |
|---------|-----------------|--------------|----------------|
| Section title | "Why TenderPath" | "Why Choose TenderPath" | Minor, keep either |
| Feature count | 6 features | 6 features | Same |
| Feature card style | Icon + title + body, subtle border | Same | Keep Vercel — nearly identical |

### Pricing / Services

| Element | Polsia Reference | Vercel Build | Recommendation |
|---------|-----------------|--------------|----------------|
| Tier 1 | Tender Intelligence — $49/mo | Same name, $49/mo | Match — correct |
| Tier 2 | Submission Package — $299/mo | Same name, **$199/mo** | **Fix Vercel to $299** |
| Tier 3 | Strategic Partnership — $999/mo | Same name, **$599/mo** | **Fix Vercel to $999** |
| "Most Popular" | Middle tier (Submission Package) | **Highest tier (Strategic Partnership)** | **Fix Vercel** — move badge to tier 2 |
| CTA per tier | "Start Free", "Get Started", "Contact Us" | All → /assessment | Adopt Polsia differentiated CTAs |
| Feature table | Horizontal comparison table below cards | None | **Add to Vercel** |

### Testimonials (Polsia only)

Polsia reference includes 2–3 testimonial cards with vendor name, company, country, and a 2-sentence quote about finding/winning a UN tender through TenderPath.

**Vercel build has no testimonials.**

Recommendation: **Add** — critical trust signal for B2B/procurement audience. Even placeholder testimonials with "Early Access" framing are better than none.

### CTA Section

| Element | Polsia Reference | Vercel Build | Recommendation |
|---------|-----------------|--------------|----------------|
| Headline | Similar urgency-driven copy | Similar | Keep |
| Primary CTA | "Start Your Free Assessment" | Same | Keep |
| Trust micro-copy | "Free — No credit card — Results in 2 minutes" | "...under 5 minutes" | Align to 2 minutes |
| Secondary CTA | "See Pricing" ghost link | None | Add ghost link |

### Footer

| Element | Polsia Reference | Vercel Build | Recommendation |
|---------|-----------------|--------------|----------------|
| Column structure | 3 columns: Brand, Product, Company | 4 columns: Brand, Product, Resources, Company | Vercel structure is better — keep |
| Link resolution | Most links go to real anchors or stubs | Most links are `href="#"` | **Fix Vercel** — resolve or remove placeholder links |
| Social links | LinkedIn icon | None | Add LinkedIn to Vercel |

---

## What to Keep from Polsia

1. Pricing: $49/$299/$999 with "Most Popular" on middle tier
2. Social proof logo strip (UN agency logos, framed as "Tenders from...")
3. Testimonial cards (add 2–3 real or illustrative testimonials)
4. Per-tier differentiated CTAs ("Start Free" / "Get Started" / "Contact Us")
5. Horizontal pricing comparison table
6. "Join X vendors" counter beneath hero CTAs
7. "2 minutes" time claim (consistent with assessment page)
8. Scroll-triggered stat animations

## What to Keep from Vercel

1. Dark navy + gold color system — well-implemented
2. AssessmentResults component — rich, unique, strong
3. VendorReadinessCard concept in hero — just needs "Sample" label
4. 4-column footer structure
5. Assessment form (multi-step, country picker) — solid UX
6. Overall component architecture (clean, modular)

## What to Discard / Replace

1. "My Dashboard" nav CTA label
2. $49/$199/$599 pricing on Services.tsx
3. "Most Popular" on highest tier
4. All `href="#"` footer links
5. Unbranded login page
6. Dev token exposure in login UI
7. Fabricated grant dimension breakdown in AssessmentResults

---

## Canonical Direction Recommendation

**Keep the Vercel codebase as the source of truth** — it's more complete and production-ready. Apply Polsia reference corrections to pricing, badge placement, social proof sections, and CTA labels. Do not rebuild from Polsia; selectively harvest its content improvements.
